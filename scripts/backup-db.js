/**
 * Unified Database Backup & Restore Utility (MySQL + SQLite)
 * Usage:
 *   node scripts/backup-db.js backup
 *   node scripts/backup-db.js restore <backup_file_path>
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadEnvFile } = require('../lib/env');
loadEnvFile();

const { resolveSqliteDbPath, resolveBackupsDir } = require('../lib/paths');

const MAX_RETAINED_BACKUPS = 14;

const MYSQL_BACKUP_TABLES = [
  'schema_migrations',
  'platform_settings',
  'users',
  'vouchers',
  'lessons',
  'assessments',
  'questions',
  'assessment_sessions',
  'submissions',
  'lesson_progress',
  'lesson_questions',
  'lesson_notes',
  'study_activity',
  'notifications',
  'notification_reads',
  'live_sessions',
  'live_session_attendance',
  'weekly_parent_reports',
  'whatsapp_logs',
  'security_events',
  'audit_logs',
  'login_attempts'
];

/**
 * Escapes single quotes inside a SQLite string literal so paths with `'` do not break VACUUM INTO.
 */
function escapeSqliteStringLiteral(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/'/g, "''");
}

/**
 * Keeps only the latest `keepCount` backup files matching `matn_backup_*.(db|sql|json)`.
 */
function rotateBackups(backupsDir, keepCount = MAX_RETAINED_BACKUPS) {
  if (!fs.existsSync(backupsDir)) return [];
  const entries = fs.readdirSync(backupsDir)
    .filter((f) => /^matn_backup_.*\.(db|sql|json)$/.test(f))
    .sort((a, b) => b.localeCompare(a));

  const deleted = [];
  for (const oldFile of entries.slice(keepCount)) {
    const full = path.join(backupsDir, oldFile);
    try {
      fs.unlinkSync(full);
      deleted.push(oldFile);
    } catch {}
  }
  return deleted;
}

