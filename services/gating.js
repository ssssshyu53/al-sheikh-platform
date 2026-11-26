const crypto = require('node:crypto');
const { db } = require('../database');
const { PREP_GRADES, isSubjectAllowedForGrade } = require('../lib/constants');

function runInTransaction(fn) {
  return db.transaction(fn);
}

async function getPlatformSetting(key, fallback = '') {
  const row = await db.get('SELECT value FROM platform_settings WHERE `key` = ?', [key]);
  return row ? row.value : fallback;
}

function isBranchCompatible(itemBranch, userGrade, userBranch) {
  const isPrep = PREP_GRADES.includes(userGrade);
  if (isPrep) {
    return ['general', 'both', 'all'].includes(itemBranch);
  }
  return itemBranch === 'both' || itemBranch === userBranch;
}

function validateVoucherForPhoneAndGrade(voucher, targetPhone, targetGrade, notFoundStatus = 400) {
  if (!voucher) {
    return { ok: false, status: notFoundStatus, error: 'كود التفعيل غير صحيح. تأكد من كتابته بشكل صحيح أو اطلبه من الدعم.' };
  }
  if (voucher.is_used) {
    return { ok: false, status: 400, error: 'هذا الكود تم استخدامه مسبقاً.' };
  }
  if (voucher.grade_scope !== 'all' && voucher.grade_scope !== targetGrade) {
    return { ok: false, status: 400, error: 'هذا الكود مخصص لصف دراسي آخر غير صفك المسجل.' };
  }
  if (voucher.subject_scope !== 'all' && !isSubjectAllowedForGrade(voucher.subject_scope, targetGrade)) {
    return { ok: false, status: 400, error: 'مادة هذا الكود غير مقررة على صفك الدراسي المسجل.' };
  }
  if (voucher.restrict_to_phone && voucher.assigned_to_phone && voucher.assigned_to_phone !== targetPhone) {
    return { ok: false, status: 403, error: 'هذا الكود مقفول ومخصص لرقم هاتف آخر ولا يمكن استخدامه على هذا الحساب.' };
  }
  return { ok: true };
}

function hasActiveSubjectSubscriptionSync(user, subject, subRows = null) {
  const now = new Date();
  const subExp = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
  if (user.subscribed_subjects === 'all' && subExp && subExp > now) {
    return true;
  }

  if (Array.isArray(subRows) && subRows.length > 0) {
    const match = subRows.find((r) => r.subject === subject);
    return Boolean(match && match.expires_at && new Date(match.expires_at) > now);
  }

  const allowedSubjects = String(user.subscribed_subjects || '').split(',').map((s) => s.trim()).filter(Boolean);
  return Boolean(subExp && subExp > now && allowedSubjects.includes(subject));
}

/**
 * Checks if student has active subscription for `subject`.
 * Uses `user_subject_subscriptions` when present; supports 'all' wildcard; falls back to legacy column only if no per-subject rows exist for the user.
 */
async function hasActiveSubjectSubscription(dbConn, user, subject, prefetchedSubRows = null) {
  const now = new Date();
  const subExp = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
  if (user.subscribed_subjects === 'all' && subExp && subExp > now) {
    return true;
  }

  const rows = prefetchedSubRows !== null
    ? prefetchedSubRows
    : await dbConn.all(`SELECT subject, expires_at FROM user_subject_subscriptions WHERE user_id = ?`, [user.id]);

  return hasActiveSubjectSubscriptionSync(user, subject, rows);
}

/**
 * Automatically closes expired unsubmitted exam/retake_exam sessions as 0-score timed-out submissions
 * so a student who leaves mid-exam is never deadlocked and appears properly in failed/retake lists.
 */
