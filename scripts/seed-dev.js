/**
 * Development Curriculum Seeder (Development Only)
 * Seeds Sharia curriculum lessons and MCQ questions for local development testing.
 * Never seeds real student data or hardcoded credentials.
 */
const { loadEnvFile } = require('../lib/env');
loadEnvFile();

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to run development seed in production environment.');
  process.exit(1);
}

const { db, initDatabase } = require('../database');

async function main() {
  await initDatabase();

  const now = new Date().toISOString();
  const countRow = await db.get(`SELECT COUNT(*) AS c FROM lessons`);
  const existingLessons = countRow?.c || 0;

  if (existingLessons > 0) {
    console.log(`Curriculum already contains ${existingLessons} lesson(s). Skipping seed.`);
    return;
  }

  const insertLessonSql = `
    INSERT INTO lessons (
      title, description, subject, grade, branch, unit_title, order_index,
      video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `;

  const insertAssessmentSql = `
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `;

  const insertQuestionSql = `
    INSERT INTO questions (assessment_id, question_text, topic_tag, options_json, correct_option, explanation, points)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const fiqh1Pdf = JSON.stringify([
    {
      heading: 'متن الإقناع في الفقه الشافعي - كتاب الطلاق',
      matn: '«وَأَرْكَانُ الطَّلَاقِ خَمْسَةٌ: مُطَلِّقٌ، وَصِيغَةٌ، وَمَحَلٌّ، وَوِلَايَةٌ، وَقَصْدٌ»',
      sharh: [
        '١- تعريف الطلاق لغةً: حل القيد، وشرعاً: حل قيد النكاح بلفظ الطلاق ونحوه.',
        '٢- ينقسم الطلاق إلى صريح (لا يحتاج إلى نية) وكناية (تفتقر إلى النية).'
      ],
      notes: 'موضع سؤال امتحاني متكرر لطلاب الشهادة الثانوية الأزهرية.'
    }
  ]);

  const l1Res = await db.run(insertLessonSql, [
    'الحصة الأولى: أحكام الطلاق وأركانه وصيغه في الفقه الشافعي',
    'شرح تفصيلي لكتاب الطلاق من مقرر الفقه الشافعي للصف الثالث الثانوي الأزهري.',
    'fiqh',
    'grade_3',
    'both',
    'الباب الأول: أحكام الفرقة بين الزوجين',
    1,
    'upload',
    'uploads/videos/matn_video_1794961663644.mp4',
    45,
    'مذكرة مَتْن في الفقه الشافعي - أحكام الطلاق',
    'uploads/pdfs/matn_pdf_1794961401820.pdf',
    fiqh1Pdf,
    now
  ]);
  const l1 = l1Res.lastInsertRowid;

  const hw1Res = await db.run(insertAssessmentSql, [l1, 'واجب الحصة الأولى: أركان الطلاق', 'homework', 10, now]);
  const hw1 = hw1Res.lastInsertRowid;
  await db.run(insertQuestionSql, [hw1, 'كم عدد أركان الطلاق إجمالاً في المذهب الشافعي؟', 'أركان الطلاق', JSON.stringify(['ثلاثة أركان', 'أربعة أركان', 'خمسة أركان', 'ستة أركان']), 'خمسة أركان', 'أركان الطلاق خمسة: مطلق، وصيغة، ومحل، وولاية، وقصد.', 2]);
  await db.run(insertQuestionSql, [hw1, 'أي الألفاظ الآتية يُعد من صريح الطلاق عند الشافعية؟', 'صريح الطلاق وكنايته', JSON.stringify(['الحقي بأهلك', 'أنتِ خلية', 'أنتِ طالق أو مفارقة أو مسرحة', 'اعتدي']), 'أنتِ طالق أو مفارقة أو مسرحة', 'ألفاظ الصريح ثلاثة: الطلاق والفراق والسراح.', 2]);

  const ex1Res = await db.run(insertAssessmentSql, [l1, 'امتحان الحصة الأولى (شرط فتح الحصة الثانية - النجاح فوق 50%)', 'exam', 15, now]);
  const ex1 = ex1Res.lastInsertRowid;
  await db.run(insertQuestionSql, [ex1, 'ما الحكم إذا قال الزوج لزوجته لفظ كناية في الطلاق ونوى به الطلاق؟', 'اقتران النية بالكناية', JSON.stringify(['يقع الطلاق في الأصح لاقتران النية', 'لا يقع الطلاق مطلقاً', 'يقع رجعياً بلا نية', 'ينقلب إلى ظهار']), 'يقع الطلاق في الأصح لاقتران النية', 'يكفي اقتران النية بجزء من لفظ الكناية عند الشافعية.', 2]);
  await db.run(insertQuestionSql, [ex1, 'طلق رجل زوجته المدخول بها في حيض، فما حكم هذا الطلاق؟', 'الطلاق السني والبدعي', JSON.stringify(['حرام بدعي مع وقوعه شرعاً', 'سني مباح لا إثم فيه', 'باطل لا يقع أصلاً', 'مندوب إليه شرعاً']), 'حرام بدعي مع وقوعه شرعاً', 'الطلاق في الحيض طلاق بدعي محرم لتطويل العدة، لكنه يقع شرعاً.', 2]);

  const l2Res = await db.run(insertLessonSql, [
    'الحصة الثانية: أحكام الخلع والرجعة وشروط صحتهما (تُفتح بعد اجتياز الحصة الأولى)',
    'دراسة أحكام الخلع وأركانه الخمسة وأحكام الرجعة في المذهب الشافعي.',
    'fiqh',
    'grade_3',
    'both',
    'الباب الأول: أحكام الفرقة بين الزوجين',
    2,
    'upload',
    'uploads/videos/matn_video_1794961663644.mp4',
    45,
    'مذكرة مَتْن في الفقه الشافعي - الخلع والرجعة',
    'uploads/pdfs/matn_pdf_1794961401820.pdf',
    fiqh1Pdf,
    now
  ]);

  console.log('Development curriculum seeded successfully (lessons:', l1, l2Res.lastInsertRowid, ').');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.close().catch(() => {}));
