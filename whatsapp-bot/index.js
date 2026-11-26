import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 4001;
const DEFAULT_HOST = '127.0.0.1';
const MIN_DELAY_MS_DEFAULT = 12000;
const JITTER_MS_DEFAULT = 6000;
const BATCH_SIZE_DEFAULT = 40;
const BATCH_COOLDOWN_MS_DEFAULT = 90000;
const POLL_INTERVAL_MS_DEFAULT = 15000;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RECONNECT_BACKOFF_MS = 60000;

export function isLoopbackHost(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost';
}

export function isValidLocalHostHeader(hostHeader, port) {
  const value = String(hostHeader || '').trim().toLowerCase();
  return (
    value === `127.0.0.1:${port}` ||
    value === `localhost:${port}` ||
    value === '127.0.0.1' ||
    value === 'localhost'
  );
}

export function isAllowedPlatformUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol === 'https:') return true;
    if (parsed.protocol === 'http:') {
      return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    }
    return false;
  } catch {
    return false;
  }
}

export function normalizeEgyptianPhone(rawPhone) {
  const cleaned = String(rawPhone || '')
    .trim()
    .replace(/[\s\-().\u200e\u200f\u202a-\u202e]/g, '');
  const match = cleaned.match(/^(?:\+20|0020|20|0)(1[0125]\d{8})$/);
  return match ? `20${match[1]}` : null;
}

export function loadEnvFile(envPath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(envPath)) return false;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
  return true;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:"
  );
}