async function finalizeExpiredAssessmentSessions(dbConn, userId, nowMs = Date.now()) {
  if (!userId) return;
  const expiredSessions = await dbConn.all(
    `SELECT sess.*, a.lesson_id, a.assessment_type
     FROM assessment_sessions sess
     JOIN assessments a ON a.id = sess.assessment_id
     WHERE sess.user_id = ?
       AND sess.submitted_at IS NULL
       AND sess.expires_at < ?
       AND a.assessment_type IN ('exam', 'retake_exam')`,
    [userId, nowMs]
  );
  if (expiredSessions.length === 0) return;

  const finalizeOne = async (tx, sess) => {
    const lockClause = tx.forUpdate ? tx.forUpdate() : '';
    const lockedSess = await tx.get(
      `SELECT id, submitted_at FROM assessment_sessions WHERE id = ? ${lockClause}`,
      [sess.id]
    );
    if (!lockedSess || lockedSess.submitted_at !== null) return;

    const qRows = await tx.all(`SELECT points, topic_tag FROM questions WHERE assessment_id = ?`, [sess.assessment_id]);
    const totalPoints = qRows.reduce((acc, q) => acc + Number(q.points || 0), 0);
    const weakTopics = [...new Set(qRows.map((q) => q.topic_tag).filter(Boolean))];
    const existingSub = await tx.get(
      `SELECT id FROM submissions WHERE user_id = ? AND assessment_id = ? LIMIT 1`,
      [userId, sess.assessment_id]
    );

    await tx.run(`UPDATE assessment_sessions SET submitted_at = ? WHERE id = ? AND submitted_at IS NULL`, [sess.expires_at, sess.id]);
    if (!existingSub) {
      const spentSec = Math.max(1, Math.floor((sess.expires_at - sess.started_at) / 1000));
      await tx.run(
        `INSERT INTO submissions (
           user_id, lesson_id, assessment_id, assessment_type,
           score, total_points, percentage, passed,
           answers_json, weak_topics_json, strong_topics_json, time_spent_seconds, submitted_at
         ) VALUES (?, ?, ?, ?, 0, ?, 0, 0, '[]', ?, '[]', ?, ?)`,
        [userId, sess.lesson_id, sess.assessment_id, sess.assessment_type, totalPoints, JSON.stringify(weakTopics), spentSec, new Date(sess.expires_at).toISOString()]
      );
    }
  };

  for (const sess of expiredSessions) {
    if (typeof dbConn.transaction === 'function') {
      await dbConn.transaction(async (tx) => finalizeOne(tx, sess));
    } else {
      await finalizeOne(dbConn, sess);
    }
  }
}

/**
 * Shared transitive prerequisite evaluator used by BOTH `authorizeLessonAccess()` and `/api/student/dashboard`.
 * Checks ALL preceding lessons (0 .. targetIdx - 1) in the same (grade, subject, branch).
 */
function evaluatePrecedingLessonsGate({
  subjectLessons,
  targetIdx,
  assessmentsByLesson,
  submittedAssessmentIds,
  passedAssessmentIds,
  failedExamByLesson
}) {
  for (let i = 0; i < targetIdx; i++) {
    const prevLesson = subjectLessons[i];
    const prevAssessments = assessmentsByLesson.get(prevLesson.id) || [];

    const activeHomeworks = prevAssessments.filter((a) => a.assessment_type === 'homework' && a.is_active);
    for (const hw of activeHomeworks) {
      if (!submittedAssessmentIds.has(hw.id)) {
        return {
          allowed: false,
          status: 403,
          lockType: 'prerequisite_homework',
          prevLessonId: prevLesson.id,
          reason: `مغلق: يجب أولاً حل واجب الحصة السابقة («${prevLesson.title}»).`
        };
      }
    }

    const activeExams = prevAssessments.filter((a) => (a.assessment_type === 'exam' || a.assessment_type === 'retake_exam') && a.is_active);
    if (activeExams.length > 0) {
      const passedActiveExam = activeExams.some((ex) => passedAssessmentIds.has(ex.id));
      if (!passedActiveExam) {
        const retakes = activeExams.filter((a) => a.assessment_type === 'retake_exam');
        const retakeExam = retakes.length > 0 ? retakes[retakes.length - 1] : null;
        const failedExamSub = failedExamByLesson.get(prevLesson.id);
        if (failedExamSub) {
          return {
            allowed: false,
            status: 403,
            lockType: 'failed_prev_exam',
            prevLessonId: prevLesson.id,
            retakeExam: retakeExam || null,
            reason: retakeExam
              ? `مغلق: لم تتجاوز النصف في امتحان «${prevLesson.title}». اجتز امتحان الإعادة (${retakeExam.title}) لفتح هذه الحصة.`
              : `مغلق: حصلت على (${failedExamSub.score}/${failedExamSub.total_points}) في امتحان «${prevLesson.title}» (يشترط فوق النصف). انتظر موعد امتحان الراسبين.`
          };
        }
        return {
          allowed: false,
          status: 403,
          lockType: 'prerequisite_exam',
          prevLessonId: prevLesson.id,
          reason: `مغلق: يشترط اجتياز امتحان الحصة السابقة («${prevLesson.title}») بمجموع فوق النصف ولو بدرجة واحدة.`
        };
      }
    }
  }
  return { allowed: true, status: 200, reason: null };
}

