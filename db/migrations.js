const { loadEnvFile } = require('../lib/env');
loadEnvFile();

const { createDatabaseConnection } = require('./adapter');

const MYSQL_TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

const SQLITE_MIGRATIONS = [
  {
    version: 1,
    name: 'initial_production_schema',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        parent_phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        grade TEXT DEFAULT 'grade_3',
        branch TEXT DEFAULT 'scientific',
        token_version INTEGER NOT NULL DEFAULT 1,
        is_locked INTEGER NOT NULL DEFAULT 0,
        is_whatsapp_verified INTEGER NOT NULL DEFAULT 0,
        whatsapp_otp_hash TEXT,
        whatsapp_otp_expires TEXT,
        otp_attempts INTEGER NOT NULL DEFAULT 0,
        otp_resend_count INTEGER NOT NULL DEFAULT 0,
        otp_last_sent_at TEXT,
        device_id TEXT,
        device_name TEXT,
        device_locked_at TEXT,
        device_reset_requested INTEGER NOT NULL DEFAULT 0,
        blocked_login_attempts INTEGER NOT NULL DEFAULT 0,
        subscription_expires_at TEXT,
        subscribed_subjects TEXT DEFAULT 'all',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        batch_name TEXT NOT NULL,
        duration_days INTEGER NOT NULL DEFAULT 30,
        subject_scope TEXT NOT NULL DEFAULT 'all',
        grade_scope TEXT NOT NULL DEFAULT 'all',
        price_egp REAL NOT NULL DEFAULT 150,
        is_used INTEGER NOT NULL DEFAULT 0,
        used_by_user_id INTEGER,
        used_at TEXT,
        expires_after_use_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        subject TEXT NOT NULL,
        grade TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'both',
        unit_title TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 1,
        video_type TEXT NOT NULL DEFAULT 'upload',
        video_path TEXT,
        duration_minutes INTEGER DEFAULT 45,
        pdf_title TEXT,
        pdf_path TEXT,
        pdf_content_json TEXT,
        is_published INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        assessment_type TEXT NOT NULL,
        time_limit_minutes INTEGER NOT NULL DEFAULT 15,
        scheduled_start TEXT,
        scheduled_end TEXT,
        target_student_ids_json TEXT DEFAULT '[]',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        topic_tag TEXT NOT NULL,
        options_json TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        explanation TEXT,
        points INTEGER NOT NULL DEFAULT 2,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS assessment_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        assessment_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        submitted_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        lesson_id INTEGER NOT NULL,
        assessment_id INTEGER NOT NULL,
        assessment_type TEXT NOT NULL,
        score INTEGER NOT NULL,
        total_points INTEGER NOT NULL,
        percentage REAL NOT NULL,
        passed INTEGER NOT NULL,
        answers_json TEXT,
        weak_topics_json TEXT,
        strong_topics_json TEXT,
        time_spent_seconds INTEGER DEFAULT 0,
        submitted_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient_phone TEXT NOT NULL,
        student_name TEXT,
        message_type TEXT NOT NULL,
        message_summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        failure_reason TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        student_name TEXT,
        phone TEXT,
        event_type TEXT NOT NULL,
        details TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id INTEGER,
        actor_role TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        ip_address TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS platform_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    name: 'performance_indexes_for_700_students',
    up: `
      CREATE INDEX IF NOT EXISTS idx_users_role_grade_branch ON users(role, grade, branch);
      CREATE INDEX IF NOT EXISTS idx_lessons_grade_subj_branch_pub_ord ON lessons(grade, subject, branch, is_published, order_index);
      CREATE INDEX IF NOT EXISTS idx_assessments_lesson_type_active ON assessments(lesson_id, assessment_type, is_active);
      CREATE INDEX IF NOT EXISTS idx_questions_assessment ON questions(assessment_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_assessment_sub ON assessment_sessions(user_id, assessment_id, submitted_at);
      CREATE INDEX IF NOT EXISTS idx_submissions_user_assessment ON submissions(user_id, assessment_id);
      CREATE INDEX IF NOT EXISTS idx_submissions_user_lesson_type_passed ON submissions(user_id, lesson_id, assessment_type, passed);
      CREATE INDEX IF NOT EXISTS idx_submissions_lesson_type_passed ON submissions(lesson_id, assessment_type, passed);
      CREATE INDEX IF NOT EXISTS idx_vouchers_is_used ON vouchers(is_used);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    `
  },
  {
    version: 3,
    name: 'add_preparatory_stages_and_subjects_banner',
    up: `
      UPDATE platform_settings
      SET value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • السيرة • التجويد)'
      WHERE key = 'announcement_banner'
        AND value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للثانوية الأزهرية (الحديث • الفقه الشافعي • التوحيد • التفسير)';
    `
  },
  {
    version: 4,
    name: 'add_mawareeth_secondary_banner',
    up: `
      UPDATE platform_settings
      SET value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • المواريث • السيرة • التجويد)'
      WHERE key = 'announcement_banner'
        AND value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • السيرة • التجويد)';
    `
  },
  {
    version: 5,
    name: 'security_hardening_subscribed_subjects_lockout_and_support_whatsapp',
    up: `
      PRAGMA foreign_keys = OFF;
      BEGIN TRANSACTION;

      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        parent_phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student',
        grade TEXT DEFAULT 'grade_3',
        branch TEXT DEFAULT 'scientific',
        token_version INTEGER NOT NULL DEFAULT 1,
        is_locked INTEGER NOT NULL DEFAULT 0,
        is_whatsapp_verified INTEGER NOT NULL DEFAULT 0,
        whatsapp_otp_hash TEXT,
        whatsapp_otp_expires TEXT,
        otp_attempts INTEGER NOT NULL DEFAULT 0,
        otp_resend_count INTEGER NOT NULL DEFAULT 0,
        otp_last_sent_at TEXT,
        device_id TEXT,
        device_name TEXT,
        device_locked_at TEXT,
        device_reset_requested INTEGER NOT NULL DEFAULT 0,
        blocked_login_attempts INTEGER NOT NULL DEFAULT 0,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        last_failed_login_at TEXT,
        login_locked_until TEXT,
        subscription_expires_at TEXT,
        subscribed_subjects TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      INSERT INTO users_new (
        id, full_name, phone, parent_phone, password_hash, role, grade, branch,
        token_version, is_locked, is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires,
        otp_attempts, otp_resend_count, otp_last_sent_at, device_id, device_name, device_locked_at,
        device_reset_requested, blocked_login_attempts, failed_login_attempts, last_failed_login_at,
        login_locked_until, subscription_expires_at, subscribed_subjects, created_at
      )
      SELECT
        id, full_name, phone, parent_phone, password_hash, role, grade, branch,
        token_version, is_locked, is_whatsapp_verified, whatsapp_otp_hash, whatsapp_otp_expires,
        otp_attempts, otp_resend_count, otp_last_sent_at, device_id, device_name, device_locked_at,
        device_reset_requested, blocked_login_attempts, 0, NULL, NULL,
        subscription_expires_at,
        CASE
          WHEN role = 'admin' THEN 'all'
          WHEN subscription_expires_at IS NOT NULL THEN COALESCE(subscribed_subjects, '')
          ELSE ''
        END,
        created_at
      FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      CREATE INDEX IF NOT EXISTS idx_users_role_grade_branch ON users(role, grade, branch);
      CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);

      INSERT OR IGNORE INTO platform_settings (key, value)
      VALUES (
        'support_whatsapp',
        COALESCE((SELECT value FROM platform_settings WHERE key = 'admin_whatsapp' LIMIT 1), '01026379242')
      );

      COMMIT;
      PRAGMA foreign_keys = ON;
    `
  },
  {
    version: 6,
    name: 'question_type_true_false_support',
    up: `
      ALTER TABLE questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'mcq';
    `
  },
  {
    version: 7,
    name: 'ip_phone_login_attempts_tracking',
    up: `
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip_address TEXT NOT NULL,
        phone TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        last_failed_at TEXT,
        locked_until TEXT,
        PRIMARY KEY (ip_address, phone)
      );
    `
  },
  {
    version: 8,
    name: 'vodafone_cash_and_instapay_settings',
    up: `
      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('vodafone_cash_number', '');
      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('instapay_handle', '');
    `
  },
  {
    version: 9,
    name: 'voucher_assignment_and_phone_lock',
    up: `
      ALTER TABLE vouchers ADD COLUMN assigned_to_name TEXT;
      ALTER TABLE vouchers ADD COLUMN assigned_to_phone TEXT;
      ALTER TABLE vouchers ADD COLUMN restrict_to_phone INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vouchers ADD COLUMN sent_at TEXT;
    `
  },
  {
    version: 10,
    name: 'progress_qa_weekly_parent_reports_and_honor_roll',
    up: `
      CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id INTEGER NOT NULL,
        lesson_id INTEGER NOT NULL,
        last_position_seconds INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        max_watched_percent INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, lesson_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS lesson_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        question_text TEXT NOT NULL,
        admin_answer TEXT,
        answered_by_admin_id INTEGER,
        is_published INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        answered_at TEXT,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (answered_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lesson_questions_lesson_pub ON lesson_questions(lesson_id, is_published);

      CREATE TABLE IF NOT EXISTS weekly_parent_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_key TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        student_name TEXT NOT NULL,
        parent_phone TEXT NOT NULL,
        report_text TEXT NOT NULL,
        whatsapp_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_reason TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(week_key, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_weekly_reports_week_status ON weekly_parent_reports(week_key, status);

      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('auto_friday_reports_enabled', '1');
      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('honor_roll_enabled', '1');
    `
  },
  {
    version: 11,
    name: 'in_app_notifications_and_live_sessions',
    up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        notif_type TEXT NOT NULL DEFAULT 'announcement',
        target_user_id INTEGER,
        target_grade TEXT NOT NULL DEFAULT 'all',
        target_branch TEXT NOT NULL DEFAULT 'all',
        link_lesson_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (link_lesson_id) REFERENCES lessons(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_user_id, target_grade, target_branch, created_at DESC);

      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (notification_id, user_id),
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS live_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        subject TEXT NOT NULL,
        grade TEXT NOT NULL,
        branch TEXT NOT NULL DEFAULT 'both',
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 60,
        join_early_minutes INTEGER NOT NULL DEFAULT 15,
        stream_url TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'zoom',
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_by_admin_id INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_live_sessions_grade_subj_starts ON live_sessions(grade, subject, starts_at);

      CREATE TABLE IF NOT EXISTS live_session_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        live_session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        UNIQUE(live_session_id, user_id),
        FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `
  },
  {
    version: 12,
    name: 'lesson_notes_study_streak_and_exam_countdown',
    up: `
      CREATE TABLE IF NOT EXISTS lesson_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        lesson_id INTEGER NOT NULL,
        timestamp_seconds INTEGER NOT NULL DEFAULT 0,
        note_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_lesson_notes_user_lesson ON lesson_notes(user_id, lesson_id, timestamp_seconds ASC);

      CREATE TABLE IF NOT EXISTS study_activity (
        user_id INTEGER NOT NULL,
        activity_date TEXT NOT NULL,
        actions_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, activity_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO platform_settings (key, value) VALUES ('azhar_exam_date', '');
    `
  },
  {
    version: 13,
    name: 'add_otp_purpose_and_per_subject_subs',
    up: `
      ALTER TABLE users ADD COLUMN otp_purpose TEXT;

      CREATE TABLE IF NOT EXISTS user_subject_subscriptions (
        user_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (user_id, subject),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_subj_subs_exp ON user_subject_subscriptions(user_id, expires_at);
    `,
    postRunSqlite: async (db) => {
      const rows = await db.all(
        `SELECT id, subscribed_subjects, subscription_expires_at FROM users
         WHERE role = 'student' AND subscribed_subjects IS NOT NULL AND subscribed_subjects != '' AND subscribed_subjects != 'all' AND subscription_expires_at IS NOT NULL`
      );
      for (const u of rows) {
        for (const s of String(u.subscribed_subjects).split(',').map((x) => x.trim()).filter(Boolean)) {
          await db.run(
            `INSERT OR IGNORE INTO user_subject_subscriptions (user_id, subject, expires_at) VALUES (?, ?, ?)`,
            [u.id, s, u.subscription_expires_at]
          );
        }
      }
    }
  },
  {
    version: 14,
    name: 'add_weekly_report_pull_lease',
    up: `
      CREATE INDEX IF NOT EXISTS idx_weekly_reports_week_status ON weekly_parent_reports(week_key, status);
    `,
    postRunSqlite: async (db) => {
      const cols = await db.all(`PRAGMA table_info(weekly_parent_reports)`);
      const names = new Set(cols.map((c) => c.name));
      if (!names.has('claimed_at')) {
        await db.exec(`ALTER TABLE weekly_parent_reports ADD COLUMN claimed_at TEXT`);
      }
      if (!names.has('attempt_count')) {
        await db.exec(`ALTER TABLE weekly_parent_reports ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0`);
      }
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_weekly_reports_claim ON weekly_parent_reports(week_key, status, claimed_at)`);
    }
  }
];

