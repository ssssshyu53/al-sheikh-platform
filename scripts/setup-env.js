/**
 * Interactive & CLI Production `.env` Generator for MATN Platform (Hostinger + MySQL Ready)
 * Generates cryptographically strong random JWT_SECRET & STREAM_TICKET_SECRET locally.
 * Usage:
 *   npm run setup:env
 *   node scripts/setup-env.js --domain=matn-platform.com --yes
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

const APP_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(APP_ROOT, '.env');

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--force' || a === '-f') args.force = true;
    else if (a.startsWith('--domain=')) args.domain = a.slice('--domain='.length).trim();
    else if (a.startsWith('--port=')) args.port = a.slice('--port='.length).trim();
    else if (a.startsWith('--host=')) args.host = a.slice('--host='.length).trim();
    else if (a.startsWith('--mode=')) args.mode = a.slice('--mode='.length).trim();
    else if (a.startsWith('--db-client=')) args.dbClient = a.slice('--db-client='.length).trim();
    else if (a.startsWith('--db-host=')) args.dbHost = a.slice('--db-host='.length).trim();
    else if (a.startsWith('--db-port=')) args.dbPort = a.slice('--db-port='.length).trim();
    else if (a.startsWith('--db-user=')) args.dbUser = a.slice('--db-user='.length).trim();
    else if (a.startsWith('--db-password=')) args.dbPassword = a.slice('--db-password='.length).trim();
    else if (a.startsWith('--db-name=')) args.dbName = a.slice('--db-name='.length).trim();
    else if (a.startsWith('--out=')) args.out = path.resolve(a.slice('--out='.length).trim());
  }
  return args;
}

function buildEnvContent({
  nodeEnv = 'production',
  host = '0.0.0.0',
  port = '4000',
  domain = '',
  jwtSecret,
  streamTicketSecret,
  dbClient = 'mysql',
  dbHost = '127.0.0.1',
  dbPort = '3306',
  dbUser = '',
  dbPassword = '',
  dbName = '',
  dbPoolLimit = '30',
  dbSsl = 'false',
  bunnyLibId = '',
  bunnyApiKey = '',
  bunnyTokenKey = '',
  whatsappUrl = '',
  whatsappToken = ''
}) {
  const corsOrigins = domain
    ? `https://${domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
    : '';
  return [
    '# Environment Mode (development | production | test)',
    `NODE_ENV=${nodeEnv}`,
    '',
    '# Server Configuration',
    `HOST=${host}`,
    `PORT=${port}`,
    `CORS_ALLOWED_ORIGINS=${corsOrigins}`,
    'TRUSTED_PROXY_COUNT=1',
    'MAX_VIDEO_UPLOAD_MB=1500',
    'USE_NGINX_ACCEL=false',
    'UV_THREADPOOL_SIZE=16',
    '',
    '# Security Secrets (Auto-generated cryptographically secure keys)',
    `JWT_SECRET=${jwtSecret}`,
    'JWT_ISSUER=matn-platform',
    'JWT_AUDIENCE=matn-users',
    'JWT_EXPIRES_IN_SECONDS=7200',
    `STREAM_TICKET_SECRET=${streamTicketSecret}`,
    '',
    '# Primary Database (Hostinger Unlimited Web Hosting MySQL)',
    `DB_CLIENT=${dbClient}`,
    `DB_HOST=${dbHost}`,
    `DB_PORT=${dbPort}`,
    `DB_USER=${dbUser}`,
    `DB_PASSWORD=${dbPassword}`,
    `DB_NAME=${dbName}`,
    `DB_POOL_LIMIT=${dbPoolLimit}`,
    `DB_SSL=${dbSsl}`,
    '',
    '# Storage & Optional Local SQLite Fallback',
    'STORAGE_DIR=',
    'SQLITE_DB_PATH=',
    'UPLOADS_DIR=',
    'BACKUPS_DIR=',
    '',
    '# External Providers (Server-side only)',
    'ALLOW_UNVERIFIED_REGISTRATION=false',
    `WHATSAPP_API_URL=${whatsappUrl}`,
    `WHATSAPP_API_TOKEN=${whatsappToken}`,
    `BUNNY_STREAM_LIBRARY_ID=${bunnyLibId}`,
    `BUNNY_STREAM_API_KEY=${bunnyApiKey}`,
    `BUNNY_STREAM_TOKEN_KEY=${bunnyTokenKey}`,
    ''
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const outPath = args.out || ENV_PATH;

  if (fs.existsSync(outPath) && !args.force) {
    console.error(`File already exists at ${outPath}. Pass --force to overwrite.`);
    process.exit(1);
  }

  let domain = args.domain || '';
  let nodeEnv = args.mode || 'production';
  let port = args.port || '4000';
  let host = args.host || '0.0.0.0';
  let dbClient = args.dbClient || 'mysql';
  let dbHost = args.dbHost || '127.0.0.1';
  let dbPort = args.dbPort || '3306';
  let dbUser = args.dbUser || '';
  let dbPassword = args.dbPassword || '';
  let dbName = args.dbName || '';
  let bunnyLibId = '';
  let bunnyApiKey = '';
  let bunnyTokenKey = '';
  let whatsappUrl = '';
  let whatsappToken = '';

  if (!args.yes && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const d = await rl.question('النطاق الرسمي للمنصة (مثال: matn-platform.com، اتركه فارغاً للتعديل لاحقاً): ');
      if (d.trim()) domain = d.trim();
      const e = await rl.question('وضع التشغيل [production]: ');
      if (e.trim()) nodeEnv = e.trim();
      const p = await rl.question('المنفذ [4000]: ');
      if (p.trim()) port = p.trim();
      const dbc = await rl.question('نوع قاعدة البيانات (mysql / sqlite) [mysql]: ');
      if (dbc.trim()) dbClient = dbc.trim().toLowerCase();
      if (dbClient === 'mysql') {
        const dh = await rl.question('خادم MySQL DB_HOST [127.0.0.1]: ');
        if (dh.trim()) dbHost = dh.trim();
        const dn = await rl.question('اسم قاعدة البيانات DB_NAME (من hPanel): ');
        if (dn.trim()) dbName = dn.trim();
        const du = await rl.question('مستخدم قاعدة البيانات DB_USER: ');
        if (du.trim()) dbUser = du.trim();
        const dp = await rl.question('كلمة مرور قاعدة البيانات DB_PASSWORD: ');
        if (dp.trim()) dbPassword = dp.trim();
      }
      bunnyLibId = (await rl.question('Bunny Stream Library ID (اختياري): ')).trim();
      if (bunnyLibId) {
        bunnyApiKey = (await rl.question('Bunny Stream API Key: ')).trim();
        bunnyTokenKey = (await rl.question('Bunny Stream Token Authentication Key: ')).trim();
      }
      whatsappUrl = (await rl.question('رابط بوابة الواتساب https://... (اختياري): ')).trim();
      if (whatsappUrl) {
        whatsappToken = (await rl.question('توكن بوابة الواتساب: ')).trim();
      }
    } finally {
      rl.close();
    }
  }

  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const streamTicketSecret = crypto.randomBytes(32).toString('hex');

  const content = buildEnvContent({
    nodeEnv,
    host,
    port,
    domain,
    jwtSecret,
    streamTicketSecret,
    dbClient,
    dbHost,
    dbPort,
    dbUser,
    dbPassword,
    dbName,
    bunnyLibId,
    bunnyApiKey,
    bunnyTokenKey,
    whatsappUrl,
    whatsappToken
  });

  fs.writeFileSync(outPath, content, { encoding: 'utf8', mode: 0o600 });
  console.log(`✅ Generated secure ${path.basename(outPath)} at: ${outPath}`);
  console.log('   - JWT_SECRET: 64-char random hex secret generated.');
  console.log('   - STREAM_TICKET_SECRET: 64-char random hex secret generated.');
  console.log(`   - DB_CLIENT=${dbClient} configured.`);
  console.log('   - Never commit .env to Git.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Setup failed:', err.message);
    process.exit(1);
  });
}

module.exports = { buildEnvContent };
