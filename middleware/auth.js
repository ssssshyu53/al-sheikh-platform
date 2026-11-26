const crypto = require('node:crypto');
const { db } = require('../database');
const {
  JWT_SECRET,
  STREAM_TICKET_SECRET,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_EXPIRES_IN_SECONDS,
  STREAM_TICKET_TTL_SECONDS,
  parseRequestUrl
} = require('../lib/constants');
const { parseCookies, sendJson } = require('./security');

function createToken(user) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    sub: String(user.id),
    id: user.id,
    role: user.role,
    ver: user.token_version || 1,
    jti: crypto.randomUUID(),
    iat: nowSec,
    exp: nowSec + JWT_EXPIRES_IN_SECONDS
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    if (!headerB64 || !bodyB64 || !sigB64) return null;

    // Verify HMAC signature BEFORE parsing untrusted JSON header/payload
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${bodyB64}`).digest('base64url');
    const sigBuf = Buffer.from(sigB64, 'utf8');
    const expBuf = Buffer.from(expectedSig, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (!header || header.alg !== 'HS256') return null;

    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || payload.iss !== JWT_ISSUER || payload.aud !== JWT_AUDIENCE) return null;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || nowSec > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createStreamTicket(userId, lessonId, deviceId) {
  const exp = Math.floor(Date.now() / 1000) + STREAM_TICKET_TTL_SECONDS;
  const data = `${userId}:${lessonId}:${deviceId || 'admin'}:${exp}`;
  const sig = crypto.createHmac('sha256', STREAM_TICKET_SECRET).update(data).digest('base64url');
  return Buffer.from(`${data}:${sig}`).toString('base64url');
}

function verifyStreamTicket(ticket, expectedUserId, expectedLessonId, expectedDeviceId) {
  if (!ticket || typeof ticket !== 'string') return false;
  try {
    const decoded = Buffer.from(ticket, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 5) return false;
    const [uId, lId, devId, expStr, sig] = parts;
    if (!uId || !lId || !devId || !expStr || !sig) return false;
    if (Number(uId) !== Number(expectedUserId) || Number(lId) !== Number(expectedLessonId)) return false;
    const expNum = Number(expStr);
    if (!Number.isFinite(expNum) || Math.floor(Date.now() / 1000) > expNum) return false;
    if (!expectedDeviceId || devId !== String(expectedDeviceId)) return false;

    const data = `${uId}:${lId}:${devId}:${expStr}`;
    const expectedSig = crypto.createHmac('sha256', STREAM_TICKET_SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function getAuthUser(req) {
  const urlObj = parseRequestUrl(req);
  if (!urlObj) return null;
  if (urlObj.searchParams.has('token')) {
    return { _queryTokenRejected: true };
  }

  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const cookies = parseCookies(req);
  const cookieToken = cookies.matn_access_token || null;

  const token = bearerToken || cookieToken;
  if (!token) return null;

  if (!bearerToken && cookieToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const csrfCookie = String(cookies.matn_csrf_token || '');
    const csrfHeader = String(req.headers['x-csrf-token'] || '');
    const cBuf = Buffer.from(csrfCookie, 'utf8');
    const hBuf = Buffer.from(csrfHeader, 'utf8');
    if (!csrfCookie || !csrfHeader || cBuf.length !== hBuf.length || !crypto.timingSafeEqual(cBuf, hBuf)) {
      return { _csrfMismatch: true };
    }
  }

  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await db.get(
    `SELECT id, full_name, phone, parent_phone, role, grade, branch, token_version,
            is_locked, is_whatsapp_verified, device_id, device_name, device_locked_at,
            device_reset_requested, subscription_expires_at, subscribed_subjects, created_at
     FROM users WHERE id = ?`,
    [payload.id]
  );
  if (!user) return null;
  if (user.is_locked) return { ...user, _accountLocked: true };
  if (typeof payload.ver !== 'number' || payload.ver !== user.token_version) return null;

  if (user.role === 'student') {
    const cookieDeviceId = String(cookies.matn_device_binding || '').trim();
    const headerDeviceId = String(req.headers['x-device-id'] || '').trim();
    const clientDeviceId = cookieDeviceId || headerDeviceId;
    if (!user.device_id || !clientDeviceId || user.device_id !== clientDeviceId) {
      return { ...user, _deviceMismatch: true };
    }
  }

  return user;
}

async function requireAuth(req, res, options = { adminOnly: false }) {
  const user = await getAuthUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: 'يرجى تسجيل الدخول للمتابعة.' });
    return null;
  }
  if (user._queryTokenRejected) {
    sendJson(req, res, 400, { error: 'لا يُسمح بإرسال رمز الجلسة (Token) في الرابط (Query String).' });
    return null;
  }
  if (user._csrfMismatch) {
    sendJson(req, res, 403, { error: 'فشل التحقق من رمز الحماية CSRF.' });
    return null;
  }
  if (user._accountLocked) {
    sendJson(req, res, 403, { error: 'هذا الحساب موقوف. يرجى مراجعة إدارة المنصة.' });
    return null;
  }
  if (user._deviceMismatch) {
    sendJson(req, res, 403, {
      error_code: 'DEVICE_LOCKED',
      error: 'هذا الحساب مرتبط بجهاز آخر أو لم يتم تقديم معرف الجهاز المعتمد.'
    });
    return null;
  }
  if (user.role === 'student' && !user.is_whatsapp_verified) {
    sendJson(req, res, 403, {
      error_code: 'WHATSAPP_NOT_VERIFIED',
      error: 'يرجى تأكيد رقم الواتساب أولاً.'
    });
    return null;
  }
  if (options.adminOnly && user.role !== 'admin') {
    sendJson(req, res, 403, { error: 'هذه الصلاحية مخصصة لحساب الأدمن فقط.' });
    return null;
  }
  return user;
}

module.exports = {
  createToken,
  verifyToken,
  createStreamTicket,
  verifyStreamTicket,
  getAuthUser,
  requireAuth
};
