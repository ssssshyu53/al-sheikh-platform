const { isSubjectAllowedForGrade } = require('../lib/constants');
const { isBranchCompatible, hasActiveSubjectSubscriptionSync } = require('./gating');

function canStudentSeeLiveSession(user, session) {
  if (!user || !session) return false;
  if (user.role === 'admin') return true;
  if (session.grade !== user.grade) return false;
  if (!isBranchCompatible(session.branch, user.grade, user.branch)) return false;
  if (!isSubjectAllowedForGrade(session.subject, user.grade)) return false;
  return true;
}

function isStudentSubscribedToLiveSession(user, session, nowMs = Date.now(), subRows = null) {
  if (user.role === 'admin') return true;
  if (Array.isArray(subRows)) {
    return hasActiveSubjectSubscriptionSync(user, session.subject, subRows);
  }
  const subExp = user.subscription_expires_at ? new Date(user.subscription_expires_at).getTime() : 0;
  const hasActiveSub = subExp > nowMs;
  const allowedSubjects = String(user.subscribed_subjects || '').split(',').map((s) => s.trim()).filter(Boolean);
  const subjectAllowed = user.subscribed_subjects === 'all' || allowedSubjects.includes(session.subject);
  return hasActiveSub && subjectAllowed;
}

function evaluateLiveJoinAccess(user, session, nowMs = Date.now(), subRows = null) {
  if (!canStudentSeeLiveSession(user, session)) {
    return { allowed: false, status: 403, reason: 'هذه الحصة المباشرة غير مخصصة لصفك أو شعبتك.' };
  }
  if (user.role === 'admin') {
    return { allowed: true, status: 200, reason: null };
  }
  if (!isStudentSubscribedToLiveSession(user, session, nowMs, subRows)) {
    return { allowed: false, status: 403, reason: 'يتطلب اشتراكاً شهرياً سارياً في هذه المادة لدخول البث المباشر.' };
  }
  if (session.status === 'cancelled' || session.status === 'ended') {
    return { allowed: false, status: 403, reason: 'انتهت هذه الحصة المباشرة أو تم إلغاؤها.' };
  }

  const startMs = new Date(session.starts_at).getTime();
  const durationMs = Math.max(5, Number(session.duration_minutes || 60)) * 60 * 1000;
  const earlyMs = Math.max(0, Number(session.join_early_minutes ?? 15)) * 60 * 1000;

  if (Number.isNaN(startMs)) {
    return { allowed: false, status: 403, reason: 'موعد الحصة غير مضبوط.' };
  }
  if (nowMs > startMs + durationMs + 30 * 60 * 1000) {
    return { allowed: false, status: 403, reason: 'انتهى وقت البث المباشر لهذه الحصة.' };
  }
  if (session.status === 'live') {
    return { allowed: true, status: 200, reason: null };
  }
  if (nowMs < startMs - earlyMs) {
    return {
      allowed: false,
      status: 403,
      reason: `سيُفتح رابط الحصة المباشرة قبل الموعد بـ ${session.join_early_minutes ?? 15} دقيقة (${new Date(startMs).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}).`
    };
  }
  return { allowed: true, status: 200, reason: null };
}

function formatStudentLiveSession(user, session, attendanceRow, nowMs = Date.now(), subRows = null) {
  const access = evaluateLiveJoinAccess(user, session, nowMs, subRows);
  const attended = Boolean(attendanceRow);
  return {
    id: session.id,
    title: session.title,
    description: session.description,
    subject: session.subject,
    grade: session.grade,
    branch: session.branch,
    starts_at: session.starts_at,
    duration_minutes: session.duration_minutes,
    join_early_minutes: session.join_early_minutes,
    provider: session.provider,
    status: session.status,
    can_join: access.allowed,
    lock_reason: access.allowed ? null : access.reason,
    stream_url: user.role === 'admin' || attended ? session.stream_url : null,
    attended,
    joined_at: attendanceRow ? attendanceRow.joined_at : null
  };
}

module.exports = {
  canStudentSeeLiveSession,
  isStudentSubscribedToLiveSession,
  evaluateLiveJoinAccess,
  formatStudentLiveSession
};