function formatDurationMinutes(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0 د';
  const totalSec = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs} ث`;
  if (secs === 0) return `${mins} د`;
  return `${mins} د ${secs} ث`;
}

export function createInitialBotState() {
  return {
    whatsappStatus: 'starting',
    workerStatus: 'idle',
    connectedPhone: null,
    qrDataUrl: null,
    lastError: null,
    weekKey: null,
    totalReports: 0,
    alreadySent: 0,
    sessionSent: 0,
    sessionFailed: 0,
    remainingPending: 0,
    lastStudent: null,
    lastRunAt: null,
    recentLogs: []
  };
}

function appendLog(state, message) {
  const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  state.recentLogs.unshift(`[${stamp}] ${message}`);
  if (state.recentLogs.length > 20) {
    state.recentLogs.length = 20;
  }
}

function renderStatusPage(state) {
  const statusMap = {
    starting: 'جاري بدء البوت...',
    qr_ready: 'في انتظار مسح رمز QR من واتساب',
    connected: 'متصل بواتساب وجاهز',
    reconnecting: 'جاري إعادة الاتصال...',
    logged_out: 'تم تسجيل الخروج من واتساب — يلزم مسح QR جديد',
    stopped: 'متوقف'
  };
  const workerMap = {
    idle: 'بانتظار اتصال واتساب',
    preparing: 'جاري تجهيز تقارير الأسبوع...',
    sending: 'جاري سحب وإرسال التقارير الآن...',
    cooldown: 'استراحة حماية مؤقتة بين الدفعات...',
    done: 'اكتمل إرسال جميع تقارير هذا الأسبوع',
    paused_disconnected: 'متوقف مؤقتاً لانقطاع واتساب (سيكمل تلقائياً عند العودة)',
    config_error: 'يرجى ضبط PLATFORM_URL و BOT_PULL_TOKEN في ملف .env'
  };

  const processed = Math.min(state.totalReports, state.alreadySent + state.sessionSent);
  const pct = state.totalReports > 0 ? Math.min(100, Math.round((processed / state.totalReports) * 100)) : 0;
  const avgDelayMs = MIN_DELAY_MS_DEFAULT + Math.round(JITTER_MS_DEFAULT / 2);
  const etaStr = state.remainingPending > 0 ? formatDurationMinutes(state.remainingPending * avgDelayMs) : '0 د';

  const qrBlock = state.qrDataUrl
    ? `<div class="qr-box"><img src="${escapeHtml(state.qrDataUrl)}" alt="WhatsApp QR Code" /><p class="muted">افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز وامسح الرمز</p></div>`
    : '';

  const errBlock = state.lastError
    ? `<div class="err-box"><strong>ملاحظة:</strong> ${escapeHtml(state.lastError)}</div>`
    : '';

  const logsHtml = state.recentLogs.length
    ? state.recentLogs.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')
    : '<li>لا توجد عمليات مسجلة بعد.</li>';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="5" />
<title>بوت واتساب منصة متن — لوحة السحب</title>
<style>
  body { font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif; background:#0f172a; color:#f8fafc; margin:0; padding:24px; line-height:1.6; }
  .card { max-width:680px; margin:0 auto; background:#1e293b; border:1px solid #334155; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.35); }
  h1 { margin:0 0 8px; font-size:22px; color:#38bdf8; }
  .sub { color:#94a3b8; font-size:14px; margin:0 0 20px; }
  .row { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:16px 0; }
  .stat { background:#0f172a; border:1px solid #334155; border-radius:12px; padding:12px; text-align:center; }
  .stat .num { font-size:22px; font-weight:700; color:#f8fafc; }
  .stat .lbl { font-size:12px; color:#94a3b8; }
  .bar-wrap { background:#0f172a; border-radius:999px; height:12px; overflow:hidden; margin:12px 0; border:1px solid #334155; }
  .bar { background:#22c55e; height:100%; width:${pct}%; }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; background:#0ea5e9; color:#0f172a; font-weight:700; font-size:13px; margin-bottom:8px; }
  .qr-box { text-align:center; background:#ffffff; color:#0f172a; padding:18px; border-radius:12px; margin:18px 0; }
  .qr-box img { width:240px; height:240px; }
  .err-box { background:#7f1d1d; border:1px solid #ef4444; color:#fecaca; padding:12px; border-radius:10px; margin:12px 0; font-size:14px; }
  .muted { color:#475569; font-size:13px; margin:8px 0 0; }
  ul.logs { list-style:none; padding:12px; margin:14px 0 0; background:#0f172a; border:1px solid #334155; border-radius:10px; font-family:monospace; font-size:12px; direction:ltr; text-align:left; max-height:220px; overflow:auto; }
  ul.logs li { padding:3px 0; border-bottom:1px solid #1e293b; color:#cbd5e1; }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">Pull Worker v2</span>
    <h1>بوت واتساب منصة مَتْن — متابعة تقارير الجمعة</h1>
    <p class="sub">حالة واتساب: <strong>${escapeHtml(statusMap[state.whatsappStatus] || state.whatsappStatus)}</strong> ${state.connectedPhone ? `(${escapeHtml(state.connectedPhone)})` : ''}</p>
    <p class="sub">حالة السحب: <strong>${escapeHtml(workerMap[state.workerStatus] || state.workerStatus)}</strong> ${state.weekKey ? `| الأسبوع: ${escapeHtml(state.weekKey)}` : ''}</p>

    ${qrBlock}
    ${errBlock}

    <div class="bar-wrap"><div class="bar"></div></div>
    <p class="sub">نسبة الإنجاز: <strong>${pct}%</strong> | الوقت المتبقي التقريبي: <strong>${escapeHtml(etaStr)}</strong></p>

    <div class="row">
      <div class="stat"><div class="num">${state.totalReports}</div><div class="lbl">إجمالي التقارير</div></div>
      <div class="stat"><div class="num">${state.alreadySent}</div><div class="lbl">مُرسل مسبقاً</div></div>
      <div class="stat"><div class="num">${state.sessionSent}</div><div class="lbl">تم إرساله الآن</div></div>
      <div class="stat"><div class="num">${state.remainingPending}</div><div class="lbl">متبقي للإرسال</div></div>
      <div class="stat"><div class="num">${state.sessionFailed}</div><div class="lbl">فشل في الجلسة</div></div>
    </div>

    ${state.lastStudent ? `<p class="sub">آخر طالب تمت معالجته: <strong>${escapeHtml(state.lastStudent)}</strong></p>` : ''}
    <ul class="logs">${logsHtml}</ul>
  </div>
</body>
</html>`;
}

