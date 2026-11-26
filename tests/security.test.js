const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Configure isolated in-memory test database & temp uploads dir before loading server/database
const tempUploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'matn-test-uploads-'));
process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_DB_PATH = ':memory:';
process.env.UPLOADS_DIR = tempUploadsRoot;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.WHATSAPP_API_URL = '';
process.env.WHATSAPP_API_TOKEN = '';
process.env.BOT_PULL_TOKEN = '';

const { db, initDatabase, hashPassword, hashOtp } = require('../database');
const { server, createToken } = require('../server');

let baseUrl = '';
let adminToken = '';
let adminUser = null;

test.before(async () => {
  await initDatabase();
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });

  // Create a test admin via random test credentials (never default password)
  const now = new Date().toISOString();
  const randomAdminPass = crypto.randomBytes(16).toString('hex');
  const res = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES (?, ?, ?, ?, 'admin', 'grade_3', 'scientific', 1, '2099-12-31T23:59:59.000Z', 'all', ?)
  `, ['مدير الاختبار الآمن', '01099990000', '01099990000', hashPassword(randomAdminPass), now]));

  adminUser = (await db.get(`SELECT * FROM users WHERE id = ?`, [res.lastInsertRowid]));
  adminToken = createToken(adminUser);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close().catch(() => {});
  try {
    fs.rmSync(tempUploadsRoot, { recursive: true, force: true });
  } catch {}
});

test('1. Default legacy admin credentials do NOT exist and cannot log in', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '01026379242', password: 'Matn@2026' })
  });
  assert.equal(res.status, 401);
});

test('2. Forged JWTs and query-string tokens (?token=...) are strictly rejected', async () => {
  const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const fakeBody = Buffer.from(JSON.stringify({
    iss: 'matn-platform',
    aud: 'matn-users',
    sub: '1',
    id: 1,
    role: 'admin',
    ver: 1,
    exp: Math.floor(Date.now() / 1000) + 3600
  })).toString('base64url');
  const forgedSig = crypto.createHmac('sha256', 'wrong_secret').update(`${fakeHeader}.${fakeBody}`).digest('base64url');
  const forgedToken = `${fakeHeader}.${fakeBody}.${forgedSig}`;

  const resForged = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${forgedToken}` }
  });
  assert.equal(resForged.status, 401);

  // Valid token passed in query string must be rejected
  const resQueryToken = await fetch(`${baseUrl}/api/auth/me?token=${encodeURIComponent(adminToken)}`);
  assert.equal(resQueryToken.status, 400);
});

test('3. OTP hashing, expiration, and max 5 attempts enforcement', async () => {
  const now = new Date().toISOString();
  const phone = '01012345001';
  const expiredIso = new Date(Date.now() - 60 * 1000).toISOString();

  (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_attempts,
      device_id, device_name, created_at
    ) VALUES (?, ?, ?, ?, 'student', 'grade_3', 'scientific', 0, ?, ?, 0, 'DEV-TEST-01', 'TestDevice', ?)
  `, ['طالب اختبار التحقق الأول', phone, '01012345999', hashPassword('Pass123456'), hashOtp('123456'), expiredIso, now]));

  // Expired OTP must fail
  const resExp = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-TEST-01' },
    body: JSON.stringify({ phone, otp_code: '123456' })
  });
  assert.equal(resExp.status, 400);

  // Set valid future expiration, then fail 5 times with wrong OTP
  const futureIso = new Date(Date.now() + 600 * 1000).toISOString();
  (await db.run(`UPDATE users SET whatsapp_otp_expires = ?, otp_attempts = 0 WHERE phone = ?`, [futureIso, phone]));

  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${baseUrl}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-TEST-01' },
      body: JSON.stringify({ phone, otp_code: '000000' })
    });
    assert.equal(r.status, 400);
  }

  // 6th attempt even with correct OTP must be rejected with 429
  const resLocked = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-TEST-01' },
    body: JSON.stringify({ phone, otp_code: '123456' })
  });
  assert.equal(resLocked.status, 429);
});

test('4. Device binding cannot be bypassed by omitting X-Device-Id header', async () => {
  const now = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();
  const ins = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, device_name, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES (?, '01012345002', '01012345998', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-BOUND-100', 'Phone1', ?, 'all', ?)
  `, ['طالب اختبار ربط الجهاز', hashPassword('Pass123456'), futureSub, now]));

  const student = (await db.get(`SELECT * FROM users WHERE id = ?`, [ins.lastInsertRowid]));
  const studentToken = createToken(student);

  // Request WITHOUT X-Device-Id must be blocked with 403 DEVICE_LOCKED
  const resNoHeader = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  assert.equal(resNoHeader.status, 403);

  // Request with WRONG X-Device-Id must be blocked with 403 DEVICE_LOCKED
  const resWrongHeader = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${studentToken}`, 'X-Device-Id': 'DEV-WRONG-999' }
  });
  assert.equal(resWrongHeader.status, 403);

  // Request with matching X-Device-Id succeeds
  const resOk = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${studentToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resOk.status, 200);
});

test('5. Unsubscribed students and cross-grade/branch students cannot access videos, PDFs, or exams', async () => {
  const now = new Date().toISOString();
  // Create a Grade 3 Scientific lesson + exam
  const lessonId = (await db.run(`
    INSERT INTO lessons (
      title, description, subject, grade, branch, unit_title, order_index,
      video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
    ) VALUES ('درس الفقه ١', 'وصف', 'fiqh', 'grade_3', 'scientific', 'الباب الأول', 1, 'upload', '', 45, 'مذكرة', '', '[]', 1, ?)
  `, [now])).lastInsertRowid;

  const examId = (await db.run(`
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
    VALUES (?, 'امتحان الفقه ١', 'exam', 15, 1, ?)
  `, [lessonId, now])).lastInsertRowid;

  (await db.run(`
    INSERT INTO questions (assessment_id, question_text, topic_tag, options_json, correct_option, explanation, points)
    VALUES (?, 'سؤال ١؟', 'الطلاق', '["أ","ب"]', 'أ', 'شرح', 2)
  `, [examId]));

  // Create unsubscribed student
  const unsubId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب غير مشترك للتجربة', '01012345003', '01012345997', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-UNSUB-1', NULL, 'all', ?)
  `, [hashPassword('Pass123456'), now])).lastInsertRowid;
  const unsubToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [unsubId])));

  const resVideoUnsub = await fetch(`${baseUrl}/api/stream/video/${lessonId}`, {
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-UNSUB-1' }
  });
  assert.equal(resVideoUnsub.status, 403);

  const resPdfUnsub = await fetch(`${baseUrl}/api/stream/pdf/${lessonId}`, {
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-UNSUB-1' }
  });
  assert.equal(resPdfUnsub.status, 403);

  // Create subscribed student but in Literary branch (branch mismatch!)
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();
  const litId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب أدبي مشترك للتجربة', '01012345004', '01012345996', ?, 'student', 'grade_3', 'literary', 1, 'DEV-LIT-1', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, now])).lastInsertRowid;
  const litToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [litId])));

  const resExamWrongBranch = await fetch(`${baseUrl}/api/assessments/${examId}/start`, {
    headers: { 'Authorization': `Bearer ${litToken}`, 'X-Device-Id': 'DEV-LIT-1' }
  });
  assert.equal(resExamWrongBranch.status, 403);
});

test('6. Retake exam only allows targeted failed students and within scheduled window', async () => {
  const now = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();

  const lessonId = (await db.run(`
    INSERT INTO lessons (
      title, description, subject, grade, branch, unit_title, order_index,
      video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
    ) VALUES ('درس الحديث ١', 'وصف', 'hadith', 'grade_3', 'both', 'الباب الأول', 1, 'upload', '', 45, 'مذكرة', '', '[]', 1, ?)
  `, [now])).lastInsertRowid;

  const mainExamId = (await db.run(`
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
    VALUES (?, 'امتحان الحديث الأساسي', 'exam', 15, 1, ?)
  `, [lessonId, now])).lastInsertRowid;

  // Create Student A (failed main exam) and Student B (never failed main exam)
  const stFailId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب راسب مستهدف للملحق', '01012345005', '01012345995', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-FAIL-1', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, now])).lastInsertRowid;

  const stOtherId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب آخر غير مستهدف', '01012345006', '01012345994', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-OTHER-1', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, now])).lastInsertRowid;

  // Record failed submission for Student A
  (await db.run(`
    INSERT INTO submissions (user_id, lesson_id, assessment_id, assessment_type, score, total_points, percentage, passed, submitted_at)
    VALUES (?, ?, ?, 'exam', 0, 4, 0, 0, ?)
  `, [stFailId, lessonId, mainExamId, now]));

  // Create Retake Exam scheduled in the FUTURE first
  const futureStart = new Date(Date.now() + 3600 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 7200 * 1000).toISOString();
  const retakeId = (await db.run(`
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, scheduled_start, scheduled_end, target_student_ids_json, is_active, created_at)
    VALUES (?, 'امتحان الملحق', 'retake_exam', 15, ?, ?, ?, 1, ?)
  `, [lessonId, futureStart, futureEnd, JSON.stringify([stFailId]), now])).lastInsertRowid;

  (await db.run(`
    INSERT INTO questions (assessment_id, question_text, topic_tag, options_json, correct_option, explanation, points)
    VALUES (?, 'سؤال الملحق؟', 'الحديث', '["صح","خطأ"]', 'صح', '', 2)
  `, [retakeId]));

  const failToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [stFailId])));
  const otherToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [stOtherId])));

  // Before scheduled_start -> rejected (403)
  const resBeforeStart = await fetch(`${baseUrl}/api/assessments/${retakeId}/start`, {
    headers: { 'Authorization': `Bearer ${failToken}`, 'X-Device-Id': 'DEV-FAIL-1' }
  });
  assert.equal(resBeforeStart.status, 403);

  // Update schedule to be active right now
  const activeStart = new Date(Date.now() - 60 * 1000).toISOString();
  (await db.run(`UPDATE assessments SET scheduled_start = ? WHERE id = ?`, [activeStart, retakeId]));

  // Non-targeted student B -> rejected (403)
  const resNonTargeted = await fetch(`${baseUrl}/api/assessments/${retakeId}/start`, {
    headers: { 'Authorization': `Bearer ${otherToken}`, 'X-Device-Id': 'DEV-OTHER-1' }
  });
  assert.equal(resNonTargeted.status, 403);

  // Targeted failed student A during active window -> allowed (200)
  const resTargetedAllowed = await fetch(`${baseUrl}/api/assessments/${retakeId}/start`, {
    headers: { 'Authorization': `Bearer ${failToken}`, 'X-Device-Id': 'DEV-FAIL-1' }
  });
  assert.equal(resTargetedAllowed.status, 200);
});

test('7. Public endpoint never exposes secrets and PDF endpoint never returns pdf_base64', async () => {
  (await db.run(`INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('whatsapp_api_token', 'SUPER_SECRET_TOKEN')`));
  (await db.run(`INSERT OR REPLACE INTO platform_settings (key, value) VALUES ('bunny_api_key', 'SUPER_SECRET_BUNNY')`));

  const resPub = await fetch(`${baseUrl}/api/public/info`);
  assert.equal(resPub.status, 200);
  const pubData = await resPub.json();
  assert.equal(pubData.settings.whatsapp_api_token, undefined);
  assert.equal(pubData.settings.bunny_api_key, undefined);

  // Check Admin PDF metadata response does NOT contain pdf_base64
  const lesson = (await db.get(`SELECT id FROM lessons LIMIT 1`));
  const resPdf = await fetch(`${baseUrl}/api/stream/pdf/${lesson.id}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(resPdf.status, 200);
  const pdfMeta = await resPdf.json();
  assert.equal(pdfMeta.pdf_base64, undefined);
});

test('8. Upload endpoint rejects invalid extensions and spoofed file magic bytes', async () => {
  // 1. Disallowed extension (.exe)
  const resBadExt = await fetch(`${baseUrl}/api/admin/upload-chunk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'X-Upload-Type': 'pdf',
      'X-File-Name': 'malware.exe',
      'X-Chunk-Index': '0',
      'X-Total-Chunks': '1'
    },
    body: Buffer.from('MZfake_executable_content')
  });
  assert.equal(resBadExt.status, 400);

  // 2. Spoofed .pdf extension with non-PDF magic bytes
  const resSpoofedPdf = await fetch(`${baseUrl}/api/admin/upload-chunk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'X-Upload-Type': 'pdf',
      'X-File-Name': 'spoofed.pdf',
      'X-Chunk-Index': '0',
      'X-Total-Chunks': '1'
    },
    body: Buffer.from('<html><script>alert(1)</script></html>')
  });
  assert.equal(resSpoofedPdf.status, 400);

  // 3. Valid PDF magic bytes (%PDF-1.4...) succeeds
  const resValidPdf = await fetch(`${baseUrl}/api/admin/upload-chunk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'X-Upload-Type': 'pdf',
      'X-File-Name': 'valid_notes.pdf',
      'X-Chunk-Index': '0',
      'X-Total-Chunks': '1'
    },
    body: Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF')
  });
  assert.equal(resValidPdf.status, 200);
});

test('9. Strict CSRF enforcement on Cookie-based state-mutating requests', async () => {
  // Cookie-authenticated POST without X-CSRF-Token must be rejected with 403
  const resMissingCsrf = await fetch(`${baseUrl}/api/admin/vouchers/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `matn_access_token=${encodeURIComponent(adminToken)}; matn_csrf_token=csrf_secret_123`
    },
    body: JSON.stringify({ batch_name: 'Test', count: 1 })
  });
  assert.equal(resMissingCsrf.status, 403);

  // Cookie-authenticated POST WITH matching X-CSRF-Token succeeds (201)
  const resValidCsrf = await fetch(`${baseUrl}/api/admin/vouchers/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `matn_access_token=${encodeURIComponent(adminToken)}; matn_csrf_token=csrf_secret_123`,
      'X-CSRF-Token': 'csrf_secret_123'
    },
    body: JSON.stringify({ batch_name: 'Test', count: 1 })
  });
  assert.equal(resValidCsrf.status, 201);
});

test('10. High-concurrency burst simulation (100 simultaneous student requests)', async () => {
  const st = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const stToken = createToken(st);

  const requests = Array.from({ length: 100 }, () =>
    fetch(`${baseUrl}/api/student/dashboard`, {
      headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
    })
  );

  const responses = await Promise.all(requests);
  const allOk = responses.every((r) => r.status === 200);
  assert.equal(allOk, true);
});

