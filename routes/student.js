const { db } = require('../database');
const { PREP_GRADES, isSubjectAllowedForGrade, parsePositiveInt, safeJsonParse, sanitizeUser } = require('../lib/constants');
const { checkRateLimit, sendJson, parseBody } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../services/audit');
const {
  authorizeLessonAccess,
  isBranchCompatible,
  hasActiveSubjectSubscriptionSync,
  finalizeExpiredAssessmentSessions,
  evaluatePrecedingLessonsGate,
  canRevealSubmissionReview,
  getPlatformSetting
} = require('../services/gating');
const { ensureSubscriptionExpiringNotification } = require('../services/notifications');
const { recordStudyActivity, computeStudyStreak, computeStudentBadges } = require('../services/gamification');

async function handleStudentRoutes(req, res, ctx) {
  const { pathname, urlObj } = ctx;

  if (pathname === '/api/student/dashboard' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    await ensureSubscriptionExpiringNotification(db, user);
    if (user.role === 'student') {
      await recordStudyActivity(db, user.id);
      await finalizeExpiredAssessmentSessions(db, user.id, Date.now());
    }

    const gradeFilter = user.role === 'admin' ? (urlObj.searchParams.get('grade') || user.grade) : user.grade;
    const branchFilter = user.role === 'admin'
      ? (urlObj.searchParams.get('branch') || (PREP_GRADES.includes(gradeFilter) ? 'general' : user.branch))
      : user.branch;

    const lessons = (await db.all(
      `SELECT * FROM lessons
       WHERE is_published = 1
         AND grade = ?
       ORDER BY subject ASC, order_index ASC, id ASC`,
      [gradeFilter]
    )).filter((l) => isBranchCompatible(l.branch, gradeFilter, branchFilter) && isSubjectAllowedForGrade(l.subject, gradeFilter));

    const assessmentsByLesson = new Map();
    if (lessons.length > 0) {
      const lPlaceholders = lessons.map(() => '?').join(',');
      const allAssessments = await db.all(
        `SELECT a.id, a.lesson_id, a.title, a.assessment_type, a.time_limit_minutes,
                a.scheduled_start, a.scheduled_end, a.target_student_ids_json, a.is_active,
                (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id) AS questions_count
         FROM assessments a
         WHERE a.lesson_id IN (${lPlaceholders}) AND a.is_active = 1
         ORDER BY CASE a.assessment_type WHEN 'homework' THEN 1 WHEN 'exam' THEN 2 WHEN 'retake_exam' THEN 3 END, a.id ASC`,
        lessons.map((l) => l.id)
      );

      for (const a of allAssessments) {
        if (!assessmentsByLesson.has(a.lesson_id)) assessmentsByLesson.set(a.lesson_id, []);
        assessmentsByLesson.get(a.lesson_id).push(a);
      }
    }

    const rawUserSubmissions = await db.all(
      `SELECT s.id, s.lesson_id, s.assessment_id, s.assessment_type, s.score, s.total_points,
              s.percentage, s.passed, s.weak_topics_json, s.strong_topics_json, s.time_spent_seconds, s.submitted_at,
              a.title AS assessment_title, a.scheduled_end AS assessment_scheduled_end,
              l.title AS lesson_title, l.subject
       FROM submissions s
       JOIN assessments a ON a.id = s.assessment_id
       JOIN lessons l ON l.id = s.lesson_id
       WHERE s.user_id = ?
       ORDER BY s.id DESC`,
      [user.id]
    );

    const latestSubByAssessment = new Map();
    const submittedAssessmentIds = new Set();
    const passedAssessmentIds = new Set();
    const passedExamByLesson = new Set();
    const failedMainByLesson = new Map();

    const submissions = rawUserSubmissions.map((s) => {
      submittedAssessmentIds.add(s.assessment_id);
      if (s.passed) passedAssessmentIds.add(s.assessment_id);
      if (!latestSubByAssessment.has(s.assessment_id)) latestSubByAssessment.set(s.assessment_id, s);
      if (['exam', 'retake_exam'].includes(s.assessment_type) && s.passed) passedExamByLesson.add(s.lesson_id);
      if (s.assessment_type === 'exam' && !s.passed && !failedMainByLesson.has(s.lesson_id)) {
        failedMainByLesson.set(s.lesson_id, s);
      }
      const reviewAllowed = canRevealSubmissionReview(user, { assessment_type: s.assessment_type, scheduled_end: s.assessment_scheduled_end });
      return {
        ...s,
        weak_topics: reviewAllowed ? safeJsonParse(s.weak_topics_json, []) : [],
        strong_topics: reviewAllowed ? safeJsonParse(s.strong_topics_json, []) : [],
        review_allowed: reviewAllowed
      };
    });

    const userSubjectSubs = user.role === 'student'
      ? await db.all(`SELECT subject, expires_at FROM user_subject_subscriptions WHERE user_id = ?`, [user.id])
      : [];

    const progressRows = await db.all(
      `SELECT lesson_id, last_position_seconds, duration_seconds, max_watched_percent, updated_at
       FROM lesson_progress WHERE user_id = ?`,
      [user.id]
    );
    const progressByLesson = new Map();
    for (const p of progressRows) progressByLesson.set(p.lesson_id, p);

    const lessonsBySubject = new Map();
    for (const lesson of lessons) {
      if (!lessonsBySubject.has(lesson.subject)) lessonsBySubject.set(lesson.subject, []);
      lessonsBySubject.get(lesson.subject).push(lesson);
    }

    const enrichedLessons = lessons.map((lesson) => {
      let authAllowed = true;
      let lockType = null;
      let lockReason = null;
      let retakeExam = null;

      if (user.role !== 'admin') {
        if (lesson.grade !== user.grade || !isBranchCompatible(lesson.branch, user.grade, user.branch) || !isSubjectAllowedForGrade(lesson.subject, user.grade)) {
          authAllowed = false;
          lockType = 'grade_branch_mismatch';
          lockReason = 'غير مصرح لك بفتح محاضرات خاصة بصف دراسي آخر أو شعبة أخرى.';
        } else if (!hasActiveSubjectSubscriptionSync(user, lesson.subject, userSubjectSubs)) {
          authAllowed = false;
          lockType = 'subscription';
          lockReason = 'يتطلب تفعيل كود اشتراك شهري سارٍ (30 يوماً) لفتح محاضرات هذه المادة.';
        } else {
          const subjectLessons = lessonsBySubject.get(lesson.subject) || [];
          const targetIdx = subjectLessons.findIndex((l) => l.id === lesson.id);
          const gate = evaluatePrecedingLessonsGate({
            subjectLessons,
            targetIdx,
            assessmentsByLesson,
            submittedAssessmentIds,
            passedAssessmentIds,
            failedExamByLesson: failedMainByLesson
          });
          if (!gate.allowed) {
            authAllowed = false;
            lockType = gate.lockType;
            lockReason = gate.reason;
            retakeExam = gate.retakeExam;
          }
        }
      }

      const lessonAssessments = (assessmentsByLesson.get(lesson.id) || [])
        .filter((a) => {
          if (a.assessment_type !== 'retake_exam' || user.role === 'admin') return true;
          if (latestSubByAssessment.has(a.id)) return true;
          if (passedExamByLesson.has(lesson.id)) return false;
          const targets = safeJsonParse(a.target_student_ids_json, []);
          if (targets.length > 0) return targets.includes(user.id);
          return failedMainByLesson.has(lesson.id);
        })
        .map((a) => {
          const latestSub = latestSubByAssessment.get(a.id);
          const reviewAllowed = canRevealSubmissionReview(user, a);
          return {
            id: a.id,
            lesson_id: a.lesson_id,
            title: a.title,
            assessment_type: a.assessment_type,
            time_limit_minutes: a.time_limit_minutes,
            scheduled_start: a.scheduled_start,
            scheduled_end: a.scheduled_end,
            questions_count: Number(a.questions_count || 0),
            latest_submission: latestSub ? {
              id: latestSub.id,
              score: latestSub.score,
              total_points: latestSub.total_points,
              percentage: latestSub.percentage,
              passed: latestSub.passed,
              submitted_at: latestSub.submitted_at,
              weak_topics: reviewAllowed ? safeJsonParse(latestSub.weak_topics_json, []) : [],
              strong_topics: reviewAllowed ? safeJsonParse(latestSub.strong_topics_json, []) : [],
              review_allowed: reviewAllowed
            } : null
          };
        });

      return {
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        subject: lesson.subject,
        grade: lesson.grade,
        branch: lesson.branch,
        unit_title: lesson.unit_title,
        order_index: lesson.order_index,
        video_type: lesson.video_type,
        has_uploaded_video: Boolean(lesson.video_path && lesson.video_path.startsWith('uploads/videos/')),
        bunny_video: Boolean(lesson.video_type === 'bunny' && lesson.video_path),
        duration_minutes: lesson.duration_minutes,
        pdf_title: lesson.pdf_title,
        unlocked: authAllowed,
        lock_type: lockType,
        lock_reason: lockReason,
        retake_exam_info: retakeExam ? {
          id: retakeExam.id,
          title: retakeExam.title,
          scheduled_start: retakeExam.scheduled_start,
          scheduled_end: retakeExam.scheduled_end
        } : null,
        assessments: lessonAssessments,
        progress: progressByLesson.get(lesson.id) || {
          last_position_seconds: 0,
          duration_seconds: 0,
          max_watched_percent: 0
        }
      };
    });

    const weaknessMap = Object.create(null);
    const strengthMap = Object.create(null);
    for (const sub of submissions) {
      for (const topic of sub.weak_topics) weaknessMap[topic] = (weaknessMap[topic] || 0) + 1;
      for (const topic of sub.strong_topics) strengthMap[topic] = (strengthMap[topic] || 0) + 1;
    }

    const failedLessonIds = Array.from(failedMainByLesson.keys()).filter((lid) => !passedExamByLesson.has(lid));
    let scheduledRetakes = [];
    if (user.role === 'student') {
      const candidateLessonIds = Array.from(new Set([
        ...failedLessonIds,
        ...lessons.filter((l) => !passedExamByLesson.has(l.id)).map((l) => l.id)
      ]));
      if (candidateLessonIds.length > 0) {
        const placeholders = candidateLessonIds.map(() => '?').join(',');
        const rawRetakes = await db.all(
          `SELECT a.id, a.lesson_id, a.title, a.time_limit_minutes, a.scheduled_start, a.scheduled_end,
                  a.target_student_ids_json, l.title AS lesson_title, l.subject
           FROM assessments a
           JOIN lessons l ON l.id = a.lesson_id
           WHERE a.lesson_id IN (${placeholders}) AND a.assessment_type = 'retake_exam' AND a.is_active = 1`,
          candidateLessonIds
        );
        scheduledRetakes = rawRetakes.filter((r) => {
          if (latestSubByAssessment.has(r.id)) return false;
          if (passedExamByLesson.has(r.lesson_id)) return false;
          const targets = safeJsonParse(r.target_student_ids_json, []);
          if (targets.length > 0) return targets.includes(user.id);
          return failedMainByLesson.has(r.lesson_id);
        });
      }
    }

    const honorRollEnabled = (await getPlatformSetting('honor_roll_enabled', '1')) === '1';
    let honorRoll = [];
    if (honorRollEnabled) {
      honorRoll = await db.all(
        `SELECT u.full_name, ROUND(AVG(s.percentage), 1) AS avg_percentage, COUNT(s.id) AS exams_count
         FROM submissions s
         JOIN users u ON u.id = s.user_id
         WHERE u.role = 'student' AND u.is_locked = 0 AND u.grade = ?
           AND s.assessment_type IN ('exam', 'retake_exam')
         GROUP BY u.id, u.full_name
         HAVING COUNT(s.id) >= 1
         ORDER BY avg_percentage DESC, exams_count DESC, MAX(s.submitted_at) ASC
         LIMIT 5`,
        [gradeFilter]
      );
    }

    const studyStreak = await computeStudyStreak(db, user.id);
    const badges = computeStudentBadges({ studyStreak, lessons: enrichedLessons, submissions });
    const azharExamDate = await getPlatformSetting('azhar_exam_date', '');

    sendJson(req, res, 200, {
      user: sanitizeUser(user),
      lessons: enrichedLessons,
      submissions,
      weakness_summary: Object.entries(weaknessMap).map(([topic, count]) => ({ topic, count })),
      strength_summary: Object.entries(strengthMap).map(([topic, count]) => ({ topic, count })),
      scheduled_retakes: scheduledRetakes,
      honor_roll_enabled: honorRollEnabled,
      honor_roll: honorRoll,
      study_streak: studyStreak,
      badges,
      azhar_exam_date: azharExamDate
    });
    return true;
  }

  if (pathname === '/api/student/mistakes' && req.method === 'GET') {
    const user = await requireAuth(req, res);
    if (!user) return true;

    const subjectFilter = String(urlObj.searchParams.get('subject') || '').trim();
    const rawSubs = await db.all(
      `SELECT s.id AS submission_id, s.lesson_id, s.assessment_id, s.assessment_type,
              s.answers_json, s.submitted_at,
              a.title AS assessment_title, a.scheduled_end AS assessment_scheduled_end,
              l.title AS lesson_title, l.subject, l.grade
       FROM submissions s
       JOIN assessments a ON a.id = s.assessment_id
       JOIN lessons l ON l.id = s.lesson_id
       WHERE s.user_id = ?
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT 120`,
      [user.id]
    );

    const questionIdSet = new Set();
    const parsedSubs = [];
    for (const sub of rawSubs) {
      if (!canRevealSubmissionReview(user, { assessment_type: sub.assessment_type, scheduled_end: sub.assessment_scheduled_end })) {
        continue;
      }
      const reviewItems = safeJsonParse(sub.answers_json, []);
      if (!Array.isArray(reviewItems)) continue;
      parsedSubs.push({ sub, reviewItems });
      for (const item of reviewItems) {
        const qId = parsePositiveInt(item?.question_id);
        if (qId) questionIdSet.add(qId);
      }
    }

    const questionMetaMap = new Map();
    const qIds = Array.from(questionIdSet);
    if (qIds.length > 0) {
      const qPlaceholders = qIds.map(() => '?').join(',');
      const questionMetaRows = await db.all(
        `SELECT id, question_type, options_json FROM questions WHERE id IN (${qPlaceholders})`,
        qIds
      );
      for (const qm of questionMetaRows) {
        questionMetaMap.set(qm.id, {
          question_type: qm.question_type || 'mcq',
          options: safeJsonParse(qm.options_json, [])
        });
      }
    }

    const mistakesMap = new Map();
    const subjectCounts = Object.create(null);

    for (const { sub, reviewItems } of parsedSubs) {
      for (const item of reviewItems) {
        if (!item || item.is_correct) continue;
        subjectCounts[sub.subject] = (subjectCounts[sub.subject] || 0) + 1;
        if (subjectFilter && subjectFilter !== 'all' && sub.subject !== subjectFilter) continue;

        const dedupeKey = item.question_id ? `q_${item.question_id}` : `s_${sub.submission_id}_${item.question_text}`;
        if (mistakesMap.has(dedupeKey)) continue;

        const qMeta = item.question_id ? questionMetaMap.get(item.question_id) : null;
        const qType = item.question_type || qMeta?.question_type || 'mcq';
        const options = qType === 'true_false'
          ? ['صح', 'خطأ']
          : (Array.isArray(qMeta?.options) && qMeta.options.length > 0 ? qMeta.options : [item.correct_option, item.selected_option].filter(Boolean));

        mistakesMap.set(dedupeKey, {
          question_id: item.question_id || null,
          question_type: qType,
          question_text: item.question_text,
          topic_tag: item.topic_tag,
          selected_option: item.selected_option,
          correct_option: item.correct_option,
          explanation: item.explanation || '',
          options,
          subject: sub.subject,
          grade: sub.grade,
          lesson_id: sub.lesson_id,
          lesson_title: sub.lesson_title,
          assessment_id: sub.assessment_id,
          assessment_title: sub.assessment_title,
          submission_id: sub.submission_id,
          submitted_at: sub.submitted_at
        });
      }
    }

    const mistakes = Array.from(mistakesMap.values());
    sendJson(req, res, 200, {
      mistakes,
      total_count: mistakes.length,
      subject_counts: subjectCounts
    });
    return true;
  }

  const noteDeleteMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/notes\/([^/]+)$/);
  if (noteDeleteMatch && req.method === 'DELETE') {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const lessonId = parsePositiveInt(noteDeleteMatch[1]);
    const noteId = parsePositiveInt(noteDeleteMatch[2]);
    if (!lessonId || !noteId) {
      sendJson(req, res, 404, { error: 'الملاحظة غير موجودة.' });
      return true;
    }

    const existingNote = await db.get(`SELECT id, user_id, lesson_id FROM lesson_notes WHERE id = ? AND lesson_id = ?`, [noteId, lessonId]);
    if (!existingNote) {
      sendJson(req, res, 404, { error: 'الملاحظة غير موجودة.' });
      return true;
    }
    if (user.role !== 'admin' && existingNote.user_id !== user.id) {
      sendJson(req, res, 403, { error: 'غير مصرح لك بحذف ملاحظة طالب آخر.' });
      return true;
    }
    await db.run(`DELETE FROM lesson_notes WHERE id = ?`, [noteId]);
    sendJson(req, res, 200, { message: 'تم حذف الملاحظة بنجاح.' });
    return true;
  }

  const lessonActionMatch = pathname.match(/^\/api\/lessons\/([^/]+)\/(progress|questions|notes)$/);
  if (lessonActionMatch) {
    const user = await requireAuth(req, res);
    if (!user) return true;
    const lessonId = parsePositiveInt(lessonActionMatch[1]);
    if (!lessonId) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const access = await authorizeLessonAccess(user, lessonId);
    if (!access.allowed) {
      sendJson(req, res, access.status || 403, { error: access.reason });
      return true;
    }

    if (lessonActionMatch[2] === 'progress' && req.method === 'POST') {
      const body = await parseBody(req, 8 * 1024);
      const pos = Math.max(0, Math.floor(Number(body.position_seconds || 0) || 0));
      const dur = Math.max(0, Math.floor(Number(body.duration_seconds || 0) || 0));
      const pct = dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;
      const nowIso = new Date().toISOString();

      const upsertSql = db.isMysql
        ? `INSERT INTO lesson_progress (user_id, lesson_id, last_position_seconds, duration_seconds, max_watched_percent, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             last_position_seconds = VALUES(last_position_seconds),
             duration_seconds = IF(VALUES(duration_seconds) > 0, VALUES(duration_seconds), duration_seconds),
             max_watched_percent = GREATEST(max_watched_percent, VALUES(max_watched_percent)),
             updated_at = VALUES(updated_at)`
        : `INSERT INTO lesson_progress (user_id, lesson_id, last_position_seconds, duration_seconds, max_watched_percent, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, lesson_id) DO UPDATE SET
             last_position_seconds = excluded.last_position_seconds,
             duration_seconds = CASE WHEN excluded.duration_seconds > 0 THEN excluded.duration_seconds ELSE lesson_progress.duration_seconds END,
             max_watched_percent = MAX(lesson_progress.max_watched_percent, excluded.max_watched_percent),
             updated_at = excluded.updated_at`;
      await db.run(upsertSql, [user.id, lessonId, pos, dur, pct, nowIso]);
      if (user.role === 'student') await recordStudyActivity(db, user.id);

      const row = await db.get(
        `SELECT last_position_seconds, duration_seconds, max_watched_percent FROM lesson_progress WHERE user_id = ? AND lesson_id = ?`,
        [user.id, lessonId]
      );
      sendJson(req, res, 200, { saved: true, progress: row });
      return true;
    }

    if (lessonActionMatch[2] === 'notes' && req.method === 'GET') {
      const notes = await db.all(
        `SELECT id, lesson_id, timestamp_seconds, note_text, created_at
         FROM lesson_notes
         WHERE user_id = ? AND lesson_id = ?
         ORDER BY timestamp_seconds ASC, id DESC
         LIMIT 100`,
        [user.id, lessonId]
      );
      sendJson(req, res, 200, { notes });
      return true;
    }

    if (lessonActionMatch[2] === 'notes' && req.method === 'POST') {
      if (!checkRateLimit(`lesson_note:${user.id}`, 40, 15 * 60 * 1000)) {
        sendJson(req, res, 429, { error: 'تم تجاوز حد إضافة الملاحظات مؤقتاً.' });
        return true;
      }
      const body = await parseBody(req, 16 * 1024);
      const noteText = String(body.note_text || '').trim();
      const tsSec = Math.max(0, Math.floor(Number(body.timestamp_seconds || 0) || 0));
      if (noteText.length < 2 || noteText.length > 500) {
        sendJson(req, res, 400, { error: 'يجب أن يتراوح نص الملاحظة بين ٢ و٥٠٠ حرف.' });
        return true;
      }
      const nowIso = new Date().toISOString();
      const ins = await db.run(
        `INSERT INTO lesson_notes (user_id, lesson_id, timestamp_seconds, note_text, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [user.id, lessonId, tsSec, noteText, nowIso]
      );
      if (user.role === 'student') await recordStudyActivity(db, user.id);

      const note = await db.get(
        `SELECT id, lesson_id, timestamp_seconds, note_text, created_at FROM lesson_notes WHERE id = ?`,
        [ins.lastInsertRowid]
      );
      sendJson(req, res, 201, {
        message: 'تم حفظ الملاحظة عند هذه الثانية من الشرح!',
        note
      });
      return true;
    }

    if (lessonActionMatch[2] === 'questions' && req.method === 'GET') {
      const rows = user.role === 'admin'
        ? await db.all(
            `SELECT lq.id, lq.lesson_id, lq.user_id, u.full_name AS student_name, lq.question_text,
                    lq.admin_answer, lq.is_published, lq.created_at, lq.answered_at
             FROM lesson_questions lq
             JOIN users u ON u.id = lq.user_id
             WHERE lq.lesson_id = ?
             ORDER BY lq.id DESC`,
            [lessonId]
          )
        : await db.all(
            `SELECT lq.id, lq.lesson_id, lq.user_id, u.full_name AS student_name, lq.question_text,
                    lq.admin_answer, lq.is_published, lq.created_at, lq.answered_at
             FROM lesson_questions lq
             JOIN users u ON u.id = lq.user_id
             WHERE lq.lesson_id = ? AND ((lq.is_published = 1 AND lq.admin_answer IS NOT NULL) OR lq.user_id = ?)
             ORDER BY lq.id DESC`,
            [lessonId, user.id]
          );

      sendJson(req, res, 200, {
        questions: rows.map((r) => ({ ...r, is_mine: r.user_id === user.id }))
      });
      return true;
    }

    if (lessonActionMatch[2] === 'questions' && req.method === 'POST') {
      if (!checkRateLimit(`lesson_q:${user.id}`, 10, 15 * 60 * 1000)) {
        sendJson(req, res, 429, { error: 'تم تجاوز حد إرسال الأسئلة مؤقتاً. يرجى الانتظار.' });
        return true;
      }
      const body = await parseBody(req, 16 * 1024);
      const qText = String(body.question_text || '').trim();
      if (qText.length < 5 || qText.length > 600) {
        sendJson(req, res, 400, { error: 'يرجى كتابة سؤال واضح يتراوح بين ٥ و ٦٠٠ حرف.' });
        return true;
      }
      const nowIso = new Date().toISOString();
      const ins = await db.run(
        `INSERT INTO lesson_questions (lesson_id, user_id, question_text, is_published, created_at)
         VALUES (?, ?, ?, 0, ?)`,
        [lessonId, user.id, qText, nowIso]
      );
      writeAuditLog(req, user, 'LESSON_QUESTION_ASKED', 'lesson_question', ins.lastInsertRowid, { lessonId });
      sendJson(req, res, 201, {
        message: 'تم إرسال سؤالك لفضيلة الأستاذ بنجاح، وسيظهر الرد هنا فور الإجابة عليه.',
        question_id: ins.lastInsertRowid
      });
      return true;
    }
  }

  return false;
}

module.exports = { handleStudentRoutes };
