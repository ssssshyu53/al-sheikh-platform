# 🛠️ دليل استلام المطور (Developer Handover Manual)

مرحباً بك في فريق تطوير **منصة مَتْن (MATN)**. يغطي هذا الدليل كل ما تحتاجه للعمل على المستودع من اليوم الأول بأمان واتساق.

---

## 1. قائمة التحقق لليوم الأول (Day-1 Onboarding Checklist)

- [ ] تثبيت **Node.js `>= 22.13.0`** (لدعم `node:sqlite` محلياً أثناء تشغيل الاختبارات والتطوير).
- [ ] تثبيت **Git** وضبط الهوية المحلية.
- [ ] تشغيل `npm install` في الجذر، وداخل `whatsapp-bot/` عند العمل على البوت.
- [ ] إنشاء `.env` محلياً للتطوير (`NODE_ENV=development`, `DB_CLIENT=sqlite`, `ALLOW_UNVERIFIED_REGISTRATION=true`).
- [ ] تشغيل `npm run db:migrate && npm run seed:dev && npm test` والتأكد من نجاح الـ 48 اختباراً (`48 pass, 0 fail`).
- [ ] (لمطوري الموبايل) تثبيت **Flutter SDK `>= 3.2.0`** وتشغيل `flutter pub get` داخل `mobile_app/`.

---

## 2. هيكل المجلدات (Repository Map)

```text
al-sheikh-platform/
├── server.js              # نقطة الدخول، خادم HTTP، مجدول الجمعة، والإغلاق الآمن
├── database.js            # تهيئة الاتصال، bootstrap للأدمن، وتشفير scrypt المقيد
├── db/
│   ├── adapter.js         # طبقة التجريد الموحدة (MySQL Pool | node:sqlite WAL)
│   ├── migrations.js      # 14 ترحيلاً متطابقاً للـ MySQL والـ SQLite
│   └── schema_mysql.sql   # مرجع مخطط MySQL الكامل
├── lib/
│   ├── constants.js       # الثوابت، الصفوف/المواد، تطبيع الأرقام والهواتف
│   ├── env.js             # تحميل .env بدون الكتابة فوق متغيرات البيئة
│   ├── paths.js           # حل مسارات STORAGE_DIR / SQLITE_DB_PATH / UPLOADS_DIR / BACKUPS_DIR
│   └── weekly-reports.js  # صياغة وطابور تقارير أولياء الأمور الأسبوعية
├── middleware/
│   ├── auth.js            # JWT HS256، تذاكر البث، CSRF، والتحقق من الجهاز
│   └── security.js        # Rate Limit، استخراج IP الموثوق، CSP/CORS، parseBody
├── routes/                # معالجات مسارات API (9 ملفات حسب النطاق)
├── services/              # منطق الأعمال (gating, media, gamification, live, notifications, whatsapp, audit)
├── public/                # واجهة الويب PWA + وحدات ES (public/js/) + pdf.js المحلي
├── scripts/               # أدوات CLI (setup-env, setup-admin, seed-dev, backup-db, preflight, load-test)
├── deploy/                # ملفات النشر (Dockerfile, compose, ecosystem, nginx, install-vps.sh)
├── tests/                 # حزمة الاختبارات الأمنية والوظيفية (security.test.js)
├── whatsapp-bot/          # بوت الواتساب الساحب (Baileys Pull-Worker)
├── mobile_app/            # تطبيق Flutter (Android & iOS)
└── docs/                  # التوثيق الهندسي الكامل
```

---

## 3. معايير البرمجة وقواعد قاعدة البيانات (Coding & DB Standards)

1. **الكتابة المتوافقة مع MySQL وSQLite (`db/adapter.js`):**
   - استخدم دائماً واجهة المحوّل: `db.get(sql, params)`, `db.all(sql, params)`, `db.run(sql, params)`, `db.exec(sql)`, و`db.transaction(async (tx) => ...)`.
   - لا تكتب SQL خاصاً بمحرك واحد داخل `routes/` أو `services/` بدون تفريع صريح عبر `db.isMysql`:
     - استخدم `db.forUpdate()` لأقفال الصفوف (`FOR UPDATE` في MySQL وفارغ في SQLite داخل `BEGIN IMMEDIATE`).
     - استخدم `db.insertIgnorePrefix()` بدلاً من كتابة `INSERT OR IGNORE` مباشرة.
     - استخدم `ON DUPLICATE KEY UPDATE` لـ MySQL مقابل `ON CONFLICT(...) DO UPDATE` لـ SQLite.
   - أضف أي تعديل جديد على الجداول كنسخة ترحيل جديدة متناظرة في **كلا** المصفوفتين `SQLITE_MIGRATIONS` و`MYSQL_MIGRATIONS` داخل `db/migrations.js`.