test('11. Preparatory grades (prep_1..prep_3) & 6 subjects (incl. seerah & tajweed) + cross-grade isolation', async () => {
  // 1. Register prep_1 student; server must accept prep_1 and normalize branch to 'general'
  const resRegPrep = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-PREP-01' },
    body: JSON.stringify({
      full_name: 'طالب إعدادي أزهري للتجربة',
      phone: '01012345007',
      parent_phone: '01012345993',
      grade: 'prep_1',
      branch: 'general',
      password: 'PrepPassword123!'
    })
  });
  assert.equal(resRegPrep.status, 201);

  const prepUser = (await db.get(`SELECT * FROM users WHERE phone = '01012345007'`));
  assert.equal(prepUser.grade, 'prep_1');
  assert.equal(prepUser.branch, 'general');

  // Activate & subscribe prep_1 student
  (await db.run(`
    UPDATE users SET is_whatsapp_verified = 1, subscription_expires_at = '2099-12-31T23:59:59.000Z', subscribed_subjects = 'all'
    WHERE id = ?
  `, [prepUser.id]));
  const prepToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [prepUser.id])));

  // 2. Admin creates prep_1 Seerah & Tajweed lessons and prep_2 Fiqh lesson via API
  const resSeerah = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'غزوة بدر الكبرى',
      subject: 'seerah',
      grade: 'prep_1',
      branch: 'general',
      order_index: 1
    })
  });
  assert.equal(resSeerah.status, 201);
  const seerahLessonId = (await resSeerah.json()).lesson_id;

  const resTajweed = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'أحكام النون الساكنة والتنوين',
      subject: 'tajweed',
      grade: 'prep_1',
      branch: 'general',
      order_index: 1
    })
  });
  assert.equal(resTajweed.status, 201);
  const tajweedLessonId = (await resTajweed.json()).lesson_id;

  const resPrep2 = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'فقه الثاني الإعدادي',
      subject: 'fiqh',
      grade: 'prep_2',
      branch: 'general',
      order_index: 1
    })
  });
  assert.equal(resPrep2.status, 201);
  const prep2LessonId = (await resPrep2.json()).lesson_id;

  // Reject scientific/literary branch for prep grades
  const resBadPrepBranch = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'درس خاطئ الشعبة',
      subject: 'fiqh',
      grade: 'prep_3',
      branch: 'scientific',
      order_index: 1
    })
  });
  assert.equal(resBadPrepBranch.status, 400);

  // 3. Prep_1 student CAN get media tickets for prep_1 Seerah & Tajweed, CANNOT access prep_2
  const tSeerah = await fetch(`${baseUrl}/api/media/ticket/${seerahLessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${prepToken}`, 'X-Device-Id': 'DEV-PREP-01' }
  });
  assert.equal(tSeerah.status, 200);

  const tTajweed = await fetch(`${baseUrl}/api/media/ticket/${tajweedLessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${prepToken}`, 'X-Device-Id': 'DEV-PREP-01' }
  });
  assert.equal(tTajweed.status, 200);

  const tPrep2 = await fetch(`${baseUrl}/api/media/ticket/${prep2LessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${prepToken}`, 'X-Device-Id': 'DEV-PREP-01' }
  });
  assert.equal(tPrep2.status, 403);

  // 4. Secondary student (grade_3) CANNOT access prep_1 Seerah lesson
  const secUser = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const secToken = createToken(secUser);
  const tSecCross = await fetch(`${baseUrl}/api/media/ticket/${seerahLessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(tSecCross.status, 403);

  // 5. Secondary subject 'mawareeth' works for grade_3 student and is blocked for prep_1 student
  const resMawareeth = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'مقدمة علم المواريث وأصحاب الفروض',
      subject: 'mawareeth',
      grade: 'grade_3',
      branch: 'both',
      order_index: 1
    })
  });
  assert.equal(resMawareeth.status, 201);
  const mawareethLessonId = (await resMawareeth.json()).lesson_id;

  const tSecMawareeth = await fetch(`${baseUrl}/api/media/ticket/${mawareethLessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(tSecMawareeth.status, 200);

  const tPrepMawareeth = await fetch(`${baseUrl}/api/media/ticket/${mawareethLessonId}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${prepToken}`, 'X-Device-Id': 'DEV-PREP-01' }
  });
  assert.equal(tPrepMawareeth.status, 403);

  // 6. Mawareeth is strictly grade_3 only: grade_1, grade_2, and prep lessons cannot use 'mawareeth'
  for (const invalidGrade of ['grade_1', 'grade_2', 'prep_1']) {
    const resBadMawareeth = await fetch(`${baseUrl}/api/admin/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({
        title: `درس مواريث غير مسموح (${invalidGrade})`,
        subject: 'mawareeth',
        grade: invalidGrade,
        branch: invalidGrade.startsWith('prep_') ? 'general' : 'both',
        order_index: 1
      })
    });
    assert.equal(resBadMawareeth.status, 400);
  }
});

test('12. [Fix 1] Exam invalid JSON keeps session open, late submit records zero-score, and /start blocks retake', async () => {
  const now = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();

  const stId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب اختبار انتهاء الوقت', '01012345008', '01012345992', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-LATE-01', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, now])).lastInsertRowid;
  const stToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [stId])));

  const lessonId = (await db.run(`
    INSERT INTO lessons (
      title, description, subject, grade, branch, unit_title, order_index,
      video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
    ) VALUES ('درس التوحيد ١', 'وصف', 'tawheed', 'grade_3', 'both', 'الباب الأول', 1, 'upload', '', 45, 'مذكرة', '', '[]', 1, ?)
  `, [now])).lastInsertRowid;

  const examId = (await db.run(`
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
    VALUES (?, 'امتحان التوحيد ١', 'exam', 15, 1, ?)
  `, [lessonId, now])).lastInsertRowid;

  (await db.run(`
    INSERT INTO questions (assessment_id, question_text, topic_tag, options_json, correct_option, explanation, points)
    VALUES (?, 'سؤال التوحيد؟', 'الإلهيات', '["نعم","لا"]', 'نعم', 'شرح', 2)
  `, [examId]));

  // 1. Start exam
  const resStart1 = await fetch(`${baseUrl}/api/assessments/${examId}/start`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-LATE-01' }
  });
  assert.equal(resStart1.status, 200);

  // 2. Submit corrupted JSON -> must return 400 and NOT close the active session
  const resBadJson = await fetch(`${baseUrl}/api/assessments/${examId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-LATE-01' },
    body: '{invalid_json'
  });
  assert.equal(resBadJson.status, 400);
  const stillOpen = (await db.get(`SELECT id FROM assessment_sessions WHERE user_id = ? AND assessment_id = ? AND submitted_at IS NULL`, [stId, examId]));
  assert.ok(stillOpen);

  // 3. Expire session beyond 30s grace and submit -> records 0-score submission instead of leaving exam retakable
  const pastExpiry = Date.now() - 120 * 1000;
  (await db.run(`UPDATE assessment_sessions SET expires_at = ? WHERE id = ?`, [pastExpiry, stillOpen.id]));

  const resLateSubmit = await fetch(`${baseUrl}/api/assessments/${examId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-LATE-01' },
    body: JSON.stringify({ answers: {} })
  });
  assert.equal(resLateSubmit.status, 200);
  const lateData = await resLateSubmit.json();
  assert.equal(lateData.timed_out, true);
  assert.equal(lateData.score, 0);
  assert.equal(lateData.passed, false);

  // 4. Subsequent /start MUST return 403 EXAM_ALREADY_TAKEN
  const resRetryStart = await fetch(`${baseUrl}/api/assessments/${examId}/start`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-LATE-01' }
  });
  assert.equal(resRetryStart.status, 403);
  const retryData = await resRetryStart.json();
  assert.equal(retryData.error_code, 'EXAM_ALREADY_TAKEN');
});

test('13. [Fix 2] Single-subject voucher only unlocks that subject & new users default to empty subjects', async () => {
  const resReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VOUCH-01' },
    body: JSON.stringify({
      full_name: 'طالب كود مادة واحدة للتجربة',
      phone: '01012345010',
      parent_phone: '01012345991',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'PassVoucher123!'
    })
  });
  assert.equal(resReg.status, 201);

  const newUser = (await db.get(`SELECT * FROM users WHERE phone = '01012345010'`));
  assert.equal(newUser.subscribed_subjects, '');

  (await db.run(`UPDATE users SET is_whatsapp_verified = 1 WHERE id = ?`, [newUser.id]));
  const stToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [newUser.id])));

  // Admin generates a 12-hex single-subject voucher for 'fiqh'
  const resGen = await fetch(`${baseUrl}/api/admin/vouchers/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ batch_name: 'كود فقه فقط', count: 1, duration_days: 30, subject_scope: 'fiqh', grade_scope: 'grade_3' })
  });
  assert.equal(resGen.status, 201);
  const genData = await resGen.json();
  const code = genData.codes[0];
  assert.match(code, /^MATN-30D-[A-F0-9]{12}$/);

  // Redeem code
  const resRedeem = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-VOUCH-01' },
    body: JSON.stringify({ code })
  });
  assert.equal(resRedeem.status, 200);
  const redeemData = await resRedeem.json();
  assert.equal(redeemData.user.subscribed_subjects, 'fiqh');

  // Allowed on fiqh lesson, blocked (403) on hadith lesson
  const fiqhLesson = (await db.get(`SELECT id FROM lessons WHERE subject = 'fiqh' AND grade = 'grade_3' LIMIT 1`));
  const hadithLesson = (await db.get(`SELECT id FROM lessons WHERE subject = 'hadith' AND grade = 'grade_3' LIMIT 1`));

  const resFiqh = await fetch(`${baseUrl}/api/media/ticket/${fiqhLesson.id}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-VOUCH-01' }
  });
  assert.equal(resFiqh.status, 200);

  const resHadith = await fetch(`${baseUrl}/api/media/ticket/${hadithLesson.id}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-VOUCH-01' }
  });
  assert.equal(resHadith.status, 403);
});

test('14. [Fix 3, 7, 10] Arabic numerals normalization, malformed URI safety, device_id regex, and per-phone rate limit', async () => {
  // Register using Arabic-Indic numerals in phone & parent_phone
  const resRegArabic = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Device-Id': 'DEV_ARABIC_01',
      'X-Device-Name': '%E0%A4%A' // malformed URI sequence must NOT throw 500
    },
    body: JSON.stringify({
      full_name: 'طالب أرقام عربية للتجربة الكاملة',
      phone: '٠١٠١٢٣٤٥٠١١',
      parent_phone: '٠١٠١٢٣٤٥٩٩٠',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'ArabicDigits123!'
    })
  });
  assert.equal(resRegArabic.status, 201);
  const created = (await db.get(`SELECT * FROM users WHERE phone = '01012345011'`));
  assert.ok(created);

  // Invalid device_id containing ':' must be rejected (400)
  const resBadDevice = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV:INJECT:123' },
    body: JSON.stringify({
      full_name: 'طالب جهاز غير صالح للتجربة',
      phone: '01012345012',
      parent_phone: '01012345989',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'DeviceCheck123!'
    })
  });
  assert.equal(resBadDevice.status, 400);

  // Per-phone rate limit: exceed 5 attempts for same phone -> 429
  for (let i = 0; i < 4; i++) {
    await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV_ARABIC_01' },
      body: JSON.stringify({
        full_name: 'طالب أرقام عربية للتجربة الكاملة',
        phone: '01012345011',
        parent_phone: '01012345990',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ArabicDigits123!'
      })
    });
  }
  const resPhoneRateLimited = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV_ARABIC_01' },
    body: JSON.stringify({
      full_name: 'طالب أرقام عربية للتجربة الكاملة',
      phone: '01012345011',
      parent_phone: '01012345990',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'ArabicDigits123!'
    })
  });
  assert.equal(resPhoneRateLimited.status, 429);
});

test('15. [Fix 4 & Task 2] Public info hides admin_whatsapp and IP+phone lockout isolates attacker IP', async () => {
  const resPub = await fetch(`${baseUrl}/api/public/info`);
  assert.equal(resPub.status, 200);
  const pubData = await resPub.json();
  assert.equal(pubData.settings.admin_whatsapp, undefined);
  assert.ok(pubData.settings.support_whatsapp);

  // Create isolated account and fail login 10 times from 127.0.0.1
  const now = new Date().toISOString();
  (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, created_at
    ) VALUES ('حساب اختبار القفل الكامل', '01012345015', '01012345988', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-LOCK-15', ?)
  `, [hashPassword('CorrectPass123!'), now]));

  (await db.run(`
    INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
    VALUES ('::ffff:127.0.0.1', '01012345015', 9, ?, NULL),
           ('127.0.0.1', '01012345015', 9, ?, NULL)
  `, [now, now]));

  const res10thFail = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-LOCK-15' },
    body: JSON.stringify({ phone: '01012345015', password: 'WrongPassword!' })
  });
  assert.equal(res10thFail.status, 429);

  // Same attacker IP is blocked even with correct password during 30m IP+phone lockout
  const resLockedCorrect = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-LOCK-15' },
    body: JSON.stringify({ phone: '01012345015', password: 'CorrectPass123!' })
  });
  assert.equal(resLockedCorrect.status, 429);

  const auditRow = (await db.get(`SELECT * FROM audit_logs WHERE action = 'ACCOUNT_LOGIN_LOCKED' ORDER BY id DESC LIMIT 1`));
  assert.ok(auditRow);

  // Verify admin account is NEVER locked globally after 10 wrong attempts; logs ADMIN_LOGIN_BRUTE_FORCE
  (await db.run(`
    INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
    VALUES ('::ffff:127.0.0.1', ?, 9, ?, NULL),
           ('127.0.0.1', ?, 9, ?, NULL)
    ON CONFLICT(ip_address, phone) DO UPDATE SET failed_attempts = 9, last_failed_at = excluded.last_failed_at
  `, [adminUser.phone, now, adminUser.phone, now]));

  const resAdminFail = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: adminUser.phone, password: 'WrongAdminPass!' })
  });
  assert.equal(resAdminFail.status, 401);
  const adminSecEv = (await db.get(`SELECT * FROM security_events WHERE event_type = 'ADMIN_LOGIN_BRUTE_FORCE' ORDER BY id DESC LIMIT 1`));
  assert.ok(adminSecEv);
});

test('16. [Fix 5, 6, Phase 4] Scheduled review hiding, exam validation, admin edit/lock, password reset, and API 404', async () => {
  // Unknown /api/ endpoint must return JSON 404
  const res404 = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(res404.status, 404);
  assert.ok((res404.headers.get('content-type') || '').includes('application/json'));

  const lesson = (await db.get(`SELECT id FROM lessons WHERE subject = 'fiqh' AND grade = 'grade_3' LIMIT 1`));

  // Assessment creation must reject correct_option not in options
  const resBadExam = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      lesson_id: lesson.id,
      assessment_type: 'exam',
      title: 'امتحان خاطئ',
      time_limit_minutes: 10,
      questions: [
        { question_text: 'سؤال', options: ['أ', 'ب'], correct_option: 'ج', topic_tag: 'فقه' }
      ]
    })
  });
  assert.equal(resBadExam.status, 400);
  const badExamBody = await resBadExam.json();
  assert.ok(Array.isArray(badExamBody.invalid_questions));
  assert.equal(badExamBody.invalid_questions[0].index, 1);

  // Create scheduled exam ending in the future -> answers must be hidden on submit & /review until scheduled_end passes
  const pastStart = new Date(Date.now() - 60000).toISOString();
  const futureEnd = new Date(Date.now() + 3600 * 1000).toISOString();
  const resGoodExam = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      lesson_id: lesson.id,
      assessment_type: 'exam',
      title: 'امتحان مجدول محمي الإجابات',
      time_limit_minutes: 15,
      scheduled_start: pastStart,
      scheduled_end: futureEnd,
      questions: [
        { question_text: 'ما حكم النية؟', options: ['شرط', 'مكروه'], correct_option: 'شرط', explanation: 'تعليل', topic_tag: 'فقه' }
      ]
    })
  });
  assert.equal(resGoodExam.status, 201);
  const schedExamId = (await resGoodExam.json()).assessment_id;

  const st = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const stToken = createToken(st);

  const resStart = await fetch(`${baseUrl}/api/assessments/${schedExamId}/start`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resStart.status, 200);

  const resSub = await fetch(`${baseUrl}/api/assessments/${schedExamId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' },
    body: JSON.stringify({ answers: {} })
  });
  assert.equal(resSub.status, 200);
  const subData = await resSub.json();
  assert.equal(subData.answers_hidden, true);
  assert.equal(subData.detailed_review, undefined);

  // Review endpoint MUST deny (403) before scheduled_end
  const resRevBefore = await fetch(`${baseUrl}/api/submissions/${subData.submission_id}/review`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resRevBefore.status, 403);

  // Advance past scheduled_end -> /review returns 200 with detailed_review!
  (await db.run(`UPDATE assessments SET scheduled_end = ? WHERE id = ?`, [new Date(Date.now() - 1000).toISOString(), schedExamId]));
  const resRevAfter = await fetch(`${baseUrl}/api/submissions/${subData.submission_id}/review`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resRevAfter.status, 200);
  const revAfterData = await resRevAfter.json();
  assert.equal(revAfterData.detailed_review.length, 1);

  // Lock & Unlock student + Forgot/Reset password invalidating tokens
  const resLock = await fetch(`${baseUrl}/api/admin/students/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ student_id: st.id })
  });
  assert.equal(resLock.status, 200);
  const resMeLocked = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resMeLocked.status, 403);

  const resUnlock = await fetch(`${baseUrl}/api/admin/students/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ student_id: st.id })
  });
  assert.equal(resUnlock.status, 200);
  // Token issued before lock was revoked (token_version incremented!) -> 401
  const resOldTokAfterUnlock = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resOldTokAfterUnlock.status, 401);

  // Forgot/Reset password flow
  const otpRaw = '654321';
  (await db.run(`
    UPDATE users SET whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_attempts = 0 WHERE id = ?
  `, [hashOtp(otpRaw), new Date(Date.now() + 600000).toISOString(), st.id]));
  const resResetPw = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '٠١٠١٢٣٤٥٠٠٢', otp_code: '٦٥٤٣٢١', new_password: 'NewStrongPass99!' })
  });
  assert.equal(resResetPw.status, 200);
});

