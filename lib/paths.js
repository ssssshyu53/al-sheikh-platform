const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');

/**
 * Resolves the optional unified storage root (`STORAGE_DIR`), ideal for cloud volumes (Railway/Docker).
 */
function resolveStorageRoot() {
  const raw = (process.env.STORAGE_DIR || '').trim();
  return raw ? path.resolve(raw) : null;
}

function resolveSqliteDbPath(customDbPath) {
  if (customDbPath) return customDbPath;
  const envDb = (process.env.SQLITE_DB_PATH || '').trim();
  if (envDb) return envDb;
  const storageRoot = resolveStorageRoot();
  return storageRoot
    ? path.join(storageRoot, 'matn_platform.db')
    : path.join(APP_ROOT, 'matn_platform.db');
}

function resolveUploadsDir() {
  const envUploads = (process.env.UPLOADS_DIR || '').trim();
  if (envUploads) return path.resolve(envUploads);
  const storageRoot = resolveStorageRoot();
  return storageRoot
    ? path.join(storageRoot, 'uploads')
    : path.join(APP_ROOT, 'uploads');
}

function resolveBackupsDir() {
  const envBackups = (process.env.BACKUPS_DIR || '').trim();
  if (envBackups) return path.resolve(envBackups);
  const storageRoot = resolveStorageRoot();
  return storageRoot
    ? path.join(storageRoot, 'backups')
    : path.join(APP_ROOT, 'backups');
}

module.exports = {
  APP_ROOT,
  resolveStorageRoot,
  resolveSqliteDbPath,
  resolveUploadsDir,
  resolveBackupsDir
};
