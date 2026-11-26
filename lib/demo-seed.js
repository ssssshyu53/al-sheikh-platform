const fs = require('node:fs');
const path = require('node:path');
const { VIDEOS_DIR } = require('./paths');

const DEMO_ADMIN = Object.freeze({
  full_name: 'فضيلة الأستاذ محمد عبد الله (إدارة المنصة)',
  phone: '01000000001',
  password: 'Admin@2026',
  role: 'admin'
});

const DEMO_STUDENT = Object.freeze({
  full_name: 'أحمد محمود عبد الله السيد',
  phone: '01000000002',
  parent_phone: '01000000003',
  password: 'Student@2026',
  role: 'student',
  grade: 'grade_3',
  branch: 'scientific'
});

const DEMO_PEER_STUDENT = Object.freeze({
  full_name: 'عمر خالد إبراهيم حسن',
  phone: '01000000004',
  parent_phone: '01000000005',
  password: 'Student@2026',
  role: 'student',
  grade: 'grade_3',
  branch: 'scientific'
});

function shouldSeedDemoAccounts(env = null) {
  const source = env || process.env;
  const mode = String(source.NODE_ENV || 'development').trim().toLowerCase();
  const disableFlag = source.MATN_DISABLE_DEMO_SEED;
  const seedFlag = source.MATN_SEED_DEMO;
  if (mode === 'test' || mode === 'production') return false;
  if (disableFlag === '1') return false;
  return mode === 'development' || seedFlag === '1';
}

function getPublicDemoAccountsPayload(env = null) {
  if (!shouldSeedDemoAccounts(env)) return null;
  return {
    student: {
      label: 'حساب طالب تجريبي (الثالث الثانوي الأزهري)',
      name: DEMO_STUDENT.full_name,
      phone: DEMO_STUDENT.phone,
      password: DEMO_STUDENT.password
    },
    admin: {
      label: 'حساب أدمن تجريبي (لوحة الإدارة الكاملة)',
      name: DEMO_ADMIN.full_name,
      phone: DEMO_ADMIN.phone,
      password: DEMO_ADMIN.password
    }
  };
}

function ensureDemoVideoAsset() {
  try {
    const src = path.join(__dirname, '..', 'public', 'assets', 'matn_guide_video.mp4');
    const dst = path.join(VIDEOS_DIR, 'demo_fiqh_lesson.mp4');
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
      fs.copyFileSync(src, dst);
    }
    return fs.existsSync(dst) ? 'uploads/videos/demo_fiqh_lesson.mp4' : '';
  } catch {
    return '';
  }
}