test('17. [Production Defaults & Voucher Mode] Missing WhatsApp enters secure voucher_code mode, while ALLOW_UNVERIFIED_REGISTRATION=true logs audit & forgot-password fallback', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const prodPort = 4198;
  const prodSecret = crypto.randomBytes(32).toString('hex');

  // 17a: In production with no WhatsApp gateway and ALLOW_UNVERIFIED_REGISTRATION=false -> defaults to secure voucher_code mode
  const vPort = prodPort + 1;
  const vChild = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(vPort),
      HOST: '127.0.0.1',
      SQLITE_DB_PATH: ':memory:',
      JWT_SECRET: prodSecret,
      WHATSAPP_API_URL: '',
      ALLOW_UNVERIFIED_REGISTRATION: 'false',
      INITIAL_ADMIN_PHONE: '01099996666',
      INITIAL_ADMIN_PASSWORD: 'VoucherModeAdminPass#26'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const vBase = `http://127.0.0.1:${vPort}`;
    let vReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await fetch(`${vBase}/api/public/info`);
        if (ping.status === 200) { vReady = true; break; }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(vReady, true);

    const vPub = await (await fetch(`${vBase}/api/public/info`)).json();
    assert.equal(vPub.registration_mode, 'voucher_code');

    // Registration without activation code must be rejected (400)
    const noCodeRes = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-01' },
      body: JSON.stringify({
        full_name: 'طالب بدون كود تفعيل للتجربة',
        phone: '01012345611',
        parent_phone: '01012345612',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'VoucherPass123!'
      })
    });
    assert.equal(noCodeRes.status, 400);

    // Admin logs in, updates Vodafone Cash & InstaPay settings, and generates 2 vouchers
    const aLogin = await (await fetch(`${vBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '01099996666', password: 'VoucherModeAdminPass#26' })
    })).json();
    const setRes = await fetch(`${vBase}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aLogin.token}` },
      body: JSON.stringify({ vodafone_cash_number: '٠١٠٢٢٢٢٣٣٣٣', instapay_handle: 'sheikh.matn@instapay' })
    });
    assert.equal(setRes.status, 200);

    const pubAfterSet = await (await fetch(`${vBase}/api/public/info`)).json();
    assert.equal(pubAfterSet.settings.vodafone_cash_number, '01022223333');
    assert.equal(pubAfterSet.settings.instapay_handle, 'sheikh.matn@instapay');

    const genRes = await (await fetch(`${vBase}/api/admin/vouchers/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aLogin.token}` },
      body: JSON.stringify({ batch_name: 'تفعيل التسجيل', count: 2, duration_days: 30, subject_scope: 'fiqh', grade_scope: 'grade_3' })
    })).json();
    const [code1, code2] = genRes.codes;

    // Invalid user data (short password) must NOT burn code1
    const badDataRes = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-02' },
      body: JSON.stringify({
        full_name: 'طالب بيانات ناقصة مع كود صحيح',
        phone: '01012345613',
        parent_phone: '01012345614',
        grade: 'grade_3',
        branch: 'scientific',
        password: '123',
        activation_code: code1
      })
    });
    assert.equal(badDataRes.status, 400);

    // Valid registration with code1 -> 201 auto_verified, active fiqh subscription, code1 burned!
    const okReg = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-02' },
      body: JSON.stringify({
        full_name: 'طالب مسجل بكود التفعيل الكامل',
        phone: '01012345613',
        parent_phone: '01012345614',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ValidVoucherPass123!',
        activation_code: code1
      })
    });
    assert.equal(okReg.status, 201);
    const okRegData = await okReg.json();
    assert.equal(okRegData.auto_verified, true);
    assert.ok(okRegData.token);
    assert.equal(okRegData.user.subscription_active, true);
    assert.equal(okRegData.user.subscribed_subjects, 'fiqh');

    // Reusing code1 fails (400)
    const reuseRes = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-03' },
      body: JSON.stringify({
        full_name: 'طالب آخر بنفس الكود المستعمل',
        phone: '01012345615',
        parent_phone: '01012345616',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ValidVoucherPass123!',
        activation_code: code1
      })
    });
    assert.equal(reuseRes.status, 400);

    // Duplicate phone even with valid code2 must fail (400) without burning code2
    const dupPhoneRes = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-04' },
      body: JSON.stringify({
        full_name: 'طالب مسجل بكود التفعيل الكامل',
        phone: '01012345613',
        parent_phone: '01012345619',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ValidVoucherPass123!',
        activation_code: code2
      })
    });
    assert.equal(dupPhoneRes.status, 400);

    // Confirm code2 is still unused by registering a second valid student with it!
    const okReg2 = await fetch(`${vBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-VMODE-05' },
      body: JSON.stringify({
        full_name: 'طالب ثاني يستخدم الكود الثاني السليم',
        phone: '01012345620',
        parent_phone: '01012345621',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ValidVoucherPass123!',
        activation_code: code2
      })
    });
    assert.equal(okReg2.status, 201);
  } finally {
    vChild.kill('SIGTERM');
  }

  // 17b: In production with ALLOW_UNVERIFIED_REGISTRATION=true -> starts, auto-verifies & writes audit log
  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(prodPort),
    HOST: '127.0.0.1',
    SQLITE_DB_PATH: ':memory:',
    JWT_SECRET: prodSecret,
    TRUSTED_PROXY_COUNT: '',
    WHATSAPP_API_URL: '',
    ALLOW_UNVERIFIED_REGISTRATION: 'true'
  };

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const prodBase = `http://127.0.0.1:${prodPort}`;
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await fetch(`${prodBase}/api/public/info`);
        if (ping.status === 200) {
          ready = true;
          break;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(ready, true);

    const resAuto = await fetch(`${prodBase}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': 'DEV-PROD-AUTO-01',
        'X-Forwarded-For': '41.42.43.44'
      },
      body: JSON.stringify({
        full_name: 'طالب تفعيل تلقائي للإنتاج الكامل',
        phone: '01012345777',
        parent_phone: '01012345778',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'ProdAutoPass123!'
      })
    });
    assert.equal(resAuto.status, 201);
    const autoData = await resAuto.json();
    assert.equal(autoData.auto_verified, true);
    assert.ok(autoData.token);
    assert.ok(autoData.csrf_token);
    assert.equal(autoData.user.is_whatsapp_verified, true);
    const setCookieHeader = resAuto.headers.get('set-cookie') || '';
    assert.match(setCookieHeader, /matn_access_token=/);

    const resMe = await fetch(`${prodBase}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${autoData.token}`,
        'X-Device-Id': 'DEV-PROD-AUTO-01'
      }
    });
    assert.equal(resMe.status, 200);

    // Re-registering existing phone returns 400 and NEVER issues token
    const resDup = await fetch(`${prodBase}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': 'DEV-PROD-AUTO-02',
        'X-Forwarded-For': '41.42.43.45'
      },
      body: JSON.stringify({
        full_name: 'طالب تفعيل تلقائي للإنتاج الكامل',
        phone: '01012345777',
        parent_phone: '01012345779',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'AnotherPass123!'
      })
    });
    assert.equal(resDup.status, 400);
    const dupData = await resDup.json();
    assert.equal(dupData.token, undefined);

    // forgot-password without WhatsApp gateway must return 503 with support instructions (never pretend OTP was sent)
    // AND TRUSTED_PROXY_COUNT=1 in production separates clients by X-Forwarded-For IP (60 limit per IP)
    for (let i = 0; i < 60; i++) {
      const p = `01055${String(i).padStart(6, '0')}`;
      const r = await fetch(`${prodBase}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '197.1.1.1' },
        body: JSON.stringify({ phone: p })
      });
      assert.equal(r.status, 503);
      if (i === 0) {
        const fData = await r.json();
        assert.ok(fData.support_whatsapp);
        assert.match(fData.error, /الدعم/);
      }
    }
    const rBlocked = await fetch(`${prodBase}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '197.1.1.1' },
      body: JSON.stringify({ phone: '01055999001' })
    });
    assert.equal(rBlocked.status, 429);

    const rOtherStudentIp = await fetch(`${prodBase}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '197.2.2.2' },
      body: JSON.stringify({ phone: '01055999002' })
    });
    assert.equal(rOtherStudentIp.status, 503);
  } finally {
    child.kill('SIGTERM');
  }
});

test('18. [Feature] Mixed MCQ and True/False (صح وخطأ) questions creation, ordering, grading, and editing', async () => {
  const lesson = (await db.get(`SELECT id FROM lessons WHERE subject = 'fiqh' AND grade = 'grade_3' LIMIT 1`));

  // Reject invalid true_false correct_option
  const resInvalidTf = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      lesson_id: lesson.id,
      assessment_type: 'homework',
      title: 'واجب مرفوض',
      time_limit_minutes: 10,
      questions: [
        { question_type: 'true_false', question_text: 'عبارة تجريبية', topic_tag: 'فقه', correct_option: 'ربما', points: 2 }
      ]
    })
  });
  assert.equal(resInvalidTf.status, 400);

  // Create mixed homework (1 MCQ + 2 True/False)
  const resMixed = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      lesson_id: lesson.id,
      assessment_type: 'homework',
      title: 'واجب مختلط اختياري وصح وغلط',
      time_limit_minutes: 15,
      questions: [
        {
          question_type: 'mcq',
          question_text: 'ما حكم النية في الوضوء عند الشافعية؟',
          topic_tag: 'الطهارة',
          options: ['فرض', 'سنة', 'مكروه'],
          correct_option: 'فرض',
          points: 2
        },
        {
          question_type: 'true_false',
          question_text: 'يجوز المسح على الخفين للمقيم يوماً وليلة.',
          topic_tag: 'المسح على الخفين',
          correct_option: 'صح',
          explanation: 'ثبت ذلك بالسنة الصحيحة.',
          points: 2
        },
        {
          question_type: 'true_false',
          question_text: 'الطلاق البدعي يقع ولا إثم فيه.',
          topic_tag: 'الطلاق',
          correct_option: 'خطأ',
          explanation: 'يقع مع الإثم.',
          points: 2
        }
      ]
    })
  });
  assert.equal(resMixed.status, 201);
  const mixedId = (await resMixed.json()).assessment_id;

  const st = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const stToken = createToken(st);

  const resStart = await fetch(`${baseUrl}/api/assessments/${mixedId}/start`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' }
  });
  assert.equal(resStart.status, 200);
  const startData = await resStart.json();
  assert.equal(startData.questions.length, 3);

  const tfQuestions = startData.questions.filter((q) => q.question_type === 'true_false');
  assert.equal(tfQuestions.length, 2);
  // True/False options must stay strictly ordered ['صح', 'خطأ']
  for (const tfq of tfQuestions) {
    assert.deepEqual(tfq.options, ['صح', 'خطأ']);
  }

  // Answer all 3 correctly
  const answers = {};
  for (const q of startData.questions) {
    if (q.question_text.includes('النية')) answers[q.id] = 'فرض';
    else if (q.question_text.includes('الخفين')) answers[q.id] = 'صح';
    else answers[q.id] = 'خطأ';
  }

  const resSubmit = await fetch(`${baseUrl}/api/assessments/${mixedId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-BOUND-100' },
    body: JSON.stringify({ answers })
  });
  assert.equal(resSubmit.status, 200);
  const submitData = await resSubmit.json();
  assert.equal(submitData.score, 6);
  assert.equal(submitData.total_points, 6);
  assert.equal(submitData.passed, true);

  // Admin edits assessment keeping question_type
  const resEdit = await fetch(`${baseUrl}/api/admin/assessments/${mixedId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'واجب مختلط محدث',
      questions: [
        {
          question_type: 'true_false',
          question_text: 'سؤال صح وغلط معدل',
          topic_tag: 'مبحث',
          correct_option: 'صح',
          points: 3
        }
      ]
    })
  });
  assert.equal(resEdit.status, 200);

  const resAdminList = await fetch(`${baseUrl}/api/admin/lessons/${lesson.id}/assessments`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(resAdminList.status, 200);
  const adminListData = await resAdminList.json();
  const edited = adminListData.assessments.find((a) => a.id === mixedId);
  assert.equal(edited.questions[0].question_type, 'true_false');
  assert.equal(edited.questions[0].points, 3);
});

test('19. [Task 1 & Task 2] Admin student password reset & Cross-IP attacker cannot lock out legitimate student or admin', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  const now = new Date().toISOString();

  // Create target student & check initial login + admin reset password
  const targetRes = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, created_at
    ) VALUES ('طالب استعادة كلمة مرور من الادمن', '01012345888', '01012345889', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-RESET-19', ?)
  `, [hashPassword('OldPass123!'), now]));
  const studentRow = (await db.get(`SELECT * FROM users WHERE id = ?`, [targetRes.lastInsertRowid]));
  const oldToken = createToken(studentRow);

  // Reject short temporary password (< 8 chars)
  const resShort = await fetch(`${baseUrl}/api/admin/students/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ student_id: studentRow.id, new_password: '123' })
  });
  assert.equal(resShort.status, 400);

  // Valid admin temp password reset
  const resReset = await fetch(`${baseUrl}/api/admin/students/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ student_id: studentRow.id, new_password: 'TempNewPass99!' })
  });
  assert.equal(resReset.status, 200);

  // Old session token must be invalidated (token_version incremented)
  const resOldTok = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${oldToken}`, 'X-Device-Id': 'DEV-RESET-19' }
  });
  assert.equal(resOldTok.status, 401);

  // Login works with new temp password
  const resNewLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-RESET-19' },
    body: JSON.stringify({ phone: '01012345888', password: 'TempNewPass99!' })
  });
  assert.equal(resNewLogin.status, 200);

  const resetAudit = (await db.get(`SELECT * FROM audit_logs WHERE action = 'ADMIN_STUDENT_PASSWORD_RESET' ORDER BY id DESC LIMIT 1`));
  assert.ok(resetAudit);

  // Cross-IP brute force test on isolated proxy-aware server (TRUSTED_PROXY_COUNT=1)
  const port2 = 4197;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port2),
      HOST: '127.0.0.1',
      SQLITE_DB_PATH: ':memory:',
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      TRUSTED_PROXY_COUNT: '1',
      WHATSAPP_API_URL: '',
      ALLOW_UNVERIFIED_REGISTRATION: 'true',
      INITIAL_ADMIN_PHONE: '01099998888',
      INITIAL_ADMIN_PASSWORD: 'SuperStrongAdminPassword99!'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const pBase = `http://127.0.0.1:${port2}`;
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await fetch(`${pBase}/api/health`);
        if (ping.status === 200) { ready = true; break; }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(ready, true);

    // Register real student
    const reg = await fetch(`${pBase}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-ST', 'X-Forwarded-For': '41.10.10.20' },
      body: JSON.stringify({
        full_name: 'طالب حقيقي على عنوان نظيف تماما',
        phone: '01044445555',
        parent_phone: '01044445556',
        grade: 'grade_3',
        branch: 'scientific',
        password: 'RealStudentPass1!'
      })
    });
    assert.equal(reg.status, 201);

    // Attacker IP (198.51.100.99) fails 10 times on student's phone -> attacker IP gets locked (429)
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`${pBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-ATK', 'X-Forwarded-For': '198.51.100.99' },
        body: JSON.stringify({ phone: '01044445555', password: 'WrongPassword!' })
      });
      assert.equal(r.status, i === 9 ? 429 : 401);
    }

    // Real student logging in from clean IP (41.10.10.20) MUST still succeed!
    const realLogin = await fetch(`${pBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-ST', 'X-Forwarded-For': '41.10.10.20' },
      body: JSON.stringify({ phone: '01044445555', password: 'RealStudentPass1!' })
    });
    assert.equal(realLogin.status, 200);

    // Attacker fails 6 times against Admin from external IP -> admin MUST NOT be locked from clean IP + alert generated!
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${pBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.77' },
        body: JSON.stringify({ phone: '01099998888', password: 'BadAdminGuess!' })
      });
      assert.equal(r.status, 401);
    }
    const adminOk = await fetch(`${pBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '41.10.10.21' },
      body: JSON.stringify({ phone: '01099998888', password: 'SuperStrongAdminPassword99!' })
    });
    assert.equal(adminOk.status, 200);
    const adminData = await adminOk.json();
    const overview = await fetch(`${pBase}/api/admin/overview`, {
      headers: { 'Authorization': `Bearer ${adminData.token}` }
    });
    assert.equal(overview.status, 200);
    const ovJson = await overview.json();
    assert.ok(Array.isArray(ovJson.admin_security_alerts) && ovJson.admin_security_alerts.length >= 1);
  } finally {
    child.kill('SIGTERM');
  }
});

