/**
 * Secure First-Time Admin Setup Script
 * Usage:
 *   INITIAL_ADMIN_PHONE=010xxxxxxxx INITIAL_ADMIN_PASSWORD="<StrongPassword12+Chars>" node scripts/setup-admin.js
 */
const { loadEnvFile } = require('../lib/env');
loadEnvFile();

const { db, initDatabase, hashPasswordAsync } = require('../database');

function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

async function main() {
  const phone = normalizeDigits(process.env.INITIAL_ADMIN_PHONE || process.argv[2] || '').trim().replace(/\s+/g, '');
  const password = process.env.INITIAL_ADMIN_PASSWORD || process.argv[3] || '';
  const fullName = (process.env.INITIAL_ADMIN_NAME || process.argv[4] || 'فضيلة الأستاذ محمد عبد الله (الإدارة)').trim();

  if (!/^01[0125]\d{8}$/.test(phone)) {
    console.error('Error: Valid Egyptian phone number is required via INITIAL_ADMIN_PHONE or argv[2].');
    process.exit(1);
  }

  if (!password || password.length < 12) {
    console.error('Error: Admin password must be at least 12 characters long via INITIAL_ADMIN_PASSWORD or argv[3].');
    process.exit(1);
  }

  await initDatabase();

  const now = new Date().toISOString();
  const pwHash = await hashPasswordAsync(password);
  const existing = await db.get(`SELECT id FROM users WHERE phone = ?`, [phone]);

  if (existing) {
    await db.run(
      `UPDATE users
       SET full_name = ?, password_hash = ?, role = 'admin', is_whatsapp_verified = 1,
           subscribed_subjects = 'all', is_locked = 0, failed_login_attempts = 0,
           login_locked_until = NULL, token_version = token_version + 1
       WHERE id = ?`,
      [fullName, pwHash, existing.id]
    );
    console.log(`Admin account (${phone}) updated and existing tokens revoked.`);
  } else {
    await db.run(
      `INSERT INTO users (
         full_name, phone, parent_phone, password_hash, role, grade, branch,
         is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
       ) VALUES (?, ?, ?, ?, 'admin', 'grade_3', 'scientific', 1, '2099-12-31T23:59:59.000Z', 'all', ?)`,
      [fullName, phone, phone, pwHash, now]
    );
    console.log(`Admin account (${phone}) created successfully.`);
  }
}

main()
  .catch((err) => {
    console.error('Admin setup failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close().catch(() => {}));
