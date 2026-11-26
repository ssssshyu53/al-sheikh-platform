# 🚀 دليل النشر والتشغيل الإنتاجي (Deployment Guide)

يدعم المشروع 4 مسارات نشر إنتاجية جاهزة، مع تفضيل **Hostinger (Node.js + MySQL)** أو **Ubuntu VPS (Nginx + PM2 + Let's Encrypt)**.

---

## 1. النشر على Hostinger Web Hosting (hPanel — Node.js + MySQL)

1. **إنشاء قاعدة بيانات MySQL:**
   - من لوحة **hPanel → Databases → Management**: أنشئ قاعدة البيانات والمستخدم (مثال `u123456_matn`).
   - احفظ: `DB_HOST` (`127.0.0.1` أو `localhost`)، `DB_NAME`، `DB_USER`، `DB_PASSWORD`.
2. **رفع المشروع وضبط تطبيق Node.js:**
   - اربط المستودع عبر Git أو ارفع الملفات إلى مجلد التطبيق في hPanel.
   - اختر **Node.js 20** أو **Node.js 22** واجعل نقطة البدء `server.js`.
   - ثبّت اعتماديات الإنتاج:
     ```bash
     npm install --omit=dev
     ```
3. **إعداد متغيرات البيئة (`.env` أو hPanel Environment Variables):**
   - نفّذ `npm run setup:env` أو أضف المتغيرات التالية بدقة:
     ```dotenv
     NODE_ENV=production
     HOST=0.0.0.0
     PORT=4000
     CORS_ALLOWED_ORIGINS=https://your-domain.com
     TRUSTED_PROXY_COUNT=1
     UV_THREADPOOL_SIZE=16
     JWT_SECRET=<64-char-random-hex>
     STREAM_TICKET_SECRET=<64-char-random-hex>
     DB_CLIENT=mysql
     DB_HOST=127.0.0.1
     DB_PORT=3306
     DB_USER=u123456_user
     DB_PASSWORD=strong_mysql_password
     DB_NAME=u123456_matn
     DB_POOL_LIMIT=12
     BOT_PULL_TOKEN=<32+-char-random-hex>
     ```
4. **الترحيل، إنشاء الأدمن، وفحص الجاهزية:**
   ```bash
   npm run db:migrate
   INITIAL_ADMIN_PHONE=010xxxxxxxx INITIAL_ADMIN_PASSWORD="StrongAdminPassword123!" npm run setup:admin
   npm run preflight
   ```

---

## 2. النشر على Ubuntu VPS (Nginx + Certbot + PM2)

يتضمن المستودع سكربت تهيئة آلي كامل في `deploy/install-vps.sh` وملفات الإعداد في `deploy/`:

```bash
chmod +x deploy/install-vps.sh
MATN_DOMAIN=matn-platform.com ./deploy/install-vps.sh
```

### ما يقوم به السكربت والملفات المرفقة:
- تثبيت **Node.js 22 LTS**، **Nginx**، **Certbot**، **PM2**، و**UFW** (فتح 22/80/443 فقط).
- رفع حد الملفات المفتوحة (`nofile 65535`) في `/etc/security/limits.conf`.
- تشغيل `npm ci --omit=dev` ثم `npm run db:migrate` و`NODE_ENV=production npm run preflight`.
- تشغيل الخادم عبر `pm2 start deploy/ecosystem.config.js --env production` وحفظه للبدء التلقائي.
- إعداد Cron يومي للنسخ الاحتياطي الساعة 3:30 فجراً.
- تهيئة `/etc/nginx/sites-available/matn-platform` من قالب `deploy/nginx-matn.conf`.

### ترتيب إصدار شهادة SSL (Let's Encrypt) بدون تعطل Nginx:
> [!IMPORTANT]
> لا تفعّل بلوك `listen 443 ssl` في `deploy/nginx-matn.conf` قبل وجود الشهادات في `/etc/letsencrypt/live/<domain>/`.
1. شغّل مؤقتاً بلوك منفذ `80` مع `location /.well-known/acme-challenge/ { root /var/www/certbot; }`.
2. نفّذ:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot certonly --webroot -w /var/www/certbot -d your-domain.com -d www.your-domain.com
   ```
3. فعّل `deploy/nginx-matn.conf` الكامل، واضبط `USE_NGINX_ACCEL=true` في `.env` لتسليم الفيديو بصفر حمل على Node.js عبر `X-Accel-Redirect`، ثم:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   pm2 restart matn-platform --update-env
   ```

---

## 3. النشر عبر Docker / Railway

- **Docker Compose (`deploy/docker-compose.yml` & `deploy/Dockerfile`):**
  ```bash
  cp .env.example .env
  # عدّل .env وأنشئ مجلدات data/ uploads/ backups/
  docker compose -f deploy/docker-compose.yml up -d --build
  ```
  يتضمن `Dockerfile` فحص صحة تلقائي (`HEALTHCHECK`) على `/api/health`.
- **Railway (`railway.json`):** يستخدم `NIXPACKS` ويشغّل `node server.js` مع فحص `/api/health`. اضبط `STORAGE_DIR=/data` لربط الحجم الدائم (Volume) لقاعدة البيانات والملفات المرفوعة والنسخ الاحتياطي.

---

## 4. النسخ الاحتياطي والاستعادة (Backup, Restore & Off-Server Sync)

- **النسخ المحلي (`scripts/backup-db.js`):**
  - مع MySQL: يستخدم `mysqldump` (`--single-transaction --quick --default-character-set=utf8mb4`)؛ وفي حال عدم توفره ينتج Snapshot JSON كامل (`matn_backup_*.json`) تلقائياً.
  - مع SQLite: ينفّذ `VACUUM INTO` بأمان.
  - يحتفظ تلقائياً بآخر **14 نسخة** ويحذف الأقدم.
  ```bash
  npm run db:backup
  npm run db:restore backups/<backup_file>
  ```
- **النسخ خارج السيرفر (`scripts/sync-backup-rclone.sh`):**
  ```bash
  rclone config   # أنشئ remote باسم matn-gdrive
  chmod +x scripts/sync-backup-rclone.sh
  ./scripts/sync-backup-rclone.sh matn-gdrive:matn-backups
  ```

---

## 5. تشغيل بوت الواتساب الساحب (`whatsapp-bot/`) وربط تطبيق الموبايل (`mobile_app/`)

### بوت الواتساب على جهاز المعلم (Windows / Linux)
1. تأكد أن `BOT_PULL_TOKEN` متطابق في `.env` على الخادم وفي `whatsapp-bot/.env` (بطول >= 32 حرفاً).
2. داخل مجلد `whatsapp-bot/`:
   ```bash
   cp .env.example .env
   npm install
   npm start
   ```
   *(على Windows يمكن تشغيل `whatsapp-bot/start-bot.bat` مباشرة).*
3. افتح `http://127.0.0.1:4001/` وامسح رمز QR من تطبيق واتساب لبدء سحب وإرسال تقارير الجمعة بالتتابع الآمن (تأخير 12–18 ثانية + استراحة 90 ثانية كل 40 رسالة).

### بناء تطبيق الموبايل (`mobile_app/`)
```bash
cd mobile_app
flutter pub get
flutter build apk --release --dart-define=MATN_API_BASE_URL=https://your-production-domain.com
flutter build ipa --release --dart-define=MATN_API_BASE_URL=https://your-production-domain.com
```
*(لاحظ أن المتغير في `mobile_app/lib/config/app_config.dart` هو `MATN_API_BASE_URL`).*