export function createUiServer({
  state,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT
}) {
  if (!isLoopbackHost(host)) {
    throw new Error('BOT_HOST must strictly be 127.0.0.1 or localhost.');
  }
  const bindHost = host.trim().toLowerCase() === 'localhost' ? '127.0.0.1' : host.trim();

  const server = http.createServer((req, res) => {
    setSecurityHeaders(res);

    const addressInfo = server.address();
    const activePort = addressInfo && typeof addressInfo === 'object' ? addressInfo.port : port;
    if (!isValidLocalHostHeader(req.headers.host, activePort)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Forbidden host header' }));
      return;
    }

    if (!req.url || req.url.length > 2048) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, `http://127.0.0.1:${activePort}`);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          ok: true,
          mode: 'pull_worker',
          whatsappStatus: state.whatsappStatus,
          workerStatus: state.workerStatus,
          connectedPhone: state.connectedPhone,
          weekKey: state.weekKey,
          totalReports: state.totalReports,
          alreadySent: state.alreadySent,
          sessionSent: state.sessionSent,
          sessionFailed: state.sessionFailed,
          remainingPending: state.remainingPending
        })
      );
      return;
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderStatusPage(state));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('clientError', (_err, socket) => {
    if (socket && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });

  return { server, bindHost };
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text || `HTTP ${response.status}` };
    }
    return { status: response.status, ok: response.ok, data: json };
  } finally {
    clearTimeout(timer);
  }
}

