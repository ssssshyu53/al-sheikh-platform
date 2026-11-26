# 🧩 دليل الوحدات والمنطق البرمجي (Modules & API Guide)

## 1. وحدة المصادقة وربط الأجهزة (`routes/auth.js`, `middleware/auth.js`)

### أوضاع التسجيل التلقائية (`registration_mode`)
يحدد الخادم وضع التسجيل تلقائياً حسب متغيرات البيئة:
1. **`whatsapp_otp`**: عندما يكون `WHATSAPP_API_URL` مضبوطاً وصالحاً (`https://` أو loopback `http://127.0.0.1|localhost`). يُنشأ الطالب بـ `is_whatsapp_verified = 0` ويُرسل رمز OTP من 6 أرقام صالح لـ 10 دقائق (بحد أقصى 5 محاولات تحقق و3 مرات إعادة إرسال بفارق 60 ثانية).
2. **`voucher_code`** *(الافتراضي في الإنتاج بدون بوابة واتساب)*: يشترط إدخال كود تفعيل صالح (`activation_code`) عند التسجيل، فيُفعَّل الحساب والاشتراك في معاملة ذرية واحدة (`runInTransaction`).
3. **`direct`** *(للتطوير فقط)*: عند ضبط `ALLOW_UNVERIFIED_REGISTRATION=true` بدون بوابة واتساب.

### قواعد التحقق الصارمة
- **الاسم الرباعي:** 4 كلمات على الأقل، بحد أقصى 120 حرفاً.
- **الهاتف المصري:** تطبيع الأرقام العربية/الفارسية (`٠-٩`, `۰-۹`) ومفاتيح `+20`/`0020`/`20` عبر `normalizePhoneNumber()` والتحقق من النمط `^01[0125]\d{8}$`، مع اشتراط اختلاف هاتف ولي الأمر عن هاتف الطالب.
- **كلمة المرور:** 8 أحرف على الأقل للطلاب، و12 حرفاً على الأقل للإدارة.
- **بصمة الجهاز (`device_id`):** مطابقة التعبير `^[a-zA-Z0-9_-]{6,100}$`. عند دخول الطالب من جهاز مختلف يُرفض برمز `403 DEVICE_LOCKED` ويُسجَّل حدث `MULTI_DEVICE_BLOCKED`؛ وعند تطابق عدة حسابات على نفس `device_id` يُسجَّل `SHARED_DEVICE_DETECTED`.

---

## 2. محرك الاشتراكات والأكواد (`routes/auth.js`, `routes/admin.js`, `services/gating.js`)

### قواعد صلاحية الكود (`validateVoucherForPhoneAndGrade`)
1. الكود غير مستخدم (`is_used = 0`).
2. `grade_scope === 'all'` أو يطابق صف الطالب.
3. `subject_scope === 'all'` أو المادة مقررة على صف الطالب (`isSubjectAllowedForGrade`).
4. إذا كان `restrict_to_phone = 1`، يجب أن يطابق `assigned_to_phone` رقم الطالب.

### حساب مدة الاشتراك (`applyVoucherSubscriptionInTx`)
- **اشتراك شامل (`subject_scope = 'all'`):** يمدد `users.subscription_expires_at` من التاريخ الأبعد بين (الآن) و(انتهاء الاشتراك الشامل الحالي).
- **اشتراك مادة واحدة:** يمدد سجل المادة في `user_subject_subscriptions (user_id, subject)` بشكل مستقل تماماً عن اشتراك `all`؛ وعند عدم وجود اشتراك شامل نشط، يُحدَّث ملخص `users.subscribed_subjects` و`users.subscription_expires_at` ليعكس المواد النشطة وأقصى تاريخ انتهاء.

---

## 3. بوابة الحصص المتسلسلة والاختبارات (`services/gating.js`, `routes/assessments.js`)