function tryMysqlDump(targetSqlPath) {
  const host = (process.env.DB_HOST || '127.0.0.1').trim();
  const port = String(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'matn_platform';

  const args = [
    `-h${host}`,
    `-P${port}`,
    `-u${user}`,
    '--single-transaction',
    '--quick',
    '--default-character-set=utf8mb4'
  ];

  const useSsl = ['true', '1', 'yes', 'on'].includes(String(process.env.DB_SSL || '').trim().toLowerCase());
  const sslCa = String(process.env.DB_SSL_CA || '').trim();
  if (useSsl || sslCa) {
    const sslMode = String(process.env.DB_SSL_MODE || 'REQUIRED').trim().toUpperCase();
    args.push(`--ssl-mode=${sslMode}`);
    if (sslCa) {
      args.push(`--ssl-ca=${sslCa}`);
    }
  }
  args.push(database);

  const env = { ...process.env };
  if (password) env.MYSQL_PWD = password;

  const dumpSql = execFileSync('mysqldump', args, {
    env,
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  fs.writeFileSync(targetSqlPath, dumpSql);
}

async function createMysqlJsonSnapshot(db, targetJsonPath) {
  const snapshot = {
    format: 'matn-mysql-snapshot-v1',
    client: 'mysql',
    exported_at: new Date().toISOString(),
    tables: {}
  };
  for (const table of MYSQL_BACKUP_TABLES) {
    snapshot.tables[table] = await db.all(`SELECT * FROM \`${table}\``);
  }
  await fs.promises.writeFile(targetJsonPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

async function createDatabaseBackup(db, backupsDir, fileName) {
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (db.isMysql) {
    const sqlName = fileName || `matn_backup_${stamp}.sql`;
    const sqlFile = path.join(backupsDir, sqlName).replace(/\\/g, '/');
    try {
      tryMysqlDump(sqlFile);
      const deleted = rotateBackups(backupsDir, MAX_RETAINED_BACKUPS);
      return { backupFile: sqlFile, deleted, method: 'mysqldump' };
    } catch (dumpErr) {
      if (['true', '1'].includes(String(process.env.REQUIRE_MYSQLDUMP || '').trim().toLowerCase())) {
        throw new Error(`mysqldump failed: ${dumpErr.message}`);
      }
      console.warn(`Warning: mysqldump failed (${dumpErr.message}); falling back to JSON snapshot.`);
      const jsonName = fileName ? fileName.replace(/\.sql$/i, '.json') : `matn_backup_${stamp}.json`;
      const jsonFile = path.join(backupsDir, jsonName).replace(/\\/g, '/');
      await createMysqlJsonSnapshot(db, jsonFile);
      const deleted = rotateBackups(backupsDir, MAX_RETAINED_BACKUPS);
      return { backupFile: jsonFile, deleted, method: 'json_snapshot' };
    }
  }

  const backupName = fileName || `matn_backup_${stamp}.db`;
  const backupFile = path.join(backupsDir, backupName).replace(/\\/g, '/');
  await db.exec(`VACUUM INTO '${escapeSqliteStringLiteral(backupFile)}'`);
  const deleted = rotateBackups(backupsDir, MAX_RETAINED_BACKUPS);
  return { backupFile, deleted, method: 'sqlite_vacuum' };
}

async function restoreMysqlBackup(db, sourceFile) {
  if (sourceFile.endsWith('.json')) {
    const raw = JSON.parse(await fs.promises.readFile(sourceFile, 'utf8'));
    if (!raw || typeof raw.tables !== 'object') {
      throw new Error('Invalid JSON snapshot format.');
    }
    await db.transaction(async (tx) => {
      await tx.exec('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const table of [...MYSQL_BACKUP_TABLES].reverse()) {
          if (Array.isArray(raw.tables[table])) {
            await tx.exec(`DELETE FROM \`${table}\``);
          }
        }
        for (const table of MYSQL_BACKUP_TABLES) {
          const rows = raw.tables[table];
          if (!Array.isArray(rows) || rows.length === 0) continue;
          const cols = Object.keys(rows[0]);
          const colList = cols.map((c) => `\`${c}\``).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const sql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})`;
          for (const row of rows) {
            await tx.run(sql, cols.map((c) => row[c]));
          }
        }
      } finally {
        await tx.exec('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    return;
  }

  const sqlText = await fs.promises.readFile(sourceFile, 'utf8');
  await db.transaction(async (tx) => {
    await tx.exec('SET FOREIGN_KEY_CHECKS = 0');
    try {
      await tx.exec(sqlText);
    } finally {
      await tx.exec('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

async function runCli() {
  const { db, initDatabase } = require('../database');
  const action = (process.argv[2] || 'backup').toLowerCase();
  const backupsDir = resolveBackupsDir();
  fs.mkdirSync(backupsDir, { recursive: true });

  try {
    await initDatabase();

    if (action === 'backup') {
      const { backupFile, deleted, method } = await createDatabaseBackup(db, backupsDir);
      console.log(`Backup created successfully (${method}) at: ${backupFile}`);
      if (deleted.length > 0) {
        console.log(`Rotated ${deleted.length} old backup(s) beyond latest ${MAX_RETAINED_BACKUPS}.`);
      }
    } else if (action === 'restore') {
      const sourceFile = process.argv[3];
      if (!sourceFile || !fs.existsSync(sourceFile)) {
        console.error('Error: Please provide a valid backup file path to restore.');
        process.exitCode = 1;
        return;
      }
      if (db.isMysql) {
        await restoreMysqlBackup(db, sourceFile);
        console.log(`MySQL database restored successfully from: ${sourceFile}`);
      } else {
        const targetDbPath = resolveSqliteDbPath();
        await db.close();
        for (const sidecar of [`${targetDbPath}-wal`, `${targetDbPath}-shm`]) {
          try {
            if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
          } catch {}
        }
        fs.copyFileSync(sourceFile, targetDbPath);
        console.log(`SQLite database restored successfully from: ${sourceFile}`);
      }
    } else {
      console.error('Unknown action. Use "backup" or "restore <path>".');
      process.exitCode = 1;
    }
  } finally {
    await db.close().catch(() => {});
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error('Backup utility error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  MAX_RETAINED_BACKUPS,
  MYSQL_BACKUP_TABLES,
  escapeSqliteStringLiteral,
  rotateBackups,
  createDatabaseBackup,
  restoreMysqlBackup
};