test('20. [Task 4, 5, 6] Health check hides env & pings DB, backup handles quotes + 14-day rotation, scrypt queue & Nginx X-Accel-Redirect', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { spawn } = require('node:child_process');
  const { hashPasswordAsync } = require('../database');
  const { escapeSqliteStringLiteral, createDatabaseBackup } = require('../scripts/backup-db');

  // Task 5: /api/health hides env and includes db: 'connected'
  const resHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(resHealth.status, 200);
  const hData = await resHealth.json();
  assert.equal(hData.env, undefined);
  assert.equal(hData.db, 'connected');
  assert.equal(hData.status, 'ok');

  // Task 4: Quote escaping in SQLite literal + 14-backup rotation
  assert.equal(escapeSqliteStringLiteral("C:\\O'Brien\\matn's.db"), "C:/O''Brien/matn''s.db");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "matn's-bak-"));
  try {
    for (let i = 1; i <= 16; i++) {
      const name = `matn_backup_2026-01-${String(i).padStart(2, '0')}T00-00-00-000Z.db`;
      fs.writeFileSync(path.join(tmpDir, name), 'dummy');
    }
    const { backupFile, deleted } = await createDatabaseBackup(db, tmpDir, "matn_backup_2026-02-01T00-00-00-000Z'quote.db");
    assert.equal(fs.existsSync(backupFile), true);
    assert.equal(deleted.length, 3); // 17 total - 14 kept = 3 oldest deleted
    const remaining = fs.readdirSync(tmpDir).filter((f) => /^matn_backup_.*\.db$/.test(f));
    assert.equal(remaining.length, 14);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  // Task 6c: Bounded scrypt concurrency (10 concurrent calls keep same scrypt parameters)
  const hashes = await Promise.all(Array.from({ length: 10 }, (_, idx) => hashPasswordAsync(`PassConcurrency#${idx}`)));
  for (const h of hashes) {
    assert.match(h, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  }

  // Task 6a: USE_NGINX_ACCEL=true returns X-Accel-Redirect after ticket verification
  const vidDir = path.join(tempUploadsRoot, 'videos');
  fs.mkdirSync(vidDir, { recursive: true });
  const testVidName = `test_accel_${Date.now()}.mp4`;
  const testVidPath = path.join(vidDir, testVidName);
  fs.writeFileSync(testVidPath, Buffer.from('00000018667479706d703432', 'hex'));

  const accelPort = 4196;
  const accelChild = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_CLIENT: 'sqlite',
      PORT: String(accelPort),
      HOST: '127.0.0.1',
      SQLITE_DB_PATH: ':memory:',
      UPLOADS_DIR: tempUploadsRoot,
      JWT_SECRET: crypto.randomBytes(32).toString('hex'),
      USE_NGINX_ACCEL: 'true',
      ALLOW_UNVERIFIED_REGISTRATION: 'true',
      INITIAL_ADMIN_PHONE: '01099997777',
      INITIAL_ADMIN_PASSWORD: 'AccelAdminStrongPass99!'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const aBase = `http://127.0.0.1:${accelPort}`;
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const ping = await fetch(`${aBase}/api/health`);
        if (ping.status === 200) { ready = true; break; }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(ready, true);

    const aLogin = await fetch(`${aBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '01099997777', password: 'AccelAdminStrongPass99!' })
    });
    const aToken = (await aLogin.json()).token;

    const aLesson = await fetch(`${aBase}/api/admin/lessons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aToken}` },
      body: JSON.stringify({
        title: 'حصة بث Nginx',
        grade: 'grade_3',
        subject: 'fiqh',
        branch: 'both',
        unit_title: 'وحدة',
        order_index: 1,
        video_path: `uploads/videos/${testVidName}`
      })
    });
    assert.equal(aLesson.status, 201);
    const lId = (await aLesson.json()).lesson_id;

    const aTicket = await fetch(`${aBase}/api/media/ticket/${lId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aToken}` }
    });
    const ticket = (await aTicket.json()).ticket;

    const aStream = await fetch(`${aBase}/api/stream/video/${lId}`, {
      headers: { 'Authorization': `Bearer ${aToken}`, 'X-Stream-Ticket': ticket }
    });
    assert.equal(aStream.status, 200);
    assert.equal(aStream.headers.get('x-accel-redirect'), `/_protected_videos/${testVidName}`);
  } finally {
    accelChild.kill('SIGTERM');
    try { fs.unlinkSync(testVidPath); } catch {}
  }
});

test('21. [Final Hardening] Shared .env loading across migrations/scripts/server & >24h login_attempts cleanup', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync, spawn } = require('node:child_process');
  const { cleanupStaleLoginAttempts } = require('../server');

  // Verify cleanupStaleLoginAttempts deletes >24h old rows and keeps fresh rows
  const nowMs = Date.now();
  const staleIso = new Date(nowMs - 25 * 60 * 60 * 1000).toISOString();
  const freshIso = new Date(nowMs - 5 * 60 * 1000).toISOString();
  (await db.run(`
    INSERT OR REPLACE INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until)
    VALUES ('198.51.100.1', '01099001122', 3, ?, NULL),
           ('198.51.100.2', '01099001122', 2, ?, NULL)
  `, [staleIso, freshIso]));

  await cleanupStaleLoginAttempts(nowMs);
  const remaining = (await db.all(`SELECT ip_address FROM login_attempts WHERE phone = '01099001122'`));
  assert.deepEqual(remaining.map((r) => r.ip_address), ['198.51.100.2']);

  // Verify db/migrations.js, scripts/setup-admin.js, scripts/backup-db.js, and server.js share SQLITE_DB_PATH from .env
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matn-env-sync-'));
  const customDbPath = path.join(tmpDir, 'shared_env.db');
  const customEnvPath = path.join(tmpDir, '.env');
  const sharedAdminPhone = '01088776655';
  const sharedAdminPass = 'SharedEnvAdminPass#2026';

  fs.writeFileSync(customEnvPath, [
    'NODE_ENV=production',
    'HOST=127.0.0.1',
    'DB_CLIENT=sqlite',
    `SQLITE_DB_PATH=${customDbPath}`,
    `JWT_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    'ALLOW_UNVERIFIED_REGISTRATION=true',
    `INITIAL_ADMIN_PHONE=${sharedAdminPhone}`,
    `INITIAL_ADMIN_PASSWORD=${sharedAdminPass}`
  ].join('\n'), 'utf8');

  const baseChildEnv = { ...process.env, MATN_ENV_FILE: customEnvPath };
  delete baseChildEnv.SQLITE_DB_PATH;
  delete baseChildEnv.INITIAL_ADMIN_PHONE;
  delete baseChildEnv.INITIAL_ADMIN_PASSWORD;
  delete baseChildEnv.JWT_SECRET;
  delete baseChildEnv.ALLOW_UNVERIFIED_REGISTRATION;

  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'db', 'migrations.js')], { env: baseChildEnv });
    assert.equal(fs.existsSync(customDbPath), true);

    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'setup-admin.js')], { env: baseChildEnv });

    // Start server.js reading ONLY MATN_ENV_FILE -> must log in with the admin created by setup-admin.js!
    const syncPort = 4195;
    const srvChild = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: { ...baseChildEnv, PORT: String(syncPort) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const sBase = `http://127.0.0.1:${syncPort}`;
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const ping = await fetch(`${sBase}/api/health`);
          if (ping.status === 200) { ready = true; break; }
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.equal(ready, true);

      const loginRes = await fetch(`${sBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: sharedAdminPhone, password: sharedAdminPass })
      });
      assert.equal(loginRes.status, 200);
    } finally {
      await new Promise((resolve) => {
        if (srvChild.exitCode !== null) return resolve();
        srvChild.once('exit', resolve);
        srvChild.kill('SIGTERM');
        setTimeout(() => { try { srvChild.kill('SIGKILL'); } catch {} resolve(); }, 3000).unref();
      });
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('22. [Feature] Admin voucher assignment to student + WhatsApp greeting + optional phone lock + release', async () => {
  // Generate 2 vouchers
  const gen = await (await fetch(`${baseUrl}/api/admin/vouchers/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ batch_name: 'اختبار إرسال واتساب', count: 2, duration_days: 30, subject_scope: 'all', grade_scope: 'grade_3' })
  })).json();
  const [c1, c2] = gen.codes;
  const v1 = (await db.get(`SELECT id FROM vouchers WHERE code = ?`, [c1]));
  const v2 = (await db.get(`SELECT id FROM vouchers WHERE code = ?`, [c2]));

  // Admin searches registered students
  const searchRes = await fetch(`${baseUrl}/api/admin/students/search?q=01012345002`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert.equal(searchData.students.length, 1);
  const targetStudent = searchData.students[0];

  // Assign voucher v1 to targetStudent WITH phone lock
  const assign1 = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ voucher_id: v1.id, student_id: targetStudent.id, restrict_to_phone: true })
  });
  assert.equal(assign1.status, 200);
  const a1Data = await assign1.json();
  assert.match(a1Data.whatsapp_url, /^https:\/\/wa\.me\/201012345002\?text=/);
  assert.match(a1Data.whatsapp_message, /وعليكم السلام ورحمة الله وبركاته/);
  assert.ok(a1Data.whatsapp_message.includes(c1));
  assert.equal(a1Data.voucher.restrict_to_phone, 1);

  // Different student trying to register or redeem phone-locked code c1 gets 403
  const otherPhoneReg = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-LOCKV-01' },
    body: JSON.stringify({
      full_name: 'طالب يحاول سرقة كود مقفول برقم آخر',
      phone: '01077771111',
      parent_phone: '01077771112',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'StealAttempt123!',
      activation_code: c1
    })
  });
  assert.equal(otherPhoneReg.status, 403);

  // Also test existing different student calling /api/vouchers/redeem gets 403
  const otherStudent = (await db.get(`SELECT * FROM users WHERE phone = '01012345010'`));
  const otherTok = createToken(otherStudent);
  const otherRedeem = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${otherTok}`, 'X-Device-Id': otherStudent.device_id },
    body: JSON.stringify({ code: c1 })
  });
  assert.equal(otherRedeem.status, 403);

  // Intended student redeems c1 cleanly -> 200 OK
  const targetUserRow = (await db.get(`SELECT * FROM users WHERE id = ?`, [targetStudent.id]));
  const targetTok = createToken(targetUserRow);
  const okRedeem = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${targetTok}`, 'X-Device-Id': targetUserRow.device_id },
    body: JSON.stringify({ code: c1 })
  });
  assert.equal(okRedeem.status, 200);

  // Assign v2 to brand-new (unregistered) recipient without phone lock -> release -> verify unlocked/cleared
  const assign2 = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      voucher_id: v2.id,
      recipient_name: 'يوسف مصطفى الشافعي',
      recipient_phone: '٠١٠٦٦٦٦٧٧٧٧',
      restrict_to_phone: false
    })
  });
  assert.equal(assign2.status, 200);
  const a2Data = await assign2.json();
  assert.equal(a2Data.voucher.assigned_to_phone, '01066667777');
  assert.equal(a2Data.voucher.restrict_to_phone, 0);

  const rel2 = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ voucher_id: v2.id, action: 'release' })
  });
  assert.equal(rel2.status, 200);
  const v2Row = (await db.get(`SELECT assigned_to_phone, restrict_to_phone, sent_at FROM vouchers WHERE id = ?`, [v2.id]));
  assert.equal(v2Row.assigned_to_phone, null);
  assert.equal(v2Row.restrict_to_phone, 0);
  assert.equal(v2Row.sent_at, null);
});

test('23. [Audit Fixes & Server Readiness] Phone normalization, voucher grade check, static video 206 range, invalid ID 404, STORAGE_DIR paths', async () => {
  const { resolveSqliteDbPath, resolveUploadsDir, resolveBackupsDir } = require('../lib/paths');

  // 1. Register & login using +20 prefix, spaces, dashes, and RTL/LTR directional marks
  const regNorm = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-NORM-23' },
    body: JSON.stringify({
      full_name: 'طالب تطبيع أرقام الهواتف المصرية',
      phone: '\u202a+20 105-555-8899\u202c',
      parent_phone: '00201055558800',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'NormPhonePass123!'
    })
  });
  assert.equal(regNorm.status, 201);
  const normUser = (await db.get(`SELECT * FROM users WHERE phone = '01055558899'`));
  assert.ok(normUser);
  assert.equal(normUser.parent_phone, '01055558800');

  // 2. Assigning a prep_1-only voucher to a grade_3 student MUST fail with 400
  const prepGen = await (await fetch(`${baseUrl}/api/admin/vouchers/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ batch_name: 'كود أولى إعدادي', count: 1, duration_days: 30, subject_scope: 'fiqh', grade_scope: 'prep_1' })
  })).json();
  const prepVoucher = (await db.get(`SELECT id FROM vouchers WHERE code = ?`, [prepGen.codes[0]]));
  const badAssign = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ voucher_id: prepVoucher.id, student_id: normUser.id, restrict_to_phone: true })
  });
  assert.equal(badAssign.status, 400);

  // 3. Invalid non-numeric route IDs cleanly return 404 (not 500)
  const badLessonTicket = await fetch(`${baseUrl}/api/media/ticket/not-a-number`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(badLessonTicket.status, 404);
  const badDelStudent = await fetch(`${baseUrl}/api/admin/students/not-an-id`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(badDelStudent.status, 404);

  // 4. Static MP4 video (/assets/matn_guide_video.mp4) supports HTTP 206 Range requests
  const rangeRes = await fetch(`${baseUrl}/assets/matn_guide_video.mp4`, {
    headers: { 'Range': 'bytes=0-1023' }
  });
  assert.equal(rangeRes.status, 206);
  assert.match(rangeRes.headers.get('content-range') || '', /^bytes 0-1023\//);
  assert.equal(rangeRes.headers.get('accept-ranges'), 'bytes');
  const rangeBuf = await rangeRes.arrayBuffer();
  assert.equal(rangeBuf.byteLength, 1024);

  // 5. STORAGE_DIR fallback path resolution works cleanly when specific overrides are unset
  const prevStorage = process.env.STORAGE_DIR;
  const prevDb = process.env.SQLITE_DB_PATH;
  const prevUp = process.env.UPLOADS_DIR;
  const prevBak = process.env.BACKUPS_DIR;
  try {
    process.env.STORAGE_DIR = path.join(os.tmpdir(), 'matn-storage-root');
    delete process.env.SQLITE_DB_PATH;
    delete process.env.UPLOADS_DIR;
    delete process.env.BACKUPS_DIR;
    assert.equal(resolveSqliteDbPath(), path.join(path.resolve(process.env.STORAGE_DIR), 'matn_platform.db'));
    assert.equal(resolveUploadsDir(), path.join(path.resolve(process.env.STORAGE_DIR), 'uploads'));
    assert.equal(resolveBackupsDir(), path.join(path.resolve(process.env.STORAGE_DIR), 'backups'));
  } finally {
    if (prevStorage === undefined) delete process.env.STORAGE_DIR; else process.env.STORAGE_DIR = prevStorage;
    if (prevDb === undefined) delete process.env.SQLITE_DB_PATH; else process.env.SQLITE_DB_PATH = prevDb;
    if (prevUp === undefined) delete process.env.UPLOADS_DIR; else process.env.UPLOADS_DIR = prevUp;
    if (prevBak === undefined) delete process.env.BACKUPS_DIR; else process.env.BACKUPS_DIR = prevBak;
  }
});

test('24. [Features] Video watch progress/resume, moderated lesson Q&A, and Honor Roll toggle', async () => {
  const st = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const stToken = createToken(st);
  const otherSt = (await db.get(`SELECT * FROM users WHERE phone = '01012345005'`));
  const otherTok = createToken(otherSt);
  const unsubSt = (await db.get(`SELECT * FROM users WHERE phone = '01012345003'`));
  const unsubTok = createToken(unsubSt);
  const lesson = (await db.get(`SELECT id FROM lessons WHERE subject = 'fiqh' AND grade = 'grade_3' LIMIT 1`));

  // 1. Unsubscribed student blocked from saving or reading progress/Q&A
  const unsubProg = await fetch(`${baseUrl}/api/lessons/${lesson.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${unsubTok}`, 'X-Device-Id': unsubSt.device_id },
    body: JSON.stringify({ position_seconds: 60, duration_seconds: 300 })
  });
  assert.equal(unsubProg.status, 403);

  // 2. Subscribed student saves progress at 150/300 (50%), then rewinds to 60/300 -> max_watched_percent stays 50, last_position=60
  const p1 = await fetch(`${baseUrl}/api/lessons/${lesson.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': st.device_id },
    body: JSON.stringify({ position_seconds: 150, duration_seconds: 300 })
  });
  assert.equal(p1.status, 200);
  const p2 = await fetch(`${baseUrl}/api/lessons/${lesson.id}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': st.device_id },
    body: JSON.stringify({ position_seconds: 60, duration_seconds: 300 })
  });
  assert.equal(p2.status, 200);
  const p2Data = await p2.json();
  assert.equal(p2Data.progress.last_position_seconds, 60);
  assert.equal(p2Data.progress.max_watched_percent, 50);

  // Dashboard reflects progress & honor roll without leaking phones
  const dashRes = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': st.device_id }
  });
  assert.equal(dashRes.status, 200);
  const dashData = await dashRes.json();
  const dashLesson = dashData.lessons.find((l) => l.id === lesson.id);
  assert.equal(dashLesson.progress.last_position_seconds, 60);
  assert.equal(dashLesson.progress.max_watched_percent, 50);
  assert.equal(dashData.honor_roll_enabled, true);
  assert.ok(Array.isArray(dashData.honor_roll) && dashData.honor_roll.length >= 1);
  assert.equal(dashData.honor_roll[0].phone, undefined);

  // Turning off honor_roll_enabled in admin settings hides honor_roll in dashboard
  await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ honor_roll_enabled: '0' })
  });
  const dashOff = await (await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': st.device_id }
  })).json();
  assert.equal(dashOff.honor_roll_enabled, false);
  assert.deepEqual(dashOff.honor_roll, []);

  // 3. Student asks question -> visible to author, hidden from other students until admin answers & publishes
  const askRes = await fetch(`${baseUrl}/api/lessons/${lesson.id}/questions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': st.device_id },
    body: JSON.stringify({ question_text: 'ما الفرق بين الطلاق الرجعي والبائن؟' })
  });
  assert.equal(askRes.status, 201);
  const qId = (await askRes.json()).question_id;

  const otherSeeBefore = await (await fetch(`${baseUrl}/api/lessons/${lesson.id}/questions`, {
    headers: { 'Authorization': `Bearer ${otherTok}`, 'X-Device-Id': otherSt.device_id }
  })).json();
  assert.equal(otherSeeBefore.questions.some((q) => q.id === qId), false);

  const ansRes = await fetch(`${baseUrl}/api/admin/lesson-questions/${qId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ admin_answer: 'الرجعي يملك فيه الزوج المراجعة في العدة.', is_published: true })
  });
  assert.equal(ansRes.status, 200);

  const otherSeeAfter = await (await fetch(`${baseUrl}/api/lessons/${lesson.id}/questions`, {
    headers: { 'Authorization': `Bearer ${otherTok}`, 'X-Device-Id': otherSt.device_id }
  })).json();
  assert.equal(otherSeeAfter.questions.some((q) => q.id === qId), true);
});

test('25. [Features] Admin search, expiring-soon filter, voucher filter, and revenue summary', async () => {
  // Put normUser expiring in 2 days
  const in2DaysIso = new Date(Date.now() + 2 * 86400000).toISOString();
  (await db.run(`UPDATE users SET subscription_expires_at = ? WHERE phone = '01055558899'`, [in2DaysIso]));

  const ovExp = await (await fetch(`${baseUrl}/api/admin/overview?students_filter=expiring_soon&students_q=01055558899`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.equal(ovExp.students.length, 1);
  assert.equal(ovExp.students[0].phone, '01055558899');
  assert.ok(ovExp.expiring_soon_count >= 1);
  assert.ok(ovExp.revenue_summary.total_used_vouchers >= 1);
  assert.ok(ovExp.revenue_summary.total_revenue_egp >= 150);

  // Voucher filter 'used' only returns used vouchers
  const ovUsedVouchers = await (await fetch(`${baseUrl}/api/admin/overview?vouchers_filter=used`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.ok(ovUsedVouchers.vouchers.length >= 1);
  assert.equal(ovUsedVouchers.vouchers.every((v) => v.is_used === 1), true);
});

test('26. [Features] Friday 3 PM Cairo sequential weekly parent report queue & 1-click parent report', async () => {
  const {
    isFridayThreePmCairo,
    queueWeeklyReportsForWeek,
    processWeeklyReportQueue
  } = require('../lib/weekly-reports');

  // Verify Cairo time check (Friday 2026-11-20 13:00 UTC = 15:00 Cairo UTC+2)
  assert.equal(isFridayThreePmCairo(new Date('2026-11-20T13:05:00Z')), true);
  assert.equal(isFridayThreePmCairo(new Date('2026-11-20T11:05:00Z')), false); // 13:05 Cairo, not 3 PM
  assert.equal(isFridayThreePmCairo(new Date('2026-11-19T13:05:00Z')), false); // Thursday

  // Single student 1-click parent report endpoint
  const st1 = (await db.get(`SELECT * FROM users WHERE phone = '01012345002'`));
  const st2 = (await db.get(`SELECT * FROM users WHERE phone = '01012345005'`));
  const prRes = await fetch(`${baseUrl}/api/admin/students/${st1.id}/parent-report`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(prRes.status, 200);
  const prData = await prRes.json();
  assert.match(prData.whatsapp_url, /^https:\/\/wa\.me\/201012345998\?text=/);
  assert.ok(prData.report_text.includes(st1.full_name));

  // Sequential queue processing with mock gateway (must send st1 then st2 one-by-one with delay)
  const testWeekKey = '2026-11-20-TEST';
  const qRes = await queueWeeklyReportsForWeek(db, { weekKey: testWeekKey, studentIds: [st1.id, st2.id] });
  assert.equal(qRes.queuedCount, 2);

  const dispatchOrder = [];
  const resSeq = await processWeeklyReportQueue({
    db,
    weekKey: testWeekKey,
    hasGateway: true,
    delayMs: 25,
    dispatchWhatsApp: async (phone) => {
      dispatchOrder.push({ phone, at: Date.now() });
      return { delivered: true };
    }
  });
  assert.equal(resSeq.sent, 2);
  assert.equal(dispatchOrder.length, 2);
  assert.equal(dispatchOrder[0].phone, st1.parent_phone);
  assert.equal(dispatchOrder[1].phone, st2.parent_phone);
  assert.ok(dispatchOrder[1].at - dispatchOrder[0].at >= 15);

  // Re-running same weekKey must NOT duplicate already-sent students
  const qResAgain = await queueWeeklyReportsForWeek(db, { weekKey: testWeekKey, studentIds: [st1.id, st2.id] });
  assert.equal(qResAgain.queuedCount, 0);

  // Admin /api/admin/weekly-reports/run without gateway prepares manual_ready items & mark-sent works
  const runManual = await fetch(`${baseUrl}/api/admin/weekly-reports/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ week_key: '2026-11-27-MANUAL', student_ids: [st1.id] })
  });
  assert.equal(runManual.status, 200);
  const rmData = await runManual.json();
  assert.equal(rmData.items.length, 1);
  assert.equal(rmData.items[0].status, 'manual_ready');

  const markSent = await fetch(`${baseUrl}/api/admin/weekly-reports/${rmData.items[0].id}/mark-sent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({})
  });
  assert.equal(markSent.status, 200);
});

test('27. [Hardening] Malformed Host header resilience, NaN limit guards, and 404 on missing admin targets', async () => {
  // Raw HTTP request with malformed Host header must NOT throw ERR_INVALID_URL or crash the server
  const net = require('node:net');
  const u = new URL(baseUrl);
  const rawRes = await new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: u.hostname, port: Number(u.port) }, () => {
      sock.write('GET /api/health HTTP/1.1\r\nHost: bad host:99999\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => { data += chunk; });
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
  assert.match(rawRes, /^HTTP\/1\.1 200 /);

  // NaN query params on admin overview must safely fall back to defaults instead of binding SQLite NULL
  const ovRes = await fetch(`${baseUrl}/api/admin/overview?students_limit=abc&students_offset=nope&vouchers_limit=NaN`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(ovRes.status, 200);
  const ovData = await ovRes.json();
  assert.equal(ovData.students_limit, 50);
  assert.equal(ovData.students_offset, 0);
  assert.equal(ovData.vouchers_limit, 60);

  // Non-existent / invalid student IDs must consistently return 404
  for (const ep of ['/api/admin/students/reset-device', '/api/admin/students/verify-whatsapp', '/api/admin/students/grant-month']) {
    const r = await fetch(`${baseUrl}${ep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ student_id: 9999999 })
    });
    assert.equal(r.status, 404, `${ep} should return 404 for unknown student`);
  }
});