export function createPullController({
  platformUrl,
  botToken,
  state,
  getSocket,
  minDelayMs = MIN_DELAY_MS_DEFAULT,
  jitterMs = JITTER_MS_DEFAULT,
  batchSize = BATCH_SIZE_DEFAULT,
  batchCooldownMs = BATCH_COOLDOWN_MS_DEFAULT,
  pollIntervalMs = POLL_INTERVAL_MS_DEFAULT,
  logger = console
}) {
  let active = false;
  let stopped = false;
  let wakeupTimer = null;
  let sleepAbort = null;

  const baseUrl = String(platformUrl || '').replace(/\/+$/, '');
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${botToken}`
  };

  function abortableSleep(ms) {
    if (stopped || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (sleepAbort === cancel) sleepAbort = null;
        clearTimeout(t);
        resolve();
      };
      const cancel = () => done();
      const t = setTimeout(done, ms);
      sleepAbort = cancel;
    });
  }

  async function postBot(endpoint, body = {}) {
    return fetchJsonWithTimeout(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(body)
    });
  }

  async function runCycle() {
    if (active || stopped) return;
    const sock = getSocket();
    if (!sock || state.whatsappStatus !== 'connected') return;

    if (!isAllowedPlatformUrl(baseUrl) || String(botToken || '').trim().length < 32) {
      state.workerStatus = 'config_error';
      state.lastError = 'يجب ضبط PLATFORM_URL (https أو محلي) و BOT_PULL_TOKEN (32 حرفاً على الأقل).';
      return;
    }

    active = true;
    try {
      state.workerStatus = 'preparing';
      state.lastError = null;
      const prep = await postBot('/api/bot/weekly-reports/prepare', {});
      if (!prep.ok) {
        state.lastError = `فشل prepare (${prep.status}): ${prep.data?.error || 'خطأ غير معروف'}`;
        appendLog(state, state.lastError);
        return;
      }

      state.weekKey = prep.data.week_key || null;
      state.totalReports = Number(prep.data.total || 0);
      state.alreadySent = Number(prep.data.sent || 0);
      state.remainingPending = Number(prep.data.pending || 0) + Number(prep.data.processing || 0);
      appendLog(
        state,
        `Week ${state.weekKey}: total=${state.totalReports}, sent=${state.alreadySent}, remaining=${state.remainingPending}`
      );
      logger.log(
        `[BOT] أسبوع ${state.weekKey} — الإجمالي: ${state.totalReports} | مُرسل سابقاً: ${state.alreadySent} | متبقي: ${state.remainingPending}`
      );

      let sentInBatch = 0;

      while (!stopped && state.whatsappStatus === 'connected' && getSocket()) {
        const claimRes = await postBot('/api/bot/weekly-reports/claim', {
          week_key: state.weekKey || undefined
        });
        if (!claimRes.ok) {
          state.lastError = `فشل claim (${claimRes.status}): ${claimRes.data?.error || 'خطأ'}`;
          appendLog(state, state.lastError);
          break;
        }

        state.remainingPending = Number(claimRes.data.remaining_pending || 0);
        const item = claimRes.data.item;
        if (!item) {
          state.workerStatus = 'done';
          state.lastRunAt = new Date().toISOString();
          appendLog(state, 'All weekly reports completed.');
          logger.log('[BOT] اكتمل إرسال جميع تقارير هذا الأسبوع! يمكنك إغلاق البوت بأمان.');
          break;
        }

        state.workerStatus = 'sending';
        state.lastStudent = item.student_name;

        const normalizedPhone = normalizeEgyptianPhone(item.parent_phone);
        if (!normalizedPhone) {
          state.sessionFailed += 1;
          await postBot(`/api/bot/weekly-reports/${item.id}/ack`, {
            status: 'failed',
            error_reason: 'INVALID_EGYPTIAN_PHONE'
          }).catch(() => {});
          appendLog(state, `Skipped #${item.id} (${item.student_name}): invalid phone`);
          continue;
        }

        const currentSock = getSocket();
        if (!currentSock || state.whatsappStatus !== 'connected') {
          state.workerStatus = 'paused_disconnected';
          appendLog(state, 'Paused: WhatsApp disconnected before sending.');
          break;
        }

        const jid = `${normalizedPhone}@s.whatsapp.net`;
        try {
          const check = await currentSock.onWhatsApp(jid);
          if (!Array.isArray(check) || !check[0]?.exists) {
            state.sessionFailed += 1;
            await postBot(`/api/bot/weekly-reports/${item.id}/ack`, {
              status: 'failed',
              error_reason: 'WHATSAPP_NOT_REGISTERED'
            }).catch(() => {});
            appendLog(state, `Skipped #${item.id} (${item.student_name}): not on WhatsApp`);
            continue;
          }

          await currentSock.sendPresenceUpdate('composing', jid).catch(() => {});
          await abortableSleep(1200 + Math.floor(Math.random() * 1000));
          if (stopped || state.whatsappStatus !== 'connected') {
            state.workerStatus = 'paused_disconnected';
            break;
          }

          const sendResult = await currentSock.sendMessage(jid, { text: item.report_text });
          await currentSock.sendPresenceUpdate('paused', jid).catch(() => {});

          const providerId = sendResult?.key?.id ? String(sendResult.key.id) : null;
          await postBot(`/api/bot/weekly-reports/${item.id}/ack`, {
            status: 'sent',
            provider_message_id: providerId
          });

          state.sessionSent += 1;
          sentInBatch += 1;
          const doneCount = Math.min(state.totalReports, state.alreadySent + state.sessionSent);
          const pct = state.totalReports > 0 ? Math.round((doneCount / state.totalReports) * 100) : 100;
          appendLog(state, `Sent #${item.id} -> ${normalizedPhone} (${pct}%)`);
          logger.log(
            `[BOT] (${doneCount}/${state.totalReports} - ${pct}%) تم إرسال تقرير "${item.student_name}" | المتبقي: ${state.remainingPending}`
          );
        } catch (sendErr) {
          state.sessionFailed += 1;
          const msg = String(sendErr?.message || sendErr || 'SEND_ERROR').slice(0, 220);
          await postBot(`/api/bot/weekly-reports/${item.id}/ack`, {
            status: 'failed',
            error_reason: msg
          }).catch(() => {});
          appendLog(state, `Failed #${item.id} (${item.student_name}): ${msg}`);
        }

        if (stopped || state.whatsappStatus !== 'connected') break;

        if (batchSize > 0 && sentInBatch > 0 && sentInBatch % batchSize === 0 && state.remainingPending > 0) {
          state.workerStatus = 'cooldown';
          appendLog(state, `Batch cooldown for ${Math.round(batchCooldownMs / 1000)}s`);
          logger.log(`[BOT] استراحة حماية ${Math.round(batchCooldownMs / 1000)} ثانية بعد ${batchSize} رسالة...`);
          await abortableSleep(batchCooldownMs);
        } else if (state.remainingPending > 0) {
          const waitMs = minDelayMs + Math.floor(Math.random() * (jitterMs + 1));
          await abortableSleep(waitMs);
        }
      }
    } catch (err) {
      state.lastError = String(err?.message || err);
      appendLog(state, `Worker error: ${state.lastError}`);
    } finally {
      active = false;
      if (!stopped && state.whatsappStatus === 'connected') {
        clearTimeout(wakeupTimer);
        wakeupTimer = setTimeout(() => {
          runCycle().catch(() => {});
        }, Math.max(5000, pollIntervalMs));
      }
    }
  }

  function trigger() {
    clearTimeout(wakeupTimer);
    runCycle().catch(() => {});
  }

  function pauseForDisconnect() {
    clearTimeout(wakeupTimer);
    if (sleepAbort) sleepAbort();
    if (state.workerStatus === 'sending' || state.workerStatus === 'cooldown') {
      state.workerStatus = 'paused_disconnected';
    }
  }

  function stop() {
    stopped = true;
    clearTimeout(wakeupTimer);
    if (sleepAbort) sleepAbort();
  }

  return { runCycle, trigger, pauseForDisconnect, stop };
}