async function authorizeLessonAccess(user, lessonId, options = {}) {
  const lesson = await db.get(`SELECT * FROM lessons WHERE id = ?`, [Number(lessonId)]);
  if (!lesson) {
    return { allowed: false, status: 404, reason: 'المحاضرة غير موجودة.' };
  }

  if (user.role === 'admin') {
    return { allowed: true, lesson, status: 200, reason: null };
  }

  if (!lesson.is_published) {
    return { allowed: false, status: 403, lockType: 'unpublished', reason: 'هذه المحاضرة غير منشورة حالياً.' };
  }

  if (lesson.grade !== user.grade || !isBranchCompatible(lesson.branch, user.grade, user.branch) || !isSubjectAllowedForGrade(lesson.subject, user.grade)) {
    return {
      allowed: false,
      status: 403,
      lockType: 'grade_branch_mismatch',
      reason: 'غير مصرح لك بفتح محاضرات خاصة بصف دراسي آخر أو شعبة أخرى.'
    };
  }

  const subjectAllowed = await hasActiveSubjectSubscription(db, user, lesson.subject);
  if (!subjectAllowed) {
    return {
      allowed: false,
      status: 403,
      lockType: 'subscription',
      reason: 'يتطلب تفعيل كود اشتراك شهري سارٍ (30 يوماً) لفتح محاضرات هذه المادة.'
    };
  }

  if (options.finalizeExpired !== false) {
    await finalizeExpiredAssessmentSessions(db, user.id, Date.now());
  }

  const branchClause = PREP_GRADES.includes(user.grade)
    ? `branch IN ('general', 'both', 'all')`
    : `(branch = 'both' OR branch = ?)`;
  const branchParams = PREP_GRADES.includes(user.grade) ? [] : [user.branch];
  const subjectLessons = await db.all(
    `SELECT * FROM lessons
     WHERE is_published = 1
       AND grade = ?
       AND subject = ?
       AND ${branchClause}
     ORDER BY order_index ASC, id ASC`,
    [user.grade, lesson.subject, ...branchParams]
  );

  const idx = subjectLessons.findIndex((l) => l.id === lesson.id);
  if (idx <= 0) {
    return { allowed: true, lesson, status: 200, reason: null };
  }

  const prevLessonIds = subjectLessons.slice(0, idx).map((l) => l.id);
  const ph = prevLessonIds.map(() => '?').join(',');
  const activeAssessments = await db.all(
    `SELECT id, lesson_id, title, assessment_type, scheduled_start, scheduled_end, is_active
     FROM assessments
     WHERE lesson_id IN (${ph}) AND is_active = 1
     ORDER BY id ASC`,
    prevLessonIds
  );

  const assessmentsByLesson = new Map();
  for (const a of activeAssessments) {
    if (!assessmentsByLesson.has(a.lesson_id)) assessmentsByLesson.set(a.lesson_id, []);
    assessmentsByLesson.get(a.lesson_id).push(a);
  }

  const subs = await db.all(
    `SELECT assessment_id, lesson_id, assessment_type, passed, score, total_points
     FROM submissions
     WHERE user_id = ? AND lesson_id IN (${ph})
     ORDER BY id DESC`,
    [user.id, ...prevLessonIds]
  );
  const submittedAssessmentIds = new Set();
  const passedAssessmentIds = new Set();
  const failedExamByLesson = new Map();
  for (const s of subs) {
    submittedAssessmentIds.add(s.assessment_id);
    if (s.passed) passedAssessmentIds.add(s.assessment_id);
    if (s.assessment_type === 'exam' && !s.passed && !failedExamByLesson.has(s.lesson_id)) {
      failedExamByLesson.set(s.lesson_id, s);
    }
  }

  const gate = evaluatePrecedingLessonsGate({
    subjectLessons,
    targetIdx: idx,
    assessmentsByLesson,
    submittedAssessmentIds,
    passedAssessmentIds,
    failedExamByLesson
  });

  if (!gate.allowed) {
    return gate;
  }

  return { allowed: true, lesson, status: 200, reason: null };
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function validateScheduleWindow(scheduledStart, scheduledEnd) {
  let startIso = null;
  let endIso = null;
  if (scheduledStart !== null && scheduledStart !== undefined && String(scheduledStart).trim() !== '') {
    const t = Date.parse(String(scheduledStart));
    if (Number.isNaN(t)) return { valid: false, error: 'صيغة تاريخ البداية (scheduled_start) غير صالحة.' };
    startIso = new Date(t).toISOString();
  }
  if (scheduledEnd !== null && scheduledEnd !== undefined && String(scheduledEnd).trim() !== '') {
    const t = Date.parse(String(scheduledEnd));
    if (Number.isNaN(t)) return { valid: false, error: 'صيغة تاريخ النهاية (scheduled_end) غير صالحة.' };
    endIso = new Date(t).toISOString();
  }
  if (startIso && endIso && new Date(startIso).getTime() >= new Date(endIso).getTime()) {
    return { valid: false, error: 'تاريخ بداية الاختبار يجب أن يسبق تاريخ انتهائه.' };
  }
  return { valid: true, scheduledStart: startIso, scheduledEnd: endIso };
}

function validateAndNormalizeQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { valid: false, error: 'يرجى إضافة سؤال واحد على الأقل.', invalidQuestions: [] };
  }
  const invalidQuestions = [];
  const normalized = [];

  questions.forEach((q, idx) => {
    const num = idx + 1;
    const rawType = String(q?.question_type || 'mcq').trim().toLowerCase();
    const questionType = rawType === 'true_false' ? 'true_false' : (rawType === 'mcq' ? 'mcq' : null);
    if (!questionType) {
      invalidQuestions.push({ index: num, reason: 'نوع السؤال يجب أن يكون اختيار من متعدد (mcq) أو صح وخطأ (true_false)' });
      return;
    }

    const text = String(q?.question_text || '').trim();
    if (!text) {
      invalidQuestions.push({ index: num, reason: 'نص السؤال مطلوب' });
      return;
    }

    let opts = [];
    let correct = String(q?.correct_option || '').trim();

    if (questionType === 'true_false') {
      opts = ['صح', 'خطأ'];
      if (correct === 'صحيح' || correct.toLowerCase() === 'true') correct = 'صح';
      if (correct === 'غلط' || correct.toLowerCase() === 'false') correct = 'خطأ';
      if (!opts.includes(correct)) {
        invalidQuestions.push({ index: num, reason: 'الإجابة الصحيحة لسؤال صح أم خطأ يجب أن تكون (صح) أو (خطأ)' });
        return;
      }
    } else {
      opts = Array.isArray(q?.options)
        ? [...new Set(q.options.map((o) => String(o).trim()).filter(Boolean))]
        : [];
      if (opts.length < 2) {
        invalidQuestions.push({ index: num, reason: 'يجب إدخال اختيارين مختلفين على الأقل' });
        return;
      }
      if (!correct || !opts.includes(correct)) {
        invalidQuestions.push({ index: num, reason: 'الإجابة الصحيحة يجب أن تكون ضمن الاختيارات' });
        return;
      }
    }

    const ptsRaw = q?.points === undefined || q?.points === null || String(q.points).trim() === '' ? 2 : Number(q.points);
    if (!Number.isInteger(ptsRaw) || ptsRaw < 1 || ptsRaw > 100) {
      invalidQuestions.push({ index: num, reason: 'درجة السؤال يجب أن تكون رقماً صحيحاً بين ١ و١٠٠' });
      return;
    }

    normalized.push({
      question_type: questionType,
      question_text: text,
      topic_tag: String(q?.topic_tag || 'مباحث الدرس').trim() || 'مباحث الدرس',
      options_json: JSON.stringify(opts),
      correct_option: correct,
      explanation: String(q?.explanation || '').trim(),
      points: ptsRaw
    });
  });

  if (invalidQuestions.length > 0) {
    const first = invalidQuestions[0];
    return {
      valid: false,
      error: `خطأ في السؤال رقم ${first.index}: ${first.reason}.`,
      invalidQuestions
    };
  }
  return { valid: true, normalized };
}

