/**
 * MATN Platform Server Pre-Flight & Production Readiness Check (Hostinger MySQL + SQLite)
 * Usage:
 *   npm run preflight
 *   npm run preflight -- --dev
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { loadEnvFile } = require('../lib/env');
loadEnvFile();

const { resolveDbClient } = require('../db/adapter');
const { APP_ROOT, resolveSqliteDbPath, resolveUploadsDir, resolveBackupsDir } = require('../lib/paths');

function collectJsFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'uploads' || entry.name === 'backups' || entry.name === 'mobile_app') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJsFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function main() {
  const errors = [];
  const warnings = [];

  const dbClient = resolveDbClient();
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    errors.push(`Node.js >= 20.0.0 is required (found v${process.versions.node})`);
  }
  if (dbClient === 'sqlite') {
    if (major < 22 || (major === 22 && minor < 13)) {
      errors.push(`Node.js >= 22.13.0 is required for DB_CLIENT=sqlite (found v${process.versions.node})`);
    }
    try {
      require('node:sqlite');
    } catch {
      errors.push('Built-in node:sqlite module is not available');
    }
  }

  const jsFiles = collectJsFiles(APP_ROOT);
  for (const file of jsFiles) {
    const relPath = path.relative(APP_ROOT, file).replace(/\\/g, '/');
    try {
      if (relPath.startsWith('public/js/')) {
        execFileSync(process.execPath, ['--check', '--input-type=module'], {
          input: fs.readFileSync(file, 'utf8'),
          stdio: 'pipe'
        });
      } else {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      }
    } catch (err) {
      errors.push(`Syntax check failed in ${relPath}: ${err.stderr?.toString() || err.message}`);
    }
  }

  const dbPath = resolveSqliteDbPath();
  const uploadsDir = resolveUploadsDir();
  const backupsDir = resolveBackupsDir();

  try {
    fs.mkdirSync(path.join(uploadsDir, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(uploadsDir, 'pdfs'), { recursive: true });
    fs.mkdirSync(backupsDir, { recursive: true });
  } catch (err) {
    errors.push(`Storage directory error: ${err.message}`);
  }

  const allowDev = process.argv.includes('--dev');
  const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!isProd) {
    const msg = `NODE_ENV is "${process.env.NODE_ENV || 'unset'}" instead of "production" (pass --dev for local development checks).`;
    if (allowDev) warnings.push(msg);
    else errors.push(msg);
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret.length < 32) {
    const msg = 'JWT_SECRET (>= 32 chars) is not set in environment; required on production server.';
    if (isProd) errors.push(msg);
    else warnings.push(msg);
  }

  const streamSecret = process.env.STREAM_TICKET_SECRET || '';
  if (isProd && (!streamSecret || streamSecret.length < 32)) {
    warnings.push('STREAM_TICKET_SECRET (< 32 chars or unset); deriving from JWT_SECRET, set dedicated secret for production isolation.');
  }

  if (dbClient === 'mysql') {
    for (const envVar of ['DB_HOST', 'DB_USER', 'DB_NAME', 'DB_PASSWORD']) {
      if (!String(process.env[envVar] || '').trim()) {
        const msg = `${envVar} is not configured for MySQL mode.`;
        if (isProd) errors.push(msg);
        else warnings.push(msg);
      }
    }
    try {
      require.resolve('mysql2/promise');
    } catch {
      errors.push('Package "mysql2" is not installed (run `npm install --omit=dev`).');
    }
  }

  if (errors.length === 0) {
    const { db, initDatabase } = require('../database');
    try {
      await initDatabase();
      const ok = await db.get('SELECT 1 AS ok');
      if (!ok || Number(ok.ok) !== 1) errors.push(`Database (${dbClient}) SELECT 1 failed`);

      for (const tbl of ['users', 'lessons', 'vouchers', 'platform_settings']) {
        await db.get(`SELECT COUNT(*) AS c FROM ${tbl}`);
      }

      const adminRow = await db.get(`SELECT COUNT(*) AS c FROM users WHERE role = 'admin'`);
      if ((adminRow?.c || 0) < 1) {
        warnings.push('No admin account in database yet. Set INITIAL_ADMIN_PHONE + INITIAL_ADMIN_PASSWORD or run `npm run setup:admin`.');
      }
    } catch (err) {
      errors.push(`Database (${dbClient}) check failed: ${err.message}`);
    } finally {
      await db.close().catch(() => {});
    }
  }

  console.log('=== MATN Platform Pre-Flight Report ===');
  console.log(`Node.js: v${process.versions.node}`);
  console.log(`DB Client: ${dbClient}`);
  console.log(`Syntax checked JS files: ${jsFiles.length}`);
  console.log(dbClient === 'mysql'
    ? `MySQL Target: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'matn_platform'}`
    : `SQLite DB path: ${dbPath}`);
  console.log(`Uploads dir: ${uploadsDir}`);
  console.log(`Backups dir: ${backupsDir}`);

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  - ${w}`);
    if (!jwtSecret) {
      console.log(`  Tip - sample random JWT_SECRET for server .env: ${crypto.randomBytes(32).toString('hex')}`);
    }
  }

  if (errors.length > 0) {
    console.error('\nErrors:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log('\nPre-flight checks PASSED.');
}

main().catch((err) => {
  console.error('Preflight fatal error:', err);
  process.exit(1);
});
