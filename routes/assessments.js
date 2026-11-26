const { db } = require('../database');
const { parsePositiveInt, safeJsonParse } = require('../lib/constants');
const { sendJson, parseBody } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { dispatchWhatsApp } = require('../services/whatsapp');
const { recordStudyActivity } = require('../services/gamification');
const {
  runInTransaction,
  authorizeLessonAccess,
  finalizeExpiredAssessmentSessions,
  shuffleArray,
  isAssessmentWindowOpen,
  canRevealSubmissionReview
} = require('../services/gating');

async function handleAssessmentRoutes(req, res, ctx) {
  const { pathname } = ctx;

  if (pathname.startsWith('/api/assessments/') && pathname.endsWith('/start') && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const assessmentId = parsePositiveInt(pathname.split('/')[3]);
    const assessment = assessmentId ? await db.get(`SELECT * FROM assessments WHERE id = ? AND is_active = 1`, [assessmentId]) : null;
    if (!assessment) {
      sendJson(req, res, 404, { error: 'الاختبار غير موجود.' });
      return true;
    }

    const access = await authorizeLessonAccess(user, assessment.lesson_id, { finalizeExpired: false });
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    if (user.role === 'student') {
      const winCheck = isAssessmentWindowOpen(assessment, Date.now(), 0);
      if (!winCheck.open) {
        sendJson(req, res, 403, { error: winCheck.reason });
        return true;
      }
    }

    const nowMs = Date.now();
    const startTx = await runInTransaction(async (tx) => {
      const lockClause = tx.forUpdate();
      await tx.get(`SELECT id FROM users WHERE id = ? ${lockClause}`, [user.id]);

      if (user.role === 'student') {
        await finalizeExpiredAssessmentSessions(tx, user.id, nowMs);

        if (assessment.assessment_type === 'exam') {
          const existingExamSub = await tx.get(
            `SELECT * FROM submissions WHERE user_id = ? AND assessment_id = ? LIMIT 1`,
            [user.id, assessment.id]
          );
          if (existingExamSub) {
            return {
              ok: false,
              status: 403,
              error_code: 'EXAM_ALREADY_TAKEN',
              error: existingExamSub.passed
                ? `لقد اجتزت هذا الامتحان بالفعل (${existingExamSub.score}/${existingExamSub.total_points}).`
                : `لقد أديت هذا الامتحان وحصلت على (${existingExamSub.score}/${existingExamSub.total_points}). لا يمكن إعادة الامتحان الأساسي إلا عبر امتحان الراسبين الذي يحدده الأدمن.`
            };
          }
        }

        if (assessment.assessment_type === 'retake_exam') {
          const targetIds = safeJsonParse(assessment.target_student_ids_json, []);
          const failedMain = await tx.get(
            `SELECT id FROM submissions WHERE user_id = ? AND lesson_id = ? AND assessment_type = 'exam' AND passed = 0 LIMIT 1`,
            [user.id, assessment.lesson_id]
          );
          const alreadyPassed = await tx.get(
            `SELECT id FROM submissions WHERE user_id = ? AND lesson_id = ? AND assessment_type IN ('exam', 'retake_exam') AND passed = 1 LIMIT 1`,
            [user.id, assessment.lesson_id]
          );

          if (alreadyPassed || (!failedMain && !targetIds.includes(user.id))) {
            return { ok: false, status: 403, error: 'هذا الامتحان مخصص للطلاب الراسبين المستهدفين في هذه المحاضرة فقط.' };
          }
          if (targetIds.length > 0 && !targetIds.includes(user.id)) {
            return { ok: false, status: 403, error: 'اسمك غير مدرج في قائمة الطلاب المستهدفين لهذا الملحق.' };
          }

          const existingRetakeSub = await tx.get(
            `SELECT id FROM submissions WHERE user_id = ? AND assessment_id = ? LIMIT 1`,
            [user.id, assessment.id]
          );
          if (existingRetakeSub) {
            return { ok: false, status: 403, error: 'لقد قمت بتأدية امتحان الإعادة هذا بالفعل.' };
          }
        }
      }

      let session = await tx.get(
        `SELECT * FROM assessment_sessions
         WHERE user_id = ? AND assessment_id = ? AND submitted_at IS NULL
         ORDER BY id DESC LIMIT 1 ${lockClause}`,
        [user.id, assessment.id]
      );

      if (!session || (assessment.assessment_type === 'homework' && nowMs > session.expires_at)) {
        const expiresAt = nowMs + assessment.time_limit_minutes * 60 * 1000;
        const ins = await tx.run(
          `INSERT INTO assessment_sessions (user_id, assessment_id, started_at, expires_at, submitted_at)
           VALUES (?, ?, ?, ?, NULL)`,
          [user.id, assessment.id, nowMs, expiresAt]
        );
        session = { id: ins.lastInsertRowid, started_at: nowMs, expires_at: expiresAt };
      }

      const remainingSeconds = Math.max(0, Math.floor((session.expires_at - nowMs) / 1000));
      if (remainingSeconds <= 0 && assessment.assessment_type !== 'homework') {
        return { ok: false, status: 403, error: 'انتهى الوقت المخصص لمحاولتك في هذا الامتحان.' };
      }
      return { ok: true, session, remainingSeconds };
    });

    if (!startTx.ok) {
      sendJson(req, res, startTx.status, {
        ...(startTx.error_code ? { error_code: startTx.error_code } : {}),
        error: startTx.error
      });
      return true;
    }

    const { session, remainingSeconds } = startTx;

    const rawQuestions = await db.all(`SELECT * FROM questions WHERE assessment_id = ?`, [assessment.id]);
    const randomizedQuestions = shuffleArray(rawQuestions).map((q, idx) => {
      const qType = q.question_type === 'true_false' ? 'true_false' : 'mcq';
      const parsedOptions = safeJsonParse(q.options_json, []);
      return {
        id: q.id,
        display_number: idx + 1,
        question_type: qType,
        question_text: q.question_text,
        topic_tag: q.topic_tag,
        options: qType === 'true_false' ? ['صح', 'خطأ'] : shuffleArray(parsedOptions),
        points: q.points
      };
    });

    sendJson(req, res, 200, {
      assessment: {
        id: assessment.id,
        session_id: session.id,
        lesson_id: assessment.lesson_id,
        lesson_title: access.lesson.title,
        title: assessment.title,
        assessment_type: assessment.assessment_type,
        time_limit_minutes: assessment.time_limit_minutes,
        scheduled_start: assessment.scheduled_start,
        scheduled_end: assessment.scheduled_end,
        remaining_seconds: remainingSeconds
      },
      questions: randomizedQuestions
    });
    return true;
  }

  if (pathname.startsWith('/api/assessments/') && pathname.endsWith('/submit') && req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const assessmentId = parsePositiveInt(pathname.split('/')[3]);
    const assessment = assessmentId ? await db.get(`SELECT * FROM assessments WHERE id = ? AND is_active = 1`, [assessmentId]) : null;
    if (!assessment) {
      sendJson(req, res, 404, { error: 'الاختبار غير موجود.' });
      return true;
    }

    const access = await authorizeLessonAccess(user, assessment.lesson_id, { finalizeExpired: false });
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    const session = await db.get(
      `SELECT * FROM assessment_sessions
       WHERE user_id = ? AND assessment_id = ? AND submitted_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [user.id, assessment.id]
    );

    if (!session) {
      sendJson(req, res, 403, { error: 'لا توجد جلسة اختبار نشطة أو تم تسليم الاختبار مسبقاً.' });
      return true;
    }

    if (user.role === 'student' && ['exam', 'retake_exam'].includes(assessment.assessment_type)) {
      const duplicateSub = await db.get(
        `SELECT id FROM submissions WHERE user_id = ? AND assessment_id = ? LIMIT 1`,
        [user.id, assessment.id]
      );
      if (duplicateSub) {
        sendJson(req, res, 403, { error: 'تم تسليم هذا الامتحان مسبقاً ولا يمكن إرساله مرتين.' });
        return true;
      }
    }

    if (user.role === 'student' && assessment.assessment_type === 'retake_exam') {
      const targetIds = safeJsonParse(assessment.target_student_ids_json, []);
      if (targetIds.length > 0 && !targetIds.includes(user.id)) {
        sendJson(req, res, 403, { error: 'اسمك غير مدرج في قائمة الطلاب المستهدفين لهذا الملحق.' });
        return true;
      }
      const failedMain = await db.get(
        `SELECT id FROM submissions WHERE user_id = ? AND lesson_id = ? AND assessment_type = 'exam' AND passed = 0 LIMIT 1`,
        [user.id, assessment.lesson_id]
      );
      const alreadyPassed = await db.get(
        `SELECT id FROM submissions WHERE user_id = ? AND lesson_id = ? AND assessment_type IN ('exam', 'retake_exam') AND passed = 1 LIMIT 1`,
        [user.id, assessment.lesson_id]
      );
      if (alreadyPassed || (!failedMain && !targetIds.includes(user.id))) {
        sendJson(req, res, 403, { error: 'هذا الامتحان مخصص للطلاب الراسبين المستهدفين في هذه المحاضرة فقط.' });
        return true;
      }
    }

    const body = await parseBody(req, 64 * 1024);

    const nowMs = Date.now();
    const graceMs = 30 * 1000;

    if (user.role === 'student' && assessment.scheduled_start) {
      const startMs = new Date(assessment.scheduled_start).getTime();
      if (!Number.isNaN(startMs) && startMs > nowMs) {
        sendJson(req, res, 403, { error: `لم يبدأ موعد الاختبار بعد (${new Date(startMs).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' })}).` });
        return true;
      }
    }

    const windowCheck = isAssessmentWindowOpen(assessment, nowMs, graceMs);
    if (assessment.assessment_type === 'homework' && !windowCheck.open) {
      sendJson(req, res, 403, { error: windowCheck.reason });
      return true;
    }

    const timedOut = assessment.assessment_type !== 'homework' && (
      nowMs > session.expires_at + graceMs || (!windowCheck.open && Boolean(windowCheck.expired))
    );

    const serverTimeSpentSeconds = Math.max(1, Math.floor((nowMs - session.started_at) / 1000));
    const studentAnswers = (!timedOut && body.answers && typeof body.answers === 'object') ? body.answers : {};
    const questions = await db.all(`SELECT * FROM questions WHERE assessment_id = ?`, [assessmentId]);

    let score = 0;
    let totalPoints = 0;
    const detailedReview = [];
    const topicStats = Object.create(null);

    for (const q of questions) {
      totalPoints += q.points;
      const selected = timedOut ? '' : String(studentAnswers[q.id] || '').trim();
      const isCorrect = !timedOut && selected === q.correct_option.trim();
      if (isCorrect) score += q.points;

      if (!topicStats[q.topic_tag]) topicStats[q.topic_tag] = { earned: 0, total: 0 };
      topicStats[q.topic_tag].total += q.points;
      if (isCorrect) topicStats[q.topic_tag].earned += q.points;

      detailedReview.push({
        question_id: q.id,
        question_type: q.question_type || 'mcq',
        question_text: q.question_text,
        topic_tag: q.topic_tag,
        selected_option: selected || (timedOut ? 'انتهى الوقت' : 'لم يتم الاختيار'),
        correct_option: q.correct_option,
        is_correct: isCorrect,
        points_earned: isCorrect ? q.points : 0,
        points_total: q.points,
        explanation: q.explanation
      });
    }

    const passed = (!timedOut && score > (totalPoints / 2)) ? 1 : 0;
    const percentage = timedOut ? 0 : (totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 100);

    const weakTopics = [];
    const strongTopics = [];
    for (const [topic, st] of Object.entries(topicStats)) {
      if (st.earned <= st.total / 2) weakTopics.push(topic);
      else strongTopics.push(topic);
    }

    const nowIso = new Date(nowMs).toISOString();
    const txOut = await runInTransaction(async (tx) => {
      const lockSql = tx.forUpdate();
      await tx.get(`SELECT id FROM users WHERE id = ? ${lockSql}`, [user.id]);

      if (user.role === 'student' && ['exam', 'retake_exam'].includes(assessment.assessment_type)) {
        const dup = await tx.get(`SELECT id FROM submissions WHERE user_id = ? AND assessment_id = ? LIMIT 1`, [user.id, assessment.id]);
        if (dup) return { ok: false, status: 403, error: 'تم تسليم هذا الامتحان مسبقاً ولا يمكن إرساله مرتين.' };
      }

      const lockedSess = await tx.get(
        `SELECT id, submitted_at FROM assessment_sessions WHERE id = ? ${lockSql}`,
        [session.id]
      );
      if (!lockedSess || lockedSess.submitted_at !== null) {
        return { ok: false, status: 403, error: 'تم تسليم هذه الجلسة مسبقاً.' };
      }

      const sessUpd = await tx.run(
        `UPDATE assessment_sessions SET submitted_at = ? WHERE id = ? AND submitted_at IS NULL`,
        [nowMs, session.id]
      );

      if (sessUpd.changes !== 1) {
        return { ok: false, status: 403, error: 'تم تسليم هذه الجلسة مسبقاً.' };
      }

      const storedAnswers = timedOut ? [] : detailedReview;
      const subResult = await tx.run(
        `INSERT INTO submissions (
          user_id, lesson_id, assessment_id, assessment_type,
          score, total_points, percentage, passed,
          answers_json, weak_topics_json, strong_topics_json, time_spent_seconds, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          assessment.lesson_id,
          assessment.id,
          assessment.assessment_type,
          score,
          totalPoints,
          percentage,
          passed,
          JSON.stringify(storedAnswers),
          JSON.stringify(weakTopics),
          JSON.stringify(strongTopics),
          serverTimeSpentSeconds,
          nowIso
        ]
      );
      return { ok: true, submissionId: subResult.lastInsertRowid };
    });

    if (!txOut.ok) {
      sendJson(req, res, txOut.status, { error: txOut.error });
      return true;
    }

    if (user.role === 'student') await recordStudyActivity(db, user.id);

    if (user.parent_phone && ['exam', 'retake_exam'].includes(assessment.assessment_type)) {
      const statusLabel = passed ? 'ناجح ومجتاز ✅' : (timedOut ? 'انتهى الوقت (صفر) ⚠️' : 'راسب (يحتاج دخول امتحان الإعادة) ⚠️');
      const msg = `منصة مَتْن - نتيجة الطالب (${user.full_name}) في (${assessment.title}): ${score}/${totalPoints} (${percentage}%) - ${statusLabel}`;
      await dispatchWhatsApp(user.parent_phone, user.full_name, 'exam_result', msg, `إشعار نتيجة اختبار (${percentage}%)`);
    }

    const revealReview = canRevealSubmissionReview(user, assessment);
    sendJson(req, res, 200, {
      submission_id: txOut.submissionId,
      score,
      total_points: totalPoints,
      minimum_to_pass: Math.floor(totalPoints / 2) + 1,
      percentage,
      passed: Boolean(passed),
      timed_out: timedOut,
      time_spent_seconds: serverTimeSpentSeconds,
      weak_topics: revealReview ? weakTopics : [],
      strong_topics: revealReview ? strongTopics : [],
      answers_hidden: !revealReview,
      review_available_at: revealReview ? null : assessment.scheduled_end,
      ...(revealReview ? { detailed_review: detailedReview } : {}),
      message: timedOut
        ? '⏰ انتهى الوقت المحدد للامتحان وتم تسجيل المحاولة بدرجة صفر.'
        : (passed
          ? `🎉 أحسنت! حصلت على ${score} من ${totalPoints} (فوق النصف) وتم فتح خطوة التقدم التالية.`
          : `⚠️ حصلت على ${score} من ${totalPoints} (النجاح يتطلب ${Math.floor(totalPoints / 2) + 1} درجات على الأقل).`)
    });
    return true;
  }

  if (pathname.startsWith('/api/submissions/') && pathname.endsWith('/review') && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const submissionId = parsePositiveInt(pathname.split('/')[3]);
    const sub = submissionId ? await db.get(
      `SELECT s.*, a.title AS assessment_title, a.scheduled_end AS assessment_scheduled_end
       FROM submissions s
       JOIN assessments a ON a.id = s.assessment_id
       WHERE s.id = ?`,
      [submissionId]
    ) : null;

    if (!sub) {
      sendJson(req, res, 404, { error: 'نتيجة الاختبار غير موجودة.' });
      return true;
    }
    if (user.role !== 'admin' && sub.user_id !== user.id) {
      sendJson(req, res, 403, { error: 'غير مصرح لك بعرض مراجعة طالب آخر.' });
      return true;
    }
    if (!canRevealSubmissionReview(user, { assessment_type: sub.assessment_type, scheduled_end: sub.assessment_scheduled_end })) {
      sendJson(req, res, 403, {
        error: 'نموذج الإجابة والتعليل غير متاح قبل انتهاء الموعد المحدد للامتحان.',
        review_available_at: sub.assessment_scheduled_end
      });
      return true;
    }

    sendJson(req, res, 200, {
      submission_id: sub.id,
      assessment_id: sub.assessment_id,
      assessment_title: sub.assessment_title,
      score: sub.score,
      total_points: sub.total_points,
      percentage: sub.percentage,
      passed: Boolean(sub.passed),
      detailed_review: safeJsonParse(sub.answers_json, [])
    });
    return true;
  }

  return false;
}

module.exports = { handleAssessmentRoutes };