test('28. [Fix 1 OTP Hijack] Re-registering unverified phone overwrites password/device while verified phone stays untouched', async () => {
  const phone = '01099887766';
  const r1 = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-PRE-ATTEMPT-1' },
    body: JSON.stringify({
      full_name: 'طالب اول مؤقت غير مفعل',
      phone,
      parent_phone: '01099887700',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'PasswordAlpha11',
      device_id: 'DEV-PRE-ATTEMPT-1'
    })
  });
  assert.equal(r1.status, 201);

  const r2 = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-USER-22' },
    body: JSON.stringify({
      full_name: 'طالب حقيقي مسجل لاحقا هنا',
      phone,
      parent_phone: '01099887701',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'PasswordBeta22',
      device_id: 'DEV-REAL-USER-22'
    })
  });
  assert.equal(r2.status, 201);

  const futureIso = new Date(Date.now() + 600 * 1000).toISOString();
  (await db.run(`UPDATE users SET whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_attempts = 0 WHERE phone = ?`, [hashOtp('654321'), futureIso, phone]));

  const vRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-USER-22' },
    body: JSON.stringify({ phone, otp_code: '654321', device_id: 'DEV-REAL-USER-22' })
  });
  assert.equal(vRes.status, 200);

  // First attacker password must FAIL
  const loginOld = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-PRE-ATTEMPT-1' },
    body: JSON.stringify({ phone, password: 'PasswordAlpha11', device_id: 'DEV-PRE-ATTEMPT-1' })
  });
  assert.equal(loginOld.status, 401);

  // Latest registrant password + device must SUCCEED
  const loginNew = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-USER-22' },
    body: JSON.stringify({ phone, password: 'PasswordBeta22', device_id: 'DEV-REAL-USER-22' })
  });
  assert.equal(loginNew.status, 200);

  // Once verified, another registration attempt must NOT overwrite anything and keeps uniform 201
  const r3 = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-OTHER-999' },
    body: JSON.stringify({
      full_name: 'محاولة تلاعب بعد التفعيل الكامل',
      phone,
      parent_phone: '01099887702',
      grade: 'grade_3',
      branch: 'scientific',
      password: 'PasswordGamma33',
      device_id: 'DEV-OTHER-999'
    })
  });
  assert.equal(r3.status, 201);

  const loginAfterVerified = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-REAL-USER-22' },
    body: JSON.stringify({ phone, password: 'PasswordBeta22', device_id: 'DEV-REAL-USER-22' })
  });
  assert.equal(loginAfterVerified.status, 200);

  const loginOverwrittenAttempt = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-OTHER-999' },
    body: JSON.stringify({ phone, password: 'PasswordGamma33', device_id: 'DEV-OTHER-999' })
  });
  assert.equal(loginOverwrittenAttempt.status, 401);
});

test('29. [Fix 3 Timing Parity] Login timing difference between existing and non-existing phone is < 3x', async () => {
  const measureAvgMs = async (targetPhone) => {
    // Warmup
    await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: targetPhone, password: 'WrongPassword99' })
    });
    const runs = 4;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      const r = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: targetPhone, password: 'WrongPassword99' })
      });
      assert.equal(r.status, 401);
    }
    return (performance.now() - start) / runs;
  };

  const existingAvg = await measureAvgMs('01099887766');
  const missingAvg = await measureAvgMs('01099776655');
  const ratio = Math.max(existingAvg, missingAvg) / Math.max(1, Math.min(existingAvg, missingAvg));
  assert.ok(ratio < 3, `Expected timing ratio < 3x, got ${ratio.toFixed(2)}x (existing=${existingAvg.toFixed(1)}ms, missing=${missingAvg.toFixed(1)}ms)`);
});

test('30. [Fix 4 Self-hosted pdf.js] Local pdf.js & worker served without cdnjs in CSP and PDF stream works', async () => {
  const jsRes = await fetch(`${baseUrl}/vendor/pdfjs/pdf.min.js`);
  assert.equal(jsRes.status, 200);
  const csp = jsRes.headers.get('content-security-policy') || '';
  assert.ok(!csp.includes('cdnjs.cloudflare.com'), `CSP should not reference cdnjs.cloudflare.com: ${csp}`);
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("worker-src 'self' blob:"));
  assert.ok(csp.includes("connect-src 'self'"));

  const workerRes = await fetch(`${baseUrl}/vendor/pdfjs/pdf.worker.min.js`);
  assert.equal(workerRes.status, 200);
  assert.match(workerRes.headers.get('content-type') || '', /javascript/);

  fs.mkdirSync(path.join(tempUploadsRoot, 'pdfs'), { recursive: true });
  fs.writeFileSync(path.join(tempUploadsRoot, 'pdfs', 'test_pdfjs_stream.pdf'), Buffer.from('%PDF-1.4\n%Test\n'));
  const lPdf = (await db.run(`
    INSERT INTO lessons (
      title, description, subject, grade, branch, unit_title, order_index,
      video_type, video_path, duration_minutes, pdf_title, pdf_path, pdf_content_json, is_published, created_at
    ) VALUES ('درس فحص PDF', '', 'fiqh', 'grade_3', 'both', 'باب', 99, 'upload', '', 10, 'مذكرة', 'uploads/pdfs/test_pdfjs_stream.pdf', '[]', 1, ?)
  `, [new Date().toISOString()]));

  const metaRes = await fetch(`${baseUrl}/api/stream/pdf/${lPdf.lastInsertRowid}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(metaRes.status, 200);
  const meta = await metaRes.json();
  assert.equal(meta.has_binary_pdf, true);

  const pdfFileRes = await fetch(`${baseUrl}/api/stream/pdf-file/${lPdf.lastInsertRowid}`, {
    headers: { 'Authorization': `Bearer ${adminToken}`, 'X-Stream-Ticket': meta.stream_ticket }
  });
  assert.equal(pdfFileRes.status, 200);
  assert.equal(pdfFileRes.headers.get('content-type'), 'application/pdf');
  const pdfText = await pdfFileRes.text();
  assert.ok(pdfText.startsWith('%PDF-'));
});

test('31. [Feature 7 Notifications] Targeted broadcasts, auto-alerts on lesson/exam/expiry, and per-student read state', async () => {
  const nowIso = new Date().toISOString();
  const soonIso = new Date(Date.now() + 2 * 86400000).toISOString(); // 2 days left -> triggers expiring notification
  const farIso = new Date(Date.now() + 25 * 86400000).toISOString();

  const g3Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب إشعارات ثالثة ثانوي', '01088112201', '01088112299', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-NOTIF-G3', ?, 'all', ?)
  `, [hashPassword('Pass123456'), soonIso, nowIso])).lastInsertRowid;

  const g2Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب إشعارات ثانية ثانوي', '01088112202', '01088112298', ?, 'student', 'grade_2', 'literary', 1, 'DEV-NOTIF-G2', ?, 'all', ?)
  `, [hashPassword('Pass123456'), farIso, nowIso])).lastInsertRowid;

  const g3User = (await db.get(`SELECT * FROM users WHERE id = ?`, [g3Id]));
  const g2User = (await db.get(`SELECT * FROM users WHERE id = ?`, [g2Id]));
  const g3Token = createToken(g3User);
  const g2Token = createToken(g2User);

  // Student cannot call admin notifications endpoint
  const forbidRes = await fetch(`${baseUrl}/api/admin/notifications`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${g3Token}`, 'X-Device-Id': 'DEV-NOTIF-G3', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'اختبار', body: 'رسالة' })
  });
  assert.equal(forbidRes.status, 403);

  // Admin sends grade_3 targeted notification
  const adminBroadcast = await fetch(`${baseUrl}/api/admin/notifications`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'تنبيه خاص بالصف الثالث',
      body: 'توجد مراجعة مهمة الليلة.',
      target_grade: 'grade_3',
      target_branch: 'all'
    })
  });
  assert.equal(adminBroadcast.status, 201);

  // Admin creates a published lesson -> triggers automatic notification for grade_3
  const createLessonRes = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'حصة الميراث التجريبية للإشعارات',
      description: 'شرح',
      subject: 'mawareeth',
      grade: 'grade_3',
      branch: 'both',
      unit_title: 'الباب الأول',
      order_index: 50,
      video_type: 'upload',
      is_published: true
    })
  });
  assert.equal(createLessonRes.status, 201);
  const createdLesson = await createLessonRes.json();

  // Admin creates active exam -> triggers automatic notification for grade_3
  const createExamRes = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lesson_id: createdLesson.lesson_id,
      title: 'امتحان الميراث الفوري',
      assessment_type: 'exam',
      time_limit_minutes: 20,
      questions: [
        { question_text: 'س؟', topic_tag: 'فروض', options: ['أ', 'ب'], correct_option: 'أ', explanation: 'ت', points: 2 }
      ]
    })
  });
  assert.equal(createExamRes.status, 201);

  // Calling dashboard triggers <=3-day expiry auto-notification for g3User
  const dashRes = await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${g3Token}`, 'X-Device-Id': 'DEV-NOTIF-G3' }
  });
  assert.equal(dashRes.status, 200);

  const g3NotifsRes = await fetch(`${baseUrl}/api/student/notifications`, {
    headers: { 'Authorization': `Bearer ${g3Token}`, 'X-Device-Id': 'DEV-NOTIF-G3' }
  });
  assert.equal(g3NotifsRes.status, 200);
  const g3Notifs = await g3NotifsRes.json();
  assert.ok(g3Notifs.unread_count >= 4, `Expected >=4 unread notifs, got ${g3Notifs.unread_count}`);
  const titles = g3Notifs.notifications.map((n) => n.title);
  assert.ok(titles.some((t) => t.includes('تنبيه خاص بالصف الثالث')));
  assert.ok(titles.some((t) => t.includes('حصة الميراث التجريبية للإشعارات')));
  assert.ok(titles.some((t) => t.includes('قرب انتهاء اشتراكك')));

  // Grade 2 student must NOT receive Grade 3 targeted or expiring notification
  const g2NotifsRes = await fetch(`${baseUrl}/api/student/notifications`, {
    headers: { 'Authorization': `Bearer ${g2Token}`, 'X-Device-Id': 'DEV-NOTIF-G2' }
  });
  assert.equal(g2NotifsRes.status, 200);
  const g2Notifs = await g2NotifsRes.json();
  assert.equal(g2Notifs.notifications.some((n) => n.title.includes('تنبيه خاص بالصف الثالث')), false);

  // Mark all read for grade 3 student -> unread_count becomes 0
  const markRes = await fetch(`${baseUrl}/api/student/notifications/read`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${g3Token}`, 'X-Device-Id': 'DEV-NOTIF-G3', 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(markRes.status, 200);
  const marked = await markRes.json();
  assert.equal(marked.unread_count, 0);
});

