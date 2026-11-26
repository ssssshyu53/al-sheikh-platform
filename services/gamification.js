function getCairoDateString(date = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return fmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

async function recordStudyActivity(dbConn, userId) {
  if (!userId) return;
  const dateKey = getCairoDateString(new Date());
  try {
    const sql = dbConn.isMysql
      ? `INSERT INTO study_activity (user_id, activity_date, actions_count)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE actions_count = actions_count + 1`
      : `INSERT INTO study_activity (user_id, activity_date, actions_count)
         VALUES (?, ?, 1)
         ON CONFLICT(user_id, activity_date) DO UPDATE SET
           actions_count = study_activity.actions_count + 1`;
    await dbConn.run(sql, [userId, dateKey]);
  } catch {}
}

async function computeStudyStreak(dbConn, userId) {
  if (!userId) return 0;
  try {
    const rows = await dbConn.all(
      `SELECT activity_date FROM study_activity
       WHERE user_id = ?
       ORDER BY activity_date DESC
       LIMIT 120`,
      [userId]
    );
    if (rows.length === 0) return 0;

    const dateSet = new Set(rows.map((r) => r.activity_date));
    const todayStr = getCairoDateString(new Date());
    const [y, m, d] = todayStr.split('-').map(Number);
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return 0;

    let cursorUtcMs = Date.UTC(y, m - 1, d);
    const yesterdayStr = new Date(cursorUtcMs - 86400000).toISOString().slice(0, 10);

    if (!dateSet.has(todayStr)) {
      if (!dateSet.has(yesterdayStr)) return 0;
      cursorUtcMs -= 86400000;
    }

    let streak = 0;
    while (streak < 120) {
      const checkStr = new Date(cursorUtcMs).toISOString().slice(0, 10);
      if (!dateSet.has(checkStr)) break;
      streak++;
      cursorUtcMs -= 86400000;
    }
    return streak;
  } catch {
    return 0;
  }
}

function computeStudentBadges({ studyStreak = 0, lessons = [], submissions = [] }) {
  const watchedLesson = lessons.some((l) => Number(l.progress?.max_watched_percent || 0) >= 50);
  const hasTopExam = submissions.some((s) => ['exam', 'retake_exam'].includes(s.assessment_type) && Number(s.percentage || 0) >= 90);

  let completedAnyUnit = false;
  if (lessons.length > 0) {
    const bySubjectUnit = new Map();
    for (const l of lessons) {
      const key = `${l.subject}::${l.unit_title || 'default'}`;
      if (!bySubjectUnit.has(key)) bySubjectUnit.set(key, []);
      bySubjectUnit.get(key).push(l);
    }
    for (const unitLessons of bySubjectUnit.values()) {
      if (unitLessons.length > 0 && unitLessons.every((l) => {
        const watched = Number(l.progress?.max_watched_percent || 0) >= 80;
        const passedExam = (l.assessments || []).some((a) => ['exam', 'retake_exam'].includes(a.assessment_type) && a.latest_submission && a.latest_submission.passed);
        return watched || passedExam;
      })) {
        completedAnyUnit = true;
        break;
      }
    }
  }

  return [
    {
      id: 'first_step',
      title: 'أول خطوة',
      description: 'مشاهدة نصف محاضرة أو تسليم اختبار',
      icon: 'zap',
      unlocked: watchedLesson || submissions.length > 0
    },
    {
      id: 'streak_3',
      title: 'انطلاقة منتظمة',
      description: 'المذاكرة ٣ أيام متتالية على المنصة',
      icon: 'flame',
      unlocked: studyStreak >= 3
    },
    {
      id: 'streak_7',
      title: 'مواظب ٧ أيام',
      description: 'المذاكرة ٧ أيام متتالية بدون انقطاع',
      icon: 'flame',
      unlocked: studyStreak >= 7
    },
    {
      id: 'top_scorer',
      title: 'متفوق الامتحان',
      description: 'تحقيق ٩٠٪ فأكثر في أحد الامتحانات',
      icon: 'award',
      unlocked: hasTopExam
    },
    {
      id: 'unit_complete',
      title: 'أنهى الوحدة الأولى',
      description: 'إتمام جميع حصص وحدة دراسية كاملة',
      icon: 'trophy',
      unlocked: completedAnyUnit
    }
  ];
}

module.exports = {
  getCairoDateString,
  recordStudyActivity,
  computeStudyStreak,
  computeStudentBadges
};
