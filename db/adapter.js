const path = require('node:path');
const fs = require('node:fs');
const { resolveSqliteDbPath } = require('../lib/paths');

function resolveDbClient() {
  const explicit = String(process.env.DB_CLIENT || '').trim().toLowerCase();
  if (explicit) return explicit;
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return nodeEnv === 'production' ? 'mysql' : 'sqlite';
}

function normalizeParam(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function normalizeParams(params = []) {
  if (!Array.isArray(params)) return [];
  return params.map(normalizeParam);
}

/**
 * Splits a multi-statement SQL script on top-level semicolons (ignoring quoted literals,
 * backslash-escaped quotes, `--` line comments, `#` comments, and `/* ... *\/` / `/*!...*\/` block comments).
 * Allows keeping `multipleStatements: false` on the MySQL pool while running multi-statement DDL scripts safely.
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  const text = String(sql || '');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if ((ch === '-' && next === '-') || ch === '#') {
        inLineComment = true;
        if (ch === '-') i++;
        continue;
      }
      if (ch === '/' && next === '*') {
        // Preserve MySQL conditional comments (`/*!...*/`) as executable statements? No, strip block comments safely.
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (inSingleQuote) {
      if (ch === '\\' && next !== undefined) {
        current += ch + next;
        i++;
        continue;
      }
      if (ch === "'" && next === "'") {
        current += "''";
        i++;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = false;
      }
      current += ch;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '\\' && next !== undefined) {
        current += ch + next;
        i++;
        continue;
      }
      if (ch === '"' && next === '"') {
        current += '""';
        i++;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = false;
      }
      current += ch;
      continue;
    }

    if (ch === '`') {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (!inBacktick && ch === "'") {
      inSingleQuote = true;
      current += ch;
      continue;
    }

    if (!inBacktick && ch === '"') {
      inDoubleQuote = true;
      current += ch;
      continue;
    }

    if (ch === ';' && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
    } else {
      current += ch;
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function buildMysqlPoolConfig() {
  const limitRaw = Number(process.env.DB_POOL_LIMIT || 12);
  const connectionLimit = Math.min(Math.max(2, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 12), 50);
  const useSsl = ['true', '1', 'yes', 'on'].includes(String(process.env.DB_SSL || 'false').trim().toLowerCase());
  const rejectUnauthorized = !['false', '0', 'no', 'off'].includes(
    String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true').trim().toLowerCase()
  );

  const config = {
    host: (process.env.DB_HOST || '127.0.0.1').trim(),
    port: Math.max(1, Number(process.env.DB_PORT || 3306) || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'matn_platform',
    connectionLimit,
    waitForConnections: true,
    queueLimit: 200,
    connectTimeout: 10000,
    idleTimeout: 60000,
    decimalNumbers: true,
    charset: 'utf8mb4',
    timezone: 'Z',
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    multipleStatements: false
  };

  if (useSsl) {
    config.ssl = { rejectUnauthorized };
  }

  return config;
}

function createMysqlExecutor(executor) {
  return {
    client: 'mysql',
    isMysql: true,
    forUpdate: () => 'FOR UPDATE',
    insertIgnorePrefix: () => 'INSERT IGNORE INTO',
    async get(sql, params = []) {
      const [rows] = await executor.execute(sql, normalizeParams(params));
      return Array.isArray(rows) ? rows[0] : undefined;
    },
    async all(sql, params = []) {
      const [rows] = await executor.execute(sql, normalizeParams(params));
      return Array.isArray(rows) ? rows : [];
    },
    async run(sql, params = []) {
      const [result] = await executor.execute(sql, normalizeParams(params));
      return {
        changes: Number(result?.affectedRows || 0),
        lastInsertRowid: result?.insertId ?? 0
      };
    },
    async exec(sql) {
      const statements = splitSqlStatements(sql);
      for (const stmt of statements) {
        await executor.query(stmt);
      }
    }
  };
}

function createSqliteExecutor(sqliteDb) {
  return {
    client: 'sqlite',
    isMysql: false,
    forUpdate: () => '',
    insertIgnorePrefix: () => 'INSERT OR IGNORE INTO',
    async get(sql, params = []) {
      return sqliteDb.prepare(sql).get(...normalizeParams(params));
    },
    async all(sql, params = []) {
      return sqliteDb.prepare(sql).all(...normalizeParams(params));
    },
    async run(sql, params = []) {
      const info = sqliteDb.prepare(sql).run(...normalizeParams(params));
      return {
        changes: Number(info?.changes || 0),
        lastInsertRowid: info?.lastInsertRowid ?? 0
      };
    },
    async exec(sql) {
      sqliteDb.exec(sql);
    }
  };
}

/**
 * Unified Async Database Abstraction Layer
 * - Production default (`DB_CLIENT=mysql`): mysql2/promise connection pool tuned for Hostinger Unlimited (limit <= 50)
 * - Local/Test fallback (`DB_CLIENT=sqlite`): built-in node:sqlite with WAL mode and serialized async transaction mutex
 */
function createDatabaseConnection(customDbPath, options = {}) {
  const dbClient = String(options.client || resolveDbClient()).trim().toLowerCase();

  if (dbClient === 'postgres' || dbClient === 'postgresql') {
    throw new Error('PostgreSQL is not supported in this build. Use DB_CLIENT=mysql (production) or DB_CLIENT=sqlite (local/tests).');
  }

  if (dbClient === 'mysql') {
    const poolConfig = buildMysqlPoolConfig();
    let pool = options.mysqlPool || null;
    if (!pool) {
      const mysql = require('mysql2/promise');
      pool = mysql.createPool(poolConfig);
    }
    const base = createMysqlExecutor(pool);
    return {
      ...base,
      poolConfig: {
        host: poolConfig.host,
        port: poolConfig.port,
        database: poolConfig.database,
        connectionLimit: poolConfig.connectionLimit,
        waitForConnections: poolConfig.waitForConnections,
        queueLimit: poolConfig.queueLimit,
        connectTimeout: poolConfig.connectTimeout,
        idleTimeout: poolConfig.idleTimeout,
        decimalNumbers: poolConfig.decimalNumbers,
        charset: poolConfig.charset,
        timezone: poolConfig.timezone,
        enableKeepAlive: poolConfig.enableKeepAlive,
        multipleStatements: poolConfig.multipleStatements,
        ssl: poolConfig.ssl || null
      },
      async transaction(fn) {
        const conn = await pool.getConnection();
        const tx = createMysqlExecutor(conn);
        try {
          await conn.beginTransaction();
          const result = await fn(tx);
          await conn.commit();
          return result;
        } catch (err) {
          try {
            await conn.rollback();
          } catch (_) {}
          throw err;
        } finally {
          conn.release();
        }
      },
      async close() {
        await pool.end();
      }
    };
  }

  const { DatabaseSync } = require('node:sqlite');
  const resolvedPath = resolveSqliteDbPath(customDbPath);
  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(resolvedPath)), { recursive: true });
  }
  const sqliteDb = new DatabaseSync(resolvedPath);
  sqliteDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -64000;
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;
  `);

  const base = createSqliteExecutor(sqliteDb);
  let txLock = Promise.resolve();

  return {
    ...base,
    async transaction(fn) {
      let release;
      const prev = txLock;
      txLock = new Promise((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        sqliteDb.exec('BEGIN IMMEDIATE');
        const result = await fn(base);
        sqliteDb.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          sqliteDb.exec('ROLLBACK');
        } catch (_) {}
        throw err;
      } finally {
        release();
      }
    },
    async close() {
      try {
        sqliteDb.close();
      } catch (_) {}
    }
  };
}

module.exports = {
  createDatabaseConnection,
  resolveDbClient,
  buildMysqlPoolConfig,
  splitSqlStatements
};