test('32. [Feature 8 Live Sessions] Strict gating by subscription, grade/branch, and time window + attendance tracking', async () => {
  const nowMs = Date.now();
  const activeStart = new Date(nowMs - 2 * 60000).toISOString();
  const futureStart = new Date(nowMs + 3 * 3600000).toISOString();
  const futureSub = new Date(nowMs + 30 * 86400000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const subId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب بث مشترك متاح', '01088223301', '01088223399', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-LIVE-SUB', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;

  const unsubId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب بث غير مشترك', '01088223302', '01088223398', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-LIVE-UNSUB', NULL, '', ?)
  `, [hashPassword('Pass123456'), nowIso])).lastInsertRowid;

  const subToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [subId])));
  const unsubToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [unsubId])));

  // Admin schedules 2 live sessions: one live now, one starting 3h later
  const liveNowRes = await fetch(`${baseUrl}/api/admin/live-sessions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'مراجعة فقه مباشر الآن',
      subject: 'fiqh',
      grade: 'grade_3',
      branch: 'scientific',
      provider: 'youtube',
      stream_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      starts_at: activeStart,
      duration_minutes: 60,
      join_early_minutes: 15,
      status: 'live'
    })
  });
  assert.equal(liveNowRes.status, 201);
  const liveNowData = await liveNowRes.json();

  const futureRes = await fetch(`${baseUrl}/api/admin/live-sessions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'حصة قادمة بعد 3 ساعات',
      subject: 'fiqh',
      grade: 'grade_3',
      branch: 'both',
      provider: 'zoom',
      stream_url: 'https://zoom.us/j/123456789',
      starts_at: futureStart,
      duration_minutes: 60,
      join_early_minutes: 15,
      status: 'scheduled'
    })
  });
  assert.equal(futureRes.status, 201);
  const futureData = await futureRes.json();

  // Unsubscribed student sees sessions list ONLY with stream_url = null and cannot join
  const unsubListRes = await fetch(`${baseUrl}/api/student/live-sessions`, {
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-LIVE-UNSUB' }
  });
  assert.equal(unsubListRes.status, 200);
  const unsubList = await unsubListRes.json();
  const sUnsub = unsubList.sessions.find((s) => s.id === liveNowData.session_id);
  assert.ok(sUnsub);
  assert.equal(sUnsub.can_join, false);
  assert.equal(sUnsub.stream_url, null);

  const unsubJoinRes = await fetch(`${baseUrl}/api/student/live-sessions/${liveNowData.session_id}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-LIVE-UNSUB' }
  });
  assert.equal(unsubJoinRes.status, 403);

  // Subscribed student cannot join session starting 3 hours later (stream_url must stay hidden)
  const subListRes = await fetch(`${baseUrl}/api/student/live-sessions`, {
    headers: { 'Authorization': `Bearer ${subToken}`, 'X-Device-Id': 'DEV-LIVE-SUB' }
  });
  assert.equal(subListRes.status, 200);
  const subList = await subListRes.json();
  const futureSession = subList.sessions.find((s) => s.id === futureData.session_id);
  const activeSession = subList.sessions.find((s) => s.id === liveNowData.session_id);
  assert.equal(futureSession.can_join, false);
  assert.equal(futureSession.stream_url, null);
  assert.equal(activeSession.can_join, true);
  assert.equal(activeSession.stream_url, null);

  // Join active session -> logs attendance
  const joinRes = await fetch(`${baseUrl}/api/student/live-sessions/${liveNowData.session_id}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${subToken}`, 'X-Device-Id': 'DEV-LIVE-SUB' }
  });
  assert.equal(joinRes.status, 200);
  const joinData = await joinRes.json();
  assert.equal(joinData.joined, true);
  assert.equal(joinData.stream_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  // After attendance is logged, list reveals stream_url
  const subListAfter = await (await fetch(`${baseUrl}/api/student/live-sessions`, {
    headers: { 'Authorization': `Bearer ${subToken}`, 'X-Device-Id': 'DEV-LIVE-SUB' }
  })).json();
  const afterSession = subListAfter.sessions.find((s) => s.id === liveNowData.session_id);
  assert.equal(afterSession.attended, true);
  assert.equal(afterSession.stream_url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  // Admin checks attendance report
  const attRes = await fetch(`${baseUrl}/api/admin/live-sessions/${liveNowData.session_id}/attendance`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(attRes.status, 200);
  const att = await attRes.json();
  assert.equal(att.attendees.length, 1);
  assert.equal(att.attendees[0].phone, '01088223301');
});

test('33. [Features 3,4,6,9] Service Worker, modular ES frontend, no hardcoded WhatsApp, and Bunny endpoint validation', async () => {
  const indexRes = await fetch(`${baseUrl}/`);
  assert.equal(indexRes.status, 200);
  const html = await indexRes.text();
  assert.ok(!html.includes('201026379242'), 'index.html must NOT contain hardcoded WhatsApp support number');
  assert.ok(html.includes('/js/main.js'), 'index.html should load modular ES entrypoint /js/main.js');

  const swRes = await fetch(`${baseUrl}/sw.js`);
  assert.equal(swRes.status, 200);
  const swText = await swRes.text();
  assert.ok(swText.includes('APP_SHELL_ASSETS'));
  assert.ok(swText.includes("url.pathname.startsWith('/api/')"));

  const modRes = await fetch(`${baseUrl}/js/main.js`);
  assert.equal(modRes.status, 200);
  assert.match(modRes.headers.get('content-type') || '', /javascript/);

  const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(overviewRes.status, 200);
  const overview = await overviewRes.json();
  assert.ok(Array.isArray(overview.live_sessions));
  assert.ok(Array.isArray(overview.notifications));

  // Non-admin rejected on Bunny upload; admin returns 400 when Bunny env keys are unset
  const bunnyRes = await fetch(`${baseUrl}/api/admin/bunny/upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'X-File-Name': 'test.mp4' },
    body: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
  });
  assert.equal(bunnyRes.status, 400);
});

test('34. [Feature 5] setup-env.js generates secure random JWT & stream secrets without overwriting defaults', () => {
  const { execFileSync } = require('node:child_process');
  const tmpEnv = path.join(os.tmpdir(), `matn-test-env-${Date.now()}.env`);
  try {
    execFileSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'setup-env.js'),
      `--out=${tmpEnv}`,
      '--domain=matn-test.example.com',
      '--yes'
    ], { stdio: 'pipe' });
    const content = fs.readFileSync(tmpEnv, 'utf8');
    assert.ok(content.includes('NODE_ENV=production'));
    assert.ok(content.includes('CORS_ALLOWED_ORIGINS=https://matn-test.example.com'));
    const jwtMatch = content.match(/^JWT_SECRET=([a-f0-9]+)$/m);
    const streamMatch = content.match(/^STREAM_TICKET_SECRET=([a-f0-9]+)$/m);
    assert.ok(jwtMatch && jwtMatch[1].length >= 64);
    assert.ok(streamMatch && streamMatch[1].length >= 64);
    assert.notEqual(jwtMatch[1], streamMatch[1]);
  } finally {
    try { fs.unlinkSync(tmpEnv); } catch {}
  }
});

test('35. [Feature 4 Lesson Notes] Access control, per-student isolation, and timestamped notes CRUD', async () => {
  const nowIso = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();

  const lNoteRes = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'درس الملاحظات الزمنية',
      description: 'شرح',
      subject: 'seerah',
      grade: 'prep_2',
      branch: 'general',
      unit_title: 'وحدة الملاحظات',
      order_index: 1,
      video_type: 'upload',
      is_published: true
    })
  });
  assert.equal(lNoteRes.status, 201);
  const { lesson_id: lessonId } = await lNoteRes.json();

  const s1Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب ملاحظات أول', '01077112201', '01077112299', ?, 'student', 'prep_2', 'general', 1, 'DEV-NOTE-1', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;

  const s2Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب ملاحظات ثاني', '01077112202', '01077112298', ?, 'student', 'prep_2', 'general', 1, 'DEV-NOTE-2', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;

  const unsubId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب ملاحظات غير مشترك', '01077112203', '01077112297', ?, 'student', 'prep_2', 'general', 1, 'DEV-NOTE-3', NULL, '', ?)
  `, [hashPassword('Pass123456'), nowIso])).lastInsertRowid;

  const s1Token = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [s1Id])));
  const s2Token = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [s2Id])));
  const unsubToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [unsubId])));

  // Unsubscribed student is blocked (403)
  const unsubGet = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-NOTE-3' }
  });
  assert.equal(unsubGet.status, 403);

  const unsubPost = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${unsubToken}`, 'X-Device-Id': 'DEV-NOTE-3', 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp_seconds: 30, note_text: 'محاولة غير مصرح بها' })
  });
  assert.equal(unsubPost.status, 403);

  // Student 1 validates length and creates a timestamped note
  const badNoteRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${s1Token}`, 'X-Device-Id': 'DEV-NOTE-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp_seconds: 10, note_text: 'أ' })
  });
  assert.equal(badNoteRes.status, 400);

  const addRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${s1Token}`, 'X-Device-Id': 'DEV-NOTE-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ timestamp_seconds: 125, note_text: 'نقطة فقهية مهمة عند الدقيقة الثانية' })
  });
  assert.equal(addRes.status, 201);
  const added = await addRes.json();
  assert.equal(added.note.timestamp_seconds, 125);

  // Student 2 must NOT see Student 1's note or delete it
  const s2ListRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    headers: { 'Authorization': `Bearer ${s2Token}`, 'X-Device-Id': 'DEV-NOTE-2' }
  });
  assert.equal(s2ListRes.status, 200);
  const s2List = await s2ListRes.json();
  assert.equal(s2List.notes.length, 0);

  const s2DelRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes/${added.note.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${s2Token}`, 'X-Device-Id': 'DEV-NOTE-2' }
  });
  assert.equal(s2DelRes.status, 403);

  // Student 1 sees and deletes their own note
  const s1ListRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes`, {
    headers: { 'Authorization': `Bearer ${s1Token}`, 'X-Device-Id': 'DEV-NOTE-1' }
  });
  const s1List = await s1ListRes.json();
  assert.equal(s1List.notes.length, 1);

  const s1DelRes = await fetch(`${baseUrl}/api/lessons/${lessonId}/notes/${added.note.id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${s1Token}`, 'X-Device-Id': 'DEV-NOTE-1' }
  });
  assert.equal(s1DelRes.status, 200);
});

test('36. [Features 6,8,9 & SEO] Mistake Bank privacy/filtering, Gamification streak/badges, Admin analytics, and SEO/OG tags', async () => {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const futureSub = new Date(nowMs + 30 * 86400000).toISOString();
  const futureEnd = new Date(nowMs + 2 * 3600000).toISOString();

  // Set azhar_exam_date via admin settings
  const setRes = await fetch(`${baseUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ azhar_exam_date: '2027-06-01' })
  });
  assert.equal(setRes.status, 200);

  const lRes = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'درس بنك الأخطاء',
      description: 'وصف',
      subject: 'tafseer',
      grade: 'grade_3',
      branch: 'both',
      unit_title: 'وحدة التفسير',
      order_index: 80,
      video_type: 'upload',
      is_published: true
    })
  });
  const { lesson_id: lessonId } = await lRes.json();

  // 1) Scheduled exam with future scheduled_end (review must remain hidden!)
  const lockedExamRes = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lesson_id: lessonId,
      title: 'امتحان محجوب المراجعة',
      assessment_type: 'exam',
      time_limit_minutes: 15,
      scheduled_end: futureEnd,
      questions: [
        { question_text: 'سؤال سري في التفسير؟', topic_tag: 'السور', options: ['صحيح', 'خاطئ'], correct_option: 'صحيح', explanation: 'توضيح', points: 2 }
      ]
    })
  });
  const { assessment_id: lockedExamId } = await lockedExamRes.json();

  // 2) Homework (immediately reviewable)
  const hwRes = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lesson_id: lessonId,
      title: 'واجب بنك الأخطاء',
      assessment_type: 'homework',
      time_limit_minutes: 15,
      questions: [
        { question_text: 'ما معنى الفلق؟', topic_tag: 'الغريب', options: ['الصبح', 'المغرب'], correct_option: 'الصبح', explanation: 'الفلق هو الصبح.', points: 2 }
      ]
    })
  });
  const { assessment_id: hwId } = await hwRes.json();

  const stuId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب بنك الأخطاء', '01077223301', '01077223399', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-MISTAKE-1', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;
  const stuToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [stuId])));

  // Start & wrongly answer the locked exam -> Mistake Bank MUST NOT expose it yet
  const startLocked = await (await fetch(`${baseUrl}/api/assessments/${lockedExamId}/start`, {
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1' }
  })).json();
  assert.ok(startLocked.assessment.session_id);

  await fetch(`${baseUrl}/api/assessments/${lockedExamId}/submit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: { [startLocked.questions[0].id]: 'خاطئ' } })
  });

  const mistakesBeforeRes = await fetch(`${baseUrl}/api/student/mistakes`, {
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1' }
  });
  const mistakesBefore = await mistakesBeforeRes.json();
  assert.equal(mistakesBefore.mistakes.some((m) => m.question_text.includes('سؤال سري')), false);

  // Start & wrongly answer homework -> Mistake Bank reveals it cleanly + filters by subject
  const startHw = await (await fetch(`${baseUrl}/api/assessments/${hwId}/start`, {
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1' }
  })).json();
  await fetch(`${baseUrl}/api/assessments/${hwId}/submit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: { [startHw.questions[0].id]: 'المغرب' } })
  });

  const mistakesAfter = await (await fetch(`${baseUrl}/api/student/mistakes?subject=tafseer`, {
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1' }
  })).json();
  assert.equal(mistakesAfter.total_count, 1);
  assert.equal(mistakesAfter.mistakes[0].correct_option, 'الصبح');
  assert.ok(mistakesAfter.mistakes[0].explanation.includes('الصبح'));

  // Dashboard returns gamification streak, badges, and azhar_exam_date
  const dash = await (await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${stuToken}`, 'X-Device-Id': 'DEV-MISTAKE-1' }
  })).json();
  assert.ok(Number(dash.study_streak) >= 1);
  assert.ok(Array.isArray(dash.badges) && dash.badges.length >= 4);
  assert.equal(dash.azhar_exam_date, '2027-06-01');

  // Admin overview includes analytics + most_missed_questions
  const overview = await (await fetch(`${baseUrl}/api/admin/overview`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  })).json();
  assert.ok(overview.analytics);
  assert.ok(typeof overview.analytics.active_subscriptions_count === 'number');
  assert.ok(Array.isArray(overview.analytics.most_missed_questions));
  assert.ok(overview.analytics.most_missed_questions.some((mq) => mq.question_text.includes('الفلق')));

  // SEO / Open Graph / Twitter Cards check in index.html
  const html = await (await fetch(`${baseUrl}/`)).text();
  assert.ok(html.includes('name="description"'));
  assert.ok(html.includes('property="og:title"'));
  assert.ok(html.includes('property="og:image" content="/assets/icon-512.png"'));
  assert.ok(html.includes('property="og:locale" content="ar_EG"'));
  assert.ok(html.includes('name="twitter:card"'));
});

test('37. [Quick Hardening Fixes] Auth-gated /api/security/report allowlist + 5/10m limit & bounded rateLimitStore cap', async () => {
  // 1) Unauthenticated request must return 401
  const anonRes = await fetch(`${baseUrl}/api/security/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: 'UI_DETERRENT', details: 'test' })
  });
  assert.equal(anonRes.status, 401);

  const nowIso = new Date().toISOString();
  const sId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, created_at
    ) VALUES ('طالب تقارير أمنية', '01077334401', '01077334499', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-SECREP-1', ?)
  `, [hashPassword('Pass123456'), nowIso])).lastInsertRowid;
  const sToken = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [sId])));

  const sId2 = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, created_at
    ) VALUES ('طالب تقارير أمنية ثاني', '01077334402', '01077334498', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-SECREP-2', ?)
  `, [hashPassword('Pass123456'), nowIso])).lastInsertRowid;
  const sToken2 = createToken((await db.get(`SELECT * FROM users WHERE id = ?`, [sId2])));

  // 2) Unknown event_type rejected with 400
  const badRes = await fetch(`${baseUrl}/api/security/report`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${sToken2}`, 'X-Device-Id': 'DEV-SECREP-2', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: 'FAKE_ARBITRARY_EVENT', details: 'test' })
  });
  assert.equal(badRes.status, 400);

  // 3) Allowlisted event_type allowed 5 times, 6th returns 429
  for (let i = 0; i < 5; i++) {
    const okRes = await fetch(`${baseUrl}/api/security/report`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sToken}`, 'X-Device-Id': 'DEV-SECREP-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'UI_DETERRENT', details: `d${i}` })
    });
    assert.equal(okRes.status, 200);
  }
  const throttledRes = await fetch(`${baseUrl}/api/security/report`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${sToken}`, 'X-Device-Id': 'DEV-SECREP-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_type: 'UI_DETERRENT', details: 'over-limit' })
  });
  assert.equal(throttledRes.status, 429);

  // 4) rateLimitStore respects MAX_RATE_LIMIT_KEYS (50000) under flood
  const { rateLimitStore, MAX_RATE_LIMIT_KEYS, checkRateLimit } = require('../middleware/security');
  assert.equal(MAX_RATE_LIMIT_KEYS, 50000);
  rateLimitStore.clear();
  for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 25; i++) {
    checkRateLimit(`flood_key_${i}`, 5, 60000);
  }
  assert.equal(rateLimitStore.size, MAX_RATE_LIMIT_KEYS);
  assert.equal(rateLimitStore.has('flood_key_0'), false);
  rateLimitStore.clear();
});

test('38. [Hostinger MySQL Readiness] Async DB adapter, pool limits, real TX commit/rollback, InnoDB utf8mb4 schema & Hostinger config', async () => {
  const { createDatabaseConnection, resolveDbClient, buildMysqlPoolConfig, splitSqlStatements } = require('../db/adapter');
  const { MYSQL_MIGRATIONS } = require('../db/migrations');
  const pkg = require('../package.json');

  // 1) package.json & Hostinger default DB resolution
  assert.equal(pkg.engines.node, '>=20.0.0');
  assert.ok(pkg.dependencies.mysql2);
  const envCopy = {
    NODE_ENV: process.env.NODE_ENV,
    DB_CLIENT: process.env.DB_CLIENT,
    DB_POOL_LIMIT: process.env.DB_POOL_LIMIT,
    DB_SSL: process.env.DB_SSL,
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT
  };
  try {
    delete process.env.DB_CLIENT;
    process.env.NODE_ENV = 'production';
    assert.equal(resolveDbClient(), 'mysql');
    process.env.NODE_ENV = 'development';
    assert.equal(resolveDbClient(), 'sqlite');
    process.env.DB_CLIENT = 'mysql';
    assert.equal(resolveDbClient(), 'mysql');

    // Pool limits capped safely below Hostinger 75-connection plan limit
    delete process.env.DB_POOL_LIMIT;
    delete process.env.DB_SSL;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    const defPool = buildMysqlPoolConfig();
    assert.equal(defPool.host, '127.0.0.1');
    assert.equal(defPool.port, 3306);
    assert.equal(defPool.connectionLimit, 12);
    assert.equal(defPool.connectTimeout, 10000);
    assert.equal(defPool.idleTimeout, 60000);
    assert.equal(defPool.decimalNumbers, true);
    assert.equal(defPool.waitForConnections, true);
    assert.equal(defPool.queueLimit, 200);
    assert.equal(defPool.charset, 'utf8mb4');
    assert.equal(defPool.timezone, 'Z');
    assert.equal(defPool.enableKeepAlive, true);
    assert.equal(defPool.multipleStatements, false);
    assert.equal(defPool.ssl, undefined);

    process.env.DB_POOL_LIMIT = '120';
    process.env.DB_SSL = 'true';
    const cappedPool = buildMysqlPoolConfig();
    assert.equal(cappedPool.connectionLimit, 50);
    assert.ok(cappedPool.ssl && cappedPool.ssl.rejectUnauthorized === true);
  } finally {
    for (const [k, v] of Object.entries(envCopy)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  // 2) Mocked mysql2/promise Pool verifying CRUD normalization, DDL splitting, and TX commit/rollback
  const calls = [];
  let closed = false;
  const mockConn = {
    async beginTransaction() { calls.push('TX_BEGIN'); },
    async commit() { calls.push('TX_COMMIT'); },
    async rollback() { calls.push('TX_ROLLBACK'); },
    release() { calls.push('TX_RELEASE'); },
    async execute(sql, params) {
      calls.push({ kind: 'tx_exec', sql, params });
      return [{ affectedRows: 1, insertId: 77 }];
    },
    async query(sql) {
      calls.push({ kind: 'tx_query', sql });
      return [[]];
    }
  };
  const mockPool = {
    async execute(sql, params) {
      calls.push({ kind: 'pool_exec', sql, params });
      if (sql.includes('SELECT')) return [[{ id: 1, ok: 1 }]];
      return [{ affectedRows: 2, insertId: 55 }];
    },
    async query(sql) {
      calls.push({ kind: 'pool_query', sql });
      return [[]];
    },
    async getConnection() {
      return mockConn;
    },
    async end() {
      closed = true;
    }
  };

  const mysqlDb = createDatabaseConnection(null, { client: 'mysql', mysqlPool: mockPool });
  assert.equal(mysqlDb.isMysql, true);
  assert.equal(mysqlDb.client, 'mysql');
  assert.equal(mysqlDb.forUpdate(), 'FOR UPDATE');
  assert.equal(mysqlDb.insertIgnorePrefix(), 'INSERT IGNORE INTO');

  const row = await mysqlDb.get('SELECT 1 AS ok WHERE x = ? AND y = ?', [undefined, true]);
  assert.equal(row.ok, 1);
  assert.deepEqual(calls[0].params, [null, 1]);

  const insRes = await mysqlDb.run('INSERT INTO test (a, b) VALUES (?, ?)', [false, 'ok']);
  assert.deepEqual(insRes, { changes: 2, lastInsertRowid: 55 });

  await mysqlDb.exec(`
    /* block ; comment */
    CREATE TABLE t1 (a VARCHAR(10) DEFAULT 'a;b\\'c');
    # hash ; line comment
    CREATE TABLE t2 (id INT);
  `);
  const ddlQueries = calls.filter((c) => c.kind === 'pool_query').map((c) => c.sql);
  assert.equal(ddlQueries.length, 2);
  assert.ok(ddlQueries[0].includes("DEFAULT 'a;b\\'c'"));
  assert.equal(splitSqlStatements("/* ; */ SELECT 1; # ;\nSELECT 'x\\';y';").length, 2);

  const txVal = await mysqlDb.transaction(async (tx) => {
    await tx.run('UPDATE vouchers SET is_used = 1 WHERE id = ?', [9]);
    return 'committed_ok';
  });
  assert.equal(txVal, 'committed_ok');
  assert.ok(calls.includes('TX_BEGIN') && calls.includes('TX_COMMIT') && calls.includes('TX_RELEASE'));

  await assert.rejects(
    mysqlDb.transaction(async (tx) => {
      await tx.run('UPDATE vouchers SET is_used = 1 WHERE id = ?', [10]);
      throw new Error('SIMULATED_TX_FAIL');
    }),
    /SIMULATED_TX_FAIL/
  );
  assert.ok(calls.includes('TX_ROLLBACK'));

  await mysqlDb.close();
  assert.equal(closed, true);

  // 3) Validate MySQL DDL migrations & backtick quoting of `key`
  const combinedMysqlSql = MYSQL_MIGRATIONS.map((m) => m.sql || '').join('\n');
  assert.ok(!/PRAGMA\b/i.test(combinedMysqlSql));
  assert.ok(!/\bAUTOINCREMENT\b/i.test(combinedMysqlSql));
  assert.ok(!/\bON CONFLICT\b/i.test(combinedMysqlSql));
  assert.ok(!/INSERT OR IGNORE/i.test(combinedMysqlSql));
  assert.ok(combinedMysqlSql.includes('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'));
  assert.ok(combinedMysqlSql.includes('started_at BIGINT NOT NULL'));
  assert.ok(combinedMysqlSql.includes('`key` VARCHAR(191) PRIMARY KEY'));

  // 4) Node 20 without node:sqlite works in mysql mode (Preflight simulation check)
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(serverSrc.includes("if (nodeMajor < 20)"));
  assert.ok(serverSrc.includes("if (resolveDbClient() === 'sqlite')"));
});

test('39. [Phase 1.1] OTP purpose separation blocks password_reset OTP in verify-otp, enforces device match, and clears login_attempts on password reset', async () => {
  const nowIso = new Date().toISOString();
  const phone = '01091112201';
  const otpRaw = '774411';
  const expIso = new Date(Date.now() + 600000).toISOString();

  // Verified student receives password_reset OTP -> /verify-otp must REJECT with 400 (cannot get JWT or bypass device)
  await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_purpose, otp_attempts,
      device_id, device_name, created_at
    ) VALUES ('طالب استعادة أمان', ?, '01091112299', ?, 'student', 'grade_3', 'scientific', 1, ?, ?, 'password_reset', 0, 'DEV-ORIG-39', 'Orig', ?)
  `, [phone, hashPassword('OldPass123!'), hashOtp(otpRaw), expIso, nowIso]);

  const resAttack = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-ATK-39' },
    body: JSON.stringify({ phone, otp_code: otpRaw })
  });
  assert.equal(resAttack.status, 400);

  // Admin account with password_reset OTP -> /verify-otp must REJECT
  await db.run(
    `UPDATE users SET whatsapp_otp_hash = ?, whatsapp_otp_expires = ?, otp_purpose = 'password_reset', otp_attempts = 0 WHERE id = ?`,
    [hashOtp('998877'), expIso, adminUser.id]
  );
  const resAdminAttack = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-ATK-ADMIN' },
    body: JSON.stringify({ phone: adminUser.phone, otp_code: '998877' })
  });
  assert.equal(resAdminAttack.status, 400);
  await db.run(`UPDATE users SET whatsapp_otp_hash = NULL, whatsapp_otp_expires = NULL, otp_purpose = NULL WHERE id = ?`, [adminUser.id]);

  // Unverified student with register OTP on wrong device -> 403 DEVICE_LOCKED
  const phone2 = '01091112202';
  await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires, otp_purpose, otp_attempts,
      device_id, device_name, created_at
    ) VALUES ('طالب تفعيل جهاز مقيد', ?, '01091112298', ?, 'student', 'grade_3', 'scientific', 0, ?, ?, 'register', 0, 'DEV-REG-39', 'RegDev', ?)
  `, [phone2, hashPassword('RegPass123!'), hashOtp('112233'), expIso, nowIso]);

  const resWrongDev = await fetch(`${baseUrl}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-OTHER-39' },
    body: JSON.stringify({ phone: phone2, otp_code: '112233' })
  });
  assert.equal(resWrongDev.status, 403);
  assert.equal((await resWrongDev.json()).error_code, 'DEVICE_LOCKED');

  // Locked IP+phone login_attempts must clear on /api/auth/reset-password
  await db.run(
    `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until) VALUES ('127.0.0.1', ?, 0, ?, ?)`,
    [phone, nowIso, new Date(Date.now() + 1800000).toISOString()]
  );
  const resReset = await fetch(`${baseUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, otp_code: otpRaw, new_password: 'NewUnlockedPass99!' })
  });
  assert.equal(resReset.status, 200);
  const remLock = await db.all(`SELECT * FROM login_attempts WHERE phone = ?`, [phone]);
  assert.equal(remLock.length, 0);

  const resLoginAfter = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'DEV-ORIG-39' },
    body: JSON.stringify({ phone, password: 'NewUnlockedPass99!' })
  });
  assert.equal(resLoginAfter.status, 200);
});

test('40. [Phase 1.2] Transitive prerequisite gating blocks Lesson 3 when Lesson 1 has unpassed exam & matches dashboard', async () => {
  const nowIso = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();
  const stId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب تسلسل المحاضرات الكامل', '01092223301', '01092223399', ?, 'student', 'prep_2', 'general', 1, 'DEV-TRANS-40', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;
  const stToken = createToken(await db.get(`SELECT * FROM users WHERE id = ?`, [stId]));

  // Create L1 (has active exam), L2 (no assessments), L3 in prep_2 seerah
  const l1 = (await db.run(`
    INSERT INTO lessons (title, description, subject, grade, branch, unit_title, order_index, is_published, created_at)
    VALUES ('سيرة ١', 'د', 'seerah', 'prep_2', 'general', 'الوحدة', 1, 1, ?)
  `, [nowIso])).lastInsertRowid;
  const ex1 = (await db.run(`
    INSERT INTO assessments (lesson_id, title, assessment_type, time_limit_minutes, is_active, created_at)
    VALUES (?, 'امتحان سيرة ١', 'exam', 15, 1, ?)
  `, [l1, nowIso])).lastInsertRowid;
  await db.run(`INSERT INTO questions (assessment_id, question_text, topic_tag, options_json, correct_option, explanation, points) VALUES (?, 'س؟', 'مبحث', '["أ","ب"]', 'أ', 'ت', 2)`, [ex1]);

  const l2 = (await db.run(`
    INSERT INTO lessons (title, description, subject, grade, branch, unit_title, order_index, is_published, created_at)
    VALUES ('سيرة ٢ بدون اختبار', 'د', 'seerah', 'prep_2', 'general', 'الوحدة', 2, 1, ?)
  `, [nowIso])).lastInsertRowid;
  const l3 = (await db.run(`
    INSERT INTO lessons (title, description, subject, grade, branch, unit_title, order_index, is_published, created_at)
    VALUES ('سيرة ٣', 'د', 'seerah', 'prep_2', 'general', 'الوحدة', 3, 1, ?)
  `, [nowIso])).lastInsertRowid;

  const tktL3Blocked = await fetch(`${baseUrl}/api/media/ticket/${l3}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-TRANS-40' }
  });
  assert.equal(tktL3Blocked.status, 403);

  const dashBlocked = await (await fetch(`${baseUrl}/api/student/dashboard`, {
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-TRANS-40' }
  })).json();
  const dashL2 = dashBlocked.lessons.find((x) => x.id === l2);
  const dashL3 = dashBlocked.lessons.find((x) => x.id === l3);
  assert.equal(dashL2.unlocked, false);
  assert.equal(dashL3.unlocked, false);

  // Pass L1 exam -> L2 and L3 unlock
  await db.run(
    `INSERT INTO submissions (user_id, lesson_id, assessment_id, assessment_type, score, total_points, percentage, passed, answers_json, weak_topics_json, strong_topics_json, time_spent_seconds, submitted_at)
     VALUES (?, ?, ?, 'exam', 2, 2, 100, 1, '[]', '[]', '[]', 10, ?)`,
    [stId, l1, ex1, nowIso]
  );
  const tktL3Open = await fetch(`${baseUrl}/api/media/ticket/${l3}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-TRANS-40' }
  });
  assert.equal(tktL3Open.status, 200);
});

test('41. [Phase 1.3] Voucher subject-grade compatibility, per-subject duration isolation, and assign conflict 409', async () => {
  const nowIso = new Date().toISOString();
  const g1Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscribed_subjects, created_at
    ) VALUES ('طالب اولى ثانوي فحص كود', '01093334401', '01093334499', ?, 'student', 'grade_1', 'scientific', 1, 'DEV-G1-41', '', ?)
  `, [hashPassword('Pass123456'), nowIso])).lastInsertRowid;
  const g1Token = createToken(await db.get(`SELECT * FROM users WHERE id = ?`, [g1Id]));

  // Create mawareeth voucher with grade_scope = 'all' -> grade_1 student cannot redeem or burn it
  const vMaw = 'MATN-30D-MAW41TEST01';
  await db.run(
    `INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, created_at)
     VALUES (?, 'مواريث', 30, 'mawareeth', 'all', 100, 0, ?)`,
    [vMaw, nowIso]
  );
  const resIncompat = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${g1Token}`, 'X-Device-Id': 'DEV-G1-41' },
    body: JSON.stringify({ code: vMaw })
  });
  assert.equal(resIncompat.status, 400);
  assert.equal((await db.get(`SELECT is_used FROM vouchers WHERE code = ?`, [vMaw])).is_used, 0);

  // Two distinct 30-day subjects (fiqh & tafseer) must NOT stack to 60 days
  const vFiqh = 'MATN-30D-FIQH41TEST1';
  const vTafs = 'MATN-30D-TAFS41TEST1';
  const vAll = 'MATN-15D-ALL41TEST01';
  await db.run(`INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, created_at) VALUES (?, 'ب', 30, 'fiqh', 'grade_1', 50, 0, ?)`, [vFiqh, nowIso]);
  await db.run(`INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, created_at) VALUES (?, 'ب', 30, 'tafseer', 'grade_1', 50, 0, ?)`, [vTafs, nowIso]);
  await db.run(`INSERT INTO vouchers (code, batch_name, duration_days, subject_scope, grade_scope, price_egp, is_used, created_at) VALUES (?, 'ب', 15, 'all', 'grade_1', 150, 0, ?)`, [vAll, nowIso]);

  const r1 = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${g1Token}`, 'X-Device-Id': 'DEV-G1-41' },
    body: JSON.stringify({ code: vFiqh })
  });
  assert.equal(r1.status, 200);
  const r2 = await fetch(`${baseUrl}/api/vouchers/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${g1Token}`, 'X-Device-Id': 'DEV-G1-41' },
    body: JSON.stringify({ code: vTafs })
  });
  assert.equal(r2.status, 200);
  const uAfterTwo = await db.get(`SELECT subscription_expires_at, subscribed_subjects FROM users WHERE id = ?`, [g1Id]);
  const daysTotal = (new Date(uAfterTwo.subscription_expires_at).getTime() - Date.now()) / 86400000;
  assert.ok(daysTotal < 31 && daysTotal >= 29, `Expected ~30 days max without inflation, got ${daysTotal}`);
  assert.ok(uAfterTwo.subscribed_subjects.includes('fiqh') && uAfterTwo.subscribed_subjects.includes('tafseer'));

  // Redeeming used voucher fails cleanly; assign on newly used returns 400
  const usedV = await db.get(`SELECT id FROM vouchers WHERE code = ?`, [vFiqh]);
  const assignUsed = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ voucher_id: usedV.id, recipient_name: 'طالب', recipient_phone: '01093334401' })
  });
  assert.ok([400, 409].includes(assignUsed.status));
});

