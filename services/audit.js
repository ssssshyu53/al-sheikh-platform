const { db } = require('../database');
const { getClientIp } = require('../middleware/security');

async function writeAuditLog(req, actor, action, targetType, targetId, detailsObj = {}) {
  try {
    await db.run(
      `INSERT INTO audit_logs (actor_id, actor_role, action, target_type, target_id, ip_address, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actor ? actor.id : null,
        actor ? actor.role : 'anonymous',
        action,
        targetType || null,
        targetId !== undefined && targetId !== null ? String(targetId) : null,
        getClientIp(req),
        JSON.stringify(detailsObj),
        new Date().toISOString()
      ]
    );
  } catch {}
}

async function recordSharedDeviceIfAny(userId, fullName, phone, deviceId) {
  if (!deviceId) return;
  const others = await db.all(`SELECT id, phone FROM users WHERE device_id = ? AND id != ?`, [deviceId, userId || 0]);
  if (others.length > 0) {
    const details = `نفس معرف الجهاز (${deviceId}) مستخدم في أكثر من حساب (${others.map((o) => o.phone).join(', ')})`;
    const recentCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const userClause = userId ? 'user_id = ?' : 'user_id IS NULL';
    const params = userId ? [userId, details, recentCutoff] : [details, recentCutoff];
    const recentlyLogged = await db.get(
      `SELECT id FROM security_events
       WHERE ${userClause} AND event_type = 'SHARED_DEVICE_DETECTED' AND details = ? AND created_at >= ?
       LIMIT 1`,
      params
    );
    if (recentlyLogged) return;
    await db.run(
      `INSERT INTO security_events (user_id, student_name, phone, event_type, details, created_at)
       VALUES (?, ?, ?, 'SHARED_DEVICE_DETECTED', ?, ?)`,
      [
        userId || null,
        fullName || '',
        phone || '',
        details,
        new Date().toISOString()
      ]
    );
  }
}

async function cleanupStaleLoginAttempts(nowMs = Date.now()) {
  try {
    const cutoff24h = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    await db.run(
      `DELETE FROM login_attempts
       WHERE (last_failed_at IS NULL OR last_failed_at < ?)
         AND (locked_until IS NULL OR locked_until < ?)`,
      [cutoff24h, nowIso]
    );
  } catch {}
}

module.exports = {
  writeAuditLog,
  recordSharedDeviceIfAny,
  cleanupStaleLoginAttempts
};