### القاعدة الموحدة للفتح المتسلسل (`evaluatePrecedingLessonsGate`)
تُستخدم نفس الدالة في كل من لوحة الطالب (`/api/student/dashboard`) والتحقق الخادمي المباشر (`authorizeLessonAccess`) لضمان تطابق العرض مع الحماية:
- تُرتَّب المحاضرات المنشورة في نفس `(grade, subject, branch)` حسب `order_index ASC, id ASC`.
- لفتح المحاضرة رقم `i`، يجب أن يكون الطالب قد حقق التالي في **جميع المحاضرات السابقة** (`0 .. i-1`):
  1. تسليم جميع الواجبات النشطة (`assessment_type = 'homework'`).
  2. اجتياز الامتحان الأساسي النشط (`exam`) أو امتحان الإعادة (`retake_exam`) بنسبة **فوق النصف** (`score > total_points / 2` أي `floor(total_points / 2) + 1` على الأقل).

### دورة حياة الاختبار (`assessment_sessions` & `submissions`)
- **`GET /api/assessments/:id/start`:** يتحقق من فتح النافذة الزمنية (`scheduled_start` .. `scheduled_end`)، ويغلق أي جلسات سابقة منتهية عبر `finalizeExpiredAssessmentSessions()`، ويمنع إعادة الامتحان الأساسي إذا سبق تسليمه، ويقصر `retake_exam` على الطلاب الراسبين أو المدرجين في `target_student_ids_json`.
- **الخلط العشوائي:** يتم خلط ترتيب الأسئلة وترتيب اختيارات `mcq` باستخدام `crypto.randomInt` في `shuffleArray()`. أسئلة `true_false` تُعرض دائماً بالترتيب `['صح', 'خطأ']`.
- **`POST /api/assessments/:id/submit`:** يُغلق الجلسة مع فترة سماح `30` ثانية؛ إذا انتهى الوقت يُسجَّل التسليم بدرجة `0` (`timed_out: true`)؛ تُحجب الإجابات النموذجية ونقاط القوة والضعف في الامتحانات المجدولة حتى مرور `scheduled_end` (`canRevealSubmissionReview`).

---

## 4. الوسائط والبث المؤمّن (`routes/media.js`, `services/media.js`)

1. **تذاكر البث (`POST /api/media/ticket/:lessonId`):** تُصدر تذكرة HMAC-SHA256 صالحة لمدة `3600` ثانية، مربوطة بـ `userId:lessonId:deviceId:exp`، وتُرسل في Cookie (`HttpOnly`) وفي JSON؛ وفي حال استخدام Bunny Stream تُوقَّع URL التضمين (`signBunnyEmbedUrl`).
2. **تدفق الفيديو (`GET /api/stream/video/:lessonId`):** يدعم طلبات النطاق (`Range: bytes=...`) بوضع `206 Partial Content` (بما في ذلك suffix ranges)، أو التفويض المباشر لـ Nginx عبر `X-Accel-Redirect: /_protected_videos/...` عند تفعيل `USE_NGINX_ACCEL=true`.
3. **معالجة الرفع المجزأ (`POST /api/admin/upload-chunk`):**
   - فحص التوقيع الرقمي الفعلي (`Magic Bytes`): `%PDF-` للمذكرات، و`ftyp` (MP4) أو `0x1A45DFA3` (WebM) للفيديو.
   - تشغيل `relocateMoovToFront()` (Pure-Node `qt-faststart`) على ملفات MP4 لنقل ذرة `moov` إلى المقدمة وتحديث جداول `stco`/`co64` تلقائياً.
   - إمكانية الرفع المتزامن لـ Bunny Stream عبر `/api/admin/bunny/upload`.
4. **المذكرات المحمية (`GET /api/stream/pdf/:id` & `/api/stream/pdf-file/:id`):** بث ثنائي `application/pdf` لعرضه داخل `pdf.js` المستضاف محلياً مع رسم العلامة المائية (`الاسم • الهاتف • منصة مَتْن`) وترويسة `X-Matn-Watermark`.

---

## 5. التلعيب، بنك الأخطاء، المباشر، وبوت الواتساب

