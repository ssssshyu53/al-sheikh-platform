const { db } = require('../database');
const { HAS_WHATSAPP_GATEWAY, ALLOW_UNVERIFIED_REGISTRATION } = require('../lib/constants');
const { sendJson } = require('../middleware/security');

async function handlePublicRoutes(req, res, ctx) {
  const { pathname } = ctx;

  if (pathname === '/api/health' && req.method === 'GET') {
    try {
      const row = await db.get('SELECT 1 AS ok');
      if (!row || Number(row.ok) !== 1) throw new Error('DB check failed');
      sendJson(req, res, 200, { status: 'ok', db: 'connected', client: db.client, uptime_sec: Math.floor(process.uptime()) });
    } catch {
      sendJson(req, res, 503, { status: 'error', db: 'unavailable' });
    }
    return true;
  }

  if (pathname === '/api/public/info' && req.method === 'GET') {
    const allowedPublicKeys = [
      'teacher_name',
      'platform_name',
      'support_whatsapp',
      'vodafone_cash_number',
      'instapay_handle',
      'honor_roll_enabled',
      'azhar_exam_date',
      'announcement_banner'
    ];
    const rows = await db.all(
      `SELECT \`key\`, value FROM platform_settings
       WHERE \`key\` IN ('teacher_name', 'platform_name', 'support_whatsapp', 'vodafone_cash_number', 'instapay_handle', 'honor_roll_enabled', 'azhar_exam_date', 'announcement_banner')`
    );
    const settings = {};
    for (const r of rows) {
      if (allowedPublicKeys.includes(r.key)) settings[r.key] = r.value;
    }
    const registrationMode = HAS_WHATSAPP_GATEWAY
      ? 'whatsapp_otp'
      : (ALLOW_UNVERIFIED_REGISTRATION ? 'direct' : 'voucher_code');
    const [studentsRow, lessonsRow, examsRow] = await Promise.all([
      db.get(`SELECT COUNT(*) AS c FROM users WHERE role = 'student'`),
      db.get(`SELECT COUNT(*) AS c FROM lessons WHERE is_published = 1`),
      db.get(`SELECT COUNT(*) AS c FROM assessments WHERE is_active = 1`)
    ]);
    const stats = {
      studentsCount: studentsRow?.c || 0,
      lessonsCount: lessonsRow?.c || 0,
      examsCount: examsRow?.c || 0
    };
    sendJson(req, res, 200, { settings, stats, registration_mode: registrationMode });
    return true;
  }

  return false;
}

module.exports = { handlePublicRoutes };
