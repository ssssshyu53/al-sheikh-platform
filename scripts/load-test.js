/**
 * Local Load Testing Script for MATN Platform (Zero External Dependencies)
 * Simulates 100-300 concurrent students hitting:
 *   1) GET / (Landing HTML)
 *   2) POST /api/auth/login (Authenticated session + device binding)
 *   3) GET /api/student/dashboard (Full curriculum, gamification & live data)
 *
 * Usage:
 *   npm run test:load
 *   node scripts/load-test.js --students=250
 *   node scripts/load-test.js --students=150 --url=http://127.0.0.1:4000
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

function parseArgs(argv) {
  const out = { students: 150, url: '' };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--students=')) {
      const n = Number.parseInt(arg.slice('--students='.length), 10);
      if (Number.isFinite(n) && n >= 10 && n <= 1000) out.students = n;
    } else if (arg.startsWith('--url=')) {
      out.url = arg.slice('--url='.length).trim().replace(/\/+$/, '');
    }
  }
  return out;
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

async function timedFetch(url, options = {}) {
  const start = performance.now();
  try {
    const res = await fetch(url, options);
    await res.arrayBuffer();
    return {
      ok: res.status >= 200 && res.status < 400,
      status: res.status,
      ms: performance.now() - start,
      headers: res.headers
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: performance.now() - start,
      error: err.message
    };
  }
}

async function simulateStudentWorker(idx, baseUrl, creds) {
  const lat = [];
  const results = { ok: 0, fail: 0 };
  const fakeIp = `10.20.${Math.floor(idx / 250)}.${(idx % 250) + 1}`;

  // 1. Landing Page
  const r1 = await timedFetch(`${baseUrl}/`, { headers: { 'X-Forwarded-For': fakeIp } });
  lat.push(r1.ms);
  if (r1.ok) results.ok++;
  else results.fail++;

  // 2. Student Login
  let cookieHeader = '';
  const startLogin = performance.now();
  try {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': creds.deviceId,
        'X-Forwarded-For': fakeIp
      },
      body: JSON.stringify({ phone: creds.phone, password: creds.password })
    });
    const loginJson = await loginRes.json().catch(() => ({}));
    lat.push(performance.now() - startLogin);
    if (loginRes.ok && loginJson.token) {
      results.ok++;
      cookieHeader = `Bearer ${loginJson.token}`;
    } else {
      results.fail++;
    }
  } catch {
    lat.push(performance.now() - startLogin);
    results.fail++;
  }

  // 3. Student Dashboard
  const r3 = await timedFetch(`${baseUrl}/api/student/dashboard`, {
    headers: {
      ...(cookieHeader ? { Authorization: cookieHeader } : {}),
      'X-Device-Id': creds.deviceId,
      'X-Forwarded-For': fakeIp
    }
  });
  lat.push(r3.ms);
  if (r3.ok) results.ok++;
  else results.fail++;

  return { lat, ok: results.ok, fail: results.fail };
}

async function run() {
  const opts = parseArgs(process.argv);
  const studentCount = opts.students;
  let baseUrl = opts.url;
  let tempDir = null;
  let localServer = null;
  let gracefulShutdown = null;
  const studentCreds = [];

  let closeDb = null;
  if (!baseUrl) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'matn-loadtest-'));
    process.env.NODE_ENV = 'test';
    process.env.DB_CLIENT = 'sqlite';
    process.env.TRUSTED_PROXY_COUNT = '1';
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    process.env.SQLITE_DB_PATH = ':memory:';
    process.env.UPLOADS_DIR = path.join(tempDir, 'uploads');
    process.env.BACKUPS_DIR = path.join(tempDir, 'backups');
    process.env.JWT_SECRET = 'load-test-secret-key-matn-platform-32chars';

    const { db, initDatabase, hashPasswordAsync } = require('../database');
    const srvMod = require('../server');
    localServer = srvMod.server;
    gracefulShutdown = srvMod.gracefulShutdown;
    closeDb = () => db.close();

    await initDatabase();
    await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
    const addr = localServer.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const nowIso = new Date().toISOString();
    const expIso = new Date(Date.now() + 30 * 86400000).toISOString();
    const pwHash = await hashPasswordAsync('LoadTest1234');
    const insertUserSql = `
      INSERT INTO users (
        full_name, phone, parent_phone, password_hash, role, grade, branch,
        is_whatsapp_verified, device_id, subscription_expires_at, subscribed_subjects, created_at
      ) VALUES (?, ?, ?, ?, 'student', 'grade_3', 'scientific', 1, ?, ?, 'all', ?)
    `;

    await db.transaction(async (tx) => {
      for (let i = 0; i < studentCount; i++) {
        const phone = `0109${String(1000000 + i)}`;
        const parentPhone = `0119${String(1000000 + i)}`;
        const deviceId = `DEV-LOAD-${String(i).padStart(4, '0')}`;
        await tx.run(insertUserSql, [`طالب اختبار ضغط ${i + 1}`, phone, parentPhone, pwHash, deviceId, expIso, nowIso]);
        studentCreds.push({ phone, password: 'LoadTest1234', deviceId });
      }
    });
  } else {
    for (let i = 0; i < studentCount; i++) {
      studentCreds.push({
        phone: `0109${String(1000000 + i)}`,
        password: process.env.LOAD_TEST_PASSWORD || 'LoadTest1234',
        deviceId: `DEV-LOAD-${String(i).padStart(4, '0')}`
      });
    }
  }

  console.log(`\n🚀 Starting MATN Load Test: ${studentCount} concurrent virtual students -> ${baseUrl}\n`);
  const wallStart = performance.now();
  const workerOutputs = await Promise.all(
    studentCreds.map((creds, idx) => simulateStudentWorker(idx, baseUrl, creds))
  );
  const wallMs = performance.now() - wallStart;

  const allLatencies = workerOutputs.flatMap((w) => w.lat).sort((a, b) => a - b);
  const totalOk = workerOutputs.reduce((acc, w) => acc + w.ok, 0);
  const totalFail = workerOutputs.reduce((acc, w) => acc + w.fail, 0);
  const totalReqs = totalOk + totalFail;
  const successRate = totalReqs > 0 ? ((totalOk / totalReqs) * 100).toFixed(2) : '0.00';
  const avgMs = allLatencies.length > 0
    ? (allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length).toFixed(1)
    : '0';

  console.log('=== MATN Load Test Summary ===');
  console.log(`Concurrent Students : ${studentCount}`);
  console.log(`Total Requests      : ${totalReqs} (Landing + Login + Dashboard)`);
  console.log(`Succeeded / Failed  : ${totalOk} / ${totalFail} (${successRate}%)`);
  console.log(`Total Wall Time     : ${wallMs.toFixed(0)} ms`);
  console.log(`Throughput          : ${((totalReqs / Math.max(1, wallMs)) * 1000).toFixed(1)} req/sec`);
  console.log(`Latency (min/avg/p95/max): ${allLatencies[0]?.toFixed(1) || 0}ms / ${avgMs}ms / ${percentile(allLatencies, 95).toFixed(1)}ms / ${allLatencies[allLatencies.length - 1]?.toFixed(1) || 0}ms\n`);

  if (localServer) {
    await new Promise((resolve) => localServer.close(resolve));
  }
  if (closeDb) {
    await closeDb().catch(() => {});
  }
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (gracefulShutdown) {
    // Allow clean exit
  }
  process.exit(Number(successRate) >= 95 ? 0 : 1);
}

run().catch((err) => {
  console.error('Load test error:', err);
  process.exit(1);
});