- **المواظبة والأوسمة (`services/gamification.js`):** يحسب `computeStudyStreak` الأيام المتتالية بتوقيت القاهرة (`Africa/Cairo`) من جدول `study_activity`، وتُمنح 5 أوسمة (`first_step`, `streak_3`, `streak_7`, `top_scorer`, `unit_complete`).
- **الحصص المباشرة (`services/live-sessions.js`):** تفتح الحصة قبل موعدها بـ `join_early_minutes` (افتراضياً 15 دقيقة) وتُغلق بعد `starts_at + duration_minutes + 30m`، مع تسجيل الحضور عند الانضمام.
- **تقارير الجمعة وبوت السحب (`lib/weekly-reports.js`, `routes/bot.js`, `whatsapp-bot/index.js`):**
  - المعرف الأسبوعي ISO بتوقيت القاهرة (مثال `2026-W48`).
  - كل جمعة من الساعة 15:00 بتوقيت القاهرة، تُجهَّز تقارير الطلاب النشطين خلال آخر 14 يوماً أو ذوي الاشتراك الساري.
  - إذا كان `BOT_PULL_TOKEN` مضبوطاً (`>= 32` حرفاً) ولا توجد بوابة HTTPS، تبقى التقارير بحالة `pending` ليسحبها `whatsapp-bot` على جهاز المعلم عبر:
    - `POST /api/bot/weekly-reports/prepare`
    - `POST /api/bot/weekly-reports/claim` *(مهلة استحواذ 5 دقائق وإعادة محاولة تلقائية حتى 3 مرات)*
    - `POST /api/bot/weekly-reports/:id/ack`

---

## 6. مرجع نقاط النهاية المختصر (API Endpoints Reference)

### العامة والمصادقة (`/api/public`, `/api/auth`, `/api/vouchers`)
- `GET /api/health` — فحص صحة الخادم وقاعدة البيانات.
- `GET /api/public/info` — بيانات المنصة العامة وإحصاءات الأعداد و`registration_mode`.
- `POST /api/auth/register` | `POST /api/auth/verify-otp` | `POST /api/auth/resend-otp`
- `POST /api/auth/login` | `POST /api/auth/logout` | `GET /api/auth/me`
- `POST /api/auth/forgot-password` | `POST /api/auth/reset-password`
- `POST /api/auth/request-device-reset` | `POST /api/security/report` | `POST /api/vouchers/redeem`

### الطالب والوسائط والاختبارات (`/api/student`, `/api/lessons`, `/api/assessments`, `/api/media`, `/api/stream`)
- `GET /api/student/dashboard` | `GET /api/student/mistakes`
- `GET /api/student/notifications` | `POST /api/student/notifications/read`
- `GET /api/student/live-sessions` | `POST /api/student/live-sessions/:id/join`
- `POST /api/lessons/:id/progress` | `GET|POST /api/lessons/:id/questions` | `GET|POST /api/lessons/:id/notes` | `DELETE /api/lessons/:id/notes/:noteId`
- `GET /api/assessments/:id/start` | `POST /api/assessments/:id/submit` | `GET /api/submissions/:id/review`
- `POST /api/media/ticket/:lessonId` | `GET /api/stream/video/:lessonId` | `GET /api/stream/pdf/:lessonId` | `GET /api/stream/pdf-file/:lessonId`

### الإدارة (`/api/admin/*`)
- `GET /api/admin/overview` — ملخص الطلاب، الإيرادات، الدروس، الأكواد، الراسبين، الأسئلة، التقارير، البث، السجلات الأمنية.
- `PUT /api/admin/settings` — تحديث الإعدادات العامة والتنبيهات.
- `GET /api/admin/students/search` | `POST /api/admin/students/reset-device` | `lock` | `unlock` | `reset-password` | `verify-whatsapp` | `grant-month` | `DELETE /api/admin/students/:id` | `GET /api/admin/students/:id/parent-report`
- `POST /api/admin/upload-chunk` | `POST /api/admin/bunny/upload` | `POST /api/admin/lessons` | `PUT|DELETE /api/admin/lessons/:id` | `GET /api/admin/lessons/:id/assessments`
- `POST /api/admin/assessments` | `PUT|DELETE /api/admin/assessments/:id`
- `POST /api/admin/vouchers/generate` | `POST /api/admin/vouchers/assign`
- `PUT|DELETE /api/admin/lesson-questions/:id`
- `GET|POST|PUT|DELETE /api/admin/live-sessions` | `GET /api/admin/live-sessions/:id/attendance`
- `GET|POST|DELETE /api/admin/notifications`
- `GET /api/admin/weekly-reports` | `POST /api/admin/weekly-reports/run` | `POST /api/admin/weekly-reports/:id/mark-sent`
