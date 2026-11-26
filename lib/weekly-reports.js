/**
 * Weekly Friday 3:00 PM (Africa/Cairo) Sequential Parent Progress Reports
 * Builds individualized academic follow-up reports for parents and dispatches
 * them strictly sequentially (one student at a time with configurable spacing).
 */

function getIsoWeekKeyFromYmd(year, month, day) {
  const utcDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getCairoDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const map = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hourNum = Number(map.hour === '24' ? '0' : map.hour);
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    weekday: map.weekday,
    hour: Number.isFinite(hourNum) ? hourNum : 0,
    minute: Number(map.minute || 0),
    weekKey: getIsoWeekKeyFromYmd(map.year, map.month, map.day)
  };
}

function isFridayThreePmCairo(date = new Date()) {
  const parts = getCairoDateTimeParts(date);
  return parts.weekday === 'Fri' && parts.hour === 15;
}

function buildWhatsappParentUrl(parentPhone, messageText) {
  const digits = String(parentPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const intl = digits.startsWith('0') ? `2${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(messageText)}`;
}

function safeParseJsonArray(str) {
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatStudentParentReportText(student, submissions, progressRows, now = new Date()) {
  const sevenDaysAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentSubmissions = submissions.filter((s) => s.submitted_at >= sevenDaysAgoIso);
  const recentExams = recentSubmissions.filter((s) => ['exam', 'retake_exam'].includes(s.assessment_type));
  const examPool = recentExams.length > 0
    ? recentExams
    : submissions.filter((s) => ['exam', 'retake_exam'].includes(s.assessment_type)).slice(0, 3);

  const recentWatchedCount = progressRows.filter((p) => p.updated_at >= sevenDaysAgoIso && p.max_watched_percent > 0).length;
  const avgWatchPercent = progressRows.length > 0
    ? Math.round(progressRows.reduce((acc, r) => acc + Number(r.max_watched_percent || 0), 0) / progressRows.length)
    : 0;

  const avgExamPct = examPool.length > 0
    ? Math.round(examPool.reduce((acc, r) => acc + Number(r.percentage || 0), 0) / examPool.length)
    : null;

  const weakSet = new Set();
  for (const s of (recentSubmissions.length > 0 ? recentSubmissions : submissions.slice(0, 5))) {
    for (const topic of safeParseJsonArray(s.weak_topics_json)) {
      if (topic) weakSet.add(String(topic));
    }
  }

  const subExp = student.subscription_expires_at ? new Date(student.subscription_expires_at) : null;
  const daysRemaining = subExp && subExp > now
    ? Math.ceil((subExp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  const latestExam = examPool[0] || null;
  const lines = [
    'السلام عليكم ورحمة الله وبركاته',
    `ولي أمر الطالب/ة: ${student.full_name}`,
    'تقرير المتابعة الأسبوعي من منصة مَتْن (MATN) للمواد الشرعية:',
    `• المحاضرات المتابَعة هذا الأسبوع: ${recentWatchedCount} محاضرة (متوسط المشاهدة العام: ${avgWatchPercent}%).`,
    `• الواجبات والاختبارات المنجزة هذا الأسبوع: ${recentSubmissions.length}.`,
    ...(avgExamPct !== null ? [`• متوسط درجات الامتحانات الأخيرة: ${avgExamPct}%${latestExam ? ` (آخر امتحان: ${latestExam.assessment_title} — ${latestExam.score}/${latestExam.total_points})` : ''}.`] : ['• لم تُسجَّل امتحانات بعد هذا الأسبوع.']),
    ...(weakSet.size > 0 ? [`• مباحث تحتاج مراجعة: ${Array.from(weakSet).slice(0, 4).join('، ')}.`] : ['• مستوى الفهم في المباحث الشرعية مستقر بفضل الله.']),
    `• حالة الاشتراك الشهري: ${daysRemaining > 0 ? `سارٍ (متبقٍ ${daysRemaining} يوماً)` : 'منتهٍ — يرجى التجديد للاستمرار'}.`,
    'نسأل الله لابنائكم التوفيق والسداد.'
  ];

  const reportText = lines.join('\n');
  const whatsappUrl = buildWhatsappParentUrl(student.parent_phone, reportText);
  return { reportText, whatsappUrl };
}

async function buildStudentParentReport(db, student, now = new Date()) {
  const submissions = await db.all(
    `SELECT s.score, s.total_points, s.percentage, s.passed, s.assessment_type, s.weak_topics_json, s.submitted_at,
            a.title AS assessment_title, l.title AS lesson_title
     FROM submissions s
     JOIN assessments a ON a.id = s.assessment_id
     JOIN lessons l ON l.id = s.lesson_id
     WHERE s.user_id = ?
     ORDER BY s.id DESC`,
    [student.id]
  );

  const progressRows = await db.all(
    `SELECT lesson_id, max_watched_percent, updated_at
     FROM lesson_progress
     WHERE user_id = ?`,
    [student.id]
  );

  return formatStudentParentReportText(student, submissions, progressRows, now);
}

async function queueWeeklyReportsForWeek(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const weekKey = String(options.weekKey || getCairoDateTimeParts(now).weekKey).slice(0, 32);
  const studentIds = Array.isArray(options.studentIds) && options.studentIds.length > 0
    ? options.studentIds.map(Number).filter(Number.isInteger)
    : null;

  let students = [];
  if (studentIds && studentIds.length > 0) {
    const ph = studentIds.map(() => '?').join(',');
    students = await db.all(
      `SELECT u.id, u.full_name, u.phone, u.parent_phone, u.subscription_expires_at, u.is_locked, u.is_whatsapp_verified
       FROM users u
       WHERE u.role = 'student' AND u.is_locked = 0 AND u.id IN (${ph})
         AND NOT EXISTS (
           SELECT 1 FROM weekly_parent_reports wpr WHERE wpr.week_key = ? AND wpr.user_id = u.id
         )
       ORDER BY u.id ASC`,
      [...studentIds, weekKey]
    );
  } else if (options.includeAllVerified) {
    students = await db.all(
      `SELECT u.id, u.full_name, u.phone, u.parent_phone, u.subscription_expires_at
       FROM users u
       WHERE u.role = 'student'
         AND u.is_locked = 0
         AND u.is_whatsapp_verified = 1
         AND u.parent_phone IS NOT NULL
         AND u.parent_phone != ''
         AND NOT EXISTS (
           SELECT 1 FROM weekly_parent_reports wpr WHERE wpr.week_key = ? AND wpr.user_id = u.id
         )
       ORDER BY u.id ASC`,
      [weekKey]
    );
  } else {
    const nowIso = now.toISOString();
    const activeWindowIso = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    students = await db.all(
      `SELECT u.id, u.full_name, u.phone, u.parent_phone, u.subscription_expires_at
       FROM users u
       WHERE u.role = 'student'
         AND u.is_locked = 0
         AND u.is_whatsapp_verified = 1
         AND u.parent_phone IS NOT NULL
         AND u.parent_phone != ''
         AND (
           (u.subscription_expires_at IS NOT NULL AND u.subscription_expires_at > ?)
           OR EXISTS (SELECT 1 FROM submissions s WHERE s.user_id = u.id AND s.submitted_at >= ?)
           OR EXISTS (SELECT 1 FROM lesson_progress lp WHERE lp.user_id = u.id AND lp.updated_at >= ?)
         )
         AND NOT EXISTS (
           SELECT 1 FROM weekly_parent_reports wpr WHERE wpr.week_key = ? AND wpr.user_id = u.id
         )
       ORDER BY u.id ASC`,
      [nowIso, activeWindowIso, activeWindowIso, weekKey]
    );
  }

  const validStudents = students.filter((st) => /^01[0125]\d{8}$/.test(String(st.parent_phone || '')));
  if (validStudents.length === 0) {
    return { weekKey, queuedCount: 0 };
  }

  const targetIds = validStudents.map((s) => s.id);
  const ph = targetIds.map(() => '?').join(',');
  const [allSubmissions, allProgress] = await Promise.all([
    db.all(
      `SELECT s.user_id, s.score, s.total_points, s.percentage, s.passed, s.assessment_type, s.weak_topics_json, s.submitted_at,
              a.title AS assessment_title, l.title AS lesson_title
       FROM submissions s
       JOIN assessments a ON a.id = s.assessment_id
       JOIN lessons l ON l.id = s.lesson_id
       WHERE s.user_id IN (${ph})
       ORDER BY s.id DESC`,
      targetIds
    ),
    db.all(
      `SELECT user_id, lesson_id, max_watched_percent, updated_at
       FROM lesson_progress
       WHERE user_id IN (${ph})`,
      targetIds
    )
  ]);

  const subsByUser = new Map();
  for (const s of allSubmissions) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id).push(s);
  }
  const progByUser = new Map();
  for (const p of allProgress) {
    if (!progByUser.has(p.user_id)) progByUser.set(p.user_id, []);
    progByUser.get(p.user_id).push(p);
  }

  const insertPrefix = db.insertIgnorePrefix
    ? db.insertIgnorePrefix()
    : (db.isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');
  const createdAt = now.toISOString();
  const rowsToInsert = validStudents.map((st) => {
    const { reportText, whatsappUrl } = formatStudentParentReportText(
      st,
      subsByUser.get(st.id) || [],
      progByUser.get(st.id) || [],
      now
    );
    return [weekKey, st.id, st.full_name, st.parent_phone, reportText, whatsappUrl, createdAt];
  });

  let queuedCount = 0;
  await db.transaction(async (tx) => {
    for (let i = 0; i < rowsToInsert.length; i += 100) {
      const batch = rowsToInsert.slice(i, i + 100);
      const valuesClause = batch.map(() => `(?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`).join(', ');
      const flatParams = batch.flat();
      const info = await tx.run(
        `${insertPrefix} weekly_parent_reports (
          week_key, user_id, student_name, parent_phone, report_text, whatsapp_url, status, error_reason, created_at
        ) VALUES ${valuesClause}`,
        flatParams
      );
      queuedCount += Number(info.changes || 0);
    }
  });

  return { weekKey, queuedCount };
}

let activeSequentialDispatch = null;

/**
 * Processes pending parent reports in strict student-by-student sequence with spacing between each send.
 */
async function processWeeklyReportQueue({ db, weekKey, dispatchWhatsApp, hasGateway, delayMs = 4000 }) {
  if (activeSequentialDispatch) return activeSequentialDispatch;

  activeSequentialDispatch = (async () => {
    const pendingRows = await db.all(
      `SELECT * FROM weekly_parent_reports
       WHERE week_key = ? AND status = 'pending'
       ORDER BY id ASC`,
      [weekKey]
    );

    let sent = 0;
    let failed = 0;
    let manualReady = 0;

    for (let i = 0; i < pendingRows.length; i++) {
      const row = pendingRows[i];
      const claim = await db.run(
        `UPDATE weekly_parent_reports SET status = 'processing' WHERE id = ? AND status = 'pending'`,
        [row.id]
      );
      if (claim.changes === 0) continue;

      if (!hasGateway) {
        await db.run(
          `UPDATE weekly_parent_reports
           SET status = 'manual_ready', error_reason = 'بوابة الواتساب الآلية غير مفعلة في .env — متاح للإرسال التسلسلي بنقرة واحدة'
           WHERE id = ?`,
          [row.id]
        );
        manualReady++;
        continue;
      }

      const res = await dispatchWhatsApp(
        row.parent_phone,
        row.student_name,
        'weekly_parent_report',
        row.report_text,
        `تقرير المتابعة الأسبوعي (${weekKey})`
      );

      if (res && res.delivered) {
        await db.run(
          `UPDATE weekly_parent_reports
           SET status = 'sent', error_reason = NULL, sent_at = ?
           WHERE id = ?`,
          [new Date().toISOString(), row.id]
        );
        sent++;
      } else {
        await db.run(
          `UPDATE weekly_parent_reports
           SET status = 'failed', error_reason = 'فشل الإرسال عبر بوابة الواتساب'
           WHERE id = ?`,
          [row.id]
        );
        failed++;
      }

      // Wait sequentially between students so reports go out one-by-one rather than in a single burst
      if (delayMs > 0 && i < pendingRows.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return { weekKey, processed: pendingRows.length, sent, failed, manualReady };
  })();

  try {
    return await activeSequentialDispatch;
  } finally {
    activeSequentialDispatch = null;
  }
}

module.exports = {
  getCairoDateTimeParts,
  isFridayThreePmCairo,
  buildWhatsappParentUrl,
  buildStudentParentReport,
  queueWeeklyReportsForWeek,
  processWeeklyReportQueue
};
