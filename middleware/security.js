const net = require('node:net');
const {
  IS_PROD,
  TRUSTED_PROXY_COUNT,
  JWT_EXPIRES_IN_SECONDS,
  safeDecode
} = require('../lib/constants');

function normalizeRemoteIp(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '127.0.0.1';
  if (trimmed.startsWith('::ffff:')) {
    const mapped = trimmed.slice(7);
    if (net.isIPv4(mapped)) return mapped;
  }
  return trimmed;
}

function isTrustedProxyAddress(rawIp) {
  const ip = normalizeRemoteIp(rawIp);
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    if (octets[0] === 127 || octets[0] === 10) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}

const rateLimitStore = new Map();
const MAX_RATE_LIMIT_KEYS = 50000;

function checkRateLimit(bucketKey, maxRequests, windowMs) {
  const now = Date.now();
  const isNewKey = !rateLimitStore.has(bucketKey);
  if (isNewKey && rateLimitStore.size >= MAX_RATE_LIMIT_KEYS) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (oldestKey !== undefined) rateLimitStore.delete(oldestKey);
  }

  const entry = rateLimitStore.get(bucketKey) || { timestamps: [], windowMs };
  entry.windowMs = windowMs;
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  if (entry.timestamps.length >= maxRequests) {
    rateLimitStore.delete(bucketKey);
    rateLimitStore.set(bucketKey, entry);
    return false;
  }
  entry.timestamps.push(now);
  rateLimitStore.delete(bucketKey);
  rateLimitStore.set(bucketKey, entry);
  return true;
}

function getClientIp(req) {
  const remote = normalizeRemoteIp(req.socket?.remoteAddress || '127.0.0.1');
  if (TRUSTED_PROXY_COUNT > 0 && isTrustedProxyAddress(remote)) {
    const xff = req.headers['x-forwarded-for'];
    if (xff && typeof xff === 'string') {
      const parts = xff.split(',').map((s) => normalizeRemoteIp(s)).filter(Boolean);
      if (parts.length > 0) {
        const idx = Math.max(0, parts.length - TRUSTED_PROXY_COUNT);
        const candidate = parts[idx];
        if (candidate && candidate.length <= 45 && net.isIP(candidate) !== 0) {
          return candidate;
        }
      }
    }
  }
  return (remote.length <= 45 && net.isIP(remote) !== 0) ? remote : '127.0.0.1';
}

function parseCookies(req) {
  const list = Object.create(null);
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return;
    const val = safeDecode(parts.join('='), '');
    list[key] = val;
  });
  return list;
}

function isCrossSiteHttpsRequest(req) {
  if (!req || !req.headers) return false;
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = proto.includes('https') || Boolean(req.socket && req.socket.encrypted);
  if (!isHttps) return false;
  const secDest = String(req.headers['sec-fetch-dest'] || '').toLowerCase();
  const secSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  return secDest === 'iframe' || secSite === 'cross-site' || Boolean(process.env.APPLET_ID);
}

function buildAuthCookies(token, csrfToken, deviceId, req = null) {
  const crossSiteHttps = isCrossSiteHttpsRequest(req);
  const sameSiteAttr = crossSiteHttps ? 'SameSite=None; Secure; Partitioned' : `SameSite=Lax${IS_PROD ? '; Secure' : ''}`;
  const cookies = [
    `matn_access_token=${encodeURIComponent(token)}; HttpOnly; Path=/; ${sameSiteAttr}; Max-Age=${JWT_EXPIRES_IN_SECONDS}`,
    `matn_csrf_token=${encodeURIComponent(csrfToken)}; Path=/; ${sameSiteAttr}; Max-Age=${JWT_EXPIRES_IN_SECONDS}`
  ];
  if (deviceId) {
    cookies.push(`matn_device_binding=${encodeURIComponent(deviceId)}; HttpOnly; Path=/; ${sameSiteAttr}; Max-Age=31536000`);
  }
  return cookies;
}

function clearAuthCookies(req = null) {
  const crossSiteHttps = isCrossSiteHttpsRequest(req);
  const sameSiteAttr = crossSiteHttps ? 'SameSite=None; Secure; Partitioned' : `SameSite=Lax${IS_PROD ? '; Secure' : ''}`;
  return [
    `matn_access_token=; HttpOnly; Path=/; ${sameSiteAttr}; Max-Age=0`,
    `matn_csrf_token=; Path=/; ${sameSiteAttr}; Max-Age=0`
  ];
}

function getSecurityHeaders(req, extraHeaders = {}) {
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const requestOrigin = req.headers.origin;
  let corsOrigin = '';
  if (requestOrigin) {
    if (allowedOrigins.includes(requestOrigin)) {
      corsOrigin = requestOrigin;
    } else if (!IS_PROD) {
      corsOrigin = requestOrigin;
    }
  }

  const allowPreviewFrame = !IS_PROD || Boolean(process.env.APPLET_ID);
  const frameAncestors = allowPreviewFrame
    ? "'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com https://*.run.app"
    : "'self'";

  return {
    'X-Content-Type-Options': 'nosniff',
    ...(allowPreviewFrame ? {} : { 'X-Frame-Options': 'SAMEORIGIN' }),
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'self' https://iframe.mediadelivery.net; connect-src 'self'; frame-ancestors ${frameAncestors};`,
    ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
    ...(corsOrigin ? {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token, X-Device-Id, X-Device-Name, X-File-Name, X-Upload-Type, X-Upload-Id, X-Chunk-Index, X-Total-Chunks, X-Stream-Ticket',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    } : {}),
    ...extraHeaders
  };
}

function sendJson(req, res, status, data, extraHeaders = {}) {
  res.writeHead(status, getSecurityHeaders(req, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...extraHeaders
  }));
  res.end(JSON.stringify(data));
}

function parseBody(req, maxBytes = 1 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('حجم البيانات المرسلة يتجاوز الحد المسموح به.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('صيغة البيانات JSON غير صالحة.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  rateLimitStore,
  MAX_RATE_LIMIT_KEYS,
  checkRateLimit,
  getClientIp,
  parseCookies,
  buildAuthCookies,
  clearAuthCookies,
  getSecurityHeaders,
  sendJson,
  parseBody
};
