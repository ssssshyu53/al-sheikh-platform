const { db } = require('../database');
const { PREP_GRADES } = require('../lib/constants');

async function createNotification(dbConn, {
  title,
  body,
  notifType = 'announcement',
  targetUserId = null,
  targetGrade = 'all',
  targetBranch = 'all',
  linkLessonId = null
}) {
  const now = new Date().toISOString();
  const res = await dbConn.run(
    `INSERT INTO notifications (title, body, notif_type, target_user_id, target_grade, target_branch, link_lesson_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(title || '').trim().slice(0, 180),
      String(body || '').trim().slice(0, 800),
      String(notifType || 'announcement').slice(0, 40),
      targetUserId || null,
      targetGrade || 'all',
      targetBranch || 'all',
      linkLessonId || null,
      now
    ]
  );
  return res.lastInsertRowid;
}

/**
 * Generates an automatic expiry reminder notification if the student has <= 3 days remaining.
 */
async function ensureSubscriptionExpiringNotification(dbConn, user) {
  if (!user || user.role !== 'student' || !user.subscription_expires_at) return;
  const nowMs = Date.now();
  const expMs = new Date(user.subscription_expires_at).getTime();
  if (Number.isNaN(expMs) || expMs <= nowMs) return;

  const daysLeft = Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000));
  if (daysLeft > 3) return;

  const recentCutoff = new Date(nowMs - 4 * 24 * 60 * 60 * 1000).toISOString();
  const existing = await dbConn.get(
    `SELECT id FROM notifications
     WHERE target_user_id = ? AND notif_type = 'subscription_expiring' AND created_at >= ?
     LIMIT 1`,
    [user.id, recentCutoff]
  );

  if (!existing) {
    await createNotification(dbConn, {
      title: 'تنبيه: قرب انتهاء اشتراكك الشهري',
      body: `متبقٍ ${daysLeft} ${daysLeft === 1 ? 'يوم' : 'أيام'} فقط على انتهاء اشتراكك الحالي. بادر بتجديد الكود لضمان استمرار فتح المحاضرات.`,
      notifType: 'subscription_expiring',
      targetUserId: user.id,
      targetGrade: user.grade || 'all',
      targetBranch: user.branch || 'all'
    });
  }
}

async function getStudentNotifications(dbConn, user, limit = 30) {
  await ensureSubscriptionExpiringNotification(dbConn, user);

  const parsedLimit = Number.parseInt(String(limit ?? '30'), 10);
  const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 30;
  const branchParam = user.branch || (PREP_GRADES.includes(user.grade) ? 'general' : 'scientific');
  const isPrepFlag = PREP_GRADES.includes(user.grade) ? 1 : 0;
  const targetParams = [
    user.id,
    user.grade || 'grade_3',
    branchParam,
    isPrepFlag,
    user.created_at || '1970-01-01T00:00:00.000Z'
  ];

  const rows = await dbConn.all(
    `SELECT n.id, n.title, n.body, n.notif_type, n.target_user_id, n.target_grade, n.target_branch,
            n.link_lesson_id, n.created_at,
            CASE WHEN nr.notification_id IS NOT NULL THEN 1 ELSE 0 END AS is_read,
            nr.read_at
     FROM notifications n
     LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
     WHERE (n.target_user_id = ?)
        OR (
          n.target_user_id IS NULL
          AND (n.target_grade = 'all' OR n.target_grade = ?)
          AND (
            n.target_branch IN ('all', 'both')
            OR n.target_branch = ?
            OR (? = 1 AND n.target_branch = 'general')
          )
          AND n.created_at >= ?
        )
     ORDER BY n.id DESC
     LIMIT ${safeLimit}`,
    [user.id, ...targetParams]
  );

  const unreadRow = await dbConn.get(
    `SELECT COUNT(*) AS c
     FROM notifications n
     LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
     WHERE nr.notification_id IS NULL
       AND (
         (n.target_user_id = ?)
         OR (
           n.target_user_id IS NULL
           AND (n.target_grade = 'all' OR n.target_grade = ?)
           AND (
             n.target_branch IN ('all', 'both')
             OR n.target_branch = ?
             OR (? = 1 AND n.target_branch = 'general')
           )
           AND n.created_at >= ?
         )
       )`,
    [user.id, ...targetParams]
  );

  return {
    unread_count: Number(unreadRow?.c || 0),
    notifications: rows.map((r) => ({ ...r, is_read: Boolean(r.is_read) }))
  };
}

async function markNotificationsRead(dbConn, user, notificationIds = null) {
  const now = new Date().toISOString();
  const insertPrefix = dbConn.insertIgnorePrefix
    ? dbConn.insertIgnorePrefix()
    : (dbConn.isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');

  const branchParam = user.branch || (PREP_GRADES.includes(user.grade) ? 'general' : 'scientific');
  const isPrepFlag = PREP_GRADES.includes(user.grade) ? 1 : 0;
  let targetIds = [];

  if (Array.isArray(notificationIds) && notificationIds.length > 0) {
    const cleanIds = Array.from(new Set(notificationIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
    if (cleanIds.length === 0) return 0;
    const ph = cleanIds.map(() => '?').join(',');
    const validRows = await dbConn.all(
      `SELECT n.id
       FROM notifications n
       WHERE n.id IN (${ph})
         AND (
           n.target_user_id = ?
           OR (
             n.target_user_id IS NULL
             AND (n.target_grade = 'all' OR n.target_grade = ?)
             AND (
               n.target_branch IN ('all', 'both')
               OR n.target_branch = ?
               OR (? = 1 AND n.target_branch = 'general')
             )
             AND n.created_at >= ?
           )
         )`,
      [...cleanIds, user.id, user.grade || 'grade_3', branchParam, isPrepFlag, user.created_at || '1970-01-01T00:00:00.000Z']
    );
    targetIds = validRows.map((r) => r.id);
  } else {
    const unreadRows = await dbConn.all(
      `SELECT n.id
       FROM notifications n
       LEFT JOIN notification_reads nr ON nr.notification_id = n.id AND nr.user_id = ?
       WHERE nr.notification_id IS NULL
         AND (
           n.target_user_id = ?
           OR (
             n.target_user_id IS NULL
             AND (n.target_grade = 'all' OR n.target_grade = ?)
             AND (
               n.target_branch IN ('all', 'both')
               OR n.target_branch = ?
               OR (? = 1 AND n.target_branch = 'general')
             )
             AND n.created_at >= ?
           )
         )
       ORDER BY n.id DESC
       LIMIT 200`,
      [user.id, user.id, user.grade || 'grade_3', branchParam, isPrepFlag, user.created_at || '1970-01-01T00:00:00.000Z']
    );
    targetIds = unreadRows.map((r) => r.id);
  }

  if (targetIds.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < targetIds.length; i += 100) {
    const chunk = targetIds.slice(i, i + 100);
    const valuesClause = chunk.map(() => '(?, ?, ?)').join(', ');
    const params = chunk.flatMap((nid) => [nid, user.id, now]);
    const info = await dbConn.run(
      `${insertPrefix} notification_reads (notification_id, user_id, read_at) VALUES ${valuesClause}`,
      params
    );
    count += Number(info.changes || 0);
  }
  return count;
}

module.exports = {
  db,
  createNotification,
  ensureSubscriptionExpiringNotification,
  getStudentNotifications,
  markNotificationsRead
};