2. **الأمان أولاً:**
   - لا تغيّر التشفير بعيداً عن `hashPasswordAsync` / `verifyPasswordAsync` (المقيَّد بـ `runBoundedScrypt`).
   - لا تسمح مطلقاً بإرجاع `password_hash` أو `whatsapp_otp_hash` أو الأسرار في أي استجابة API.
   - حافظ على مطابقة منطق البوابة المتسلسلة في `evaluatePrecedingLessonsGate()` بين لوحة الطالب ومسارات البث والاختبارات.
3. **الاعتماديات:**
   - الخادم الأساسي يعتمد فقط على مكتبات Node.js القياسية + `mysql2`. لا تضف حزم npm جديدة للخادم إلا عند الضرورة القصوى.

---

## 4. مرجع أوامر CLI السريع (CLI Cheat Sheet)

| الأمر | الوظيفة |
| :--- | :--- |
| `npm run dev` / `npm start` | تشغيل الخادم (`server.js`) |
| `npm run setup:env` | توليد `.env` إنتاجي بمفاتيح عشوائية آمنة |
| `npm run db:migrate` | تطبيق ترحيلات قاعدة البيانات والفهارس |
| `npm run setup:admin` | إنشاء أو تحديث حساب الإدارة (`12+` حرفاً لكلمة المرور) |
| `npm run seed:dev` | إضافة بيانات منهج تجريبية للتطوير فقط |
| `npm run preflight` | فحص النحو والبيئة والاتصال بقاعدة البيانات قبل التشغيل الإنتاجي |
| `npm run preflight -- --dev` | فحص الجاهزية في وضع التطوير المحلي |
| `npm test` | تشغيل 48 اختباراً أمنياً ووظيفياً (`tests/security.test.js`) |
| `npm run test:load` | اختبار تحمل التزامن (`scripts/load-test.js`) |
| `npm run db:backup` | أخذ نسخة احتياطية وتدوير آخر 14 نسخة |
| `npm run db:restore <path>` | استعادة نسخة احتياطية (MySQL SQL/JSON أو SQLite `.db`) |

---

## 5. سير عمل Git وحل الأعطال الشائعة (Git Workflow & Troubleshooting)

### قواعد Git
- لا تقم مطلقاً بعمل commit لملفات `.env` أو قواعد البيانات `*.db` أو جلسات `whatsapp-bot/auth_info/` أو مجلدات `uploads/` و`backups/`.
- شغّل `npm test` و`npm run preflight -- --dev` قبل أي دمج أو رفع.

### الأعطال الشائعة وحلولها
| المشكلة | السبب المحتمل | الحل |
| :--- | :--- | :--- |
| `FATAL ERROR: JWT_SECRET ... required in production` | تشغيل `NODE_ENV=production` بدون `JWT_SECRET` بطول 32+ حرفاً | نفّذ `npm run setup:env` أو أضف `JWT_SECRET` عشوائياً من 64 حرفاً hex. |
| `Node.js >= 22.13.0 is required for DB_CLIENT=sqlite` | استخدام Node 20 مع SQLite | رقِّ Node إلى 22.13+ للتطوير المحلي، أو اضبط `DB_CLIENT=mysql` على Node 20+. |
| توقف Nginx عن البدء مع خطأ شهادة SSL | تفعيل بلوك `443` قبل إصدار شهادة Certbot | أصلِح الشهادة أولاً عبر `--webroot` على منفذ `80` ثم فعّل بلوك `443`. |
| تسجيل الطلاب يطلب كود تفعيل بدلاً من OTP | متغير `WHATSAPP_API_URL` فارغ | هذا السلوك المقصود (`voucher_code` mode) للحماية بدون بوابة OTP؛ اضبط بوابة HTTPS صالحة أو فعّل `ALLOW_UNVERIFIED_REGISTRATION=true` محلياً فقط. |
| بوت الواتساب يظهر `BOT_PULL_TOKEN` غير مضبوط | عدم تطابق التوكن بين الخادم و`whatsapp-bot/.env` أو طوله أقل من 32 حرفاً | انسخ نفس قيمة `BOT_PULL_TOKEN` (32+ حرفاً) في كلا الملفين وأعد تشغيل البوت. |
