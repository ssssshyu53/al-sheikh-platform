const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const {
  DEMO_ADMIN,
  DEMO_STUDENT,
  shouldSeedDemoAccounts,
  getPublicDemoAccountsPayload,
  seedDemoData
} = require('../lib/demo-seed');
const { createDatabaseConnection } = require('../db/adapter');
const { runMigrations } = require('../db/migrations');

test('shouldSeedDemoAccounts strictly disables seeding in test and production', () => {
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'test' }), false);
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'production' }), false);
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'production', MATN_SEED_DEMO: '1' }), false);
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'development', MATN_DISABLE_DEMO_SEED: '1' }), false);
  assert.equal(shouldSeedDemoAccounts({ NODE_ENV: 'development' }), true);
});

test('getPublicDemoAccountsPayload returns null in production/test and credentials in development', () => {
  assert.equal(getPublicDemoAccountsPayload({ NODE_ENV: 'production' }), null);
  assert.equal(getPublicDemoAccountsPayload({ NODE_ENV: 'test' }), null);

  const payload = getPublicDemoAccountsPayload({ NODE_ENV: 'development' });
  assert.ok(payload);
  assert.equal(payload.admin.phone, DEMO_ADMIN.phone);
  assert.equal(payload.student.phone, DEMO_STUDENT.phone);
});

test('seedDemoData populates rich curriculum and accounts idempotently on isolated SQLite DB', async () => {
  const tmpFile = path.join(os.tmpdir(), `matn-demo-seed-test-${Date.now()}.db`);
  const db = createDatabaseConnection(tmpFile, { client: 'sqlite' });
  try {
    await runMigrations(db);
    const fakeHash = async (pw) => `hash:${pw}`;

    const first = await seedDemoData(db, fakeHash, { force: true });
    assert.equal(first.seeded, true);

    const admin = await db.get('SELECT role, phone FROM users WHERE phone = ?', [DEMO_ADMIN.phone]);
    const student = await db.get('SELECT role, phone, subscribed_subjects FROM users WHERE phone = ?', [DEMO_STUDENT.phone]);
    assert.equal(admin?.role, 'admin');
    assert.equal(student?.role, 'student');
    assert.equal(student?.subscribed_subjects, 'all');

    const lessonsCount1 = Number((await db.get('SELECT COUNT(*) AS c FROM lessons')).c);
    const assessmentsCount1 = Number((await db.get('SELECT COUNT(*) AS c FROM assessments')).c);
    const submissionsCount1 = Number((await db.get('SELECT COUNT(*) AS c FROM submissions')).c);
    const vouchersCount1 = Number((await db.get('SELECT COUNT(*) AS c FROM vouchers')).c);
    const liveCount1 = Number((await db.get('SELECT COUNT(*) AS c FROM live_sessions')).c);

    assert.equal(lessonsCount1, 6);
    assert.equal(assessmentsCount1, 3);
    assert.equal(submissionsCount1, 3);
    assert.equal(vouchersCount1, 5);
    assert.equal(liveCount1, 1);

    // Run a second time to verify idempotency (no duplicate lessons/users/vouchers)
    await seedDemoData(db, fakeHash, { force: true });
    const lessonsCount2 = Number((await db.get('SELECT COUNT(*) AS c FROM lessons')).c);
    const vouchersCount2 = Number((await db.get('SELECT COUNT(*) AS c FROM vouchers')).c);
    assert.equal(lessonsCount2, 6);
    assert.equal(vouchersCount2, 5);
  } finally {
    await db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(tmpFile + suffix)) fs.unlinkSync(tmpFile + suffix);
    }
  }
});