test('42. [Phase 1.4] IP spoofing validation, empty/bad scrypt hashes, JWT pre-signature verify & request-device-reset brute protection', async () => {
  const { getClientIp } = require('../middleware/security');
  const { verifyToken } = require('../middleware/auth');
  const { verifyPassword } = require('../database');

  // IP spoofing rejected when socket is external or malformed header
  const spoofReq = {
    headers: { 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '1.1.1.1' },
    socket: { remoteAddress: '41.20.30.40' }
  };
  assert.equal(getClientIp(spoofReq), '41.20.30.40');
  const badIpReq = {
    headers: { 'x-forwarded-for': 'not-an-ip-$$$' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  assert.equal(getClientIp(badIpReq), '127.0.0.1');

  // Empty/malformed hash rejected
  assert.equal(verifyPassword('any', '').valid, false);
  assert.equal(verifyPassword('any', 'scrypt:16384:8:1:saltsalt:short').valid, false);

  // JWT invalid signature rejected
  assert.equal(verifyToken('eyJbad.eyJbad.badSig'), null);

  // request-device-reset rate limits and locks after wrong attempts
  const rPhone = '01094445501';
  await db.run(
    `INSERT INTO users (full_name, phone, parent_phone, password_hash, role, grade, branch, is_whatsapp_verified, device_id, created_at)
     VALUES ('طالب اختبار فك الجهاز', ?, '01094445599', ?, 'student', 'grade_3', 'scientific', 1, 'DEV-RST-42', ?)`,
    [rPhone, hashPassword('ValidReset123!'), new Date().toISOString()]
  );
  await db.run(
    `INSERT INTO login_attempts (ip_address, phone, failed_attempts, last_failed_at, locked_until) VALUES ('::ffff:127.0.0.1', ?, 9, ?, NULL), ('127.0.0.1', ?, 9, ?, NULL)`,
    [rPhone, new Date().toISOString(), rPhone, new Date().toISOString()]
  );
  // First wrong attempt pushes failed_attempts -> 10 (locks for future) or subsequent returns 429
  await fetch(`${baseUrl}/api/auth/request-device-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: rPhone, password: 'WrongPassword!' })
  });
  const lockedReset = await fetch(`${baseUrl}/api/auth/request-device-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: rPhone, password: 'ValidReset123!' })
  });
  assert.equal(lockedReset.status, 429);
});

