const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { createDatabaseConnection } = require('./db/adapter');
const { runMigrations } = require('./db/migrations');

const scryptAsync = promisify(crypto.scrypt);
const db = createDatabaseConnection();

let initPromise = null;

async function bootstrapInitialAdmin() {
  if (process.env.INITIAL_ADMIN_PHONE && process.env.INITIAL_ADMIN_PASSWORD) {
    let lockAcquired = false;
    if (db.isMysql) {
      try {
        const lockRow = await db.get("SELECT GET_LOCK('matn_bootstrap_admin', 15) AS acquired");
        lockAcquired = Number(lockRow?.acquired || 0) === 1;
      } catch {}
    }
    try {
      const existingAdmin = await db.get(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
      if (!existingAdmin) {
        const now = new Date().toISOString();
        const adminPhone = process.env.INITIAL_ADMIN_PHONE.trim();
        const passwordHash = await hashPasswordAsync(process.env.INITIAL_ADMIN_PASSWORD);
        const prefix = db.insertIgnorePrefix ? db.insertIgnorePrefix() : (db.isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO');
        await db.run(
          `${prefix} users (
            full_name, phone, parent_phone, password_hash, role, grade, branch,
            is_whatsapp_verified, subscription_expires_at, subscribed_subjects, created_at
          ) VALUES (?, ?, ?, ?, 'admin', 'grade_3', 'scientific', 1, '2099-12-31T23:59:59.000Z', 'all', ?)`,
          [
            process.env.INITIAL_ADMIN_NAME || 'فضيلة الأستاذ محمد عبد الله (الإدارة)',
            adminPhone,
            adminPhone,
            passwordHash,
            now
          ]
        );
      }
    } finally {
      if (lockAcquired) {
        try { await db.get("SELECT RELEASE_LOCK('matn_bootstrap_admin')"); } catch {}
      }
    }
  }
}

function initDatabase() {
  if (!initPromise) {
    initPromise = (async () => {
      await runMigrations(db);
      await bootstrapInitialAdmin();
      return db;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const KEYLEN = 64;
const OTP_KEYLEN = 32;
const MAX_CONCURRENT_SCRYPT = Math.max(1, Number(process.env.MAX_CONCURRENT_SCRYPT || 4));
const MAX_SCRYPT_QUEUE = Math.max(10, Number(process.env.MAX_SCRYPT_QUEUE || 100));

let activeScryptCount = 0;
const scryptWaitQueue = [];

/**
 * Limits concurrent async scrypt derivations so burst logins cannot saturate libuv threads or memory.
 */
function runBoundedScrypt(fn) {
  return new Promise((resolve, reject) => {
    const execute = async () => {
      activeScryptCount++;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        activeScryptCount--;
        const next = scryptWaitQueue.shift();
        if (next) next();
      }
    };
    if (activeScryptCount < MAX_CONCURRENT_SCRYPT) {
      execute();
    } else if (scryptWaitQueue.length >= MAX_SCRYPT_QUEUE) {
      const overloadErr = new Error('الخادم مزدحم حالياً بطلبات تسجيل الدخول. يرجى المحاولة بعد ثوانٍ.');
      overloadErr.statusCode = 503;
      reject(overloadErr);
    } else {
      scryptWaitQueue.push(execute);
    }
  });
}

function parseScryptHash(storedHash) {
  const parts = storedHash.split('$');
  if (parts.length !== 6) return null;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isInteger(N) || N < 1024 || N > 65536 || (N & (N - 1)) !== 0 ||
    !Number.isInteger(r) || r < 1 || r > 32 ||
    !Number.isInteger(p) || p < 1 || p > 16
  ) {
    return null;
  }
  if (!/^[a-f0-9]+$/i.test(parts[4]) || !/^[a-f0-9]+$/i.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (salt.length < 8 || expected.length !== KEYLEN) return null;
  return { N, r, p, salt, expected };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16);
  const derived = await runBoundedScrypt(() => scryptAsync(String(password), salt, KEYLEN, SCRYPT_PARAMS));
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsUpgrade: false };
  }

  if (storedHash.startsWith('scrypt$')) {
    const parsed = parseScryptHash(storedHash);
    if (!parsed) return { valid: false, needsUpgrade: false };
    const { N, r, p, salt, expected } = parsed;
    const derived = crypto.scryptSync(String(password), salt, KEYLEN, { N, r, p, maxmem: 32 * 1024 * 1024 });
    const valid = derived.length === KEYLEN && crypto.timingSafeEqual(derived, expected);
    return { valid, needsUpgrade: false };
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacy = crypto.createHash('sha256').update(String(password) + '_MATN_SALT_2026').digest('hex');
    const bufA = Buffer.from(legacy, 'utf8');
    const bufB = Buffer.from(storedHash, 'utf8');
    const valid = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    if (valid) {
      return { valid: true, needsUpgrade: true, upgradedHash: hashPassword(password) };
    }
  }

  return { valid: false, needsUpgrade: false };
}

async function verifyPasswordAsync(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') {
    return { valid: false, needsUpgrade: false };
  }

  if (storedHash.startsWith('scrypt$')) {
    const parsed = parseScryptHash(storedHash);
    if (!parsed) return { valid: false, needsUpgrade: false };
    const { N, r, p, salt, expected } = parsed;
    const derived = await runBoundedScrypt(() => scryptAsync(String(password), salt, KEYLEN, { N, r, p, maxmem: 32 * 1024 * 1024 }));
    const valid = derived.length === KEYLEN && crypto.timingSafeEqual(derived, expected);
    return { valid, needsUpgrade: false };
  }

  if (/^[a-f0-9]{64}$/i.test(storedHash)) {
    const legacy = crypto.createHash('sha256').update(String(password) + '_MATN_SALT_2026').digest('hex');
    const bufA = Buffer.from(legacy, 'utf8');
    const bufB = Buffer.from(storedHash, 'utf8');
    const valid = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    if (valid) {
      return { valid: true, needsUpgrade: true, upgradedHash: await hashPasswordAsync(password) };
    }
  }

  return { valid: false, needsUpgrade: false };
}

function generateSecureOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otpCode) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(otpCode).trim(), salt, 32, SCRYPT_PARAMS);
  return `otp$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function hashOtpAsync(otpCode) {
  const salt = crypto.randomBytes(16);
  const derived = await runBoundedScrypt(() => scryptAsync(String(otpCode).trim(), salt, 32, SCRYPT_PARAMS));
  return `otp$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function parseOtpHash(storedOtpHash) {
  if (!storedOtpHash || typeof storedOtpHash !== 'string' || !storedOtpHash.startsWith('otp$')) return null;
  const parts = storedOtpHash.split('$');
  if (parts.length !== 3) return null;
  if (!/^[a-f0-9]+$/i.test(parts[1]) || !/^[a-f0-9]+$/i.test(parts[2])) return null;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length < 8 || expected.length !== OTP_KEYLEN) return null;
  return { salt, expected };
}

function verifyOtpHash(otpCode, storedOtpHash) {
  const parsed = parseOtpHash(storedOtpHash);
  if (!parsed) return false;
  const derived = crypto.scryptSync(String(otpCode || '').trim(), parsed.salt, OTP_KEYLEN, SCRYPT_PARAMS);
  return derived.length === OTP_KEYLEN && crypto.timingSafeEqual(derived, parsed.expected);
}

async function verifyOtpHashAsync(otpCode, storedOtpHash) {
  const parsed = parseOtpHash(storedOtpHash);
  if (!parsed) return false;
  const derived = await runBoundedScrypt(() => scryptAsync(String(otpCode || '').trim(), parsed.salt, OTP_KEYLEN, SCRYPT_PARAMS));
  return derived.length === OTP_KEYLEN && crypto.timingSafeEqual(derived, parsed.expected);
}

module.exports = {
  db,
  initDatabase,
  bootstrapInitialAdmin,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
  generateSecureOtp,
  hashOtp,
  hashOtpAsync,
  verifyOtpHash,
  verifyOtpHashAsync
};