async function defaultLoadBaileysDeps() {
  const [baileysMod, pinoMod, qrcodeMod, qrcodeTerminalMod] = await Promise.all([
    import('baileys'),
    import('pino'),
    import('qrcode'),
    import('qrcode-terminal')
  ]);
  return {
    makeWASocket: baileysMod.default,
    useMultiFileAuthState: baileysMod.useMultiFileAuthState,
    DisconnectReason: baileysMod.DisconnectReason,
    fetchLatestBaileysVersion: baileysMod.fetchLatestBaileysVersion,
    Browsers: baileysMod.Browsers,
    pino: pinoMod.default,
    QRCode: qrcodeMod.default,
    qrcodeTerminal: qrcodeTerminalMod.default
  };
}

export async function startWhatsAppSocket({
  state,
  authDir = path.join(__dirname, 'auth_info'),
  onConnected,
  onDisconnected,
  loadDepsFn = defaultLoadBaileysDeps,
  fetchLatestVersionFn,
  useAuthStateFn,
  makeSocketFn,
  logger = console
}) {
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let currentSocket = null;
  let closed = false;

  const scheduleReconnect = () => {
    if (closed) return;
    clearTimeout(reconnectTimer);
    const delayMs = Math.min(MAX_RECONNECT_BACKOFF_MS, 5000 * (2 ** Math.min(reconnectAttempts, 4)));
    reconnectAttempts += 1;
    state.whatsappStatus = 'reconnecting';
    reconnectTimer = setTimeout(() => {
      connect().catch((err) => {
        state.lastError = String(err?.message || err);
        appendLog(state, `Reconnect error: ${state.lastError}`);
      });
    }, delayMs);
  };

  async function connect() {
    if (closed) return null;
    clearTimeout(reconnectTimer);
    try {
      const deps =
        fetchLatestVersionFn && useAuthStateFn && makeSocketFn
          ? {
              fetchLatestBaileysVersion: fetchLatestVersionFn,
              useMultiFileAuthState: useAuthStateFn,
              makeWASocket: makeSocketFn,
              DisconnectReason: { loggedOut: 401 },
              Browsers: { ubuntu: (n) => ['Ubuntu', n, '20.04'] },
              pino: () => ({ level: 'silent' }),
              QRCode: { toDataURL: async () => '' },
              qrcodeTerminal: { generate: () => {} }
            }
          : await loadDepsFn();

      fs.mkdirSync(authDir, { recursive: true });
      const authRes = await (useAuthStateFn || deps.useMultiFileAuthState)(authDir);
      const versionRes = await (fetchLatestVersionFn || deps.fetchLatestBaileysVersion)();

      if (closed) return null;

      const sock = (makeSocketFn || deps.makeWASocket)({
        version: versionRes?.version,
        auth: authRes.state,
        logger: deps.pino ? deps.pino({ level: 'silent' }) : undefined,
        browser: deps.Browsers ? deps.Browsers.ubuntu('MATN Bot') : undefined,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false
      });

      currentSocket = sock;

      if (sock?.ev && typeof sock.ev.on === 'function') {
        sock.ev.on('creds.update', authRes.saveCreds);
        sock.ev.on('connection.update', async (update) => {
          if (closed) return;
          const { connection, lastDisconnect, qr } = update || {};

          if (qr) {
            state.whatsappStatus = 'qr_ready';
            try {
              state.qrDataUrl = deps.QRCode ? await deps.QRCode.toDataURL(qr) : null;
              if (deps.qrcodeTerminal) {
                logger.log('\n[BOT] امسح رمز QR التالي من تطبيق واتساب:');
                deps.qrcodeTerminal.generate(qr, { small: true });
              }
            } catch {
              state.qrDataUrl = null;
            }
          }

          if (connection === 'open') {
            reconnectAttempts = 0;
            state.whatsappStatus = 'connected';
            state.qrDataUrl = null;
            state.lastError = null;
            const rawId = sock.user?.id || '';
            state.connectedPhone = rawId.split(':')[0] || rawId || null;
            appendLog(state, `WhatsApp connected as ${state.connectedPhone || 'linked-device'}`);
            logger.log(`[BOT] تم الاتصال بواتساب بنجاح: ${state.connectedPhone || ''}`);
            if (onConnected) onConnected(sock);
          }

          if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const loggedOutCode = deps.DisconnectReason?.loggedOut ?? 401;
            if (onDisconnected) onDisconnected();
            if (statusCode === loggedOutCode) {
              state.whatsappStatus = 'logged_out';
              state.connectedPhone = null;
              state.lastError = 'تم فصل الجهاز من واتساب. احذف auth_info أو امسح QR جديداً.';
              appendLog(state, 'Session logged out by WhatsApp.');
            } else {
              appendLog(state, `Connection closed (${statusCode || 'unknown'}), reconnecting...`);
              scheduleReconnect();
            }
          }
        });
      }

      return sock;
    } catch (err) {
      state.lastError = String(err?.message || err);
      appendLog(state, `WhatsApp connection init failed: ${state.lastError}`);
      if (!closed) {
        scheduleReconnect();
      }
      return null;
    }
  }

  await connect();

  return {
    getSocket: () => currentSocket,
    stop: () => {
      closed = true;
      clearTimeout(reconnectTimer);
      try {
        if (currentSocket && typeof currentSocket.end === 'function') {
          currentSocket.end(new Error('Bot shutdown'));
        }
      } catch {
        // ignore socket close errors
      }
      currentSocket = null;
    }
  };
}

