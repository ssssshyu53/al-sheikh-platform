const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { db, hashPasswordAsync } = require('../database');
const {
  MAX_VIDEO_UPLOAD_MB,
  WEEKLY_REPORT_DELAY_MS,
  HAS_WHATSAPP_GATEWAY,
  isBotPullConfigured,
  PREP_GRADES,
  VALID_GRADES,
  VALID_SUBJECTS,
  VALID_LESSON_BRANCHES,
  isSubjectAllowedForGrade,
  normalizeDigits,
  normalizePhoneNumber,
  parsePositiveInt,
  parseBoundedInt,
  safeDecode,
  safeJsonParse
} = require('../lib/constants');
const { getCairoDateTimeParts, buildStudentParentReport, queueWeeklyReportsForWeek, processWeeklyReportQueue } = require('../lib/weekly-reports');
const { sendJson, parseBody } = require('../middleware/security');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../services/audit');
const { dispatchWhatsApp } = require('../services/whatsapp');
const {
  runInTransaction,
  validateScheduleWindow,
  validateAndNormalizeQuestions
} = require('../services/gating');
const {
  activeUploads,
  getUploadsRoot,
  cleanupUnusedUploadFile,
  validateFileSignature,
  relocateMoovToFront,
  isBunnyApiAvailable,
  isBunnyConfigured,
  createBunnyVideoObject,
  uploadFileStreamToBunny
} = require('../services/media');
const { createNotification } = require('../services/notifications');