async function seedDemoData(db, hashPasswordAsync, opts = {}) {
  if (!opts.force && !shouldSeedDemoAccounts()) return { seeded: false };

  const now = new Date();
  const nowIso = now.toISOString();
  const futureSubIso = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const peerSubIso = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const prefix = db.insertIgnorePrefix ? db.insertIgnorePrefix() : (db.isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');

  // 1. Ensure Demo Admin
  let adminRow = await db.get(`SELECT id FROM users WHERE phone = ?`, [DEMO_ADMIN.phone]);
  if (!adminRow) {
    const adminHash = await hashPasswordAsync(DEMO_ADMIN.password);
    await db.run(
      `${prefix} users (
        full_name, phone, parent_phone, password_hash, role, grade, branch,
        is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
      ) VALUES (?, ?, ?, ?, 'admin', 'grade_3', 'scientific', 1, '2099-12-31T23:59:59.000Z', 'all', ?)`,
      [DEMO_ADMIN.full_name, DEMO_ADMIN.phone, DEMO_ADMIN.phone, adminHash, nowIso]
    );
    adminRow = await db.get(`SELECT id FROM users WHERE phone = ?`, [DEMO_ADMIN.phone]);
  }

  // 2. Ensure Demo Student (active 90-day full subscription, verified)
  let studentRow = await db.get(`SELECT id, subscription_expires_at FROM users WHERE phone = ?`, [DEMO_STUDENT.phone]);
  if (!studentRow) {
    const studentHash = await hashPasswordAsync(DEMO_STUDENT.password);
    await db.run(
      `${prefix} users (
        full_name, phone, parent_phone, password_hash, role, grade, branch,
        is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
      ) VALUES (?, ?, ?, ?, 'student', ?, ?, 1, ?, 'all', ?)`,
      [
        DEMO_STUDENT.full_name,
        DEMO_STUDENT.phone,
        DEMO_STUDENT.parent_phone,
        studentHash,
        DEMO_STUDENT.grade,
        DEMO_STUDENT.branch,
        futureSubIso,
        nowIso
      ]
    );
    studentRow = await db.get(`SELECT id, subscription_expires_at FROM users WHERE phone = ?`, [DEMO_STUDENT.phone]);
  } else if (!studentRow.subscription_expires_at || new Date(studentRow.subscription_expires_at).getTime() < now.getTime()) {
    await db.run(
      `UPDATE users SET subscription_expires_at = ?, subscribed_subjects = 'all', is_whatsapp_verified = 1, is_locked = 0 WHERE id = ?`,
      [futureSubIso, studentRow.id]
    );
  }

  // 3. Ensure Second Demo Student for Honor Roll & Admin Table
  let peerRow = await db.get(`SELECT id FROM users WHERE phone = ?`, [DEMO_PEER_STUDENT.phone]);
  if (!peerRow) {
    const peerHash = await hashPasswordAsync(DEMO_PEER_STUDENT.password);
    await db.run(
      `${prefix} users (
        full_name, phone, parent_phone, password_hash, role, grade, branch,
        is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
      ) VALUES (?, ?, ?, ?, 'student', ?, ?, 1, ?, 'all', ?)`,
      [
        DEMO_PEER_STUDENT.full_name,
        DEMO_PEER_STUDENT.phone,
        DEMO_PEER_STUDENT.parent_phone,
        peerHash,
        DEMO_PEER_STUDENT.grade,
        DEMO_PEER_STUDENT.branch,
        peerSubIso,
        nowIso
      ]
    );
    peerRow = await db.get(`SELECT id FROM users WHERE phone = ?`, [DEMO_PEER_STUDENT.phone]);
  }

  // 4. Set helpful default exam date & payment settings if blank
  const azharDateRow = await db.get(`SELECT value FROM platform_settings WHERE \`key\` = 'azhar_exam_date'`);
  if (!azharDateRow || !azharDateRow.value) {
    const examTarget = new Date(now.getTime() + 75 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await db.run(
      `UPDATE platform_settings SET value = ? WHERE \`key\` = 'azhar_exam_date'`,
      [examTarget]
    );
  }

  // 5. Seed rich curriculum only when lessons table is empty
  const lessonCountRow = await db.get(`SELECT COUNT(*) AS c FROM lessons`);
  if (Number(lessonCountRow?.c || 0) === 0 && adminRow && studentRow) {
    const demoVideoPath = ensureDemoVideoAsset();

    const demoLessons = [
      {
        title: 'كتاب الطلاق: تعريفه وأركانه وأقسامه',
        description: 'شرح تأصيلي لأحكام الطلاق في الفقه الشافعي: الفرق بين الطلاق الصريح والكناية، والطلاق السني والبدعي، مع تطبيقات امتحانات الأزهر.',
        subject: 'fiqh',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'باب الفُرَق والطلاق',
        order_index: 1,
        video_path: demoVideoPath,
        duration_minutes: 42,
        pdf_title: 'مذكرة الفقه الشافعي — باب الطلاق',
        pdf_pages: [
          {
            heading: 'أولاً: تعريف الطلاق لغةً وشرعاً وحكمه',
            matn: '«الطلاق لغةً: حلّ القيد، وشرعاً: حلّ عقد النكاح بلفظ الطلاق ونحوه»',
            sharh: [
              'أركان الطلاق خمسة: مطلِّق، وصيغة، ومحل (زوجة)، وولاية عليها، وقصد للفظ.',
              'الصريح ثلاثة ألفاظ: الطلاق والفراق والسراح، ولا يفتقر إلى نية لظهور معناه.',
              'الكناية كل لفظ يحتمل الطلاق وغيره مثل: الحقي بأهلك، ويفتقر إلى النية المقارنة للفظ.'
            ]
          },
          {
            heading: 'ثانياً: أقسام الطلاق السني والبدعي',
            matn: '«الطلاق السني: أن يطلق المدخول بها في طهرٍ لم يجامعها فيه»',
            sharh: [
              'الطلاق البدعي: أن يطلقها في حيض أو في طهرٍ جامعها فيه، وهو محرم شرعاً لكنه يقع.',
              'غير المدخول بها والآيسة والصغيرة والحامل لا يوصف طلاقهن بسنة ولا بدعة.'
            ]
          }
        ]
      },
      {
        title: 'أحكام الرَّجعة والعِدة والإحداد',
        description: 'بيان شروط صحة الرجعة في الطلاق الرجعي، وأنواع العدد للمطلقة والمتوفى عنها زوجها وضوابط الإحداد.',
        subject: 'fiqh',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'باب الفُرَق والطلاق',
        order_index: 2,
        video_path: '',
        duration_minutes: 38,
        pdf_title: 'مذكرة الفقه — الرجعة والعدة',
        pdf_pages: [
          {
            heading: 'شروط صحة الرجعة وألفاظها',
            matn: '«إذا طلق امرأته واحدة أو اثنتين بعد الدخول فله مراجعتها ما دامت في العدة»',
            sharh: [
              'لا يشترط في الرجعة رضا الزوجة ولا وليها، ولا يُسن تجديد المهر.',
              'عدة الحامل وضع حملها، وعدة ذوات الأقراء ثلاثة قروء، وعدة المتوفى عنها أربعة أشهر وعشراً.'
            ]
          }
        ]
      },
      {
        title: 'تفسير سورة الذاريات — من الآية ١ إلى ٢٣',
        description: 'دراسة بلاغية وتفسيرية لمطلع سورة الذاريات، ومقاصد القسم الإلهي، والأسرار البلاغية والمفردات القرآنية المقررة.',
        subject: 'tafseer',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'تفسير سورة الذاريات',
        order_index: 1,
        video_path: '',
        duration_minutes: 45,
        pdf_title: 'مذكرة التفسير — سورة الذاريات',
        pdf_pages: [
          {
            heading: 'معاني المفردات وأسرار القسم في مطلع السورة',
            matn: '«وَالذَّارِيَاتِ ذَرْوًا ۝ فَالْحَامِلَاتِ وِقْرًا ۝ فَالْجَارِيَاتِ يُسْرًا ۝ فَالْمُقَسِّمَاتِ أَمْرًا»',
            sharh: [
              'الذاريات: الرياح التي تذرو التراب وغيره، والحاملات وقراً: السحب تحمل المطر الثقيل.',
              'جواب القسم: قوله تعالى «إنما توعدون لصادق وإن الدين لواقع» أي البعث والجزاء حق.'
            ]
          }
        ]
      },
      {
        title: 'الحديث الأول: فضل التيسير والسماحة في المعاملة',
        description: 'التعريف براوي الحديث، وشرح المفردات النبوية، واستنباط الأحكام الفقهية والتربوية وما يرشد إليه الحديث الشريف.',
        subject: 'hadith',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'الأحاديث المقررة — القسم الأول',
        order_index: 1,
        video_path: '',
        duration_minutes: 35,
        pdf_title: 'مذكرة الحديث الشريف — التيسير والسماحة',
        pdf_pages: [
          {
            heading: 'نص الحديث الشريف وشرح المفردات',
            matn: '«رَحِمَ اللَّهُ رَجُلًا سَمْحًا إِذَا بَاعَ، وَإِذَا اشْتَرَى، وَإِذَا اقْتَضَى»',
            sharh: [
              'سمحاً: سهلاً ليناً متجاوزاً في معاملاته التجارية بعيداً عن المشاحة.',
              'اقتضى: طلب قضاء دَينه وحقه من الغريم برفق دون عنف أو إضرار.'
            ]
          }
        ]
      },
      {
        title: 'السمعيات: حقيقة الإيمان بالغيب وسؤال القبر',
        description: 'تأصيل مباحث السمعيات في علم التوحيد، وأدلة سؤال القبر ونعيمه وعذابه، والرد على الشبهات بأسلوب ميسر.',
        subject: 'tawheed',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'مباحث السمعيات',
        order_index: 1,
        video_path: '',
        duration_minutes: 40,
        pdf_title: 'مذكرة التوحيد — السمعيات والبرزخ',
        pdf_pages: [
          {
            heading: 'مدخل إلى السمعيات وحكم الإيمان بها',
            matn: '«السمعيات: هي الأمور التي لا تُدرك بالعقل وحده، وإنما طريق ثبوتها السمع أي الكتاب والسنة»',
            sharh: [
              'يجب الإيمان بالسمعيات تفصيلاً فيما ورد فيه نص قطعي، وإجمالاً فيما أجمل.',
              'سؤال القبر ثابت بالكتاب والسنة وإجماع أهل السنة والجماعة.'
            ]
          }
        ]
      },
      {
        title: 'أصحاب الفروض: فرض النصف والربع والثمن',
        description: 'شرح منهجي لأنصبة أصحاب الفروض المقدرة في كتاب الله، مع مسائل تطبيقية محلولة خطوة بخطوة.',
        subject: 'mawareeth',
        grade: 'grade_3',
        branch: 'both',
        unit_title: 'أصحاب الفروض المقدرة',
        order_index: 1,
        video_path: '',
        duration_minutes: 48,
        pdf_title: 'مذكرة المواريث — أصحاب الفروض',
        pdf_pages: [
          {
            heading: 'المستحقون لفرض النصف وشروط كل وارث',
            matn: '«يستحق النصف خمسة: الزوج، والبنت، وبنت الابن، والأخت الشقيقة، والأخت لأب»',
            sharh: [
              'الزوج يستحق النصف عند عدم وجود الفرع الوارث للزوجة مطلقاً.',
              'البنت تستحق النصف عند الانفراد وعدم المعصّب (الابن).'
            ]
          }
        ]
      }
    ];

    const insertedLessonIds = {};
    for (const l of demoLessons) {
      const res = await db.run(
        `INSERT INTO lessons (
           title, description, subject, grade, branch, unit_title, order_index,
           video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json,
           is_published, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'upload', ?, ?, ?, '', ?, 1, ?)`,
        [
          l.title,
          l.description,
          l.subject,
          l.grade,
          l.branch,
          l.unit_title,
          l.order_index,
          l.video_path,
          l.duration_minutes,
          l.pdf_title,
          JSON.stringify(l.pdf_pages),
          nowIso
        ]
      );
      insertedLessonIds[`${l.subject}_${l.order_index}`] = res.lastInsertRowid;
    }

    const fiqh1Id = insertedLessonIds.fiqh_1;
    const tafseer1Id = insertedLessonIds.tafseer_1;

    // 6. Seed Homework + Exam for Fiqh Lesson 1, and Exam for Tafseer Lesson 1
    const hwIns = await db.run(
      `INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
       VALUES (?, ?, 'homework', 15, 1, ?)`,
      [fiqh1Id, 'واجب الحصة الأولى: أركان وأقسام الطلاق', nowIso]
    );
    const hwId = hwIns.lastInsertRowid;

    const hwQuestions = [
      {
        question_type: 'mcq',
        question_text: 'كم عدد أركان الطلاق عند فقهاء الشافعية؟',
        topic_tag: 'أركان الطلاق',
        options: ['خمسة أركان', 'ثلاثة أركان', 'أربعة أركان', 'ستة أركان'],
        correct_option: 'خمسة أركان',
        explanation: 'أركان الطلاق خمسة: مطلّق، وصيغة، ومحل، وولاية، وقصد.',
        points: 2
      },
      {
        question_type: 'mcq',
        question_text: 'أيّ الألفاظ الآتية يُعدّ من صريح الطلاق الذي لا يفتقر إلى نية؟',
        topic_tag: 'صريح الطلاق وكنايته',
        options: ['لفظ السراح', 'الحقي بأهلك', 'أنتِ خلية', 'اعتدي'],
        correct_option: 'لفظ السراح',
        explanation: 'ألفاظ صريح الطلاق ثلاثة: الطلاق والفراق والسراح.',
        points: 2
      },
      {
        question_type: 'true_false',
        question_text: 'الطلاق في زمن الحيض طلاق بدعي محرم، ولكنه يقع شرعاً عند الجمهور.',
        topic_tag: 'الطلاق السني والبدعي',
        options: ['صح', 'خطأ'],
        correct_option: 'صح',
        explanation: 'يحرم إيقاعه لتطويل العدة على المرأة، ومع ذلك يقع شرعاً.',
        points: 2
      }
    ];

    const hwQIds = [];
    for (const q of hwQuestions) {
      const qIns = await db.run(
        `INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [hwId, q.question_type, q.question_text, q.topic_tag, JSON.stringify(q.options), q.correct_option, q.explanation, q.points]
      );
      hwQIds.push(qIns.lastInsertRowid);
    }

    const examIns = await db.run(
      `INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
       VALUES (?, ?, 'exam', 20, 1, ?)`,
      [fiqh1Id, 'امتحان الحصة الأولى: باب الطلاق', nowIso]
    );
    const examId = examIns.lastInsertRowid;

    const examQuestions = [
      {
        question_type: 'mcq',
        question_text: 'ما حكم طلاق الحامل أو الآيسة من حيث الوصف بالسنة والبدعة؟',
        topic_tag: 'الطلاق السني والبدعي',
        options: ['لا يوصف بسنة ولا بدعة', 'طلاق سني دائماً', 'طلاق بدعي محرم', 'لا يقع أصلاً'],
        correct_option: 'لا يوصف بسنة ولا بدعة',
        explanation: 'أربع نسوة لا يوصف طلاقهن بسنة ولا بدعة: الصغيرة والآيسة والحامل والمختلعة التي لم يدخل بها.',
        points: 5
      },
      {
        question_type: 'true_false',
        question_text: 'كناية الطلاق تفتقر إلى النية المقارنة للفظ ليقع بها الطلاق.',
        topic_tag: 'صريح الطلاق وكنايته',
        options: ['صح', 'خطأ'],
        correct_option: 'صح',
        explanation: 'الكناية تحتمل الطلاق وغيره، فلا ينصرف للطلاق إلا بالنية.',
        points: 5
      }
    ];
    const examQIds = [];
    for (const q of examQuestions) {
      const qIns = await db.run(
        `INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [examId, q.question_type, q.question_text, q.topic_tag, JSON.stringify(q.options), q.correct_option, q.explanation, q.points]
      );
      examQIds.push(qIns.lastInsertRowid);
    }

    const tafseerExamIns = await db.run(
      `INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
       VALUES (?, ?, 'exam', 15, 1, ?)`,
      [tafseer1Id, 'اختبار سورة الذاريات (١ - ٢٣)', nowIso]
    );
    await db.run(
      `INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
       VALUES (?, 'mcq', ?, ?, ?, ?, ?, 5)`,
      [
        tafseerExamIns.lastInsertRowid,
        'ما المراد بقوله تعالى «فَالْحَامِلَاتِ وِقْرًا» في سورة الذاريات؟',
        'معاني المفردات',
        JSON.stringify(['السحب تحمل المطر الثقيل', 'السفن الجارية في البحر', 'الرياح العاصفة', 'الملائكة المقسمات']),
        'السحب تحمل المطر الثقيل',
        'الوقر هو الثقل، والحاملات وقراً هي السحب المثقلة بالماء.',
      ]
    );
    await db.run(
      `INSERT INTO questions (assessment_id, question_type, question_text, topic_tag, options_json, correct_option, explanation, points)
       VALUES (?, 'true_false', ?, ?, ?, ?, ?, 5)`,
      [
        tafseerExamIns.lastInsertRowid,
        'جواب القسم في مطلع سورة الذاريات هو قوله تعالى: «إِنَّمَا تُوعَدُونَ لَصَادِقٌ».',
        'مقاصد السورة',
        JSON.stringify(['صح', 'خطأ']),
        'صح',
        'أقسم الله بالآيات الكونية الأربع على صدق البعث والجزاء.',
      ]
    );

    // 7. Seed Lesson Progress + Study Streak + Sample Submissions (gives live Analytics, Mistake Bank & Certificate!)
    await db.run(
      `${prefix} lesson_progress (user_id, lesson_id, last_position_seconds, duration_seconds, max_watched_percent, updated_at)
       VALUES (?, ?, 180, 220, 86, ?)`,
      [studentRow.id, fiqh1Id, nowIso]
    );

    for (let dayOffset = 0; dayOffset < 4; dayOffset++) {
      const d = new Date(now.getTime() - dayOffset * 86400000).toISOString().slice(0, 10);
      await db.run(
        `${prefix} study_activity (user_id, activity_date, actions_count) VALUES (?, ?, ?)`,
        [studentRow.id, d, 3]
      );
    }

    // Seed Homework submission (4/6 = 67%, 1 intentional wrong answer so Mistake Bank works out-of-the-box)
    const hwAnswersReview = [
      {
        question_id: hwQIds[0],
        question_type: 'mcq',
        question_text: hwQuestions[0].question_text,
        topic_tag: hwQuestions[0].topic_tag,
        selected_option: 'خمسة أركان',
        correct_option: 'خمسة أركان',
        is_correct: true,
        explanation: hwQuestions[0].explanation,
        points_earned: 2,
        points_total: 2
      },
      {
        question_id: hwQIds[1],
        question_type: 'mcq',
        question_text: hwQuestions[1].question_text,
        topic_tag: hwQuestions[1].topic_tag,
        selected_option: 'الحقي بأهلك',
        correct_option: 'لفظ السراح',
        is_correct: false,
        explanation: hwQuestions[1].explanation,
        points_earned: 0,
        points_total: 2
      },
      {
        question_id: hwQIds[2],
        question_type: 'true_false',
        question_text: hwQuestions[2].question_text,
        topic_tag: hwQuestions[2].topic_tag,
        selected_option: 'صح',
        correct_option: 'صح',
        is_correct: true,
        explanation: hwQuestions[2].explanation,
        points_earned: 2,
        points_total: 2
      }
    ];
    await db.run(
      `INSERT INTO submissions (
         user_id, lesson_id, assessment_id, assessment_type, score, total_points,
         percentage, passed, answers_json, weak_topics_json, strong_topics_json,
         time_spent_seconds, submitted_at
       ) VALUES (?, ?, ?, 'homework', 4, 6, 67, 1, ?, ?, ?, 215, ?)`,
      [
        studentRow.id,
        fiqh1Id,
        hwId,
        JSON.stringify(hwAnswersReview),
        JSON.stringify(['صريح الطلاق وكنايته']),
        JSON.stringify(['أركان الطلاق', 'الطلاق السني والبدعي']),
        new Date(now.getTime() - 3600 * 1000).toISOString()
      ]
    );

    // Seed Exam submission for Demo Student (10/10 = 100%, unlocks Lesson 2 & enables Certificate!)
    const examAnswersReview = [
      {
        question_id: examQIds[0],
        question_type: 'mcq',
        question_text: examQuestions[0].question_text,
        topic_tag: examQuestions[0].topic_tag,
        selected_option: examQuestions[0].correct_option,
        correct_option: examQuestions[0].correct_option,
        is_correct: true,
        explanation: examQuestions[0].explanation,
        points_earned: 5,
        points_total: 5
      },
      {
        question_id: examQIds[1],
        question_type: 'true_false',
        question_text: examQuestions[1].question_text,
        topic_tag: examQuestions[1].topic_tag,
        selected_option: examQuestions[1].correct_option,
        correct_option: examQuestions[1].correct_option,
        is_correct: true,
        explanation: examQuestions[1].explanation,
        points_earned: 5,
        points_total: 5
      }
    ];
    await db.run(
      `INSERT INTO submissions (
         user_id, lesson_id, assessment_id, assessment_type, score, total_points,
         percentage, passed, answers_json, weak_topics_json, strong_topics_json,
         time_spent_seconds, submitted_at
       ) VALUES (?, ?, ?, 'exam', 10, 10, 100, 1, ?, '[]', ?, 180, ?)`,
      [
        studentRow.id,
        fiqh1Id,
        examId,
        JSON.stringify(examAnswersReview),
        JSON.stringify(['الطلاق السني والبدعي', 'صريح الطلاق وكنايته']),
        nowIso
      ]
    );

    // Seed Peer Student submission for Honor Roll
    if (peerRow) {
      await db.run(
        `INSERT INTO submissions (
           user_id, lesson_id, assessment_id, assessment_type, score, total_points,
           percentage, passed, answers_json, weak_topics_json, strong_topics_json,
           time_spent_seconds, submitted_at
         ) VALUES (?, ?, ?, 'exam', 9, 10, 90, 1, '[]', '[]', ?, 240, ?)`,
        [peerRow.id, fiqh1Id, examId, JSON.stringify(['الطلاق السني والبدعي']), nowIso]
      );
    }

    // 8. Seed Lesson Note + Lesson Q&A (1 answered, 1 pending for Admin)
    await db.run(
      `INSERT INTO lesson_notes (user_id, lesson_id, timestamp_seconds, note_text, created_at)
       VALUES (?, ?, 45, ?, ?)`,
      [studentRow.id, fiqh1Id, 'التفريق بين صريح الطلاق الثلاثة (الطلاق والفراق والسراح) والكناية التي تحتاج إلى نية.', nowIso]
    );

    await db.run(
      `INSERT INTO lesson_questions (lesson_id, user_id, question_text, admin_answer, answered_by_admin_id, is_published, created_at, answered_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        fiqh1Id,
        studentRow.id,
        'هل يشترط في الطلاق السني الإشهاد عليه عند فقهاء الشافعية؟',
        'لا يُشترط الإشهاد لصحة الطلاق، بل يقع بدونه، وإنما يُستحب الإشهاد حفظاً للحقوق ومنعاً للنزاع.',
        adminRow.id,
        nowIso,
        nowIso
      ]
    );
    await db.run(
      `INSERT INTO lesson_questions (lesson_id, user_id, question_text, is_published, created_at)
       VALUES (?, ?, ?, 0, ?)`,
      [
        tafseer1Id,
        studentRow.id,
        'ما الفرق البلاغي بين القسم بالذاريات والقسم بالسماء ذات الحبك في مطلع السورة؟',
        nowIso
      ]
    );

    // 9. Seed Live Session (currently live so Join works)
    await db.run(
      `INSERT INTO live_sessions (
         title, description, subject, grade, branch, starts_at, duration_minutes,
         join_early_minutes, stream_url, provider, status, created_by_admin_id, created_at
       ) VALUES (?, ?, 'fiqh', 'grade_3', 'both', ?, 60, 15, ?, 'zoom', 'live', ?, ?)`,
      [
        'مراجعة شاملة على باب الطلاق وحل نماذج الأزهر',
        'بث مباشر تفاعلي لمراجعة أهم مسائل الفقه الشافعي والإجابة عن أسئلة الطلاب المباشرة.',
        nowIso,
        'https://zoom.us/j/88442211009',
        adminRow.id,
        nowIso
      ]
    );

    // 10. Seed Notifications
    await db.run(
      `INSERT INTO notifications (title, body, notif_type, target_grade, target_branch, link_lesson_id, created_at)
       VALUES (?, ?, 'announcement', 'grade_3', 'both', ?, ?)`,
      [
        'انطلاق مراجعات الفقه والتفسير للثالث الثانوي الأزهري',
        'تم رفع محاضرات ومذكرات الوحدة الأولى كاملة مع الاختبارات التفاعلية وبنك الأخطاء.',
        fiqh1Id,
        nowIso
      ]
    );
    await db.run(
      `INSERT INTO notifications (title, body, notif_type, target_user_id, target_grade, target_branch, link_lesson_id, created_at)
       VALUES (?, ?, 'qa_answer', ?, 'grade_3', 'scientific', ?, ?)`,
      [
        'تمت الإجابة على سؤالك الشرعي',
        'أجاب فضيلة الأستاذ محمد عبد الله على سؤالك في محاضرة كتاب الطلاق.',
        studentRow.id,
        fiqh1Id,
        nowIso
      ]
    );

    // 11. Seed 3 unused Demo Vouchers + 2 redeemed vouchers (populates Admin Revenue & Monthly Growth chart)
    const demoVouchers = ['MATN-DEMO-30D-001', 'MATN-DEMO-30D-002', 'MATN-DEMO-30D-003'];
    for (const code of demoVouchers) {
      await db.run(
        `${prefix} vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, created_at)
         VALUES (?, 'دفعة التجربة السريعة', 30, 'all', 'all', 150, 0, ?)`,
        [code, nowIso]
      );
    }
    await db.run(
      `${prefix} vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, used_by_user_id, used_at, created_at)
       VALUES (?, 'دفعة الاشتراك الفعّال', 30, 'all', 'grade_3', 150, 1, ?, ?, ?)`,
      ['MATN-DEMO-PAID-001', studentRow.id, nowIso, nowIso]
    );
    if (peerRow) {
      await db.run(
        `${prefix} vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, used_by_user_id, used_at, created_at)
         VALUES (?, 'دفعة الاشتراك الفعّال', 30, 'all', 'grade_3', 150, 1, ?, ?, ?)`,
        ['MATN-DEMO-PAID-002', peerRow.id, nowIso, nowIso]
      );
    }
  }

  return { seeded: true, adminPhone: DEMO_ADMIN.phone, studentPhone: DEMO_STUDENT.phone };
}

module.exports = {
  DEMO_ADMIN,
  DEMO_STUDENT,
  shouldSeedDemoAccounts,
  getPublicDemoAccountsPayload,
  seedDemoData
};
