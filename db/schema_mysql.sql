-- =====================================================================
-- MATN (مَتْن) Educational Platform - Production MySQL Schema (utf8mb4)
-- Compatible with Hostinger Unlimited Web Hosting (MySQL 8.0 / MariaDB)
-- Import via phpMyAdmin OR run automatically via `npm run db:migrate`.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` INT PRIMARY KEY,
  `name` VARCHAR(191) NOT NULL,
  `applied_at` VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(32) NOT NULL UNIQUE,
  `parent_phone` VARCHAR(32),
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'student',
  `grade` VARCHAR(32) DEFAULT 'grade_3',
  `branch` VARCHAR(32) DEFAULT 'scientific',
  `token_version` INT NOT NULL DEFAULT 1,
  `is_locked` TINYINT(1) NOT NULL DEFAULT 0,
  `is_whatsapp_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `whatsapp_otp_hash` VARCHAR(255),
  `whatsapp_otp_expires` VARCHAR(64),
  `otp_attempts` INT NOT NULL DEFAULT 0,
  `otp_resend_count` INT NOT NULL DEFAULT 0,
  `otp_last_sent_at` VARCHAR(64),
  `otp_purpose` VARCHAR(32) NULL,
  `device_id` VARCHAR(128),
  `device_name` VARCHAR(191),
  `device_locked_at` VARCHAR(64),
  `device_reset_requested` TINYINT(1) NOT NULL DEFAULT 0,
  `blocked_login_attempts` INT NOT NULL DEFAULT 0,
  `failed_login_attempts` INT NOT NULL DEFAULT 0,
  `last_failed_login_at` VARCHAR(64),
  `login_locked_until` VARCHAR(64),
  `subscription_expires_at` VARCHAR(64),
  `subscribed_subjects` VARCHAR(191) NOT NULL DEFAULT '',
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_users_role_grade_branch` (`role`, `grade`, `branch`),
  INDEX `idx_users_device_id` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vouchers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(64) NOT NULL UNIQUE,
  `batch_name` VARCHAR(191) NOT NULL,
  `duration_days` INT NOT NULL DEFAULT 30,
  `subject_scope` VARCHAR(191) NOT NULL DEFAULT 'all',
  `grade_scope` VARCHAR(64) NOT NULL DEFAULT 'all',
  `price_egp` DOUBLE NOT NULL DEFAULT 150,
  `is_used` TINYINT(1) NOT NULL DEFAULT 0,
  `used_by_user_id` INT,
  `used_at` VARCHAR(64),
  `expires_after_use_at` VARCHAR(64),
  `assigned_to_name` VARCHAR(191) NULL,
  `assigned_to_phone` VARCHAR(32) NULL,
  `restrict_to_phone` TINYINT(1) NOT NULL DEFAULT 0,
  `sent_at` VARCHAR(64) NULL,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_vouchers_is_used` (`is_used`),
  FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lessons` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `subject` VARCHAR(64) NOT NULL,
  `grade` VARCHAR(32) NOT NULL,
  `branch` VARCHAR(32) NOT NULL DEFAULT 'both',
  `unit_title` VARCHAR(191) NOT NULL,
  `order_index` INT NOT NULL DEFAULT 1,
  `video_type` VARCHAR(32) NOT NULL DEFAULT 'upload',
  `video_path` VARCHAR(512),
  `duration_minutes` INT DEFAULT 45,
  `pdf_title` VARCHAR(255),
  `pdf_path` VARCHAR(512),
  `pdf_content_json` LONGTEXT,
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_lessons_grade_subj_branch_pub_ord` (`grade`, `subject`, `branch`, `is_published`, `order_index`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assessments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `lesson_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `assessment_type` VARCHAR(64) NOT NULL,
  `time_limit_minutes` INT NOT NULL DEFAULT 15,
  `scheduled_start` VARCHAR(64),
  `scheduled_end` VARCHAR(64),
  `target_student_ids_json` LONGTEXT,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_assessments_lesson_type_active` (`lesson_id`, `assessment_type`, `is_active`),
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `assessment_id` INT NOT NULL,
  `question_type` VARCHAR(32) NOT NULL DEFAULT 'mcq',
  `question_text` TEXT NOT NULL,
  `topic_tag` VARCHAR(191) NOT NULL,
  `options_json` LONGTEXT NOT NULL,
  `correct_option` VARCHAR(255) NOT NULL,
  `explanation` TEXT,
  `points` INT NOT NULL DEFAULT 2,
  INDEX `idx_questions_assessment` (`assessment_id`),
  FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `assessment_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `assessment_id` INT NOT NULL,
  `started_at` BIGINT NOT NULL,
  `expires_at` BIGINT NOT NULL,
  `submitted_at` BIGINT,
  INDEX `idx_sessions_user_assessment_sub` (`user_id`, `assessment_id`, `submitted_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `submissions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `lesson_id` INT NOT NULL,
  `assessment_id` INT NOT NULL,
  `assessment_type` VARCHAR(64) NOT NULL,
  `score` INT NOT NULL,
  `total_points` INT NOT NULL,
  `percentage` DOUBLE NOT NULL,
  `passed` TINYINT(1) NOT NULL,
  `answers_json` LONGTEXT,
  `weak_topics_json` LONGTEXT,
  `strong_topics_json` LONGTEXT,
  `time_spent_seconds` INT DEFAULT 0,
  `submitted_at` VARCHAR(64) NOT NULL,
  INDEX `idx_submissions_user_assessment` (`user_id`, `assessment_id`),
  INDEX `idx_submissions_user_lesson_type_passed` (`user_id`, `lesson_id`, `assessment_type`, `passed`),
  INDEX `idx_submissions_lesson_type_passed` (`lesson_id`, `assessment_type`, `passed`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `whatsapp_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `recipient_phone` VARCHAR(32) NOT NULL,
  `student_name` VARCHAR(191),
  `message_type` VARCHAR(64) NOT NULL,
  `message_summary` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `failure_reason` TEXT,
  `created_at` VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `security_events` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT,
  `student_name` VARCHAR(191),
  `phone` VARCHAR(32),
  `event_type` VARCHAR(64) NOT NULL,
  `details` TEXT,
  `created_at` VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `actor_id` INT,
  `actor_role` VARCHAR(32),
  `action` VARCHAR(128) NOT NULL,
  `target_type` VARCHAR(64),
  `target_id` VARCHAR(64),
  `ip_address` VARCHAR(64),
  `details` TEXT,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_audit_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `platform_settings` (
  `key` VARCHAR(191) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_attempts` (
  `ip_address` VARCHAR(64) NOT NULL,
  `phone` VARCHAR(32) NOT NULL,
  `failed_attempts` INT NOT NULL DEFAULT 0,
  `last_failed_at` VARCHAR(64),
  `locked_until` VARCHAR(64),
  PRIMARY KEY (`ip_address`, `phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lesson_progress` (
  `user_id` INT NOT NULL,
  `lesson_id` INT NOT NULL,
  `last_position_seconds` INT NOT NULL DEFAULT 0,
  `duration_seconds` INT NOT NULL DEFAULT 0,
  `max_watched_percent` INT NOT NULL DEFAULT 0,
  `updated_at` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`user_id`, `lesson_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lesson_questions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `lesson_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `question_text` TEXT NOT NULL,
  `admin_answer` TEXT,
  `answered_by_admin_id` INT,
  `is_published` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` VARCHAR(64) NOT NULL,
  `answered_at` VARCHAR(64),
  INDEX `idx_lesson_questions_lesson_pub` (`lesson_id`, `is_published`),
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`answered_by_admin_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `weekly_parent_reports` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `week_key` VARCHAR(32) NOT NULL,
  `user_id` INT NOT NULL,
  `student_name` VARCHAR(191) NOT NULL,
  `parent_phone` VARCHAR(32) NOT NULL,
  `report_text` TEXT NOT NULL,
  `whatsapp_url` TEXT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `claimed_at` VARCHAR(64) NULL,
  `attempt_count` INT NOT NULL DEFAULT 0,
  `error_reason` TEXT,
  `sent_at` VARCHAR(64),
  `created_at` VARCHAR(64) NOT NULL,
  UNIQUE KEY `uniq_weekly_report_week_user` (`week_key`, `user_id`),
  INDEX `idx_weekly_reports_week_status` (`week_key`, `status`),
  INDEX `idx_weekly_reports_claim` (`week_key`, `status`, `claimed_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `notif_type` VARCHAR(64) NOT NULL DEFAULT 'announcement',
  `target_user_id` INT,
  `target_grade` VARCHAR(32) NOT NULL DEFAULT 'all',
  `target_branch` VARCHAR(32) NOT NULL DEFAULT 'all',
  `link_lesson_id` INT,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_notifications_target` (`target_user_id`, `target_grade`, `target_branch`, `created_at`),
  FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`link_lesson_id`) REFERENCES `lessons`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_reads` (
  `notification_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `read_at` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`notification_id`, `user_id`),
  FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `subject` VARCHAR(64) NOT NULL,
  `grade` VARCHAR(32) NOT NULL,
  `branch` VARCHAR(32) NOT NULL DEFAULT 'both',
  `starts_at` VARCHAR(64) NOT NULL,
  `duration_minutes` INT NOT NULL DEFAULT 60,
  `join_early_minutes` INT NOT NULL DEFAULT 15,
  `stream_url` VARCHAR(512) NOT NULL,
  `provider` VARCHAR(64) NOT NULL DEFAULT 'zoom',
  `status` VARCHAR(32) NOT NULL DEFAULT 'scheduled',
  `created_by_admin_id` INT,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_live_sessions_grade_subj_starts` (`grade`, `subject`, `starts_at`),
  FOREIGN KEY (`created_by_admin_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `live_session_attendance` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `live_session_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `joined_at` VARCHAR(64) NOT NULL,
  UNIQUE KEY `uniq_live_attendance` (`live_session_id`, `user_id`),
  FOREIGN KEY (`live_session_id`) REFERENCES `live_sessions`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `lesson_notes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `lesson_id` INT NOT NULL,
  `timestamp_seconds` INT NOT NULL DEFAULT 0,
  `note_text` TEXT NOT NULL,
  `created_at` VARCHAR(64) NOT NULL,
  INDEX `idx_lesson_notes_user_lesson` (`user_id`, `lesson_id`, `timestamp_seconds`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `study_activity` (
  `user_id` INT NOT NULL,
  `activity_date` VARCHAR(32) NOT NULL,
  `actions_count` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`user_id`, `activity_date`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_subject_subscriptions` (
  `user_id` INT NOT NULL,
  `subject` VARCHAR(64) NOT NULL,
  `expires_at` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`user_id`, `subject`),
  INDEX `idx_user_subj_subs_exp` (`user_id`, `expires_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default public platform settings
INSERT IGNORE INTO `platform_settings` (`key`, `value`) VALUES
  ('teacher_name', 'فضيلة الشيخ محمد عبد الله'),
  ('platform_name', 'منصة مَتْن (MATN) للمواد الشرعية'),
  ('admin_whatsapp', '01026379242'),
  ('support_whatsapp', '01026379242'),
  ('vodafone_cash_number', ''),
  ('instapay_handle', ''),
  ('auto_friday_reports_enabled', '1'),
  ('honor_roll_enabled', '1'),
  ('azhar_exam_date', ''),
  ('announcement_banner', 'مرحباً بكم في منصة مَتْن (MATN) لفضيلة الأستاذ محمد عبد الله — للإعدادية والثانوية الأزهرية (الفقه • التفسير • الحديث • التوحيد • المواريث • السيرة • التجويد)');

-- Mark schema versions 1..12 as applied
INSERT IGNORE INTO `schema_migrations` (`version`, `name`, `applied_at`) VALUES
  (1, 'initial_production_schema', UTC_TIMESTAMP()),
  (2, 'performance_indexes_for_700_students', UTC_TIMESTAMP()),
  (3, 'add_preparatory_stages_and_subjects_banner', UTC_TIMESTAMP()),
  (4, 'add_mawareeth_secondary_banner', UTC_TIMESTAMP()),
  (5, 'security_hardening_subscribed_subjects_lockout_and_support_whatsapp', UTC_TIMESTAMP()),
  (6, 'question_type_true_false_support', UTC_TIMESTAMP()),
  (7, 'ip_phone_login_attempts_tracking', UTC_TIMESTAMP()),
  (8, 'vodafone_cash_and_instapay_settings', UTC_TIMESTAMP()),
  (9, 'voucher_assignment_and_phone_lock', UTC_TIMESTAMP()),
  (10, 'progress_qa_weekly_parent_reports_and_honor_roll', UTC_TIMESTAMP()),
  (11, 'in_app_notifications_and_live_sessions', UTC_TIMESTAMP()),
  (12, 'lesson_notes_study_streak_and_exam_countdown', UTC_TIMESTAMP()),
  (13, 'add_otp_purpose_and_per_subject_subs', UTC_TIMESTAMP()),
  (14, 'add_weekly_report_pull_lease', UTC_TIMESTAMP());

SET FOREIGN_KEY_CHECKS = 1;
