export function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizePhoneInput(raw) {
  let cleaned = normalizeDigits(raw)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\s\-()]/g, '')
    .trim();
  if (/^\+20(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(3);
  else if (/^0020(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(4);
  else if (/^20(1[0125]\d{8})$/.test(cleaned)) cleaned = '0' + cleaned.slice(2);
  return cleaned;
}

export function safeHttpsUrl(rawUrl, fallback = '') {
  if (!rawUrl || typeof rawUrl !== 'string') return fallback;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:') return parsed.href;
  } catch {}
  return fallback;
}

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  if (!match) return '';
  try {
    return decodeURIComponent(match[2]);
  } catch {
    return '';
  }
}

let memoryDeviceId = null;

export function getOrCreateDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem('matn_device_id');
  } catch {
    id = memoryDeviceId;
  }
  if (!id || !/^[a-zA-Z0-9_-]{6,100}$/.test(id)) {
    const randBytes = new Uint8Array(12);
    window.crypto.getRandomValues(randBytes);
    id = 'DEV-' + Array.from(randBytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    memoryDeviceId = id;
    try {
      localStorage.setItem('matn_device_id', id);
    } catch {}
  } else {
    memoryDeviceId = id;
  }
  return id;
}

export function detectDeviceName() {
  const ua = navigator.userAgent || '';
  const isIpadOs = /Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  let os = 'جهاز كمبيوتر';
  if (/HarmonyOS|HMSCore|HUAWEI|HONOR/i.test(ua)) os = 'هاتف هواوي';
  else if (/android/i.test(ua)) os = 'هاتف أندرويد';
  else if (/iPad/i.test(ua) || isIpadOs) os = 'جهاز آيباد';
  else if (/iPhone|iPod/.test(ua)) os = 'هاتف آيفون';
  else if (/Windows/i.test(ua)) os = 'كمبيوتر (Windows)';
  else if (/Mac/i.test(ua)) os = 'جهاز ماك';

  let browser = 'متصفح';
  if (/Edg|EdgiOS|EdgA/i.test(ua)) browser = 'Edge';
  else if (/HuaweiBrowser/i.test(ua)) browser = 'Huawei Browser';
  else if (/CriOS|Chrome/i.test(ua)) browser = 'Chrome';
  else if (/FxiOS|Firefox/i.test(ua)) browser = 'Firefox';
  else if (/Safari/i.test(ua)) browser = 'Safari';

  return `${os} • ${browser}`;
}