async function ensureMysqlColumn(db, tableName, columnName, columnDef) {
  const row = await db.get(
    `SELECT 1 AS found_col FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName]
  );
  if (!row) {
    await db.exec(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${columnDef}`);
  }
}

async function ensureMysqlIndex(db, tableName, indexName, columnsExpr) {
  const row = await db.get(
    `SELECT 1 AS found_idx FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tableName, indexName]
  );
  if (!row) {
    await db.exec(`CREATE INDEX \`${indexName}\` ON \`${tableName}\` (${columnsExpr})`);
  }
}

const MYSQL_MIGRATIONS = [
  {
    version: 1,
    name: 'initial_production_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(191) NOT NULL,
        applied_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(32) NOT NULL UNIQUE,
        parent_phone VARCHAR(32),
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'student',
        grade VARCHAR(32) DEFAULT 'grade_3',
        branch VARCHAR(32) DEFAULT 'scientific',
        token_version INT NOT NULL DEFAULT 1,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        is_whatsapp_verified TINYINT(1) NOT NULL DEFAULT 0,
        whatsapp_otp_hash VARCHAR(255),
        whatsapp_otp_expires VARCHAR(64),
        otp_attempts INT NOT NULL DEFAULT 0,
        otp_resend_count INT NOT NULL DEFAULT 0,
        otp_last_sent_at VARCHAR(64),
        device_id VARCHAR(128),
        device_name VARCHAR(191),
        device_locked_at VARCHAR(64),
        device_reset_requested TINYINT(1) NOT NULL DEFAULT 0,
        blocked_login_attempts INT NOT NULL DEFAULT 0,
        failed_login_attempts INT NOT NULL DEFAULT 0,
        last_failed_login_at VARCHAR(64),
        login_locked_until VARCHAR(64),
        subscription_expires_at VARCHAR(64),
        subscribed_subjects VARCHAR(191) NOT NULL DEFAULT '',
        created_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS vouchers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(64) NOT NULL UNIQUE,
        batch_name VARCHAR(191) NOT NULL,
        duration_days INT NOT NULL DEFAULT 30,
        subject_scope VARCHAR(191) NOT NULL DEFAULT 'all',
        grade_scope VARCHAR(64) NOT NULL DEFAULT 'all',
        price_egp DOUBLE NOT NULL DEFAULT 150,
        is_used TINYINT(1) NOT NULL DEFAULT 0,
        used_by_user_id INT,
        used_at VARCHAR(64),
        expires_after_use_at VARCHAR(64),
        created_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (used_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        subject VARCHAR(64) NOT NULL,
        grade VARCHAR(32) NOT NULL,
        branch VARCHAR(32) NOT NULL DEFAULT 'both',
        unit_title VARCHAR(191) NOT NULL,
        order_index INT NOT NULL DEFAULT 1,
        video_type VARCHAR(32) NOT NULL DEFAULT 'upload',
        video_path VARCHAR(512),
        duration_minutes INT DEFAULT 45,
        pdf_title VARCHAR(255),
        pdf_path VARCHAR(512),
        pdf_content_json LONGTEXT,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        created_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lesson_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        assessment_type VARCHAR(64) NOT NULL,
        time_limit_minutes INT NOT NULL DEFAULT 15,
        scheduled_start VARCHAR(64),
        scheduled_end VARCHAR(64),
        target_student_ids_json LONGTEXT,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        assessment_id INT NOT NULL,
        question_text TEXT NOT NULL,
        topic_tag VARCHAR(191) NOT NULL,
        options_json LONGTEXT NOT NULL,
        correct_option VARCHAR(255) NOT NULL,
        explanation TEXT,
        points INT NOT NULL DEFAULT 2,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS assessment_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        assessment_id INT NOT NULL,
        started_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        submitted_at BIGINT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        assessment_id INT NOT NULL,
        assessment_type VARCHAR(64) NOT NULL,
        score INT NOT NULL,
        total_points INT NOT NULL,
        percentage DOUBLE NOT NULL,
        passed TINYINT(1) NOT NULL,
        answers_json LONGTEXT,
        weak_topics_json LONGTEXT,
        strong_topics_json LONGTEXT,
        time_spent_seconds INT DEFAULT 0,
        submitted_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
        FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        recipient_phone VARCHAR(32) NOT NULL,
        student_name VARCHAR(191),
        message_type VARCHAR(64) NOT NULL,
        message_summary TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        failure_reason TEXT,
        created_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS security_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        student_name VARCHAR(191),
        phone VARCHAR(32),
        event_type VARCHAR(64) NOT NULL,
        details TEXT,
        created_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        actor_id INT,
        actor_role VARCHAR(32),
        action VARCHAR(128) NOT NULL,
        target_type VARCHAR(64),
        target_id VARCHAR(64),
        ip_address VARCHAR(64),
        details TEXT,
        created_at VARCHAR(64) NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS platform_settings (
        \`key\` VARCHAR(191) PRIMARY KEY,
        value TEXT NOT NULL
      ) ${MYSQL_TABLE_OPTIONS};
    `
  },
  {
    version: 2,
    name: 'performance_indexes_for_700_students',
    run: async (db) => {
      await ensureMysqlIndex(db, 'users', 'idx_users_role_grade_branch', 'role, grade, branch');
      await ensureMysqlIndex(db, 'lessons', 'idx_lessons_grade_subj_branch_pub_ord', 'grade, subject, branch, is_published, order_index');
      await ensureMysqlIndex(db, 'assessments', 'idx_assessments_lesson_type_active', 'lesson_id, assessment_type, is_active');
      await ensureMysqlIndex(db, 'questions', 'idx_questions_assessment', 'assessment_id');
      await ensureMysqlIndex(db, 'assessment_sessions', 'idx_sessions_user_assessment_sub', 'user_id, assessment_id, submitted_at');
      await ensureMysqlIndex(db, 'submissions', 'idx_submissions_user_assessment', 'user_id, assessment_id');
      await ensureMysqlIndex(db, 'submissions', 'idx_submissions_user_lesson_type_passed', 'user_id, lesson_id, assessment_type, passed');
      await ensureMysqlIndex(db, 'submissions', 'idx_submissions_lesson_type_passed', 'lesson_id, assessment_type, passed');
      await ensureMysqlIndex(db, 'vouchers', 'idx_vouchers_is_used', 'is_used');
      await ensureMysqlIndex(db, 'audit_logs', 'idx_audit_logs_created', 'created_at');
    }
  },
  {
    version: 3,
    name: 'add_preparatory_stages_and_subjects_banner',
    sql: `
      UPDATE platform_settings
      SET value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • السيرة • التجويد)'
      WHERE \`key\` = 'announcement_banner'
        AND value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للثانوية الأزهرية (الحديث • الفقه الشافعي • التوحيد • التفسير)';
    `
  },
  {
    version: 4,
    name: 'add_mawareeth_secondary_banner',
    sql: `
      UPDATE platform_settings
      SET value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • المواريث • السيرة • التجويد)'
      WHERE \`key\` = 'announcement_banner'
        AND value = 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • السيرة • التجويد)';
    `
  },
  {
    version: 5,
    name: 'security_hardening_subscribed_subjects_lockout_and_support_whatsapp',
    run: async (db) => {
      await ensureMysqlColumn(db, 'users', 'failed_login_attempts', 'INT NOT NULL DEFAULT 0');
      await ensureMysqlColumn(db, 'users', 'last_failed_login_at', 'VARCHAR(64) NULL');
      await ensureMysqlColumn(db, 'users', 'login_locked_until', 'VARCHAR(64) NULL');
      await ensureMysqlIndex(db, 'users', 'idx_users_role_grade_branch', 'role, grade, branch');
      await ensureMysqlIndex(db, 'users', 'idx_users_device_id', 'device_id');

      const adminWa = await db.get("SELECT value FROM platform_settings WHERE \`key\` = 'admin_whatsapp' LIMIT 1");
      await db.run(
        "INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('support_whatsapp', ?)",
        [adminWa?.value || '01026379242']
      );
    }
  },
  {
    version: 6,
    name: 'question_type_true_false_support',
    run: async (db) => {
      await ensureMysqlColumn(db, 'questions', 'question_type', "VARCHAR(32) NOT NULL DEFAULT 'mcq'");
    }
  },
  {
    version: 7,
    name: 'ip_phone_login_attempts_tracking',
    sql: `
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip_address VARCHAR(64) NOT NULL,
        phone VARCHAR(32) NOT NULL,
        failed_attempts INT NOT NULL DEFAULT 0,
        last_failed_at VARCHAR(64),
        locked_until VARCHAR(64),
        PRIMARY KEY (ip_address, phone)
      ) ${MYSQL_TABLE_OPTIONS};
    `
  },
  {
    version: 8,
    name: 'vodafone_cash_and_instapay_settings',
    sql: `
      INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('vodafone_cash_number', '');
      INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('instapay_handle', '');
    `
  },
  {
    version: 9,
    name: 'voucher_assignment_and_phone_lock',
    run: async (db) => {
      await ensureMysqlColumn(db, 'vouchers', 'assigned_to_name', 'VARCHAR(191) NULL');
      await ensureMysqlColumn(db, 'vouchers', 'assigned_to_phone', 'VARCHAR(32) NULL');
      await ensureMysqlColumn(db, 'vouchers', 'restrict_to_phone', 'TINYINT(1) NOT NULL DEFAULT 0');
      await ensureMysqlColumn(db, 'vouchers', 'sent_at', 'VARCHAR(64) NULL');
    }
  },
  {
    version: 10,
    name: 'progress_qa_weekly_parent_reports_and_honor_roll',
    sql: `
      CREATE TABLE IF NOT EXISTS lesson_progress (
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        last_position_seconds INT NOT NULL DEFAULT 0,
        duration_seconds INT NOT NULL DEFAULT 0,
        max_watched_percent INT NOT NULL DEFAULT 0,
        updated_at VARCHAR(64) NOT NULL,
        PRIMARY KEY (user_id, lesson_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS lesson_questions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lesson_id INT NOT NULL,
        user_id INT NOT NULL,
        question_text TEXT NOT NULL,
        admin_answer TEXT,
        answered_by_admin_id INT,
        is_published TINYINT(1) NOT NULL DEFAULT 0,
        created_at VARCHAR(64) NOT NULL,
        answered_at VARCHAR(64),
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (answered_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS weekly_parent_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        week_key VARCHAR(32) NOT NULL,
        user_id INT NOT NULL,
        student_name VARCHAR(191) NOT NULL,
        parent_phone VARCHAR(32) NOT NULL,
        report_text TEXT NOT NULL,
        whatsapp_url TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        error_reason TEXT,
        sent_at VARCHAR(64),
        created_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uniq_weekly_report_week_user (week_key, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('auto_friday_reports_enabled', '1');
      INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('honor_roll_enabled', '1');
    `,
    postRun: async (db) => {
      await ensureMysqlIndex(db, 'lesson_questions', 'idx_lesson_questions_lesson_pub', 'lesson_id, is_published');
      await ensureMysqlIndex(db, 'weekly_parent_reports', 'idx_weekly_reports_week_status', 'week_key, status');
    }
  },
  {
    version: 11,
    name: 'in_app_notifications_and_live_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        notif_type VARCHAR(64) NOT NULL DEFAULT 'announcement',
        target_user_id INT,
        target_grade VARCHAR(32) NOT NULL DEFAULT 'all',
        target_branch VARCHAR(32) NOT NULL DEFAULT 'all',
        link_lesson_id INT,
        created_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (link_lesson_id) REFERENCES lessons(id) ON DELETE SET NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS notification_reads (
        notification_id INT NOT NULL,
        user_id INT NOT NULL,
        read_at VARCHAR(64) NOT NULL,
        PRIMARY KEY (notification_id, user_id),
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS live_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        subject VARCHAR(64) NOT NULL,
        grade VARCHAR(32) NOT NULL,
        branch VARCHAR(32) NOT NULL DEFAULT 'both',
        starts_at VARCHAR(64) NOT NULL,
        duration_minutes INT NOT NULL DEFAULT 60,
        join_early_minutes INT NOT NULL DEFAULT 15,
        stream_url VARCHAR(512) NOT NULL,
        provider VARCHAR(64) NOT NULL DEFAULT 'zoom',
        status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
        created_by_admin_id INT,
        created_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS live_session_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        live_session_id INT NOT NULL,
        user_id INT NOT NULL,
        joined_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uniq_live_attendance (live_session_id, user_id),
        FOREIGN KEY (live_session_id) REFERENCES live_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};
    `,
    postRun: async (db) => {
      await ensureMysqlIndex(db, 'notifications', 'idx_notifications_target', 'target_user_id, target_grade, target_branch, created_at');
      await ensureMysqlIndex(db, 'live_sessions', 'idx_live_sessions_grade_subj_starts', 'grade, subject, starts_at');
    }
  },
  {
    version: 12,
    name: 'lesson_notes_study_streak_and_exam_countdown',
    sql: `
      CREATE TABLE IF NOT EXISTS lesson_notes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        lesson_id INT NOT NULL,
        timestamp_seconds INT NOT NULL DEFAULT 0,
        note_text TEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      CREATE TABLE IF NOT EXISTS study_activity (
        user_id INT NOT NULL,
        activity_date VARCHAR(32) NOT NULL,
        actions_count INT NOT NULL DEFAULT 1,
        PRIMARY KEY (user_id, activity_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};

      INSERT IGNORE INTO platform_settings (\`key\`, value) VALUES ('azhar_exam_date', '');
    `,
    postRun: async (db) => {
      await ensureMysqlIndex(db, 'lesson_notes', 'idx_lesson_notes_user_lesson', 'user_id, lesson_id, timestamp_seconds');
    }
  },
  {
    version: 13,
    name: 'add_otp_purpose_and_per_subject_subs',
    sql: `
      CREATE TABLE IF NOT EXISTS user_subject_subscriptions (
        user_id INT NOT NULL,
        subject VARCHAR(64) NOT NULL,
        expires_at VARCHAR(64) NOT NULL,
        PRIMARY KEY (user_id, subject),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ${MYSQL_TABLE_OPTIONS};
    `,
    run: async (db) => {
      await ensureMysqlColumn(db, 'users', 'otp_purpose', 'VARCHAR(32) NULL');
    },
    postRun: async (db) => {
      await ensureMysqlIndex(db, 'user_subject_subscriptions', 'idx_user_subj_subs_exp', 'user_id, expires_at');
      const rows = await db.all(
        `SELECT id, subscribed_subjects, subscription_expires_at FROM users
         WHERE role = 'student' AND subscribed_subjects IS NOT NULL AND subscribed_subjects != '' AND subscribed_subjects != 'all' AND subscription_expires_at IS NOT NULL`
      );
      for (const u of rows) {
        for (const s of String(u.subscribed_subjects).split(',').map((x) => x.trim()).filter(Boolean)) {
          await db.run(
            `INSERT IGNORE INTO user_subject_subscriptions (user_id, subject, expires_at) VALUES (?, ?, ?)`,
            [u.id, s, u.subscription_expires_at]
          );
        }
      }
    }
  },
  {
    version: 14,
    name: 'add_weekly_report_pull_lease',
    run: async (db) => {
      await ensureMysqlColumn(db, 'weekly_parent_reports', 'claimed_at', 'VARCHAR(64) NULL');
      await ensureMysqlColumn(db, 'weekly_parent_reports', 'attempt_count', 'INT NOT NULL DEFAULT 0');
    },
    postRun: async (db) => {
      await ensureMysqlIndex(db, 'weekly_parent_reports', 'idx_weekly_reports_claim', 'week_key, status, claimed_at');
    }
  }
];

async function runMigrations(dbInstance) {
  const db = dbInstance || createDatabaseConnection();
  const isMysql = Boolean(db.isMysql);

  if (isMysql) {
    let lockAcquired = false;
    try {
      const lockRow = await db.get("SELECT GET_LOCK('matn_migrate', 30) AS acquired");
      lockAcquired = Number(lockRow?.acquired || 0) === 1;
    } catch {}

    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          applied_at VARCHAR(64) NOT NULL
        ) ${MYSQL_TABLE_OPTIONS};
      `);

      const now = new Date().toISOString();
      for (const m of MYSQL_MIGRATIONS) {
        const exists = await db.get('SELECT version FROM schema_migrations WHERE version = ?', [m.version]);
        if (!exists) {
          if (m.sql) await db.exec(m.sql);
          if (typeof m.run === 'function') await m.run(db);
          if (typeof m.postRun === 'function') await m.postRun(db);
          await db.run('INSERT IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, now]);
        }
      }
    } finally {
      if (lockAcquired) {
        try { await db.get("SELECT RELEASE_LOCK('matn_migrate')"); } catch {}
      }
    }
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    for (const m of SQLITE_MIGRATIONS) {
      const exists = await db.get('SELECT version FROM schema_migrations WHERE version = ?', [m.version]);
      if (!exists) {
        await db.exec(m.up);
        if (typeof m.postRunSqlite === 'function') await m.postRunSqlite(db);
        await db.run('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, now]);
      }
    }
  }

  const defaultPublicSettings = {
    teacher_name: 'فضيلة الشيخ محمد عبد الله',
    platform_name: 'منصة مَتْن (MATN) للمواد الشرعية',
    admin_whatsapp: '01026379242',
    support_whatsapp: '01026379242',
    vodafone_cash_number: '',
    instapay_handle: '',
    auto_friday_reports_enabled: '1',
    honor_roll_enabled: '1',
    azhar_exam_date: '',
    announcement_banner: 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • المواريث • السيرة • التجويد)'
  };

  const insertPrefix = db.insertIgnorePrefix ? db.insertIgnorePrefix() : (isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');
  for (const [k, v] of Object.entries(defaultPublicSettings)) {
    await db.run(`${insertPrefix} platform_settings (\`key\`, value) VALUES (?, ?)`, [k, v]);
  }

  return db;
}

if (require.main === module) {
  (async () => {
    const db = createDatabaseConnection();
    try {
      await runMigrations(db);
      console.log(`Database migrations and indexes applied successfully (${db.client}).`);
    } finally {
      await db.close();
    }
  })().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

module.exports = {
  runMigrations,
  MYSQL_MIGRATIONS,
  SQLITE_MIGRATIONS
};
