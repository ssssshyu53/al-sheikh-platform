const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('database falls back to SQLite when MySQL at default localhost refuses connections and DB_HOST is unset', () => {
  const script = `
    const { db, initDatabase } = require('./database');
    initDatabase().then(async () => {
      const row = await db.get('SELECT 1 AS ok');
      console.log(JSON.stringify({ client: db.client, ok: row?.ok }));
      await db.close();
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const env = { ...process.env, NODE_ENV: 'production', SQLITE_DB_PATH: ':memory:' };
  delete env.DB_CLIENT;
  delete env.DB_HOST;
  env.DB_PORT = '19306'; // Unbound port to force ECONNREFUSED

  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 15000
  });

  assert.equal(res.status, 0, `Expected exit 0, got ${res.status}. stderr: ${res.stderr}`);
  const lines = res.stdout.trim().split(/\r?\n/);
  const payload = JSON.parse(lines[lines.length - 1]);
  assert.equal(payload.client, 'sqlite');
  assert.equal(payload.ok, 1);
});

test('database does NOT silently fall back when explicit DB_HOST is configured and unreachable', () => {
  const script = `
    const { initDatabase } = require('./database');
    initDatabase().then(() => process.exit(0)).catch((err) => {
      console.error(err.code || err.message);
      process.exit(2);
    });
  `;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DB_CLIENT: 'mysql',
    DB_HOST: '127.0.0.1',
    DB_PORT: '19306'
  };

  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
    timeout: 15000
  });

  assert.equal(res.status, 2, `Expected explicit DB_HOST failure exit 2, got ${res.status}`);
});