test('43. [Phase 1.5] Concurrent exam submit serialization, expired session auto-finalize, retake exclusion, question ID preservation & hidden topics', async () => {
  const nowIso = new Date().toISOString();
  const futureSub = new Date(Date.now() + 30 * 86400000).toISOString();
  const stId = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب تزامن الامتحانات الكامل', '01095556601', '01095556699', ?, 'student', 'prep_1', 'general', 1, 'DEV-EXAM-43', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;
  const stToken = createToken(await db.get(`SELECT * FROM users WHERE id = ?`, [stId]));

  const lId = (await db.run(`
    INSERT INTO lessons (title, description, subject, grade, branch, unit_title, order_index, is_published, created_at)
    VALUES ('درس تزامن الاختبار', 'د', 'tajweed', 'prep_1', 'general', 'الباب', 1, 1, ?)
  `, [nowIso])).lastInsertRowid;

  // Create scheduled future-end exam so answers & topics MUST be hidden
  const createRes = await fetch(`${baseUrl}/api/admin/assessments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      lesson_id: lId,
      title: 'امتحان تجويد مجدول',
      assessment_type: 'exam',
      time_limit_minutes: 10,
      scheduled_end: new Date(Date.now() + 3600000).toISOString(),
      questions: [{ question_text: 'حكم النون؟', topic_tag: 'أحكام النون', options: ['أ', 'ب'], correct_option: 'أ', explanation: 'ش', points: 2 }]
    })
  });
  assert.equal(createRes.status, 201);
  const { assessment_id: exId } = await createRes.json();
  const qBefore = await db.all(`SELECT id FROM questions WHERE assessment_id = ?`, [exId]);

  // PUT update preserves question ID & updates target_student_ids
  const updRes = await fetch(`${baseUrl}/api/admin/assessments/${exId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'امتحان تجويد محدث',
      questions: [{ id: qBefore[0].id, question_text: 'حكم النون الساكنة؟', topic_tag: 'أحكام النون', options: ['أ', 'ب'], correct_option: 'أ', explanation: 'ش', points: 2 }]
    })
  });
  assert.equal(updRes.status, 200);
  const qAfter = await db.all(`SELECT id FROM questions WHERE assessment_id = ?`, [exId]);
  assert.equal(qAfter[0].id, qBefore[0].id);

  // Start & concurrent double-submit
  await fetch(`${baseUrl}/api/assessments/${exId}/start`, { headers: { 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-EXAM-43' } });
  const [sub1, sub2] = await Promise.all([
    fetch(`${baseUrl}/api/assessments/${exId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-EXAM-43' },
      body: JSON.stringify({ answers: { [qAfter[0].id]: 'ب' } })
    }),
    fetch(`${baseUrl}/api/assessments/${exId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${stToken}`, 'X-Device-Id': 'DEV-EXAM-43' },
      body: JSON.stringify({ answers: { [qAfter[0].id]: 'ب' } })
    })
  ]);
  const statuses = [sub1.status, sub2.status].sort();
  assert.deepEqual(statuses, [200, 403]);
  const okBody = sub1.status === 200 ? await sub1.json() : await sub2.json();
  assert.equal(okBody.answers_hidden, true);
  assert.deepEqual(okBody.weak_topics, []);
  assert.deepEqual(okBody.strong_topics, []);

  // Auto-finalize expired session on second student
  const st2Id = (await db.run(`
    INSERT INTO users (
      full_name, phone, parent_phone, password_hash, role, grade, branch,
      is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
    ) VALUES ('طالب جلسة منتهية تلقائياً', '01095556602', '01095556698', ?, 'student', 'prep_1', 'general', 1, 'DEV-EXP-43', ?, 'all', ?)
  `, [hashPassword('Pass123456'), futureSub, nowIso])).lastInsertRowid;
  const st2Token = createToken(await db.get(`SELECT * FROM users WHERE id = ?`, [st2Id]));
  await fetch(`${baseUrl}/api/assessments/${exId}/start`, { headers: { 'Authorization': `Bearer ${st2Token}`, 'X-Device-Id': 'DEV-EXP-43' } });
  await db.run(`UPDATE assessment_sessions SET expires_at = ? WHERE user_id = ? AND assessment_id = ?`, [Date.now() - 60000, st2Id, exId]);

  const startAfterExp = await fetch(`${baseUrl}/api/assessments/${exId}/start`, { headers: { 'Authorization': `Bearer ${st2Token}`, 'X-Device-Id': 'DEV-EXP-43' } });
  assert.equal(startAfterExp.status, 403);
  assert.equal((await startAfterExp.json()).error_code, 'EXAM_ALREADY_TAKEN');
  const autoSub = await db.get(`SELECT score, passed FROM submissions WHERE user_id = ? AND assessment_id = ?`, [st2Id, exId]);
  assert.equal(autoSub.score, 0);
  assert.equal(autoSub.passed, 0);
});

test('44. [Phase 1.6 & 2.2] Secondary rejects branch=general & stale live session past end cutoff blocks join', async () => {
  const secLessonBad = await fetch(`${baseUrl}/api/admin/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'درس ثانوي عام مرفوض',
      subject: 'fiqh',
      grade: 'grade_3',
      branch: 'general',
      unit_title: 'الباب'
    })
  });
  assert.equal(secLessonBad.status, 400);

  const secLiveBad = await fetch(`${baseUrl}/api/admin/live-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'بث ثانوي عام مرفوض',
      subject: 'fiqh',
      grade: 'grade_2',
      branch: 'general',
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      stream_url: 'https://zoom.us/j/111222333'
    })
  });
  assert.equal(secLiveBad.status, 400);

  const staleLive = await fetch(`${baseUrl}/api/admin/live-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      title: 'بث قديم انتهى وقته',
      subject: 'fiqh',
      grade: 'grade_3',
      branch: 'both',
      status: 'live',
      starts_at: new Date(Date.now() - 4 * 3600000).toISOString(),
      duration_minutes: 60,
      stream_url: 'https://zoom.us/j/999888777'
    })
  });
  assert.equal(staleLive.status, 201);
  const { session_id: staleId } = await staleLive.json();

  const stSub = await db.get(`SELECT * FROM users WHERE phone = '01088223301'`);
  const stTok = createToken(stSub);
  const resStaleJoin = await fetch(`${baseUrl}/api/student/live-sessions/${staleId}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${stTok}`, 'X-Device-Id': 'DEV-LIVE-SUB' }
  });
  assert.equal(resStaleJoin.status, 403);

  const updLive = await fetch(`${baseUrl}/api/admin/live-sessions/${staleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ title: 'بث محدث', duration_minutes: 90, stream_url: 'https://meet.google.com/abc-defg-hij' })
  });
  assert.equal(updLive.status, 200);
});

test('45. [Phase 2.1 & 2.3] HTTP 206 suffix/clamped ranges, Bunny embed validation, ISO week key, notifications & WhatsApp https alignment', async () => {
  const fsMod = require('node:fs');
  const httpMod = require('node:http');
  const os = require('node:os');
  const { streamFileWithRange, signBunnyEmbedUrl } = require('../services/media');
  const { getCairoDateTimeParts } = require('../lib/weekly-reports');

  // Suffix range, end-clamped range, invalid range unit
  const tmpVid = path.join(os.tmpdir(), `matn_range_${Date.now()}.bin`);
  fsMod.writeFileSync(tmpVid, '0123456789ABCDEFGHIJ');
  try {
    const srv = httpMod.createServer((req, res) => streamFileWithRange(req, res, tmpVid, 20, 'video/mp4', 'private, no-store'));
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const suffixRes = await fetch(`http://127.0.0.1:${port}/`, { headers: { Range: 'bytes=-5' } });
      assert.equal(suffixRes.status, 206);
      assert.equal(suffixRes.headers.get('content-range'), 'bytes 15-19/20');
      assert.equal(await suffixRes.text(), 'FGHIJ');

      const clampRes = await fetch(`http://127.0.0.1:${port}/`, { headers: { Range: 'bytes=15-9999' } });
      assert.equal(clampRes.status, 206);
      assert.equal(clampRes.headers.get('content-range'), 'bytes 15-19/20');

      const badUnit = await fetch(`http://127.0.0.1:${port}/`, { headers: { Range: 'items=0-5' } });
      assert.equal(badUnit.status, 416);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  } finally {
    try { fsMod.unlinkSync(tmpVid); } catch {}
  }

  // signBunnyEmbedUrl fails loudly when unconfigured & returns >=1800s TTL when configured
  const prevLib = process.env.BUNNY_STREAM_LIBRARY_ID;
  const prevTok = process.env.BUNNY_STREAM_TOKEN_KEY;
  delete process.env.BUNNY_STREAM_LIBRARY_ID;
  delete process.env.BUNNY_STREAM_TOKEN_KEY;
  assert.throws(() => signBunnyEmbedUrl('test-guid-1234'), /BUNNY_NOT_CONFIGURED/);
  process.env.BUNNY_STREAM_LIBRARY_ID = '99999';
  process.env.BUNNY_STREAM_TOKEN_KEY = 'secret-key-xyz';
  try {
    const url = signBunnyEmbedUrl('test-guid-1234');
    const exp = Number(new URL(url).searchParams.get('expires'));
    assert.ok(exp - Math.floor(Date.now() / 1000) >= 1790);
  } finally {
    if (prevLib === undefined) delete process.env.BUNNY_STREAM_LIBRARY_ID; else process.env.BUNNY_STREAM_LIBRARY_ID = prevLib;
    if (prevTok === undefined) delete process.env.BUNNY_STREAM_TOKEN_KEY; else process.env.BUNNY_STREAM_TOKEN_KEY = prevTok;
  }

  // ISO week format & notifications missing user 404 & WhatsApp URL gateway check
  const parts = getCairoDateTimeParts(new Date('2026-11-20T13:05:00Z'));
  assert.match(parts.weekKey, /^\d{4}-W\d{2}$/);
  const { isAllowedWhatsappGatewayUrl } = require('../lib/constants');
  assert.equal(isAllowedWhatsappGatewayUrl('https://api.example.com/send'), true);
  assert.equal(isAllowedWhatsappGatewayUrl('http://127.0.0.1:4001/send'), true);
  assert.equal(isAllowedWhatsappGatewayUrl('http://localhost:4001/send'), true);
  assert.equal(isAllowedWhatsappGatewayUrl('http://evil.example.com/send'), false);

  const missingUserNotif = await fetch(`${baseUrl}/api/admin/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ title: 'إشعار لطالب غير موجود', body: 'نص تجريبي', target_user_id: 9999999 })
  });
  assert.equal(missingUserNotif.status, 404);
});

test('46. [Pull Worker Backend] /api/bot/* auth, prepare, concurrent claim, lease recovery, ack & voucher registration mode', async () => {
  const prevBotToken = process.env.BOT_PULL_TOKEN;
  const testToken = crypto.randomBytes(24).toString('hex'); // 48 chars

  try {
    // 1) 503 when BOT_PULL_TOKEN is unset or shorter than 32 chars
    delete process.env.BOT_PULL_TOKEN;
    const unconfRes = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare`, { method: 'POST' });
    assert.equal(unconfRes.status, 503);

    process.env.BOT_PULL_TOKEN = 'too-short-token';
    const shortRes = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare`, {
      method: 'POST',
      headers: { Authorization: 'Bearer too-short-token' }
    });
    assert.equal(shortRes.status, 503);

    // 2) Enable valid BOT_PULL_TOKEN while keeping WHATSAPP_API_URL empty -> registration stays voucher_code
    process.env.BOT_PULL_TOKEN = testToken;

    const pubRes = await fetch(`${baseUrl}/api/public/info`);
    assert.equal(pubRes.status, 200);
    const pubJson = await pubRes.json();
    assert.equal(pubJson.registration_mode, 'voucher_code');

    const overviewRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(overviewRes.status, 200);
    const overviewJson = await overviewRes.json();
    assert.equal(overviewJson.whatsapp_gateway_configured, false);
    assert.equal(overviewJson.bot_pull_configured, true);

    // 3) Auth checks: missing header, wrong token, query param, body token all return 401
    const noAuth = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare`, { method: 'POST' });
    assert.equal(noAuth.status, 401);

    const wrongAuth = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${crypto.randomBytes(24).toString('hex')}` }
    });
    assert.equal(wrongAuth.status, 401);

    const queryAuth = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare?token=${encodeURIComponent(testToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: testToken })
    });
    assert.equal(queryAuth.status, 401);

    // 4) Seed 2 active students + call prepare on synthetic week_key
    const weekKey = '2099-W12';
    const createdAt = new Date().toISOString();
    const u1Res = await db.run(
      `INSERT INTO users (full_name, phone, parent_phone, password_hash, role, grade, branch, is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at)
       VALUES (?, ?, ?, ?, 'student', 'grade_1', 'common', 1, '2099-12-31T23:59:59.000Z', 'all', ?)`,
      ['طالب السحب الأول', '01099110001', '01099110011', hashPassword('Pass!1234'), createdAt]
    );
    const u2Res = await db.run(
      `INSERT INTO users (full_name, phone, parent_phone, password_hash, role, grade, branch, is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at)
       VALUES (?, ?, ?, ?, 'student', 'grade_1', 'common', 1, '2099-12-31T23:59:59.000Z', 'all', ?)`,
      ['طالب السحب الثاني', '01099110002', '01099110012', hashPassword('Pass!1234'), createdAt]
    );
    await db.run(`DELETE FROM weekly_parent_reports WHERE week_key = ?`, [weekKey]);

    const prepRes = await fetch(`${baseUrl}/api/bot/weekly-reports/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ week_key: weekKey })
    });
    assert.equal(prepRes.status, 200);
    const prepJson = await prepRes.json();
    assert.equal(prepJson.ok, true);
    assert.equal(prepJson.week_key, weekKey);
    assert.ok(prepJson.pending >= 2);

    // Restrict the target week rows to only our 2 test users so concurrent claim behavior is deterministic
    await db.run(
      `DELETE FROM weekly_parent_reports WHERE week_key = ? AND user_id NOT IN (?, ?)`,
      [weekKey, u1Res.lastInsertRowid, u2Res.lastInsertRowid]
    );

    // 5) Concurrent claims yield distinct items & no duplicates
    const [claimARes, claimBRes] = await Promise.all([
      fetch(`${baseUrl}/api/bot/weekly-reports/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
        body: JSON.stringify({ week_key: weekKey })
      }),
      fetch(`${baseUrl}/api/bot/weekly-reports/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
        body: JSON.stringify({ week_key: weekKey })
      })
    ]);
    assert.equal(claimARes.status, 200);
    assert.equal(claimBRes.status, 200);
    const claimA = await claimARes.json();
    const claimB = await claimBRes.json();
    assert.ok(claimA.item && claimB.item);
    assert.notEqual(claimA.item.id, claimB.item.id);
    assert.equal(claimA.item.attempt_count, 1);
    assert.equal(claimB.item.attempt_count, 1);

    // Empty claim when nothing pending
    const claimEmptyRes = await fetch(`${baseUrl}/api/bot/weekly-reports/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ week_key: weekKey })
    });
    const claimEmpty = await claimEmptyRes.json();
    assert.equal(claimEmpty.item, null);

    // 6) Ack sent updates row + inserts whatsapp_logs; repeat ack returns 409 conflict
    const ackSent = await fetch(`${baseUrl}/api/bot/weekly-reports/${claimA.item.id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ status: 'sent', provider_message_id: 'MSG-PULL-001' })
    });
    assert.equal(ackSent.status, 200);
    const rowA = await db.get(`SELECT status, sent_at, claimed_at FROM weekly_parent_reports WHERE id = ?`, [claimA.item.id]);
    assert.equal(rowA.status, 'sent');
    assert.ok(rowA.sent_at);
    assert.equal(rowA.claimed_at, null);
    const logA = await db.get(`SELECT * FROM whatsapp_logs WHERE message_summary LIKE '%MSG-PULL-001%'`);
    assert.ok(logA);

    const doubleAck = await fetch(`${baseUrl}/api/bot/weekly-reports/${claimA.item.id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ status: 'sent' })
    });
    assert.equal(doubleAck.status, 409);

    // 7) Lease recovery after > 5 minutes & auto-fail at attempt_count >= 3
    const expiredIso = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await db.run(
      `UPDATE weekly_parent_reports SET claimed_at = ?, attempt_count = 1 WHERE id = ?`,
      [expiredIso, claimB.item.id]
    );
    const recoveredClaimRes = await fetch(`${baseUrl}/api/bot/weekly-reports/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ week_key: weekKey })
    });
    const recoveredClaim = await recoveredClaimRes.json();
    assert.equal(recoveredClaim.item.id, claimB.item.id);
    assert.equal(recoveredClaim.item.attempt_count, 2);

    // Ack failed test on claimB
    const ackFail = await fetch(`${baseUrl}/api/bot/weekly-reports/${claimB.item.id}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ status: 'failed', error_reason: 'WHATSAPP_NOT_REGISTERED' })
    });
    assert.equal(ackFail.status, 200);
    const rowB = await db.get(`SELECT status, error_reason FROM weekly_parent_reports WHERE id = ?`, [claimB.item.id]);
    assert.equal(rowB.status, 'failed');
    assert.equal(rowB.error_reason, 'WHATSAPP_NOT_REGISTERED');

    // Lease recovery marks item failed automatically when attempt_count >= 3
    await db.run(
      `UPDATE weekly_parent_reports SET status = 'processing', claimed_at = ?, attempt_count = 3 WHERE id = ?`,
      [expiredIso, claimB.item.id]
    );
    const maxRetryRes = await fetch(`${baseUrl}/api/bot/weekly-reports/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testToken}` },
      body: JSON.stringify({ week_key: weekKey })
    });
    const maxRetryJson = await maxRetryRes.json();
    assert.equal(maxRetryJson.item, null);
    const rowBMax = await db.get(`SELECT status FROM weekly_parent_reports WHERE id = ?`, [claimB.item.id]);
    assert.equal(rowBMax.status, 'failed');
  } finally {
    if (prevBotToken === undefined) delete process.env.BOT_PULL_TOKEN;
    else process.env.BOT_PULL_TOKEN = prevBotToken;
  }
});

test('47. [Pull Worker Bot] whatsapp-bot/index.js URL hardening, phone normalization & Baileys version failure resilience', async () => {
  const netMod = require('node:net');
  const os = require('node:os');
  const { pathToFileURL } = require('node:url');
  const botMod = await import(pathToFileURL(path.join(__dirname, '..', 'whatsapp-bot', 'index.js')).href);

  // 1) Strict Egyptian phone normalization
  assert.equal(botMod.normalizeEgyptianPhone('1234567890'), null);
  assert.equal(botMod.normalizeEgyptianPhone('01912345678'), null);
  assert.equal(botMod.normalizeEgyptianPhone('01012345678'), '201012345678');
  assert.equal(botMod.normalizeEgyptianPhone('+20 11-2345-6789'), '201123456789');
  assert.equal(botMod.normalizeEgyptianPhone('00201512345678'), '201512345678');

  // 2) Loopback host enforcement
  assert.throws(() => botMod.createUiServer({ state: botMod.createInitialBotState(), host: '0.0.0.0', port: 0 }), /127\.0\.0\.1/);

  // 3) UI server handles malformed HTTP requests (http://[invalid) with 400 cleanly & exposes NO /send route
  const state = botMod.createInitialBotState();
  const { server: uiServer, bindHost } = botMod.createUiServer({ state, host: '127.0.0.1', port: 0 });
  await new Promise((resolve) => uiServer.listen(0, bindHost, resolve));
  const uiPort = uiServer.address().port;

  try {
    const rawResp = await new Promise((resolve, reject) => {
      const sock = netMod.connect(uiPort, '127.0.0.1', () => {
        sock.write(`GET http://[invalid HTTP/1.1\r\nHost: 127.0.0.1:${uiPort}\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      sock.setEncoding('utf8');
      sock.on('data', (chunk) => { data += chunk; });
      sock.on('end', () => resolve(data));
      sock.on('error', reject);
    });
    assert.match(rawResp, /^HTTP\/1\.1 400 /);

    const sendRemoved = await fetch(`http://127.0.0.1:${uiPort}/send`, { method: 'POST' });
    assert.equal(sendRemoved.status, 404);

    const healthRes = await fetch(`http://127.0.0.1:${uiPort}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.mode, 'pull_worker');
  } finally {
    await new Promise((resolve) => uiServer.close(resolve));
  }

  // 4) fetchLatestBaileysVersion() rejection inside startWhatsAppSocket recovers cleanly without crashing
  const tempAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matn-bot-auth-'));
  let unhandledCount = 0;
  const onUnhandled = () => { unhandledCount += 1; };
  process.on('unhandledRejection', onUnhandled);
  let sockHandle = null;
  try {
    const waState = botMod.createInitialBotState();
    sockHandle = await botMod.startWhatsAppSocket({
      state: waState,
      authDir: tempAuthDir,
      useAuthStateFn: async () => ({ state: {}, saveCreds: async () => {} }),
      fetchLatestVersionFn: async () => { throw new Error('OFFLINE_BAILEYS_VERSION'); },
      makeSocketFn: () => { throw new Error('should not be called'); },
      logger: { log: () => {}, error: () => {} }
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(unhandledCount, 0);
    assert.equal(waState.whatsappStatus, 'reconnecting');
    assert.match(waState.lastError, /OFFLINE_BAILEYS_VERSION/);
  } finally {
    if (sockHandle) sockHandle.stop();
    process.removeListener('unhandledRejection', onUnhandled);
    fs.rmSync(tempAuthDir, { recursive: true, force: true });
  }
});

test('48. [Feature] Admin Quick Voucher Reply auto-pick / auto-generate + custom WhatsApp greeting + URL', async () => {
  const customGreeting = 'وعليكم السلام ورحمة الله وبركاته يا أحمد محمود\nاتفضل كود التفعيل أهو:\n{CODE}\nبالتوفيق!';
  const assignAuto = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      auto_pick: true,
      auto_generate_if_missing: true,
      grade_scope: 'grade_2',
      subject_scope: 'fiqh',
      recipient_name: 'أحمد محمود',
      recipient_phone: '01066554433',
      restrict_to_phone: true,
      custom_message: customGreeting
    })
  });
  assert.equal(assignAuto.status, 200);
  const autoJson = await assignAuto.json();
  assert.equal(autoJson.auto_picked, true);
  assert.ok(autoJson.voucher && autoJson.voucher.code.startsWith('MATN-'));
  assert.equal(autoJson.voucher.assigned_to_phone, '01066554433');
  assert.equal(autoJson.voucher.restrict_to_phone, 1);
  assert.ok(autoJson.whatsapp_message.includes(autoJson.voucher.code));
  assert.ok(!autoJson.whatsapp_message.includes('{CODE}'));
  assert.match(autoJson.whatsapp_url, /^https:\/\/wa\.me\/201066554433\?text=/);

  const badScope = await fetch(`${baseUrl}/api/admin/vouchers/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({
      auto_pick: true,
      grade_scope: 'prep_1',
      subject_scope: 'mawareeth',
      recipient_name: 'أحمد محمود',
      recipient_phone: '01066554433'
    })
  });
  assert.equal(badScope.status, 400);
});






