const fs = require('node:fs');
const path = require('node:path');
const { IS_PROD, USE_NGINX_ACCEL, STREAM_TICKET_TTL_SECONDS, parsePositiveInt, safeJsonParse } = require('../lib/constants');
const { parseCookies, getSecurityHeaders, sendJson } = require('../middleware/security');
const { requireAuth, createStreamTicket, verifyStreamTicket } = require('../middleware/auth');
const { authorizeLessonAccess } = require('../services/gating');
const {
  resolveStoredUploadPath,
  pipeStreamSafely,
  streamFileWithRange,
  isBunnyConfigured,
  signBunnyEmbedUrl
} = require('../services/media');

async function handleMediaRoutes(req, res, ctx) {
  const { pathname } = ctx;

  if (pathname.startsWith('/api/media/ticket/') && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    if (!lessonId) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const access = await authorizeLessonAccess(user, lessonId);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const ticket = createStreamTicket(user.id, lessonId, user.device_id || 'admin');
    const secureFlag = IS_PROD ? '; Secure' : '';
    const lesson = access.lesson;
    const bunnyUrl = lesson.video_type === 'bunny' && lesson.video_path && isBunnyConfigured()
      ? signBunnyEmbedUrl(lesson.video_path, STREAM_TICKET_TTL_SECONDS)
      : null;

    sendJson(req, res, 200, {
      ticket,
      expires_in_seconds: STREAM_TICKET_TTL_SECONDS,
      video_type: bunnyUrl ? 'bunny' : lesson.video_type,
      ...(bunnyUrl ? { bunny_embed_url: bunnyUrl } : {}),
      watermark_text: `${user.full_name} • ${user.phone} • منصة مَتْن`
    }, {
      'Set-Cookie': `matn_stream_ticket_${lessonId}=${encodeURIComponent(ticket)}; HttpOnly; Path=/api/stream/; SameSite=Lax; Max-Age=${STREAM_TICKET_TTL_SECONDS}${secureFlag}`
    });
    return true;
  }

  if (pathname.startsWith('/api/stream/video/') && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    if (!lessonId) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const access = await authorizeLessonAccess(user, lessonId);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const cookies = parseCookies(req);
    const ticket = req.headers['x-stream-ticket'] || cookies[`matn_stream_ticket_${lessonId}`];
    if (!verifyStreamTicket(ticket, user.id, lessonId, user.device_id || 'admin')) {
      sendJson(req, res, 403, { error: 'انتهت صلاحية تذكرة البث المؤقتة أو أنها غير صالحة.' });
      return true;
    }

    const lesson = access.lesson;
    const fullVideoPath = resolveStoredUploadPath(lesson.video_path);
    if (fullVideoPath && lesson.video_path.startsWith('uploads/videos/')) {
      let stat = null;
      try {
        stat = await fs.promises.stat(fullVideoPath);
      } catch {
        stat = null;
      }
      if (stat && stat.isFile()) {
        const ext = path.extname(fullVideoPath).toLowerCase();
        const mimeType = ext === '.webm' ? 'video/webm' : 'video/mp4';

        if (USE_NGINX_ACCEL) {
          const relVideoFile = lesson.video_path.replace(/^uploads[/\\]videos[/\\]/, '').replace(/\\/g, '/');
          res.writeHead(200, getSecurityHeaders(req, {
            'X-Accel-Redirect': `/_protected_videos/${encodeURI(relVideoFile)}`,
            'Content-Type': mimeType,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Content-Disposition': 'inline'
          }));
          res.end();
          return true;
        }

        streamFileWithRange(req, res, fullVideoPath, stat.size, mimeType, 'private, no-store');
        return true;
      }
    }

    sendJson(req, res, 404, { error: 'ملف الفيديو غير متوفر.' });
    return true;
  }

  if (pathname.startsWith('/api/stream/pdf/') && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    if (!lessonId) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const access = await authorizeLessonAccess(user, lessonId);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const lesson = access.lesson;
    let hasBinaryPdf = false;
    const candidatePdf = resolveStoredUploadPath(lesson.pdf_path);
    if (candidatePdf && lesson.pdf_path.startsWith('uploads/pdfs/')) {
      try {
        await fs.promises.access(candidatePdf, fs.constants.R_OK);
        hasBinaryPdf = true;
      } catch {
        hasBinaryPdf = false;
      }
    }

    const ticket = createStreamTicket(user.id, lessonId, user.device_id || 'admin');
    const secureFlag = IS_PROD ? '; Secure' : '';

    sendJson(req, res, 200, {
      lesson_id: lesson.id,
      pdf_title: lesson.pdf_title || `مذكرة ${lesson.title}`,
      subject: lesson.subject,
      has_binary_pdf: hasBinaryPdf,
      stream_ticket: ticket,
      structured_pages: safeJsonParse(lesson.pdf_content_json, []),
      watermark_text: `${user.full_name} • ${user.phone} • منصة مَتْن`
    }, {
      'Set-Cookie': `matn_stream_ticket_${lessonId}=${encodeURIComponent(ticket)}; HttpOnly; Path=/api/stream/; SameSite=Lax; Max-Age=${STREAM_TICKET_TTL_SECONDS}${secureFlag}`
    });
    return true;
  }

  if (pathname.startsWith('/api/stream/pdf-file/') && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    if (!lessonId) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const access = await authorizeLessonAccess(user, lessonId);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const cookies = parseCookies(req);
    const ticket = req.headers['x-stream-ticket'] || cookies[`matn_stream_ticket_${lessonId}`];
    if (!verifyStreamTicket(ticket, user.id, lessonId, user.device_id || 'admin')) {
      sendJson(req, res, 403, { error: 'تذكرة الوصول للملف غير صالحة أو منتهية الصلاحية.' });
      return true;
    }

    const lesson = access.lesson;
    const fullPdfPath = resolveStoredUploadPath(lesson.pdf_path);
    if (!fullPdfPath || !lesson.pdf_path.startsWith('uploads/pdfs/')) {
      sendJson(req, res, 404, { error: 'ملف المذكرة غير موجود.' });
      return true;
    }
    let stat = null;
    try {
      stat = await fs.promises.stat(fullPdfPath);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      sendJson(req, res, 404, { error: 'ملف المذكرة غير موجود على الخادم.' });
      return true;
    }

    // Raw PDF binaries are streamed inline strictly for canvas rendering in the self-hosted pdf.js viewer,
    // which paints dynamic per-student watermarks over every rendered page; X-Matn-Watermark carries the identity metadata.
    const watermarkMeta = `${user.full_name} • ${user.phone} • منصة مَتْن`;
    res.writeHead(200, getSecurityHeaders(req, {
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Disposition': 'inline',
      'X-Matn-Watermark': encodeURIComponent(watermarkMeta)
    }));
    pipeStreamSafely(req, res, fs.createReadStream(fullPdfPath));
    return true;
  }

  return false;
}

module.exports = { handleMediaRoutes };
