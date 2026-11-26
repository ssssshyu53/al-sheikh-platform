const { loadEnvFile } = require('./lib/env');
loadEnvFile();

const { resolveDbClient } = require('./db/adapter');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 20) {
  console.error(`FATAL ERROR: Node.js >= 20.0.0 is required (current: v${process.versions.node}).`);
  process.exit(1);
}
if (resolveDbClient() === 'sqlite') {
  if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 13)) {
    console.error(`FATAL ERROR: Node.js >= 22.13.0 is required for DB_CLIENT=sqlite (current: v${process.versions.node}). Set DB_CLIENT=mysql for Node 20+.`);
    process.exit(1);
  }
  try {
    require('node:sqlite');
  } catch {
    console.error('FATAL ERROR: Built-in module node:sqlite is not available in this Node.js runtime.');
    process.exit(1);
  }
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { db, initDatabase } = require('./database');
const {
  NODE_ENV,
  PORT,
  HOST,
  WEEKLY_REPORT_DELAY_MS,
  HAS_WHATSAPP_GATEWAY,
  isBotPullConfigured,
  parseRequestUrl
} = require('./lib/constants');
const {
  getCairoDateTimeParts,
  isFridayThreePmCairo,
  queueWeeklyReportsForWeek,
  processWeeklyReportQueue
} = require('./lib/weekly-reports');
const {
  rateLimitStore,
  getClientIp,
  getSecurityHeaders,
  sendJson
} = require('./middleware/security');
const {
  createToken,
  verifyToken,
  createStreamTicket,
  verifyStreamTicket
} = require('./middleware/auth');
const { cleanupStaleLoginAttempts } = require('./services/audit');
const { dispatchWhatsApp } = require('./services/whatsapp');
const { getPlatformSetting } = require('./services/gating');
const { activeUploads, pipeStreamSafely, streamFileWithRange } = require('./services/media');

const { handlePublicRoutes } = require('./routes/public');
const { handleAuthRoutes } = require('./routes/auth');
const { handleStudentRoutes } = require('./routes/student');
const { handleMediaRoutes } = require('./routes/media');
const { handleAssessmentRoutes } = require('./routes/assessments');
const { handleNotificationRoutes } = require('./routes/notifications');
const { handleLiveRoutes } = require('./routes/live');
const { handleAdminRoutes } = require('./routes/admin');
const { handleBotRoutes } = require('./routes/bot');

// Periodic cleanup of expired rate-limit buckets, incomplete uploads, and stale login attempts (>24h)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimitStore.entries()) {
    const win = v.windowMs || 15 * 60 * 1000;
    const active = v.timestamps.filter((t) => now - t < win);
    if (active.length === 0) rateLimitStore.delete(k);
    else v.timestamps = active;
  }
  for (const [uid, meta] of activeUploads.entries()) {
    if (now - (meta.createdAt || now) > 30 * 60 * 1000) {
      try {
        if (fs.existsSync(meta.fullPath)) fs.unlinkSync(meta.fullPath);
      } catch {}
      activeUploads.delete(uid);
    }
  }
  cleanupStaleLoginAttempts(now).catch(() => {});
}, 5 * 60 * 1000).unref();

// Friday >= 3:00 PM (Africa/Cairo) Sequential Parent Report Scheduler
if (NODE_ENV !== 'test') {
  setInterval(async () => {
    try {
      await initDatabase();
      const nowDate = new Date();
      const cairo = getCairoDateTimeParts(nowDate);
      if (cairo.weekday !== 'Fri' || cairo.hour < 15) return;
      if ((await getPlatformSetting('auto_friday_reports_enabled', '1')) !== '1') return;
      const { weekKey } = await queueWeeklyReportsForWeek(db, { now: nowDate });
      if (!HAS_WHATSAPP_GATEWAY && isBotPullConfigured()) {
        // Keep rows in 'pending' so the teacher's laptop Pull Worker claims them
        return;
      }
      const pendingRow = await db.get(
        `SELECT COUNT(*) AS c FROM weekly_parent_reports WHERE week_key = ? AND status = 'pending'`,
        [weekKey]
      );
      if ((pendingRow?.c || 0) > 0) {
        await processWeeklyReportQueue({
          db,
          weekKey,
          dispatchWhatsApp,
          hasGateway: HAS_WHATSAPP_GATEWAY,
          delayMs: WEEKLY_REPORT_DELAY_MS
        });
      }
    } catch {}
  }, 60 * 1000).unref();
}

