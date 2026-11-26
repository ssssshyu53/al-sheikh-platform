const { db } = require('../database');
const { VALID_GRADES, VALID_LESSON_BRANCHES, parsePositiveInt } = require('../lib/constants');
const { sendJson, parseBody } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../services/audit');
const { createNotification, getStudentNotifications, markNotificationsRead } = require('../services/notifications');

async function handleNotificationRoutes(req, res, ctx) {
  const { pathname } = ctx;

  if (pathname === '/api/student/notifications' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const result = await getStudentNotifications(db, user, 40);
    sendJson(req, res, 200, result);
    return true;
  }

  if (pathname === '/api/student/notifications/read' && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const body = await parseBody(req, 16 * 1024);
    const ids = Array.isArray(body.notification_ids) ? body.notification_ids : null;
    const markedCount = await markNotificationsRead(db, user, ids);
    const updated = await getStudentNotifications(db, user, 40);
    sendJson(req, res, 200, {
      marked_count: markedCount,
      unread_count: updated.unread_count,
      notifications: updated.notifications
    });
    return true;
  }

  if (pathname === '/api/admin/notifications' && req.method === 'GET') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const notifications = await db.all(
      `SELECT n.*, u.full_name AS target_student_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.target_user_id
       ORDER BY n.id DESC
       LIMIT 60`
    );
    sendJson(req, res, 200, { notifications });
    return true;
  }

  if (pathname === '/api/admin/notifications' && req.method === 'POST') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const body = await parseBody(req, 16 * 1024);
    const title = String(body.title || '').trim();
    const msgBody = String(body.body || '').trim();
    const targetGrade = String(body.target_grade || 'all').trim();
    const targetBranch = String(body.target_branch || 'all').trim();
    const targetUserId = body.target_user_id ? parsePositiveInt(body.target_user_id) : null;

    if (!title || title.length > 180) {
      sendJson(req, res, 400, { error: 'عنوان الإشعار مطلوب وألا يتجاوز ١٨٠ حرفاً.' });
      return true;
    }
    if (!msgBody || msgBody.length > 800) {
      sendJson(req, res, 400, { error: 'نص الإشعار مطلوب وألا يتجاوز ٨٠٠ حرف.' });
      return true;
    }
    if (targetGrade !== 'all' && !VALID_GRADES.includes(targetGrade)) {
      sendJson(req, res, 400, { error: 'الصف المستهدف غير صالح.' });
      return true;
    }
    if (targetBranch !== 'all' && !VALID_LESSON_BRANCHES.includes(targetBranch)) {
      sendJson(req, res, 400, { error: 'الشعبة المستهدفة غير صالحة.' });
      return true;
    }

    if (body.target_user_id && !targetUserId) {
      sendJson(req, res, 400, { error: 'معرف الطالب غير صالح.' });
      return true;
    }
    if (targetUserId) {
      const stExists = await db.get(`SELECT id FROM users WHERE id = ? AND role = 'student'`, [targetUserId]);
      if (!stExists) {
        sendJson(req, res, 404, { error: 'الطالب المستهدف غير موجود.' });
        return true;
      }
    }

    const notifId = await createNotification(db, {
      title,
      body: msgBody,
      notifType: 'announcement',
      targetUserId,
      targetGrade,
      targetBranch
    });

    writeAuditLog(req, admin, 'NOTIFICATION_SEND', 'notification', notifId, { targetGrade, targetBranch, targetUserId });
    sendJson(req, res, 201, {
      message: 'تم إرسال الإشعار للطلاب بنجاح!',
      notification_id: notifId
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/notifications/') && req.method === 'DELETE') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const notifId = parsePositiveInt(pathname.split('/')[4]);
    const del = notifId ? await db.run(`DELETE FROM notifications WHERE id = ?`, [notifId]) : { changes: 0 };
    if (del.changes === 0) {
      sendJson(req, res, 404, { error: 'الإشعار غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'NOTIFICATION_DELETE', 'notification', notifId);
    sendJson(req, res, 200, { message: 'تم حذف الإشعار.' });
    return true;
  }

  return false;
}

module.exports = { handleNotificationRoutes };