async function handleAdminRoutes(req, res, ctx) {
  const { pathname, urlObj } = ctx;
  if (!pathname.startsWith('/api/admin/')) return false;

  const admin = await requireAuth(req, res, { adminOnly: true });
  if (!admin) return true;

  if (pathname === '/api/admin/overview' && req.method === 'GET') {
    const studentsLimit = parseBoundedInt(urlObj.searchParams.get('students_limit'), 50, 1, 200);
    const studentsOffset = parseBoundedInt(urlObj.searchParams.get('students_offset'), 0, 0, 1000000);
    const vouchersLimit = parseBoundedInt(urlObj.searchParams.get('vouchers_limit'), 60, 1, 200);
    const vouchersOffset = parseBoundedInt(urlObj.searchParams.get('vouchers_offset'), 0, 0, 1000000);

    const studentsQ = String(urlObj.searchParams.get('students_q') || '').trim();
    const studentsFilter = String(urlObj.searchParams.get('students_filter') || 'all').trim();
    const vouchersQ = String(urlObj.searchParams.get('vouchers_q') || '').trim();
    const vouchersFilter = String(urlObj.searchParams.get('vouchers_filter') || 'all').trim();

    const nowIso = new Date().toISOString();
    const in3DaysIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const monthStartIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

    const studentConditions = [`role = 'student'`];
    const studentParams = [];
    if (studentsQ) {
      const normQ = normalizeDigits(studentsQ);
      studentConditions.push(`(full_name LIKE ? OR phone LIKE ? OR parent_phone LIKE ?)`);
      studentParams.push(`%${studentsQ}%`, `%${normQ}%`, `%${normQ}%`);
    }
    if (studentsFilter === 'active') {
      studentConditions.push(`subscription_expires_at IS NOT NULL AND subscription_expires_at > ?`);
      studentParams.push(nowIso);
    } else if (studentsFilter === 'expiring_soon') {
      studentConditions.push(`subscription_expires_at IS NOT NULL AND subscription_expires_at > ? AND subscription_expires_at <= ?`);
      studentParams.push(nowIso, in3DaysIso);
    } else if (studentsFilter === 'expired') {
      studentConditions.push(`(subscription_expires_at IS NULL OR subscription_expires_at <= ?)`);
      studentParams.push(nowIso);
    } else if (studentsFilter === 'locked') {
      studentConditions.push(`is_locked = 1`);
    } else if (studentsFilter === 'device_reset') {
      studentConditions.push(`device_reset_requested = 1`);
    }
    const studentWhereSql = studentConditions.join(' AND ');

    const studentsTotalRow = await db.get(`SELECT COUNT(*) AS c FROM users WHERE ${studentWhereSql}`, studentParams);
    const studentsTotal = studentsTotalRow?.c || 0;
    const studentsAllRow = await db.get(`SELECT COUNT(*) AS c FROM users WHERE role = 'student'`);
    const studentsAllCount = studentsAllRow?.c || 0;
    const expiringSoonRow = await db.get(
      `SELECT COUNT(*) AS c FROM users
       WHERE role = 'student' AND subscription_expires_at IS NOT NULL AND subscription_expires_at > ? AND subscription_expires_at <= ?`,
      [nowIso, in3DaysIso]
    );
    const expiringSoonCount = expiringSoonRow?.c || 0;

    const students = await db.all(
      `SELECT u.id, u.full_name, u.phone, u.parent_phone, u.grade, u.branch, u.is_locked, u.is_whatsapp_verified,
              u.device_id, u.device_name, u.device_locked_at, u.device_reset_requested, u.blocked_login_attempts,
              u.failed_login_attempts, u.login_locked_until, u.subscription_expires_at, u.subscribed_subjects, u.created_at,
              COALESCE((SELECT ROUND(AVG(lp.max_watched_percent)) FROM lesson_progress lp WHERE lp.user_id = u.id), 0) AS avg_watch_percent
       FROM users u
       WHERE ${studentWhereSql}
       ORDER BY u.id DESC
       LIMIT ${studentsLimit} OFFSET ${studentsOffset}`,
      studentParams
    );

    const voucherConditions = [];
    const voucherParams = [];
    if (vouchersQ) {
      const normVQ = normalizeDigits(vouchersQ);
      voucherConditions.push(`(v.code LIKE ? OR v.batch_name LIKE ? OR COALESCE(v.assigned_to_name, '') LIKE ? OR COALESCE(v.assigned_to_phone, '') LIKE ?)`);
      voucherParams.push(`%${normVQ}%`, `%${vouchersQ}%`, `%${vouchersQ}%`, `%${normVQ}%`);
    }
    if (vouchersFilter === 'unused') {
      voucherConditions.push(`v.is_used = 0 AND (v.assigned_to_phone IS NULL OR v.assigned_to_phone = '')`);
    } else if (vouchersFilter === 'reserved') {
      voucherConditions.push(`v.is_used = 0 AND v.assigned_to_phone IS NOT NULL AND v.assigned_to_phone != ''`);
    } else if (vouchersFilter === 'used') {
      voucherConditions.push(`v.is_used = 1`);
    }
    const voucherWhereSql = voucherConditions.length > 0 ? `WHERE ${voucherConditions.join(' AND ')}` : '';

    const vouchersTotalRow = await db.get(`SELECT COUNT(*) AS c FROM vouchers v ${voucherWhereSql}`, voucherParams);
    const vouchersTotal = vouchersTotalRow?.c || 0;
    const vouchersUnusedRow = await db.get(`SELECT COUNT(*) AS c FROM vouchers WHERE is_used = 0`);
    const vouchersUnusedCount = vouchersUnusedRow?.c || 0;
    const revenueRow = await db.get(
      `SELECT
         COUNT(CASE WHEN is_used = 1 THEN 1 END) AS total_used_vouchers,
         COALESCE(SUM(CASE WHEN is_used = 1 THEN price_egp ELSE 0 END), 0) AS total_revenue_egp,
         COUNT(CASE WHEN is_used = 1 AND used_at >= ? THEN 1 END) AS month_used_vouchers,
         COALESCE(SUM(CASE WHEN is_used = 1 AND used_at >= ? THEN price_egp ELSE 0 END), 0) AS month_revenue_egp
       FROM vouchers`,
      [monthStartIso, monthStartIso]
    ) || {};

    const allLessonsRaw = await db.all(
      `SELECT id, title, description, subject, grade, branch, unit_title, order_index,
              video_type, video_path, duration_minutes, pdf_title, pdf_path, is_published, created_at
       FROM lessons
       ORDER BY grade DESC, subject ASC, order_index ASC`
    );
    const assessmentsRows = await db.all(
      `SELECT a.id, a.lesson_id, a.title, a.assessment_type, a.time_limit_minutes,
              a.scheduled_start, a.scheduled_end, a.is_active, a.created_at,
              (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id) AS questions_count
       FROM assessments a
       ORDER BY a.id ASC`
    );
    const assessmentsMap = new Map();
    for (const a of assessmentsRows) {
      if (!assessmentsMap.has(a.lesson_id)) assessmentsMap.set(a.lesson_id, []);
      assessmentsMap.get(a.lesson_id).push(a);
    }

    const lessons = allLessonsRaw.map((l) => ({
      ...l,
      has_uploaded_video: Boolean(l.video_path && l.video_path.startsWith('uploads/videos/')),
      assessments: assessmentsMap.get(l.id) || []
    }));

    const vouchers = await db.all(
      `SELECT v.*, u.full_name AS used_by_name, u.phone AS used_by_phone
       FROM vouchers v
       LEFT JOIN users u ON u.id = v.used_by_user_id
       ${voucherWhereSql}
       ORDER BY v.id DESC
       LIMIT ${vouchersLimit} OFFSET ${vouchersOffset}`,
      voucherParams
    );

    const activeRetakeRows = await db.all(
      `SELECT * FROM assessments WHERE assessment_type = 'retake_exam' AND is_active = 1 ORDER BY id ASC`
    );
    const retakeByLesson = new Map();
    for (const rt of activeRetakeRows) {
      retakeByLesson.set(rt.lesson_id, rt);
    }

    const failedSubmissions = (await db.all(
      `SELECT s.*, u.full_name, u.phone, u.parent_phone, u.grade, u.branch,
              l.title AS lesson_title, l.subject, a.title AS exam_title
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN lessons l ON l.id = s.lesson_id
       JOIN assessments a ON a.id = s.assessment_id
       WHERE s.assessment_type = 'exam' AND s.passed = 0
         AND NOT EXISTS (
           SELECT 1 FROM submissions s2
           WHERE s2.user_id = s.user_id AND s2.lesson_id = s.lesson_id
             AND s2.assessment_type IN ('exam', 'retake_exam') AND s2.passed = 1
         )
       ORDER BY s.id DESC`
    )).map((r) => ({
      ...r,
      weak_topics: safeJsonParse(r.weak_topics_json, []),
      scheduled_retake: retakeByLesson.get(r.lesson_id) || null
    }));

    const lessonQuestions = await db.all(
      `SELECT lq.id, lq.lesson_id, lq.user_id, lq.question_text, lq.admin_answer, lq.is_published,
              lq.created_at, lq.answered_at, u.full_name AS student_name, u.grade AS student_grade,
              l.title AS lesson_title, l.subject
       FROM lesson_questions lq
       JOIN users u ON u.id = lq.user_id
       JOIN lessons l ON l.id = lq.lesson_id
       ORDER BY CASE WHEN lq.admin_answer IS NULL THEN 0 ELSE 1 END, lq.id DESC
       LIMIT 60`
    );
    const pendingQRow = await db.get(`SELECT COUNT(*) AS c FROM lesson_questions WHERE admin_answer IS NULL`);
    const pendingQuestionsCount = pendingQRow?.c || 0;

    const currentWeekKey = getCairoDateTimeParts(new Date()).weekKey;
    const latestWeekRow = await db.get(`SELECT week_key FROM weekly_parent_reports ORDER BY id DESC LIMIT 1`);
    const activeWeekKey = latestWeekRow ? latestWeekRow.week_key : currentWeekKey;
    const weeklyReportsTotalRow = await db.get(
      `SELECT COUNT(*) AS c FROM weekly_parent_reports WHERE week_key = ?`,
      [activeWeekKey]
    );
    const weeklyReportItems = await db.all(
      `SELECT id, week_key, user_id, student_name, parent_phone, report_text, whatsapp_url, status, error_reason, sent_at, created_at
       FROM weekly_parent_reports
       WHERE week_key = ?
       ORDER BY id ASC
       LIMIT 100`,
      [activeWeekKey]
    );

    const liveSessions = await db.all(
      `SELECT ls.*,
              (SELECT COUNT(*) FROM live_session_attendance lsa WHERE lsa.live_session_id = ls.id) AS attendance_count
       FROM live_sessions ls
       ORDER BY ls.starts_at DESC, ls.id DESC
       LIMIT 50`
    );

    const adminNotifications = await db.all(
      `SELECT n.*, u.full_name AS target_student_name
       FROM notifications n
       LEFT JOIN users u ON u.id = n.target_user_id
       ORDER BY n.id DESC
       LIMIT 50`
    );

    const deviceStudentRows = await db.all(
      `SELECT device_id, full_name, phone
       FROM users
       WHERE role = 'student'
         AND device_id IN (
           SELECT device_id FROM users
           WHERE role = 'student' AND device_id IS NOT NULL AND device_id != ''
           GROUP BY device_id
           HAVING COUNT(*) > 1
         )`
    );
    const deviceGroups = new Map();
    for (const row of deviceStudentRows) {
      if (!deviceGroups.has(row.device_id)) deviceGroups.set(row.device_id, []);
      deviceGroups.get(row.device_id).push(`${row.full_name} (${row.phone})`);
    }
    const multiAccountDevices = [];
    for (const [devId, accounts] of deviceGroups.entries()) {
      multiAccountDevices.push({
        device_id: devId,
        account_count: accounts.length,
        accounts_list: accounts.join(' | ')
      });
    }

    const securityEvents = await db.all(`SELECT * FROM security_events ORDER BY id DESC LIMIT 50`);
    const whatsappLogs = await db.all(`SELECT * FROM whatsapp_logs ORDER BY id DESC LIMIT 50`);
    const auditLogs = await db.all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 50`);

    const settingsRows = await db.all(
      `SELECT \`key\`, value FROM platform_settings
       WHERE \`key\` IN ('teacher_name', 'platform_name', 'support_whatsapp', 'vodafone_cash_number', 'instapay_handle', 'auto_friday_reports_enabled', 'honor_roll_enabled', 'azhar_exam_date', 'announcement_banner')`
    );
    const platformSettings = {};
    for (const r of settingsRows) platformSettings[r.key] = r.value;
    const adminPhoneMatchesSupport = Boolean(platformSettings.support_whatsapp && admin.phone === platformSettings.support_whatsapp);

    // Analytics: Active subscriptions, 6-month voucher growth, lesson completion rates, most missed questions
    const activeSubsRow = await db.get(
      `SELECT COUNT(*) AS c FROM users
       WHERE role = 'student' AND subscription_expires_at IS NOT NULL AND subscription_expires_at > ?`,
      [nowIso]
    );
    const activeSubsCount = activeSubsRow?.c || 0;

    const monthlyVoucherRows = (await db.all(
      `SELECT SUBSTR(used_at, 1, 7) AS ym, COUNT(*) AS activations, COALESCE(SUM(price_egp), 0) AS revenue
       FROM vouchers
       WHERE is_used = 1 AND used_at IS NOT NULL
       GROUP BY SUBSTR(used_at, 1, 7)
       ORDER BY ym DESC
       LIMIT 6`
    )).reverse();

    const lessonCompletionRows = await db.all(
      `SELECT l.id, l.title, l.subject, l.grade,
              ROUND(COALESCE(AVG(lp.max_watched_percent), 0)) AS avg_watch_percent,
              COUNT(lp.user_id) AS learners_count
       FROM lessons l
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id
       GROUP BY l.id, l.title, l.subject, l.grade
       ORDER BY learners_count DESC, avg_watch_percent DESC, l.id DESC
       LIMIT 10`
    );

    const recentSubAnswers = await db.all(
      `SELECT s.answers_json, l.title AS lesson_title
       FROM submissions s
       JOIN lessons l ON l.id = s.lesson_id
       ORDER BY s.id DESC
       LIMIT 400`
    );
    const missedStatsMap = new Map();
    for (const row of recentSubAnswers) {
      const items = safeJsonParse(row.answers_json, []);
      if (!Array.isArray(items)) continue;
      for (const it of items) {
        if (!it || !it.question_text) continue;
        const key = it.question_id ? `q_${it.question_id}` : `txt_${it.question_text.slice(0, 60)}`;
        let cur = missedStatsMap.get(key);
        if (!cur) {
          cur = {
            question_id: it.question_id || null,
            question_text: it.question_text,
            topic_tag: it.topic_tag || '',
            lesson_title: row.lesson_title || '',
            wrong_count: 0,
            total_attempts: 0
          };
          missedStatsMap.set(key, cur);
        }
        cur.total_attempts++;
        if (!it.is_correct) cur.wrong_count++;
      }
    }
    const mostMissedQuestions = Array.from(missedStatsMap.values())
      .filter((x) => x.wrong_count > 0)
      .map((x) => ({
        ...x,
        wrong_rate: x.total_attempts > 0 ? Math.round((x.wrong_count / x.total_attempts) * 100) : 0
      }))
      .sort((a, b) => b.wrong_count - a.wrong_count || b.wrong_rate - a.wrong_rate)
      .slice(0, 10);

    const uploadsRoot = getUploadsRoot();
    const vidDir = path.join(uploadsRoot, 'videos');
    const pdfDir = path.join(uploadsRoot, 'pdfs');
    await fs.promises.mkdir(vidDir, { recursive: true });
    await fs.promises.mkdir(pdfDir, { recursive: true });
    const listUploadedDir = async (dirPath, relPrefix, decimals) => {
      const entries = await fs.promises.readdir(dirPath);
      const out = [];
      for (const f of entries) {
        if (f.startsWith('.')) continue;
        try {
          const st = await fs.promises.stat(path.join(dirPath, f));
          if (st.isFile()) {
            out.push({ name: f, path: `${relPrefix}/${f}`, size_mb: (st.size / (1024 * 1024)).toFixed(decimals) });
          }
        } catch {}
      }
      return out;
    };
    const uploadedVideos = await listUploadedDir(vidDir, 'uploads/videos', 1);
    const uploadedPdfs = await listUploadedDir(pdfDir, 'uploads/pdfs', 2);

    const adminAlertsSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const adminSecurityAlerts = await db.all(
      `SELECT * FROM security_events
       WHERE event_type IN ('ADMIN_LOGIN_BRUTE_FORCE', 'DISTRIBUTED_BRUTE_FORCE_ATTEMPT')
         AND created_at >= ?
       ORDER BY id DESC LIMIT 10`,
      [adminAlertsSince]
    );

    sendJson(req, res, 200, {
      students,
      students_total: studentsTotal,
      students_all_count: studentsAllCount,
      expiring_soon_count: expiringSoonCount,
      students_limit: studentsLimit,
      students_offset: studentsOffset,
      lessons,
      vouchers,
      vouchers_total: vouchersTotal,
      vouchers_unused_count: vouchersUnusedCount,
      vouchers_limit: vouchersLimit,
      vouchers_offset: vouchersOffset,
      revenue_summary: {
        total_used_vouchers: Number(revenueRow.total_used_vouchers || 0),
        total_revenue_egp: Number(revenueRow.total_revenue_egp || 0),
        month_used_vouchers: Number(revenueRow.month_used_vouchers || 0),
        month_revenue_egp: Number(revenueRow.month_revenue_egp || 0)
      },
      failed_submissions: failedSubmissions,
      lesson_questions: lessonQuestions,
      pending_questions_count: pendingQuestionsCount,
      weekly_reports: {
        week_key: activeWeekKey,
        current_friday_key: currentWeekKey,
        total_items: Number(weeklyReportsTotalRow?.c || 0),
        items: weeklyReportItems,
        auto_friday_reports_enabled: platformSettings.auto_friday_reports_enabled !== '0'
      },
      live_sessions: liveSessions,
      notifications: adminNotifications,
      multi_account_devices: multiAccountDevices,
      security_events: securityEvents,
      admin_security_alerts: adminSecurityAlerts,
      whatsapp_logs: whatsappLogs,
      audit_logs: auditLogs,
      uploaded_videos: uploadedVideos,
      uploaded_pdfs: uploadedPdfs,
      platform_settings: platformSettings,
      admin_phone_matches_support: adminPhoneMatchesSupport,
      bunny_stream_configured: isBunnyConfigured(),
      bunny_api_available: isBunnyApiAvailable(),
      max_video_upload_mb: MAX_VIDEO_UPLOAD_MB,
      whatsapp_gateway_configured: HAS_WHATSAPP_GATEWAY,
      bot_pull_configured: isBotPullConfigured(),
      analytics: {
        active_subscriptions_count: activeSubsCount,
        subscription_growth: monthlyVoucherRows,
        lesson_completion: lessonCompletionRows,
        most_missed_questions: mostMissedQuestions
      }
    });
    return true;
  }

  // Seamless Bunny Stream Create + Direct Upload from Admin Dashboard
  if (pathname === '/api/admin/bunny/upload' && req.method === 'POST') {
    if (!isBunnyApiAvailable()) {
      sendJson(req, res, 400, { error: 'إعدادات Bunny Stream (LIBRARY_ID / API_KEY) غير مفعلة في ملف .env على الخادم.' });
      return true;
    }

    const rawTitle = safeDecode(req.headers['x-video-title'] || 'محاضرة منصة متن', 'محاضرة منصة متن');
    const rawFileName = safeDecode(req.headers['x-file-name'] || 'video.mp4', 'video.mp4');
    const ext = path.extname(rawFileName).toLowerCase() || '.mp4';
    if (!['.mp4', '.webm'].includes(ext)) {
      sendJson(req, res, 400, { error: 'يرجى رفع فيديو بصيغة MP4 أو WebM فقط.' });
      return true;
    }

    const maxBytes = MAX_VIDEO_UPLOAD_MB * 1024 * 1024;
    const tempDir = path.join(getUploadsRoot(), 'videos');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `bunny_tmp_${crypto.randomUUID()}${ext}`);
    let totalBytes = 0;
    let firstChecked = false;
    let headerBuf = Buffer.alloc(0);

    try {
      const guardStream = new Transform({
        transform(chunk, _encoding, callback) {
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            const err = new Error('حجم الفيديو يتجاوز الحد الأقصى المسموح به.');
            err.statusCode = 413;
            return callback(err);
          }
          if (!firstChecked) {
            headerBuf = Buffer.concat([headerBuf, chunk]);
            if (headerBuf.length >= 16) {
              firstChecked = true;
              if (!validateFileSignature(headerBuf, 'video', ext)) {
                const err = new Error('توقيع ملف الفيديو غير صالح (يجب أن يكون MP4 أو WebM حقيقي).');
                err.statusCode = 400;
                return callback(err);
              }
              headerBuf = Buffer.alloc(0);
            }
          }
          callback(null, chunk);
        },
        flush(callback) {
          if (!firstChecked && headerBuf.length > 0) {
            firstChecked = true;
            if (!validateFileSignature(headerBuf, 'video', ext)) {
              const err = new Error('توقيع ملف الفيديو غير صالح (يجب أن يكون MP4 أو WebM حقيقي).');
              err.statusCode = 400;
              return callback(err);
            }
          }
          callback();
        }
      });

      await pipeline(req, guardStream, fs.createWriteStream(tempFile));

      if (totalBytes <= 0) {
        try { await fs.promises.unlink(tempFile); } catch {}
        sendJson(req, res, 400, { error: 'ملف الفيديو فارغ.' });
        return true;
      }

      const guid = await createBunnyVideoObject(rawTitle);
      await uploadFileStreamToBunny(guid, tempFile);
      try { await fs.promises.unlink(tempFile); } catch {}

      writeAuditLog(req, admin, 'BUNNY_VIDEO_UPLOAD', 'bunny', guid, { bytes: totalBytes });
      sendJson(req, res, 200, {
        guid,
        message: 'تم رفع الفيديو إلى Bunny Stream (تعدد الجودات HLS + تشفير) بنجاح!'
      });
    } catch (err) {
      try { await fs.promises.unlink(tempFile); } catch {}
      const status = err?.statusCode || 502;
      const msg = err?.statusCode ? err.message : `تعذر إتمام الرفع إلى Bunny Stream: ${err.message}`;
      sendJson(req, res, status, { error: msg });
    }
    return true;
  }

  if (pathname.startsWith('/api/admin/lessons/') && pathname.endsWith('/assessments') && req.method === 'GET') {
    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    const lesson = lessonId ? await db.get(`SELECT id, title FROM lessons WHERE id = ?`, [lessonId]) : null;
    if (!lesson) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    const rawAssessments = await db.all(`SELECT * FROM assessments WHERE lesson_id = ? ORDER BY id ASC`, [lessonId]);
    const assessments = [];
    for (const a of rawAssessments) {
      const qRows = await db.all(`SELECT * FROM questions WHERE assessment_id = ? ORDER BY id ASC`, [a.id]);
      const questions = qRows.map((q) => ({
        ...q,
        options: safeJsonParse(q.options_json, [])
      }));
      assessments.push({ ...a, questions });
    }
    sendJson(req, res, 200, { lesson_id: lesson.id, lesson_title: lesson.title, assessments });
    return true;
  }

  if (pathname === '/api/admin/settings' && req.method === 'PUT') {
    const body = await parseBody(req, 32 * 1024);
    const allowedKeys = {
      teacher_name: { max: 100 },
      platform_name: { max: 120 },
      support_whatsapp: { max: 20, regex: /^01[0125]\d{8}$/ },
      vodafone_cash_number: { max: 20, optional: true, regex: /^01[0125]\d{8}$/, errorMsg: 'رقم فودافون كاش يجب أن يكون رقم هاتف مصري صحيح مكوناً من ١١ رقماً.' },
      instapay_handle: { max: 100, optional: true },
      auto_friday_reports_enabled: { max: 5, optional: true, enum: ['0', '1'] },
      honor_roll_enabled: { max: 5, optional: true, enum: ['0', '1'] },
      azhar_exam_date: { max: 20, optional: true, regex: /^\d{4}-\d{2}-\d{2}$/, errorMsg: 'تاريخ امتحانات الأزهر يجب أن يكون بصيغة YYYY-MM-DD.' },
      announcement_banner: { max: 300 }
    };

    const bodyKeys = Object.keys(body || {});
    if (bodyKeys.length === 0) {
      sendJson(req, res, 400, { error: 'لم يتم إرسال أي إعدادات للتحديث.' });
      return true;
    }

    const updates = [];
    for (const k of bodyKeys) {
      if (!allowedKeys[k]) {
        sendJson(req, res, 400, { error: `مفتاح الإعداد (${k}) غير مسموح بتعديله.` });
        return true;
      }
      const rule = allowedKeys[k];
      let val = (k === 'support_whatsapp' || k === 'vodafone_cash_number')
        ? normalizePhoneNumber(body[k])
        : (rule.enum ? (body[k] === true || String(body[k]) === '1' ? '1' : '0') : String(body[k] ?? '').trim());

      if (!rule.optional && !val) {
        sendJson(req, res, 400, { error: `قيمة الإعداد (${k}) مطلوبة.` });
        return true;
      }
      if (val.length > rule.max) {
        sendJson(req, res, 400, { error: `قيمة الإعداد (${k}) يجب ألا تتجاوز ${rule.max} حرفاً.` });
        return true;
      }
      if (val && rule.regex && !rule.regex.test(val)) {
        sendJson(req, res, 400, { error: rule.errorMsg || 'رقم واتساب الدعم العام يجب أن يكون رقم هاتف مصري صحيح مكوناً من ١١ رقماً.' });
        return true;
      }
      updates.push([k, val]);
    }

    const upsertSql = db.isMysql
      ? 'INSERT INTO platform_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)'
      : 'INSERT INTO platform_settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value';
    await runInTransaction(async (tx) => {
      for (const [k, val] of updates) {
        await tx.run(upsertSql, [k, val]);
      }
    });

    writeAuditLog(req, admin, 'SETTINGS_UPDATE', 'platform_settings', 'allowed', { keys: updates.map(([k]) => k) });
    sendJson(req, res, 200, { message: 'تم حفظ إعدادات المنصة بنجاح!' });
    return true;
  }

  if (pathname === '/api/admin/students/reset-device' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    if (!studentId) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const upd = await db.run(
      `UPDATE users
       SET device_id = NULL, device_name = NULL, device_locked_at = NULL,
           device_reset_requested = 0, blocked_login_attempts = 0, token_version = token_version + 1
       WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    if (upd.changes === 0) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }

    writeAuditLog(req, admin, 'DEVICE_RESET', 'user', studentId);
    sendJson(req, res, 200, { message: 'تم مسح الجهاز القديم للطالب بنجاح!' });
    return true;
  }

  if (pathname === '/api/admin/students/lock' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    if (!studentId) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const upd = await db.run(
      `UPDATE users SET is_locked = 1, token_version = token_version + 1 WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    if (upd.changes === 0) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'STUDENT_LOCK', 'user', studentId);
    sendJson(req, res, 200, { message: 'تم إيقاف حساب الطالب وإبطال جلساته النشطة.' });
    return true;
  }

  if (pathname === '/api/admin/students/unlock' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    const stRow = studentId ? await db.get(`SELECT id, phone FROM users WHERE id = ? AND role = 'student'`, [studentId]) : null;
    if (!stRow) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    await db.run(
      `UPDATE users SET is_locked = 0, failed_login_attempts = 0, last_failed_login_at = NULL, login_locked_until = NULL WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    await db.run(`DELETE FROM login_attempts WHERE phone = ?`, [stRow.phone]);
    writeAuditLog(req, admin, 'STUDENT_UNLOCK', 'user', studentId);
    sendJson(req, res, 200, { message: 'تم إعادة تفعيل حساب الطالب بنجاح.' });
    return true;
  }

  if (pathname === '/api/admin/students/reset-password' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 8 || newPassword.length > 128) {
      sendJson(req, res, 400, { error: 'كلمة المرور المؤقتة يجب ألا تقل عن ٨ أحرف أو أرقام.' });
      return true;
    }
    const stRow = studentId ? await db.get(`SELECT id, phone FROM users WHERE id = ? AND role = 'student'`, [studentId]) : null;
    if (!stRow) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const pwHash = await hashPasswordAsync(newPassword);
    await db.run(
      `UPDATE users
       SET password_hash = ?, token_version = token_version + 1,
           failed_login_attempts = 0, last_failed_login_at = NULL, login_locked_until = NULL
       WHERE id = ? AND role = 'student'`,
      [pwHash, studentId]
    );
    await db.run(`DELETE FROM login_attempts WHERE phone = ?`, [stRow.phone]);
    writeAuditLog(req, admin, 'ADMIN_STUDENT_PASSWORD_RESET', 'user', studentId, { phone: stRow.phone });
    sendJson(req, res, 200, { message: 'تم تعيين كلمة المرور المؤقتة للطالب وإبطال جلساته القديمة بنجاح.' });
    return true;
  }

  if (pathname === '/api/admin/students/verify-whatsapp' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    if (!studentId) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const upd = await db.run(
      `UPDATE users SET is_whatsapp_verified = 1, whatsapp_otp_hash = NULL, whatsapp_otp_expires = NULL WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    if (upd.changes === 0) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'MANUAL_WHATSAPP_VERIFY', 'user', studentId);
    sendJson(req, res, 200, { message: 'تم تأكيد حساب الطالب وتفعيله بنجاح!' });
    return true;
  }

  if (pathname === '/api/admin/students/grant-month' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const studentId = parsePositiveInt(body.student_id);
    if (!studentId) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const existingStudent = await db.get(
      `SELECT id, subscription_expires_at FROM users WHERE id = ? AND role = 'student'`,
      [studentId]
    );
    if (!existingStudent) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const nowMs = Date.now();
    const curMs = existingStudent.subscription_expires_at ? new Date(existingStudent.subscription_expires_at).getTime() : 0;
    const baseMs = Number.isFinite(curMs) && curMs > nowMs ? curMs : nowMs;
    const newExp = new Date(baseMs + 30 * 24 * 60 * 60 * 1000).toISOString();
    const upd = await db.run(
      `UPDATE users SET subscription_expires_at = ?, subscribed_subjects = 'all' WHERE id = ? AND role = 'student'`,
      [newExp, studentId]
    );
    if (upd.changes === 0) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'SUBSCRIPTION_GRANT_30D', 'user', studentId, { expires_at: newExp });
    sendJson(req, res, 200, { message: 'تم تفعيل اشتراك 30 يوماً للطالب بنجاح!' });
    return true;
  }

  if (pathname.startsWith('/api/admin/students/') && req.method === 'DELETE') {
    const studentId = parsePositiveInt(pathname.split('/')[4]);
    if (!studentId) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const del = await db.run(`DELETE FROM users WHERE id = ? AND role = 'student'`, [studentId]);
    if (del.changes === 0) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'STUDENT_DELETE', 'user', studentId);
    sendJson(req, res, 200, { message: 'تم حذف حساب الطالب نهائياً من المنصة.' });
    return true;
  }

  if ((pathname === '/api/admin/upload-chunk' || pathname === '/api/admin/upload') && req.method === 'POST') {
    const uploadType = String(req.headers['x-upload-type'] || 'video').toLowerCase();
    if (!['video', 'pdf'].includes(uploadType)) {
      sendJson(req, res, 400, { error: 'نوع الرفع غير مسموح به.' });
      return true;
    }

    const rawFileName = safeDecode(req.headers['x-file-name'] || 'file', 'file');
    const ext = path.extname(rawFileName).toLowerCase();
    const allowedExts = uploadType === 'pdf' ? ['.pdf'] : ['.mp4', '.webm'];
    if (!allowedExts.includes(ext)) {
      sendJson(req, res, 400, { error: `امتداد الملف (${ext || 'بدون امتداد'}) غير مسموح به. المسموح: ${allowedExts.join(', ')}` });
      return true;
    }

    const chunkIndex = Number(req.headers['x-chunk-index'] ?? 0);
    const totalChunks = Number(req.headers['x-total-chunks'] ?? 1);
    const maxChunksAllowed = Math.ceil(MAX_VIDEO_UPLOAD_MB / 2) + 50;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > maxChunksAllowed || chunkIndex >= totalChunks) {
      sendJson(req, res, 400, { error: 'أرقام أجزاء الرفع غير صالحة.' });
      return true;
    }

    const maxChunkBytes = 5 * 1024 * 1024;
    const maxTotalBytes = uploadType === 'pdf' ? 20 * 1024 * 1024 : MAX_VIDEO_UPLOAD_MB * 1024 * 1024;

    const chunks = [];
    let chunkBytes = 0;
    for await (const chunk of req) {
      chunkBytes += chunk.length;
      if (chunkBytes > maxChunkBytes) {
        sendJson(req, res, 413, { error: 'حجم الجزء المرفوع يتجاوز الحد المسموح به (5MB).' });
        req.destroy();
        return true;
      }
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const rawUploadId = String(req.headers['x-upload-id'] || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (chunkIndex > 0 && !rawUploadId) {
      sendJson(req, res, 400, { error: 'معرف الرفع غير صالح.' });
      return true;
    }
    const clientUploadId = rawUploadId.slice(0, 80) || crypto.randomUUID();
    let meta = activeUploads.get(clientUploadId);

    if (chunkIndex === 0) {
      if (meta) {
        sendJson(req, res, 400, { error: 'معرف الرفع مستخدم بالفعل أو تم إرسال الجزء الأول مسبقاً.' });
        return true;
      }
      if (!validateFileSignature(buffer, uploadType, ext)) {
        sendJson(req, res, 400, { error: 'محتوى الملف الفعلي لا يطابق الصيغة المسموحة (فشل فحص التوقيع الرقمي للملف).' });
        return true;
      }
      const subFolder = uploadType === 'pdf' ? 'pdfs' : 'videos';
      const targetDir = path.join(getUploadsRoot(), subFolder);
      await fs.promises.mkdir(targetDir, { recursive: true });
      const safeServerFileName = `matn_${uploadType}_${crypto.randomUUID()}${ext}`;
      meta = {
        fileName: safeServerFileName,
        relativePath: `uploads/${subFolder}/${safeServerFileName}`,
        fullPath: path.join(targetDir, safeServerFileName),
        totalBytes: 0,
        receivedChunks: 0,
        createdAt: Date.now()
      };
      activeUploads.set(clientUploadId, meta);
    } else {
      if (!meta || chunkIndex !== meta.receivedChunks) {
        sendJson(req, res, 400, { error: 'أجزاء الملف المرفوع غير مرتبة أو مكررة.' });
        return true;
      }
    }

    meta.totalBytes += buffer.length;
    if (meta.totalBytes > maxTotalBytes) {
      try { await fs.promises.unlink(meta.fullPath); } catch {}
      activeUploads.delete(clientUploadId);
      sendJson(req, res, 413, { error: 'إجمالي حجم الملف يتجاوز الحد الأقصى المسموح به.' });
      return true;
    }

    await fs.promises.appendFile(meta.fullPath, buffer);
    meta.receivedChunks += 1;

    const isLast = chunkIndex === totalChunks - 1;
    if (isLast) {
      activeUploads.delete(clientUploadId);
      if (meta.totalBytes <= 0) {
        try { await fs.promises.unlink(meta.fullPath); } catch {}
        sendJson(req, res, 400, { error: 'حجم الملف المرفوع فارغ.' });
        return true;
      }
      if (uploadType === 'video' && ext === '.mp4') {
        await relocateMoovToFront(meta.fullPath);
      }
      writeAuditLog(req, admin, 'UPLOAD_FILE', uploadType, meta.fileName, { bytes: meta.totalBytes });
    }

    sendJson(req, res, 200, {
      done: isLast,
      chunk_index: chunkIndex,
      file_path: meta.relativePath,
      file_name: meta.fileName,
      message: isLast
        ? (uploadType === 'pdf' ? 'تم رفع ملف المذكرة (PDF) والتحقق منه بنجاح!' : 'تم رفع ملف الفيديو والتحقق منه بنجاح!')
        : 'تم رفع الجزء بنجاح'
    });
    return true;
  }

  if (pathname === '/api/admin/lessons' && req.method === 'POST') {
    const body = await parseBody(req, 128 * 1024);
    const title = String(body.title || '').trim();
    const subject = String(body.subject || 'fiqh');
    const grade = String(body.grade || 'grade_3');
    const branch = String(body.branch || (PREP_GRADES.includes(grade) ? 'general' : 'both'));
    const unitTitle = String(body.unit_title || 'الباب الأول').trim().slice(0, 191);
    const orderIndex = parseBoundedInt(body.order_index, 1, 1, 10000);
    const durationMinutes = parseBoundedInt(body.duration_minutes, 45, 1, 1000);
    const isPublished = body.is_published === undefined ? 1 : (body.is_published ? 1 : 0);

    if (!title || title.length > 200) {
      sendJson(req, res, 400, { error: 'عنوان المحاضرة مطلوب وألا يتجاوز ٢٠٠ حرف.' });
      return true;
    }
    if (!VALID_SUBJECTS.includes(subject)) {
      sendJson(req, res, 400, { error: 'المادة الشرعية غير صالحة.' });
      return true;
    }
    if (!VALID_GRADES.includes(grade) || !VALID_LESSON_BRANCHES.includes(branch)) {
      sendJson(req, res, 400, { error: 'الصف أو الشعبة غير صالحة.' });
      return true;
    }
    if (PREP_GRADES.includes(grade) && ['scientific', 'literary'].includes(branch)) {
      sendJson(req, res, 400, { error: 'الصفوف الإعدادية عامة ولا تنقسم إلى قسم علمي أو أدبي.' });
      return true;
    }
    if (!PREP_GRADES.includes(grade) && branch === 'general') {
      sendJson(req, res, 400, { error: 'الصفوف الثانوية يجب أن تكون للشعبة العلمية أو الأدبية أو كليهما.' });
      return true;
    }
    if (!isSubjectAllowedForGrade(subject, grade)) {
      sendJson(req, res, 400, { error: 'هذه المادة غير مقررة على الصف المختار (المواريث للثالث الثانوي فقط، والسيرة والتجويد للمرحلة الإعدادية فقط).' });
      return true;
    }

    let videoType = String(body.video_type || 'upload') === 'bunny' ? 'bunny' : 'upload';
    let videoPath = String(body.video_path || '').trim();
    if (videoType === 'bunny') {
      if (!isBunnyConfigured()) {
        sendJson(req, res, 400, { error: 'إعدادات Bunny Stream غير مفعلة في بيئة الخادم (.env).' });
        return true;
      }
      const bunnyGuid = String(body.bunny_video_id || videoPath).trim();
      if (!/^[a-zA-Z0-9_-]{6,80}$/.test(bunnyGuid)) {
        sendJson(req, res, 400, { error: 'معرف فيديو Bunny Stream غير صالح.' });
        return true;
      }
      videoPath = bunnyGuid;
    } else if (videoPath) {
      const baseName = path.basename(videoPath);
      videoPath = `uploads/videos/${baseName}`;
    }

    let pdfPath = String(body.pdf_path || '').trim();
    if (pdfPath) {
      const baseName = path.basename(pdfPath);
      pdfPath = `uploads/pdfs/${baseName}`;
    }

    const now = new Date().toISOString();
    const pdfPages = Array.isArray(body.pdf_content) ? body.pdf_content : [
      {
        heading: body.pdf_title || title,
        matn: String(body.matn_text || '«مَتْنُ الدَّرْسِ الشَّرْعِيِّ الْمُقَرَّرِ»').slice(0, 2000),
        sharh: String(body.sharh_text || 'شرح فضيلة الأستاذ محمد عبد الله للمباحث المقررة.').split('\n').filter(Boolean),
        notes: String(body.notes_text || 'احرص على تدوين الفوائد وحل واجب وامتحان الحصة.').slice(0, 500)
      }
    ];

    const resInsert = await db.run(
      `INSERT INTO lessons (
         title, description, subject, grade, branch, unit_title, order_index,
         video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        String(body.description || '').slice(0, 1000),
        subject,
        grade,
        branch,
        unitTitle,
        orderIndex,
        videoType,
        videoPath,
        durationMinutes,
        String(body.pdf_title || `مذكرة ${title}`).slice(0, 200),
        pdfPath,
        JSON.stringify(pdfPages),
        isPublished,
        now
      ]
    );

    if (isPublished) {
      await createNotification(db, {
        title: `📖 محاضرة جديدة: ${title}`,
        body: `تمت إضافة محاضرة جديدة في مادتك (${unitTitle}). افتحها الآن وشاهد الشرح.`,
        notifType: 'new_lesson',
        targetGrade: grade,
        targetBranch: branch,
        linkLessonId: resInsert.lastInsertRowid
      });
    }

    writeAuditLog(req, admin, 'LESSON_CREATE', 'lesson', resInsert.lastInsertRowid, { title, subject, grade, videoType });
    sendJson(req, res, 201, {
      message: 'تمت إضافة المحاضرة وملفاتها المحمية بنجاح!',
      lesson_id: resInsert.lastInsertRowid
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/lessons/') && req.method === 'PUT') {
    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    const existingLesson = lessonId ? await db.get(`SELECT * FROM lessons WHERE id = ?`, [lessonId]) : null;
    if (!existingLesson) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }

    const body = await parseBody(req, 128 * 1024);
    const title = body.title !== undefined ? String(body.title).trim() : existingLesson.title;
    const description = body.description !== undefined ? String(body.description).slice(0, 1000) : existingLesson.description;
    const subject = body.subject !== undefined ? String(body.subject) : existingLesson.subject;
    const grade = body.grade !== undefined ? String(body.grade) : existingLesson.grade;
    const branch = body.branch !== undefined ? String(body.branch) : existingLesson.branch;
    const unitTitle = body.unit_title !== undefined ? String(body.unit_title).trim().slice(0, 191) : String(existingLesson.unit_title || '').slice(0, 191);
    const orderIndex = body.order_index !== undefined ? parseBoundedInt(body.order_index, existingLesson.order_index || 1, 1, 10000) : existingLesson.order_index;
    const durationMinutes = body.duration_minutes !== undefined ? parseBoundedInt(body.duration_minutes, existingLesson.duration_minutes || 45, 1, 1000) : existingLesson.duration_minutes;
    const isPublished = body.is_published !== undefined ? (body.is_published ? 1 : 0) : existingLesson.is_published;
    const pdfTitle = body.pdf_title !== undefined ? String(body.pdf_title).slice(0, 200) : existingLesson.pdf_title;

    if (!title || title.length > 200) {
      sendJson(req, res, 400, { error: 'عنوان المحاضرة مطلوب وألا يتجاوز ٢٠٠ حرف.' });
      return true;
    }
    if (!VALID_SUBJECTS.includes(subject) || !VALID_GRADES.includes(grade) || !VALID_LESSON_BRANCHES.includes(branch)) {
      sendJson(req, res, 400, { error: 'بيانات المادة أو الصف أو الشعبة غير صالحة.' });
      return true;
    }
    if (PREP_GRADES.includes(grade) && ['scientific', 'literary'].includes(branch)) {
      sendJson(req, res, 400, { error: 'الصفوف الإعدادية عامة ولا تنقسم إلى قسم علمي أو أدبي.' });
      return true;
    }
    if (!PREP_GRADES.includes(grade) && branch === 'general') {
      sendJson(req, res, 400, { error: 'الصفوف الثانوية يجب أن تكون للشعبة العلمية أو الأدبية أو كليهما.' });
      return true;
    }
    if (!PREP_GRADES.includes(grade) && branch === 'general') {
      sendJson(req, res, 400, { error: 'الصفوف الثانوية يجب أن تكون للشعبة العلمية أو الأدبية أو كليهما.' });
      return true;
    }
    if (!isSubjectAllowedForGrade(subject, grade)) {
      sendJson(req, res, 400, { error: 'هذه المادة غير مقررة على الصف الدراسي المختار.' });
      return true;
    }

    let videoType = body.video_type !== undefined ? (body.video_type === 'bunny' ? 'bunny' : 'upload') : existingLesson.video_type;
    let videoPath = existingLesson.video_path;
    if (body.video_path !== undefined || body.bunny_video_id !== undefined) {
      const rawVp = String(body.bunny_video_id || body.video_path || '').trim();
      if (videoType === 'bunny') {
        if (!isBunnyConfigured() || !/^[a-zA-Z0-9_-]{6,80}$/.test(rawVp)) {
          sendJson(req, res, 400, { error: 'بيانات Bunny Stream غير صالحة أو غير مفعلة.' });
          return true;
        }
        videoPath = rawVp;
      } else {
        videoPath = rawVp ? `uploads/videos/${path.basename(rawVp)}` : '';
      }
    }

    let pdfPath = existingLesson.pdf_path;
    if (body.pdf_path !== undefined) {
      const rawPp = String(body.pdf_path || '').trim();
      pdfPath = rawPp ? `uploads/pdfs/${path.basename(rawPp)}` : '';
    }

    await db.run(
      `UPDATE lessons
       SET title = ?, description = ?, subject = ?, grade = ?, branch = ?, unit_title = ?,
           order_index = ?, video_type = ?, video_path = ?, duration_minutes = ?,
           pdf_title = ?, pdf_path = ?, is_published = ?
       WHERE id = ?`,
      [
        title, description, subject, grade, branch, unitTitle,
        orderIndex, videoType, videoPath, durationMinutes,
        pdfTitle, pdfPath, isPublished, lessonId
      ]
    );

    if (existingLesson.video_path && existingLesson.video_path !== videoPath) {
      await cleanupUnusedUploadFile(existingLesson.video_path);
    }
    if (existingLesson.pdf_path && existingLesson.pdf_path !== pdfPath) {
      await cleanupUnusedUploadFile(existingLesson.pdf_path);
    }

    if (!existingLesson.is_published && isPublished === 1) {
      await createNotification(db, {
        title: `📖 محاضرة جديدة: ${title}`,
        body: `تم نشر محاضرة جديدة في مادتك (${unitTitle}). افتحها الآن وشاهد الشرح.`,
        notifType: 'new_lesson',
        targetGrade: grade,
        targetBranch: branch,
        linkLessonId: lessonId
      });
    }

    writeAuditLog(req, admin, 'LESSON_UPDATE', 'lesson', lessonId, { title, isPublished, subject, grade });
    sendJson(req, res, 200, { message: 'تم تحديث بيانات المحاضرة بنجاح!' });
    return true;
  }

  if (pathname.startsWith('/api/admin/lessons/') && req.method === 'DELETE') {
    const lessonId = parsePositiveInt(pathname.split('/')[4]);
    const lesson = lessonId ? await db.get(`SELECT id, video_path, pdf_path FROM lessons WHERE id = ?`, [lessonId]) : null;
    if (!lesson) {
      sendJson(req, res, 404, { error: 'المحاضرة غير موجودة.' });
      return true;
    }
    await db.run(`DELETE FROM lessons WHERE id = ?`, [lessonId]);
    await cleanupUnusedUploadFile(lesson.video_path);
    await cleanupUnusedUploadFile(lesson.pdf_path);
    writeAuditLog(req, admin, 'LESSON_DELETE', 'lesson', lessonId);
    sendJson(req, res, 200, { message: 'تم حذف المحاضرة وملفاتها غير المستخدمة بنجاح.' });
    return true;
  }

  if (pathname === '/api/admin/assessments' && req.method === 'POST') {
    const body = await parseBody(req, 128 * 1024);
    const now = new Date().toISOString();
    const lessonId = parsePositiveInt(body.lesson_id);
    const lessonRow = lessonId ? await db.get(`SELECT id, title, grade, branch FROM lessons WHERE id = ?`, [lessonId]) : null;
    if (!lessonRow) {
      sendJson(req, res, 404, { error: 'المحاضرة المرتبطة بالاختبار غير موجودة.' });
      return true;
    }

    const assessmentType = String(body.assessment_type || 'exam');
    if (!['homework', 'exam', 'retake_exam'].includes(assessmentType)) {
      sendJson(req, res, 400, { error: 'نوع الاختبار غير صالح.' });
      return true;
    }
    const title = String(body.title || 'اختبار الحصة').trim().slice(0, 200);
    if (!title) {
      sendJson(req, res, 400, { error: 'عنوان الاختبار مطلوب.' });
      return true;
    }
    const timeLimit = parseBoundedInt(body.time_limit_minutes, 15, 1, 180);

    const schedCheck = validateScheduleWindow(body.scheduled_start, body.scheduled_end);
    if (!schedCheck.valid) {
      sendJson(req, res, 400, { error: schedCheck.error });
      return true;
    }

    const qCheck = validateAndNormalizeQuestions(body.questions);
    if (!qCheck.valid) {
      sendJson(req, res, 400, { error: qCheck.error, invalid_questions: qCheck.invalidQuestions });
      return true;
    }

    let targetStudentIds = Array.isArray(body.target_student_ids) ? body.target_student_ids.map(Number).filter(Number.isInteger) : [];
    if (assessmentType === 'retake_exam' && targetStudentIds.length === 0) {
      const failedRows = await db.all(
        `SELECT DISTINCT s.user_id
         FROM submissions s
         WHERE s.lesson_id = ? AND s.assessment_type = 'exam' AND s.passed = 0
           AND NOT EXISTS (
             SELECT 1 FROM submissions sp
             WHERE sp.user_id = s.user_id
               AND sp.lesson_id = s.lesson_id
               AND sp.assessment_type IN ('exam', 'retake_exam')
               AND sp.passed = 1
           )`,
        [lessonId]
      );
      targetStudentIds = failedRows.map((r) => r.user_id);
    }

    const assessmentId = await runInTransaction(async (tx) => {
      const result = await tx.run(
        `INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, scheduled_start, scheduled_end, target_student_ids_json, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [lessonId, title, assessmentType, timeLimit, schedCheck.scheduledStart, schedCheck.scheduledEnd, JSON.stringify(targetStudentIds), now]
      );

      const aId = result.lastInsertRowid;
      const insertQSql = `
        INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      for (const q of qCheck.normalized) {
        await tx.run(insertQSql, [aId, q.question_type, q.question_text, q.topic_tag, q.options_json, q.correct_option, q.explanation, q.points]);
      }
      return aId;
    });

    // Auto in-app notifications for new exam or retake_exam
    if (assessmentType === 'exam') {
      await createNotification(db, {
        title: `📝 امتحان جديد: ${title}`,
        body: `تم فتح امتحان جديد لمحاضرة «${lessonRow.title}» لمدة ${timeLimit} دقيقة.`,
        notifType: 'new_exam',
        targetGrade: lessonRow.grade,
        targetBranch: lessonRow.branch,
        linkLessonId: lessonRow.id
      });
    } else if (assessmentType === 'retake_exam' && targetStudentIds.length > 0) {
      for (const sid of targetStudentIds) {
        await createNotification(db, {
          title: `🔁 تم فتح امتحان الإعادة: ${title}`,
          body: `يمكنك الآن دخول امتحان الإعادة لمحاضرة «${lessonRow.title}» لاستكمال فتح الحصص القادمة.`,
          notifType: 'retake_exam',
          targetUserId: sid,
          targetGrade: lessonRow.grade,
          targetBranch: lessonRow.branch,
          linkLessonId: lessonRow.id
        });
      }
    }

    writeAuditLog(req, admin, 'ASSESSMENT_CREATE', 'assessment', assessmentId, { lessonId, assessmentType });
    sendJson(req, res, 201, {
      message: assessmentType === 'retake_exam'
        ? 'تم نشر وجدولة امتحان الراسبين للطلاب المستهدفين بنجاح!'
        : 'تم إنشاء الاختبار وإضافة الأسئلة بنجاح!',
      assessment_id: assessmentId
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/assessments/') && req.method === 'PUT') {
    const assessmentId = parsePositiveInt(pathname.split('/')[4]);
    const existingAssessment = assessmentId ? await db.get(`SELECT * FROM assessments WHERE id = ?`, [assessmentId]) : null;
    if (!existingAssessment) {
      sendJson(req, res, 404, { error: 'الاختبار غير موجود.' });
      return true;
    }

    const body = await parseBody(req, 128 * 1024);
    const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) : existingAssessment.title;
    if (!title) {
      sendJson(req, res, 400, { error: 'عنوان الاختبار مطلوب.' });
      return true;
    }
    const assessmentType = body.assessment_type !== undefined ? String(body.assessment_type) : existingAssessment.assessment_type;
    if (!['homework', 'exam', 'retake_exam'].includes(assessmentType)) {
      sendJson(req, res, 400, { error: 'نوع الاختبار غير صالح.' });
      return true;
    }
    const timeLimit = body.time_limit_minutes !== undefined
      ? parseBoundedInt(body.time_limit_minutes, existingAssessment.time_limit_minutes || 15, 1, 180)
      : existingAssessment.time_limit_minutes;
    const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existingAssessment.is_active;

    const rawStart = body.scheduled_start !== undefined ? body.scheduled_start : existingAssessment.scheduled_start;
    const rawEnd = body.scheduled_end !== undefined ? body.scheduled_end : existingAssessment.scheduled_end;
    const schedCheck = validateScheduleWindow(rawStart, rawEnd);
    if (!schedCheck.valid) {
      sendJson(req, res, 400, { error: schedCheck.error });
      return true;
    }

    let normalizedQuestions = null;
    if (body.questions !== undefined) {
      const qCheck = validateAndNormalizeQuestions(body.questions);
      if (!qCheck.valid) {
        sendJson(req, res, 400, { error: qCheck.error, invalid_questions: qCheck.invalidQuestions });
        return true;
      }
      normalizedQuestions = qCheck.normalized;
    }

    let targetStudentIdsJson = existingAssessment.target_student_ids_json || '[]';
    if (body.target_student_ids !== undefined) {
      const cleanTargets = Array.isArray(body.target_student_ids)
        ? Array.from(new Set(body.target_student_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)))
        : [];
      targetStudentIdsJson = JSON.stringify(cleanTargets);
    }

    await runInTransaction(async (tx) => {
      await tx.run(
        `UPDATE assessments
         SET title = ?, assessment_type = ?, time_limit_minutes = ?,
             scheduled_start = ?, scheduled_end = ?, target_student_ids_json = ?, is_active = ?
         WHERE id = ?`,
        [title, assessmentType, timeLimit, schedCheck.scheduledStart, schedCheck.scheduledEnd, targetStudentIdsJson, isActive, assessmentId]
      );

      if (normalizedQuestions) {
        const existingQuestions = await tx.all(
          `SELECT id FROM questions WHERE assessment_id = ? ORDER BY id ASC`,
          [assessmentId]
        );
        const existingIdSet = new Set(existingQuestions.map((row) => row.id));
        const hasExplicitIds = Array.isArray(body.questions) && body.questions.some((q) => parsePositiveInt(q?.id) && existingIdSet.has(parsePositiveInt(q.id)));
        const keptIds = new Set();

        for (let i = 0; i < normalizedQuestions.length; i++) {
          const q = normalizedQuestions[i];
          const explicitId = Array.isArray(body.questions) ? parsePositiveInt(body.questions[i]?.id) : null;
          const targetQId = hasExplicitIds
            ? (explicitId && existingIdSet.has(explicitId) ? explicitId : null)
            : (existingQuestions[i] ? existingQuestions[i].id : null);

          if (targetQId) {
            keptIds.add(targetQId);
            await tx.run(
              `UPDATE questions
               SET question_type = ?, question_text = ?, topic_tag = ?, options_json = ?, correct_option = ?, explanation = ?, points = ?
               WHERE id = ? AND assessment_id = ?`,
              [q.question_type, q.question_text, q.topic_tag, q.options_json, q.correct_option, q.explanation, q.points, targetQId, assessmentId]
            );
          } else {
            await tx.run(
              `INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [assessmentId, q.question_type, q.question_text, q.topic_tag, q.options_json, q.correct_option, q.explanation, q.points]
            );
          }
        }

        const removedIds = existingQuestions.map((row) => row.id).filter((id) => !keptIds.has(id));
        if (removedIds.length > 0) {
          const ph = removedIds.map(() => '?').join(',');
          await tx.run(`DELETE FROM questions WHERE assessment_id = ? AND id IN (${ph})`, [assessmentId, ...removedIds]);
        }
      }
    });

    writeAuditLog(req, admin, 'ASSESSMENT_UPDATE', 'assessment', assessmentId, { title, isActive });
    sendJson(req, res, 200, { message: 'تم تحديث الاختبار بنجاح!' });
    return true;
  }

  if (pathname.startsWith('/api/admin/assessments/') && req.method === 'DELETE') {
    const assessmentId = parsePositiveInt(pathname.split('/')[4]);
    if (!assessmentId) {
      sendJson(req, res, 404, { error: 'الاختبار غير موجود.' });
      return true;
    }
    const del = await db.run(`DELETE FROM assessments WHERE id = ?`, [assessmentId]);
    if (del.changes === 0) {
      sendJson(req, res, 404, { error: 'الاختبار غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'ASSESSMENT_DELETE', 'assessment', assessmentId);
    sendJson(req, res, 200, { message: 'تم حذف الاختبار بنجاح.' });
    return true;
  }

  if (pathname === '/api/admin/vouchers/generate' && req.method === 'POST') {
    const body = await parseBody(req, 32 * 1024);
    const count = parseBoundedInt(body.count, 10, 1, 500);
    const batchName = String(body.batch_name || `دفعة أكواد شهرية`).trim().slice(0, 120);
    const durationDays = parseBoundedInt(body.duration_days, 30, 1, 365);
    const subjectScope = String(body.subject_scope || 'all');
    const gradeScope = String(body.grade_scope || 'all');
    if (subjectScope !== 'all' && !VALID_SUBJECTS.includes(subjectScope)) {
      sendJson(req, res, 400, { error: 'نطاق المادة في كود الشحن غير صالح.' });
      return true;
    }
    if (gradeScope !== 'all' && !VALID_GRADES.includes(gradeScope)) {
      sendJson(req, res, 400, { error: 'نطاق الصف الدراسي في كود الشحن غير صالح.' });
      return true;
    }
    if (subjectScope !== 'all' && gradeScope !== 'all' && !isSubjectAllowedForGrade(subjectScope, gradeScope)) {
      sendJson(req, res, 400, { error: 'نطاق المادة المختار غير مقرر على هذا الصف الدراسي.' });
      return true;
    }
    const parsedPrice = Number(body.price_egp);
    const priceEgp = body.price_egp !== undefined && Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 150;
    const now = new Date().toISOString();

    const insertVSql = `
      INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    const generatedCodes = await runInTransaction(async (tx) => {
      const codes = [];
      for (let i = 0; i < count; i++) {
        const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
        const code = `MATN-${durationDays}D-${rand}`;
        await tx.run(insertVSql, [code, batchName, durationDays, subjectScope, gradeScope, priceEgp, now]);
        codes.push(code);
      }
      return codes;
    });

    writeAuditLog(req, admin, 'VOUCHER_GENERATE', 'voucher_batch', batchName, { count, durationDays });
    sendJson(req, res, 201, {
      message: `تم توليد ${count} كود شحن شهري (${durationDays} يوماً من تاريخ الاستخدام) بنجاح!`,
      codes: generatedCodes
    });
    return true;
  }

  if (pathname === '/api/admin/students/search' && req.method === 'GET') {
    const q = String(urlObj.searchParams.get('q') || '').trim();
    const normalizedQ = normalizeDigits(q);
    const students = q
      ? await db.all(
          `SELECT id, full_name, phone, grade, branch
           FROM users
           WHERE role = 'student' AND (full_name LIKE ? OR phone LIKE ?)
           ORDER BY id DESC LIMIT 30`,
          [`%${q}%`, `%${normalizedQ}%`]
        )
      : await db.all(
          `SELECT id, full_name, phone, grade, branch
           FROM users
           WHERE role = 'student'
           ORDER BY id DESC LIMIT 30`
        );
    sendJson(req, res, 200, { students });
    return true;
  }

  if (pathname === '/api/admin/vouchers/assign' && req.method === 'POST') {
    const body = await parseBody(req, 16 * 1024);
    const voucherId = parsePositiveInt(body.voucher_id);
    const action = String(body.action || 'assign').trim().toLowerCase();

    if (action === 'release') {
      const voucher = voucherId ? await db.get(`SELECT * FROM vouchers WHERE id = ?`, [voucherId]) : null;
      if (!voucher) {
        sendJson(req, res, 404, { error: 'كود التفعيل غير موجود.' });
        return true;
      }
      if (voucher.is_used) {
        sendJson(req, res, 400, { error: 'هذا الكود تم استخدامه بالفعل ولا يمكن تعديل حجزه.' });
        return true;
      }
      await db.run(
        `UPDATE vouchers
         SET assigned_to_name = NULL, assigned_to_phone = NULL, restrict_to_phone = 0, sent_at = NULL
         WHERE id = ? AND is_used = 0`,
        [voucherId]
      );
      writeAuditLog(req, admin, 'VOUCHER_UNASSIGN', 'voucher', voucherId);
      sendJson(req, res, 200, { message: 'تم إلغاء حجز الكود وإتاحته مرة أخرى.' });
      return true;
    }

    const autoPick = Boolean(body.auto_pick) && !voucherId;
    if (!voucherId && !autoPick) {
      sendJson(req, res, 404, { error: 'كود التفعيل غير موجود.' });
      return true;
    }

    let recipientName = String(body.recipient_name || '').trim();
    let recipientPhone = normalizePhoneNumber(body.recipient_phone || '');
    const studentId = body.student_id ? parsePositiveInt(body.student_id) : null;
    let studentGrade = null;

    if (studentId) {
      const stRow = await db.get(`SELECT id, full_name, phone, grade FROM users WHERE id = ? AND role = 'student'`, [studentId]);
      if (!stRow) {
        sendJson(req, res, 404, { error: 'الطالب المختار غير موجود.' });
        return true;
      }
      studentGrade = stRow.grade;
      recipientName = stRow.full_name;
      recipientPhone = stRow.phone;
    }

    if (!recipientName || recipientName.length < 2 || recipientName.length > 120) {
      sendJson(req, res, 400, { error: 'يرجى كتابة اسم الطالب المستلم (حرفان على الأقل).' });
      return true;
    }
    if (!/^01[0125]\d{8}$/.test(recipientPhone)) {
      sendJson(req, res, 400, { error: 'يرجى إدخال رقم واتساب مصري صحيح للطالب مكون من ١١ رقماً.' });
      return true;
    }

    const reqGradeScope = String(body.grade_scope || 'all').trim();
    const reqSubjectScope = String(body.subject_scope || 'all').trim();
    if (autoPick) {
      if (reqGradeScope !== 'all' && !VALID_GRADES.includes(reqGradeScope)) {
        sendJson(req, res, 400, { error: 'نطاق الصف الدراسي غير صالح.' });
        return true;
      }
      if (reqSubjectScope !== 'all' && !VALID_SUBJECTS.includes(reqSubjectScope)) {
        sendJson(req, res, 400, { error: 'نطاق المادة غير صالح.' });
        return true;
      }
      if (reqSubjectScope !== 'all' && reqGradeScope !== 'all' && !isSubjectAllowedForGrade(reqSubjectScope, reqGradeScope)) {
        sendJson(req, res, 400, { error: 'المادة المختارة غير مقررة على هذا الصف الدراسي.' });
        return true;
      }
      if (studentGrade && reqGradeScope !== 'all' && reqGradeScope !== studentGrade) {
        sendJson(req, res, 400, { error: 'الصف المختار للكود يختلف عن صف الطالب المحدد.' });
        return true;
      }
    }

    const restrictToPhone = body.restrict_to_phone ? 1 : 0;
    const durationDays = parseBoundedInt(body.duration_days, 30, 1, 365);
    const parsedPrice = Number(body.price_egp);
    const priceEgp = body.price_egp !== undefined && Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 150;
    const now = new Date().toISOString();

    const assignTx = await runInTransaction(async (tx) => {
      const lockClause = tx.forUpdate();
      let voucher = null;

      if (voucherId) {
        voucher = await tx.get(`SELECT * FROM vouchers WHERE id = ? ${lockClause}`, [voucherId]);
        if (!voucher) {
          return { ok: false, status: 404, error: 'كود التفعيل غير موجود.' };
        }
        if (voucher.is_used) {
          return { ok: false, status: 400, error: 'هذا الكود تم استخدامه بالفعل ولا يمكن تعديل حجزه.' };
        }
        if (studentGrade && voucher.grade_scope !== 'all' && voucher.grade_scope !== studentGrade) {
          return { ok: false, status: 400, error: 'هذا الكود مخصص لصف دراسي آخر مختلف عن صف الطالب المختار.' };
        }
      } else {
        voucher = await tx.get(
          `SELECT * FROM vouchers
           WHERE is_used = 0
             AND (assigned_to_phone IS NULL OR assigned_to_phone = '')
             AND (grade_scope = ? OR grade_scope = 'all')
             AND subject_scope = ?
           ORDER BY CASE WHEN grade_scope = ? THEN 0 ELSE 1 END, id ASC
           LIMIT 1 ${lockClause}`,
          [reqGradeScope, reqSubjectScope, reqGradeScope]
        );

        if (!voucher) {
          if (body.auto_generate_if_missing === false) {
            return { ok: false, status: 404, error: 'لا يوجد كود متاح غير محجوز يطابق الصف والمادة المختارة.' };
          }
          const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
          const newCode = `MATN-${durationDays}D-${rand}`;
          const ins = await tx.run(
            `INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, created_at)
             VALUES (?, 'رد سريع واتساب', ?, ?, ?, ?, ?)`,
            [newCode, durationDays, reqSubjectScope, reqGradeScope, priceEgp, now]
          );
          voucher = await tx.get(`SELECT * FROM vouchers WHERE id = ?`, [ins.lastInsertRowid]);
        }
      }

      const upd = await tx.run(
        `UPDATE vouchers
         SET assigned_to_name = ?, assigned_to_phone = ?, restrict_to_phone = ?, sent_at = ?
         WHERE id = ? AND is_used = 0`,
        [recipientName, recipientPhone, restrictToPhone, now, voucher.id]
      );
      if (upd.changes === 0) {
        return { ok: false, status: 409, error: 'تم استخدام الكود بالفعل.' };
      }

      const updatedVoucher = await tx.get(`SELECT * FROM vouchers WHERE id = ?`, [voucher.id]);
      return { ok: true, voucher: updatedVoucher };
    });

    if (!assignTx.ok) {
      sendJson(req, res, assignTx.status, { error: assignTx.error });
      return true;
    }

    const updatedVoucher = assignTx.voucher;
    const customMsgRaw = String(body.custom_message || '').trim().slice(0, 1200);
    let msg = '';
    if (customMsgRaw) {
      msg = customMsgRaw
        .replace(/\{\{\s*CODE\s*\}\}|\{\s*CODE\s*\}|\[الكود\]/gi, updatedVoucher.code);
      if (!msg.includes(updatedVoucher.code)) {
        msg = `${msg}\n${updatedVoucher.code}`;
      }
    } else {
      msg = [
        `وعليكم السلام ورحمة الله وبركاته يا ${recipientName}`,
        'تم تأكيد استلام التحويل بنجاح ✅',
        'اتفضل كود التفعيل الخاص باشتراكك في منصة مَتْن:',
        updatedVoucher.code,
        'بالتوفيق إن شاء الله!'
      ].join('\n');
    }

    const intlPhone = recipientPhone.startsWith('0') ? `2${recipientPhone}` : recipientPhone;
    const whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;

    if (HAS_WHATSAPP_GATEWAY && body.send_via_gateway !== false) {
      await dispatchWhatsApp(recipientPhone, recipientName, 'voucher_send', msg, `إرسال كود تفعيل (${updatedVoucher.code})`);
    }

    writeAuditLog(req, admin, 'VOUCHER_ASSIGN_SEND', 'voucher', updatedVoucher.id, {
      recipientPhone,
      restrictToPhone: Boolean(restrictToPhone),
      autoPicked: autoPick
    });

    sendJson(req, res, 200, {
      message: `تم حجز الكود (${updatedVoucher.code}) للطالب (${recipientName}) وتجهيز رسالة الواتساب بنجاح!`,
      whatsapp_url: whatsappUrl,
      whatsapp_message: msg,
      voucher: updatedVoucher,
      auto_picked: autoPick
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/students/') && pathname.endsWith('/parent-report') && req.method === 'GET') {
    const studentId = parsePositiveInt(pathname.split('/')[4]);
    const stRow = studentId
      ? await db.get(`SELECT id, full_name, phone, parent_phone, grade, branch, subscription_expires_at FROM users WHERE id = ? AND role = 'student'`, [studentId])
      : null;
    if (!stRow) {
      sendJson(req, res, 404, { error: 'الطالب غير موجود.' });
      return true;
    }
    const { reportText, whatsappUrl } = await buildStudentParentReport(db, stRow, new Date());
    sendJson(req, res, 200, {
      student_id: stRow.id,
      student_name: stRow.full_name,
      parent_phone: stRow.parent_phone || '',
      report_text: reportText,
      whatsapp_url: whatsappUrl
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/lesson-questions/') && req.method === 'PUT') {
    const qId = parsePositiveInt(pathname.split('/')[4]);
    const qRow = qId ? await db.get(`SELECT * FROM lesson_questions WHERE id = ?`, [qId]) : null;
    if (!qRow) {
      sendJson(req, res, 404, { error: 'السؤال غير موجود.' });
      return true;
    }
    const body = await parseBody(req, 16 * 1024);
    const answer = body.admin_answer !== undefined ? String(body.admin_answer || '').trim() : qRow.admin_answer;
    const isPublished = body.is_published !== undefined ? (body.is_published ? 1 : 0) : (answer ? 1 : 0);
    if (!answer || answer.length < 2) {
      sendJson(req, res, 400, { error: 'يرجى كتابة رد واضح على سؤال الطالب.' });
      return true;
    }
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE lesson_questions
       SET admin_answer = ?, answered_by_admin_id = ?, is_published = ?, answered_at = ?
       WHERE id = ?`,
      [answer.slice(0, 2000), admin.id, isPublished, nowIso, qId]
    );
    if (isPublished === 1) {
      await createNotification(db, {
        title: '💬 تمت الإجابة على سؤالك',
        body: `رد فضيلة الأستاذ على سؤالك: ${answer.slice(0, 180)}`,
        notifType: 'qa_answer',
        targetUserId: qRow.user_id,
        linkLessonId: qRow.lesson_id
      });
    }
    writeAuditLog(req, admin, 'LESSON_QUESTION_ANSWERED', 'lesson_question', qId, { isPublished: Boolean(isPublished) });
    sendJson(req, res, 200, { message: 'تم حفظ رد فضيلة الأستاذ ونشره للطالب بنجاح!' });
    return true;
  }

  if (pathname.startsWith('/api/admin/lesson-questions/') && req.method === 'DELETE') {
    const qId = parsePositiveInt(pathname.split('/')[4]);
    const del = qId ? await db.run(`DELETE FROM lesson_questions WHERE id = ?`, [qId]) : { changes: 0 };
    if (del.changes === 0) {
      sendJson(req, res, 404, { error: 'السؤال غير موجود.' });
      return true;
    }
    writeAuditLog(req, admin, 'LESSON_QUESTION_DELETED', 'lesson_question', qId);
    sendJson(req, res, 200, { message: 'تم حذف السؤال بنجاح.' });
    return true;
  }

  if (pathname === '/api/admin/weekly-reports' && req.method === 'GET') {
    const currentWeekKey = getCairoDateTimeParts(new Date()).weekKey;
    const weekKey = String(urlObj.searchParams.get('week_key') || '').trim() || currentWeekKey;
    if (weekKey.length > 32) {
      sendJson(req, res, 400, { error: 'معرف الأسبوع (week_key) يجب ألا يتجاوز ٣٢ حرفاً.' });
      return true;
    }
    const itemsLimit = parseBoundedInt(urlObj.searchParams.get('limit'), 100, 1, 200);
    const itemsOffset = parseBoundedInt(urlObj.searchParams.get('offset'), 0, 0, 1000000);
    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM weekly_parent_reports WHERE week_key = ?`,
      [weekKey]
    );
    const items = await db.all(
      `SELECT id, week_key, user_id, student_name, parent_phone, report_text, whatsapp_url, status, error_reason, sent_at, created_at
       FROM weekly_parent_reports
       WHERE week_key = ?
       ORDER BY id ASC
       LIMIT ${itemsLimit} OFFSET ${itemsOffset}`,
      [weekKey]
    );
    const autoRow = await db.get("SELECT value FROM platform_settings WHERE `key` = 'auto_friday_reports_enabled'");
    sendJson(req, res, 200, {
      week_key: weekKey,
      current_friday_key: currentWeekKey,
      gateway_configured: HAS_WHATSAPP_GATEWAY,
      bot_pull_configured: isBotPullConfigured(),
      auto_friday_reports_enabled: autoRow?.value === '1',
      total_items: Number(totalRow?.c || 0),
      items_limit: itemsLimit,
      items_offset: itemsOffset,
      items
    });
    return true;
  }

  if (pathname === '/api/admin/weekly-reports/run' && req.method === 'POST') {
    const body = await parseBody(req, 32 * 1024);
    const nowDate = new Date();
    const weekKey = String(body.week_key || '').trim() || getCairoDateTimeParts(nowDate).weekKey;
    if (weekKey.length > 32) {
      sendJson(req, res, 400, { error: 'معرف الأسبوع (week_key) يجب ألا يتجاوز ٣٢ حرفاً.' });
      return true;
    }
    const studentIds = Array.isArray(body.student_ids) ? body.student_ids : null;
    const includeAllVerified = Boolean(body.include_all_verified);
    const delayMs = Number.isFinite(Number(body.delay_ms))
      ? Math.min(Math.max(Number(body.delay_ms), 0), 15000)
      : WEEKLY_REPORT_DELAY_MS;
    const itemsLimit = parseBoundedInt(body.limit, 100, 1, 200);
    const itemsOffset = parseBoundedInt(body.offset, 0, 0, 1000000);

    const { queuedCount } = await queueWeeklyReportsForWeek(db, {
      now: nowDate,
      weekKey,
      studentIds,
      includeAllVerified
    });

    const pullConfigured = isBotPullConfigured();
    let runResult = null;
    if (HAS_WHATSAPP_GATEWAY) {
      if (body.await_completion === true) {
        runResult = await processWeeklyReportQueue({
          db,
          weekKey,
          dispatchWhatsApp,
          hasGateway: true,
          delayMs
        });
      } else {
        processWeeklyReportQueue({
          db,
          weekKey,
          dispatchWhatsApp,
          hasGateway: true,
          delayMs
        }).catch(() => {});
      }
    } else if (!pullConfigured) {
      runResult = await processWeeklyReportQueue({
        db,
        weekKey,
        dispatchWhatsApp,
        hasGateway: false,
        delayMs
      });
    }

    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM weekly_parent_reports WHERE week_key = ?`,
      [weekKey]
    );
    const items = await db.all(
      `SELECT id, week_key, user_id, student_name, parent_phone, report_text, whatsapp_url, status, error_reason, sent_at, created_at
       FROM weekly_parent_reports
       WHERE week_key = ?
       ORDER BY id ASC
       LIMIT ${itemsLimit} OFFSET ${itemsOffset}`,
      [weekKey]
    );

    writeAuditLog(req, admin, 'WEEKLY_PARENT_REPORTS_RUN', 'weekly_parent_reports', weekKey, {
      queuedCount,
      gatewayConfigured: HAS_WHATSAPP_GATEWAY,
      botPullConfigured: pullConfigured
    });

    sendJson(req, res, 200, {
      message: HAS_WHATSAPP_GATEWAY
        ? 'بدأ إرسال تقارير أولياء الأمور بالتتابع (طالب تلو الآخر) عبر بوابة الواتساب!'
        : (pullConfigured
          ? 'تم تجهيز تقارير الأسبوع في الطابور! شغّل بوت الواتساب على جهازك لسحبها وإرسالها بالتتابع.'
          : 'تم تجهيز قائمة تقارير أولياء الأمور بالتتابع! يمكنك إرسالها لطالب تلو الآخر بنقرة واحدة (أو ربط بوابة الواتساب في .env للإرسال الآلي كل جمعة ٣ عصراً).'),
      week_key: weekKey,
      queued_count: queuedCount,
      total_items: Number(totalRow?.c || 0),
      gateway_configured: HAS_WHATSAPP_GATEWAY,
      bot_pull_configured: pullConfigured,
      in_progress: Boolean(HAS_WHATSAPP_GATEWAY && body.await_completion !== true),
      result: runResult,
      items
    });
    return true;
  }

  if (pathname.startsWith('/api/admin/weekly-reports/') && pathname.endsWith('/mark-sent') && req.method === 'POST') {
    const repId = parsePositiveInt(pathname.split('/')[4]);
    const row = repId ? await db.get(`SELECT * FROM weekly_parent_reports WHERE id = ?`, [repId]) : null;
    if (!row) {
      sendJson(req, res, 404, { error: 'سجل التقرير غير موجود.' });
      return true;
    }
    const nowIso = new Date().toISOString();
    await db.run(
      `UPDATE weekly_parent_reports
       SET status = 'sent', error_reason = NULL, sent_at = ?
       WHERE id = ?`,
      [nowIso, repId]
    );
    sendJson(req, res, 200, { message: `تم تسجيل إرسال تقرير (${row.student_name}) لولي الأمر.` });
    return true;
  }

  return false;
}

module.exports = { handleAdminRoutes };