async function main() {
  loadEnvFile();

  const host = process.env.BOT_HOST || DEFAULT_HOST;
  if (!isLoopbackHost(host)) {
    console.error('[BOT] خطأ أمني: يجب أن يكون BOT_HOST مساوياً لـ 127.0.0.1 أو localhost فقط.');
    process.exit(1);
  }

  const port = Number(process.env.BOT_PORT || DEFAULT_PORT);
  const platformUrl = String(process.env.PLATFORM_URL || '').trim();
  const botToken = String(process.env.BOT_PULL_TOKEN || '').trim();

  if (!isAllowedPlatformUrl(platformUrl)) {
    console.error('[BOT] خطأ إعدادات: اضبط PLATFORM_URL في whatsapp-bot/.env ليكون https://... أو http://127.0.0.1:4000');
    process.exit(1);
  }
  if (botToken.length < 32) {
    console.error('[BOT] خطأ إعدادات: اضبط BOT_PULL_TOKEN في whatsapp-bot/.env بطول 32 حرفاً على الأقل.');
    process.exit(1);
  }

  const state = createInitialBotState();
  const { server, bindHost } = createUiServer({ state, host, port });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, bindHost, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  console.log(`[BOT] لوحة متابعة بوت متن تعمل محلياً على: http://${bindHost}:${port}/`);
  console.log(`[BOT] وضع السحب (Pull Worker) مربوط مع: ${platformUrl}`);

  let socketHandle = null;
  const pullController = createPullController({
    platformUrl,
    botToken,
    state,
    getSocket: () => socketHandle?.getSocket() || null,
    minDelayMs: Math.max(5000, Number(process.env.BOT_MIN_DELAY_MS || MIN_DELAY_MS_DEFAULT)),
    jitterMs: Math.max(0, Number(process.env.BOT_JITTER_MS || JITTER_MS_DEFAULT)),
    batchSize: Math.max(1, Number(process.env.BOT_BATCH_SIZE || BATCH_SIZE_DEFAULT)),
    batchCooldownMs: Math.max(0, Number(process.env.BOT_BATCH_COOLDOWN_MS || BATCH_COOLDOWN_MS_DEFAULT)),
    pollIntervalMs: Math.max(5000, Number(process.env.BOT_POLL_INTERVAL_MS || POLL_INTERVAL_MS_DEFAULT))
  });

  socketHandle = await startWhatsAppSocket({
    state,
    onConnected: () => pullController.trigger(),
    onDisconnected: () => pullController.pauseForDisconnect()
  });

  const shutdown = (signal) => {
    console.log(`\n[BOT] إغلاق آمن (${signal})...`);
    state.whatsappStatus = 'stopped';
    pullController.stop();
    if (socketHandle) socketHandle.stop();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    state.lastError = String(reason?.message || reason);
    appendLog(state, `Unhandled rejection recovered: ${state.lastError}`);
  });
  process.on('uncaughtException', (err) => {
    state.lastError = String(err?.message || err);
    appendLog(state, `Uncaught exception recovered: ${state.lastError}`);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  main().catch((err) => {
    console.error('[BOT] فشل تشغيل البوت:', err);
    process.exit(1);
  });
}
