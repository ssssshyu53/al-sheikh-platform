const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');

function isManagedCloudRuntime(env = process.env) {
  return Boolean(
    env.APPLET_ID ||
    env.K_SERVICE ||
    env.K_REVISION ||
    env.CLOUD_RUN_TIMEOUT_SECONDS ||
    env.CNB_STACK_ID
  );
}

function isDirWritable(dirPath) {
  let current = path.resolve(dirPath);
  while (true) {
    if (fs.existsSync(current)) {
      try {
        fs.accessSync(current, fs.constants.W_OK);
        return true;
      } catch {
        return false;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function isFileOrParentWritable(filePath) {
  const abs = path.resolve(filePath);
  if (!isDirWritable(path.dirname(abs))) return false;
  if (fs.existsSync(abs)) {
    try {
      fs.accessSync(abs, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

function getFallbackStorageRoot() {
  return path.join(os.tmpdir(), 'matn-storage');
}

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
  if (storageRoot) {
    return path.join(storageRoot, 'matn_platform.db');
  }
  const defaultPath = path.join(APP_ROOT, 'matn_platform.db');
  if (isFileOrParentWritable(defaultPath)) {
    return defaultPath;
  }
  return path.join(getFallbackStorageRoot(), 'matn_platform.db');
}

function resolveUploadsDir() {
  const envUploads = (process.env.UPLOADS_DIR || '').trim();
  if (envUploads) return path.resolve(envUploads);
  const storageRoot = resolveStorageRoot();
  if (storageRoot) {
    return path.join(storageRoot, 'uploads');
  }
  const defaultDir = path.join(APP_ROOT, 'uploads');
  if (isDirWritable(defaultDir)) {
    return defaultDir;
  }
  return path.join(getFallbackStorageRoot(), 'uploads');
}

function resolveBackupsDir() {
  const envBackups = (process.env.BACKUPS_DIR || '').trim();
  if (envBackups) return path.resolve(envBackups);
  const storageRoot = resolveStorageRoot();
  if (storageRoot) {
    return path.join(storageRoot, 'backups');
  }
  const defaultDir = path.join(APP_ROOT, 'backups');
  if (isDirWritable(defaultDir)) {
    return defaultDir;
  }
  return path.join(getFallbackStorageRoot(), 'backups');
}

module.exports = {
  APP_ROOT,
  isManagedCloudRuntime,
  getFallbackStorageRoot,
  resolveStorageRoot,
  resolveSqliteDbPath,
  resolveUploadsDir,
  resolveBackupsDir
};