function isAssessmentWindowOpen(assessment, nowMs = Date.now(), graceMs = 0) {
  if (assessment.scheduled_start) {
    const startMs = new Date(assessment.scheduled_start).getTime();
    if (!Number.isNaN(startMs) && startMs > nowMs) {
      return {
        open: false,
        reason: `سيفتح الاختبار في الموعد المحدد: ${new Date(startMs).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}`
      };
    }
  }
  if (assessment.scheduled_end) {
    const endMs = new Date(assessment.scheduled_end).getTime();
    if (!Number.isNaN(endMs) && nowMs > endMs + graceMs) {
      return {
        open: false,
        expired: true,
        reason: `انتهى موعد الاختبار المحدد في: ${new Date(endMs).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}`
      };
    }
  }
  return { open: true };
}

function canRevealSubmissionReview(user, assessment) {
  if (user && user.role === 'admin') return true;
  if (!assessment || assessment.assessment_type === 'homework') return true;
  if (!assessment.scheduled_end) return true;
  return Date.now() >= new Date(assessment.scheduled_end).getTime();
}

module.exports = {
  runInTransaction,
  getPlatformSetting,
  isBranchCompatible,
  validateVoucherForPhoneAndGrade,
  hasActiveSubjectSubscriptionSync,
  hasActiveSubjectSubscription,
  finalizeExpiredAssessmentSessions,
  evaluatePrecedingLessonsGate,
  authorizeLessonAccess,
  shuffleArray,
  validateScheduleWindow,
  validateAndNormalizeQuestions,
  isAssessmentWindowOpen,
  canRevealSubmissionReview
};
