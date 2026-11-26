const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads environment variables from `.env` (or `MATN_ENV_FILE`) into `process.env`
 * without overriding variables already set in the environment.
 */
function loadEnvFile(customEnvPath) {
  const envFilePath = path.resolve(
    customEnvPath || process.env.MATN_ENV_FILE || path.join(__dirname, '..', '.env')
  );
  if (!fs.existsSync(envFilePath)) return false;

  const envContent = fs.readFileSync(envFilePath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
  return true;
}

module.exports = {
  loadEnvFile
};
