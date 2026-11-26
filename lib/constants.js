const crypto = require('node:crypto');
const { URL } = require('node:url');
const { hashPassword } = require('../database');

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const DB_CLIENT = (process.env.DB_CLIENT || (IS_PROD ? 'mysql' : 'sqlite')).trim().toLowerCase();
const IS_CLOUD_PAAS = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RENDER ||
  process.env.FLY_APP_NAME
);
const PORT = Number(process.env.PORT || 3000);
const HOST = (process.env.HOST || '').trim() || '0.0.0.0';
const rawTrustedProxies = (process.env.TRUSTED_PROXY_COUNT ?? process.env.TRUSTED_PROXIES ?? '').trim();
const TRUSTED_PROXY_COUNT = Math.max(
  0,
  Number.parseInt(rawTrustedProxies || (IS_PROD ? '1' : '0'), 10) || 0
);
const MAX_VIDEO_UPLOAD_MB = Math.max(10, Number(process.env.MAX_VIDEO_UPLOAD_MB || 1500));
const WEEKLY_REPORT_DELAY_MS = Math.max(0, Number(process.env.WEEKLY_REPORT_DELAY_MS || 4000));
const USE_NGINX_ACCEL = ['true', '1', 'yes', 'on'].includes(String(process.env.USE_NGINX_ACCEL || 'false').trim().toLowerCase());
function isAllowedWhatsappGatewayUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:') {
      return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
    }
  } catch {}
  return false;
}

const HAS_WHATSAPP_GATEWAY = isAllowedWhatsappGatewayUrl(process.env.WHATSAPP_API_URL);
function getBotPullToken() {
  return String(process.env.BOT_PULL_TOKEN || '').trim();
}
function isBotPullConfigured() {
  return getBotPullToken().length >= 32;
}
const BOT_PULL_TOKEN = getBotPullToken();
const HAS_BOT_PULL_TOKEN = isBotPullConfigured();
const ALLOW_UNVERIFIED_REGISTRATION = ['true', '1', 'yes', 'on'].includes(
  String(process.env.ALLOW_UNVERIFIED_REGISTRATION || 'false').trim().toLowerCase()
);

const IS_MANAGED_RUNTIME = Boolean(process.env.APPLET_ID || process.env.K_SERVICE);
if (IS_PROD && !IS_MANAGED_RUNTIME && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  console.error('FATAL ERROR: JWT_SECRET environment variable (minimum 32 characters) is required in production.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const STREAM_TICKET_SECRET = process.env.STREAM_TICKET_SECRET || crypto.createHash('sha256').update(JWT_SECRET + ':stream').digest('hex');
const JWT_ISSUER = process.env.JWT_ISSUER || 'matn-platform';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'matn-users';
const JWT_EXPIRES_IN_SECONDS = Number(process.env.JWT_EXPIRES_IN_SECONDS || 7200);
const STREAM_TICKET_TTL_SECONDS = 3600;

// Constant dummy hash computed once at boot for scrypt timing parity on non-existent accounts
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const PREP_GRADES = ['prep_1', 'prep_2', 'prep_3'];
const SEC_GRADES = ['grade_1', 'grade_2', 'grade_3'];
const VALID_GRADES = [...PREP_GRADES, ...SEC_GRADES];
const VALID_SUBJECTS = ['fiqh', 'tafseer', 'hadith', 'tawheed', 'seerah', 'tajweed', 'mawareeth'];
const VALID_LESSON_BRANCHES = ['scientific', 'literary', 'both', 'general'];
const PREP_SUBJECTS = ['fiqh', 'tafseer', 'hadith', 'tawheed', 'seerah', 'tajweed'];
const SEC_BASE_SUBJECTS = ['fiqh', 'hadith', 'tawheed', 'tafseer'];
const SUBJECTS_BY_GRADE = {
  prep_1: PREP_SUBJECTS,
  prep_2: PREP_SUBJECTS,
  prep_3: PREP_SUBJECTS,
  grade_1: SEC_BASE_SUBJECTS,
  grade_2: SEC_BASE_SUBJECTS,
  grade_3: [...SEC_BASE_SUBJECTS, 'mawareeth']
};

function isSubjectAllowedForGrade(subject, grade) {
  return Array.isArray(SUBJECTS_BY_GRADE[grade]) && SUBJECTS_BY_GRADE[grade].includes(subject);
}

function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function normalizePhoneNumber(raw) {
  let cleaned = normalizeDigits(raw)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\s\-()]/g, '')
    .trim();
  if (/^\+20(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(3);
  else if (/^0020(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(4);
  else if (/^20(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(2);
  return cleaned;
}

function parsePositiveInt(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseBoundedInt(raw, fallback, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function parseRequestUrl(req) {
  try {
    return new URL(String(req.url || '/'), 'http://localhost');
  } catch {
    return null;
  }
}

function safeDecode(str, fallback = '') {
  if (str === null || str === undefined) return fallback;
  try {
    return decodeURIComponent(String(str));
  } catch {
    return fallback;
  }
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function isValidDeviceId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{6,100}$/.test(id);
}

function sanitizeUser(u) {
  if (!u) return null;
  const now = new Date();
  const exp = u.subscription_expires_at ? new Date(u.subscription_expires_at) : null;
  const daysRemaining = exp && exp > now ? Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
  return {
    id: u.id,
    full_name: u.full_name,
    phone: u.phone,
    parent_phone: u.parent_phone,
    role: u.role,
    grade: u.grade,
    branch: u.branch,
    is_whatsapp_verified: Boolean(u.is_whatsapp_verified),
    device_name: u.device_name,
    subscription_expires_at: u.subscription_expires_at,
    subscription_active: daysRemaining > 0 || u.role === 'admin',
    days_remaining: u.role === 'admin' ? 999 : daysRemaining,
    subscribed_subjects: u.subscribed_subjects
  };
}

module.exports = {
  NODE_ENV,
  IS_PROD,
  DB_CLIENT,
  IS_CLOUD_PAAS,
  PORT,
  HOST,
  TRUSTED_PROXY_COUNT,
  MAX_VIDEO_UPLOAD_MB,
  WEEKLY_REPORT_DELAY_MS,
  USE_NGINX_ACCEL,
  isAllowedWhatsappGatewayUrl,
  HAS_WHATSAPP_GATEWAY,
  getBotPullToken,
  isBotPullConfigured,
  BOT_PULL_TOKEN,
  HAS_BOT_PULL_TOKEN,
  ALLOW_UNVERIFIED_REGISTRATION,
  JWT_SECRET,
  STREAM_TICKET_SECRET,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_EXPIRES_IN_SECONDS,
  STREAM_TICKET_TTL_SECONDS,
  DUMMY_HASH,
  PREP_GRADES,
  SEC_GRADES,
  VALID_GRADES,
  VALID_SUBJECTS,
  VALID_LESSON_BRANCHES,
  PREP_SUBJECTS,
  SEC_BASE_SUBJECTS,
  SUBJECTS_BY_GRADE,
  isSubjectAllowedForGrade,
  normalizeDigits,
  normalizePhoneNumber,
  parsePositiveInt,
  parseBoundedInt,
  parseRequestUrl,
  safeDecode,
  safeJsonParse,
  isValidDeviceId,
  sanitizeUser
};
