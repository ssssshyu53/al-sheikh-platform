const { db } = require('../database');
const {
  PREP_GRADES,
  VALID_GRADES,
  VALID_SUBJECTS,
  VALID_LESSON_BRANCHES,
  isSubjectAllowedForGrade,
  parsePositiveInt,
  parseBoundedInt
} = require('../lib/constants');
const { sendJson, parseBody } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../services/audit');
const { createNotification } = require('../services/notifications');
const { isBranchCompatible } = require('../services/gating');
const { evaluateLiveJoinAccess, formatStudentLiveSession } = require('../services/live-sessions');

function isValidHttpStreamUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    return parsed.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:');
  } catch {
    return false;
  }
}

async function handleLiveRoutes(req, res, ctx) {
  const { pathname } = ctx;

  if (pathname === '/api/student/live-sessions' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const nowMs = Date.now();
    const rawSessions = user.role === 'admin'
      ? await db.all(`SELECT * FROM live_sessions ORDER BY starts_at DESC, id DESC LIMIT 50`)
      : (await db.all(
          `SELECT * FROM live_sessions
           WHERE grade = ?
           ORDER BY starts_at DESC, id DESC
           LIMIT 50`,
          [user.grade]
        )).filter((s) => isBranchCompatible(s.branch, user.grade, user.branch) && isSubjectAllowedForGrade(s.subject, user.grade));

    const attRows = await db.all(`SELECT live_session_id, joined_at FROM live_session_attendance WHERE user_id = ?`, [user.id]);
    const attMap = new Map();
    for (const r of attRows) attMap.set(r.live_session_id, r);
    const subRows = user.role === 'student'
      ? await db.all(`SELECT subject, expires_at FROM user_subject_subscriptions WHERE user_id = ?`, [user.id])
      : null;

    const sessions = rawSessions.map((s) => formatStudentLiveSession(user, s, attMap.get(s.id) || null, nowMs, subRows));
    sendJson(req, res, 200, { sessions });
    return true;
  }

  if (pathname.startsWith('/api/student/live-sessions/') && pathname.endsWith('/join') && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const sessionId = parsePositiveInt(pathname.split('/')[4]);
    const session = sessionId ? await db.get(`SELECT * FROM live_sessions WHERE id = ?`, [sessionId]) : null;
    if (!session) {
      sendJson(req, res, 404, { error: 'الحصة المباشرة غير موجودة.' });
      return true;
    }

    const subRows = user.role === 'student'
      ? await db.all(`SELECT subject, expires_at FROM user_subject_subscriptions WHERE user_id = ?`, [user.id])
      : null;
    const access = evaluateLiveJoinAccess(user, session, Date.now(), subRows);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const joinedAt = new Date().toISOString();
    if (user.role === 'student') {
      const insertPrefix = db.insertIgnorePrefix ? db.insertIgnorePrefix() : (db.isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');
      await db.run(
        `${insertPrefix} live_session_attendance (live_session_id, user_id, joined_at)
         VALUES (?, ?, ?)`,
        [session.id, user.id, joinedAt]
      );
      writeAuditLog(req, user, 'LIVE_SESSION_JOIN', 'live_session', session.id);
    }

    sendJson(req, res, 200, {
      joined: true,
      session_id: session.id,
      title: session.title,
      provider: session.provider,
      stream_url: session.stream_url,
      joined_at: joinedAt,
      message: 'تم تسجيل حضورك بنجاح! يمكنك الدخول للبث المباشر الآن.'
    });
    return true;
  }

  if (pathname === '/api/admin/live-sessions' && req.method === 'GET') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const sessions = await db.all(
      `SELECT ls.*,
              (SELECT COUNT(*) FROM live_session_attendance lsa WHERE lsa.live_session_id = ls.id) AS attendance_count
       FROM live_sessions ls
       ORDER BY ls.starts_at DESC, ls.id DESC
       LIMIT 60`
    );
    sendJson(req, res, 200, { sessions });
    return true;
  }

  if (pathname === '/api/admin/live-sessions' && req.method === 'POST') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const body = await parseBody(req, 16 * 1024);

    const title = String(body.title || '').trim();
    const description = String(body.description || '').trim().slice(0, 600);
    const subject = String(body.subject || 'fiqh').trim();
    const grade = String(body.grade || 'grade_3').trim();
    const branch = String(body.branch || (PREP_GRADES.includes(grade) ? 'general' : 'both')).trim();
    const startsAtRaw = String(body.starts_at || '').trim();
    const durationMinutes = parseBoundedInt(body.duration_minutes, 60, 10, 300);
    const joinEarlyMinutes = parseBoundedInt(body.join_early_minutes, 15, 0, 120);
    const streamUrl = String(body.stream_url || '').trim();
    const provider = ['zoom', 'youtube', 'meet', 'other'].includes(String(body.provider || 'zoom'))
      ? String(body.provider || 'zoom')
      : 'other';
    const status = ['scheduled', 'live', 'ended', 'cancelled'].includes(String(body.status || 'scheduled'))
      ? String(body.status || 'scheduled')
      : 'scheduled';

    if (!title || title.length > 200) {
      sendJson(req, res, 400, { error: 'عنوان الحصة المباشرة مطلوب وألا يتجاوز ٢٠٠ حرف.' });
      return true;
    }
    if (!VALID_SUBJECTS.includes(subject) || !VALID_GRADES.includes(grade) || !VALID_LESSON_BRANCHES.includes(branch)) {
      sendJson(req, res, 400, { error: 'المادة أو الصف أو الشعبة غير صالحة.' });
      return true;
    }
    if (PREP_GRADES.includes(grade) && ['scientific', 'literary'].includes(branch)) {
      sendJson(req, res, 400, { error: 'الصفوف الإعدادية عامة ولا تنقسم إلى علمي أو أدبي.' });
      return true;
    }
    if (!PREP_GRADES.includes(grade) && branch === 'general') {
      sendJson(req, res, 400, { error: 'الصفوف الثانوية يجب أن تكون للشعبة العلمية أو الأدبية أو كليهما.' });
      return true;
    }
    if (!isSubjectAllowedForGrade(subject, grade)) {
      sendJson(req, res, 400, { error: 'المادة المختارة غير مقررة على هذا الصف الدراسي.' });
      return true;
    }
    const startMs = Date.parse(startsAtRaw);
    if (!startsAtRaw || Number.isNaN(startMs)) {
      sendJson(req, res, 400, { error: 'يرجى تحديد موعد بداية صالح للحصة المباشرة.' });
      return true;
    }
    if (!isValidHttpStreamUrl(streamUrl) || streamUrl.length > 512) {
      sendJson(req, res, 400, { error: 'رابط البث المباشر يجب أن يكون رابطاً صحيحاً يبدأ بـ https:// وألا يتجاوز ٥١٢ حرفاً.' });
      return true;
    }

    const startsAtIso = new Date(startMs).toISOString();
    const nowIso = new Date().toISOString();
    const ins = await db.run(
      `INSERT INTO live_sessions (
         title, description, subject, grade, branch, starts_at,
         duration_minutes, join_early_minutes, stream_url, provider, status,
         created_by_admin_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, subject, grade, branch, startsAtIso, durationMinutes, joinEarlyMinutes, streamUrl, provider, status, admin.id, nowIso]
    );

    await createNotification(db, {
      title: `🔴 حصة مباشرة جديدة: ${title}`,
      body: `موعد البث: ${new Date(startMs).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })} — المدة: ${durationMinutes} دقيقة.`,
      notifType: 'live_session',
      targetGrade: grade,
      targetBranch: branch
    });

    writeAuditLog(req, admin, 'LIVE_SESSION_CREATE', 'live_session', ins.lastInsertRowid, { grade, subject });
    sendJson(req, res, 201, {
      message: 'تم جدولة الحصة المباشرة وإشعار طلاب الصف بنجاح!',
      session_id: ins.lastInsertRowid
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/live-sessions/') && pathname.endsWith('/attendance') && req.method === 'GET') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const sessionId = parsePositiveInt(pathname.split('/')[4]);
    const session = sessionId ? await db.get(`SELECT id, title FROM live_sessions WHERE id = ?`, [sessionId]) : null;
    if (!session) {
      sendJson(req, res, 404, { error: 'الحصة المباشرة غير موجودة.' });
      return true;
    }
    const attendees = await db.all(
      `SELECT lsa.joined_at, u.id AS user_id, u.full_name, u.phone, u.grade, u.branch
       FROM live_session_attendance lsa
       JOIN users u ON u.id = lsa.user_id
       WHERE lsa.live_session_id = ?
       ORDER BY lsa.joined_at DESC`,
      [sessionId]
    );
    sendJson(req, res, 200, { session, attendees });
    return true;
  }

  if (pathname.startsWith('/api/admin/live-sessions/') && req.method === 'PUT') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const sessionId = parsePositiveInt(pathname.split('/')[4]);
    const existing = sessionId ? await db.get(`SELECT * FROM live_sessions WHERE id = ?`, [sessionId]) : null;
    if (!existing) {
      sendJson(req, res, 404, { error: 'الحصة المباشرة غير موجودة.' });
      return true;
    }
    const body = await parseBody(req, 16 * 1024);
    const status = body.status !== undefined && ['scheduled', 'live', 'ended', 'cancelled'].includes(String(body.status))
      ? String(body.status)
      : existing.status;
    const streamUrl = body.stream_url !== undefined ? String(body.stream_url).trim() : existing.stream_url;
    if (!isValidHttpStreamUrl(streamUrl) || streamUrl.length > 512) {
      sendJson(req, res, 400, { error: 'رابط البث المباشر غير صالح أو يتجاوز ٥١٢ حرفاً.' });
      return true;
    }
    const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) : existing.title;
    if (!title) {
      sendJson(req, res, 400, { error: 'عنوان الحصة مطلوب.' });
      return true;
    }
    const description = body.description !== undefined ? String(body.description || '').trim().slice(0, 600) : existing.description;
    const subject = body.subject !== undefined ? String(body.subject).trim() : existing.subject;
    const grade = body.grade !== undefined ? String(body.grade).trim() : existing.grade;
    const branch = body.branch !== undefined ? String(body.branch).trim() : existing.branch;
    const durationMinutes = body.duration_minutes !== undefined
      ? parseBoundedInt(body.duration_minutes, existing.duration_minutes || 60, 10, 300)
      : existing.duration_minutes;
    const joinEarlyMinutes = body.join_early_minutes !== undefined
      ? parseBoundedInt(body.join_early_minutes, existing.join_early_minutes ?? 15, 0, 120)
      : existing.join_early_minutes;
    const provider = body.provider !== undefined
      ? (['zoom', 'youtube', 'meet', 'other'].includes(String(body.provider)) ? String(body.provider) : 'other')
      : existing.provider;

    let startsAtIso = existing.starts_at;
    if (body.starts_at !== undefined) {
      const startMs = Date.parse(String(body.starts_at || '').trim());
      if (Number.isNaN(startMs)) {
        sendJson(req, res, 400, { error: 'موعد بداية الحصة غير صالح.' });
        return true;
      }
      startsAtIso = new Date(startMs).toISOString();
    }

    if (!VALID_SUBJECTS.includes(subject) || !VALID_GRADES.includes(grade) || !VALID_LESSON_BRANCHES.includes(branch)) {
      sendJson(req, res, 400, { error: 'المادة أو الصف أو الشعبة غير صالحة.' });
      return true;
    }
    if (PREP_GRADES.includes(grade) && ['scientific', 'literary'].includes(branch)) {
      sendJson(req, res, 400, { error: 'الصفوف الإعدادية عامة ولا تنقسم إلى علمي أو أدبي.' });
      return true;
    }
    if (!PREP_GRADES.includes(grade) && branch === 'general') {
      sendJson(req, res, 400, { error: 'الصفوف الثانوية يجب أن تكون للشعبة العلمية أو الأدبية أو كليهما.' });
      return true;
    }
    if (!isSubjectAllowedForGrade(subject, grade)) {
      sendJson(req, res, 400, { error: 'المادة المختارة غير مقررة على هذا الصف الدراسي.' });
      return true;
    }

    await db.run(
      `UPDATE live_sessions
       SET title = ?, description = ?, subject = ?, grade = ?, branch = ?,
           starts_at = ?, duration_minutes = ?, join_early_minutes = ?,
           stream_url = ?, provider = ?, status = ?
       WHERE id = ?`,
      [title, description, subject, grade, branch, startsAtIso, durationMinutes, joinEarlyMinutes, streamUrl, provider, status, sessionId]
    );
    writeAuditLog(req, admin, 'LIVE_SESSION_UPDATE', 'live_session', sessionId, { status, grade, subject });
    sendJson(req, res, 200, { message: 'تم تحديث حالة الحصة المباشرة بنجاح!' });
    return true;
  }

  if (pathname.startsWith('/api/admin/live-sessions/') && req.method === 'DELETE') {
    const admin = await requireAuth(req, res, { adminOnly: true });
    if (!admin) return true;
    const sessionId = parsePositiveInt(pathname.split('/')[4]);
    const del = sessionId ? await db.run(`DELETE FROM live_sessions WHERE id = ?`, [sessionId]) : { changes: 0 };
    if (del.changes === 0) {
      sendJson(req, res, 404, { error: 'الحصة المباشرة غير موجودة.' });
      return true;
    }
    writeAuditLog(req, admin, 'LIVE_SESSION_DELETE', 'live_session', sessionId);
    sendJson(req, res, 200, { message: 'تم حذف الحصة المباشرة بنجاح.' });
    return true;
  }

  return false;
}

module.exports = { handleLiveRoutes };