const routeHandlers = [
  handlePublicRoutes,
  handleAuthRoutes,
  handleStudentRoutes,
  handleMediaRoutes,
  handleAssessmentRoutes,
  handleNotificationRoutes,
  handleLiveRoutes,
  handleBotRoutes,
  handleAdminRoutes
];

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, getSecurityHeaders(req));
    res.end();
    return;
  }

  const urlObj = parseRequestUrl(req);
  if (!urlObj) {
    sendJson(req, res, 400, { error: 'عنوان الطلب غير صالح.' });
    return;
  }

  const ctx = {
    urlObj,
    pathname: urlObj.pathname,
    clientIp: getClientIp(req),
    getCairoDateTimeParts
  };

  try {
    await initDatabase();
    for (const handler of routeHandlers) {
      if (await handler(req, res, ctx)) return;
    }

    if (ctx.pathname.startsWith('/api/')) {
      sendJson(req, res, 404, { error: 'نقطة النهاية المطلوبة غير موجودة.' });
      return;
    }

    const publicRoot = path.join(__dirname, 'public');
    const filePath = ctx.pathname === '/' ? 'index.html' : ctx.pathname.replace(/^\/+/, '');
    const safeSuffix = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.resolve(publicRoot, safeSuffix);

    if (!fullPath.startsWith(publicRoot + path.sep)) {
      sendJson(req, res, 404, { error: 'Not found' });
      return;
    }

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const stat = fs.statSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
        '.ttf': 'font/ttf',
        '.otf': 'font/otf',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm'
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      const isFont = ext === '.woff2' || ext === '.woff' || ext === '.ttf' || ext === '.otf';
      const cacheControl = isFont
        ? 'public, max-age=31536000, immutable'
        : ((ext === '.png' || ext === '.jpg' || ext === '.mp4' || ext === '.webm') ? 'public, max-age=3600' : 'no-cache');
      if (ext === '.mp4' || ext === '.webm') {
        streamFileWithRange(req, res, fullPath, stat.size, mimeType, cacheControl);
      } else {
        res.writeHead(200, getSecurityHeaders(req, {
          'Content-Type': mimeType,
          'Cache-Control': cacheControl
        }));
        pipeStreamSafely(req, res, fs.createReadStream(fullPath));
      }
      return;
    }

    const indexHtml = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, getSecurityHeaders(req, { 'Content-Type': 'text/html; charset=utf-8' }));
      pipeStreamSafely(req, res, fs.createReadStream(indexHtml));
      return;
    }

    sendJson(req, res, 404, { error: 'Not found' });
  } catch (err) {
    const status = err.statusCode || 500;
    sendJson(req, res, status, { error: status === 500 ? 'حدث خطأ داخلي في الخادم.' : err.message });
  }
});

server.requestTimeout = 5 * 60 * 1000;
server.headersTimeout = 30 * 1000;
server.keepAliveTimeout = 65 * 1000;

let isShuttingDown = false;
function gracefulShutdown(signalName, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Shutting down gracefully (${signalName})...`);

  const forceExitTimer = setTimeout(() => {
    Promise.resolve(db.close()).catch(() => {}).finally(() => process.exit(exitCode || 1));
  }, 15000);
  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    Promise.resolve(db.close()).catch(() => {}).finally(() => process.exit(exitCode));
  });
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
}

if (require.main === module) {
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled Promise Rejection:', err?.message || 'Unknown rejection');
    gracefulShutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err?.message || 'Unknown error');
    gracefulShutdown('uncaughtException', 1);
  });
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0));
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

  initDatabase()
    .then(() => {
      server.listen(PORT, HOST, () => {
        console.log('==============================================================');
        console.log(`🕌 منصة مَتْن (MATN) - وضع التشغيل: ${NODE_ENV} (${db.client})`);
        console.log(`🌐 الرابط المباشر: http://${HOST}:${PORT}`);
        console.log('==============================================================');
        if (NODE_ENV !== 'production' && NODE_ENV !== 'test') {
          console.warn(`\x1b[31m⚠️ تحذير: الخادم يعمل بوضع التطوير (NODE_ENV=${NODE_ENV}) وهو غير آمن للإنتاج! عيّن NODE_ENV=production على السيرفر.\x1b[0m`);
        }
      });
    })
    .catch((err) => {
      console.error('FATAL ERROR: Failed to initialize database:', err);
      process.exit(1);
    });
}

module.exports = {
  server,
  initDatabase,
  gracefulShutdown,
  cleanupStaleLoginAttempts,
  createToken,
  verifyToken,
  createStreamTicket,
  verifyStreamTicket
};
