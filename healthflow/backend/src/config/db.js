require('dotenv').config();

const usePglite =
  process.env.DB_DRIVER === 'pglite' ||
  String(process.env.DATABASE_URL || '').startsWith('pglite:');

let pool;
let withTransaction;

if (usePglite) {
  const path = require('path');
  const { PGlite } = require('@electric-sql/pglite');

  const dataDir = process.env.PGLITE_DIR || path.join(__dirname, '..', '..', '.pglite');
  const pglite = new PGlite(dataDir);

  // Count top-level statements, skipping strings, quoted identifiers, comments
  // and dollar-quoted bodies. PGlite's prepared path rejects >1 statement, so
  // those must go through the simple executor (exec) instead of query.
  function statementCount(sql) {
    let count = 0;
    let hasContent = false;
    let i = 0;
    const n = sql.length;

    while (i < n) {
      const ch = sql[i];
      const two = sql.slice(i, i + 2);

      if (two === '--') {
        i += 2;
        while (i < n && sql[i] !== '\n') i += 1;
        continue;
      }
      if (two === '/*') {
        i += 2;
        while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
        i += 2;
        continue;
      }
      if (ch === "'") {
        i += 1;
        while (i < n) {
          if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
          if (sql[i] === "'") { i += 1; break; }
          i += 1;
        }
        hasContent = true;
        continue;
      }
      if (ch === '"') {
        i += 1;
        while (i < n && sql[i] !== '"') i += 1;
        i += 1;
        hasContent = true;
        continue;
      }
      if (ch === '$') {
        const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
        if (tag) {
          const end = sql.indexOf(tag[0], i + tag[0].length);
          i = end === -1 ? n : end + tag[0].length;
          hasContent = true;
          continue;
        }
      }
      if (ch === ';') {
        if (hasContent) { count += 1; hasContent = false; }
        i += 1;
        continue;
      }
      if (!/\s/.test(ch)) hasContent = true;
      i += 1;
    }

    if (hasContent) count += 1;
    return count;
  }

  const run = async (text, params) => {
    if (params && params.length) {
      return pglite.query(text, params);
    }
    if (statementCount(text) > 1) {
      await pglite.exec(text);
      return { rows: [] };
    }
    return pglite.query(text);
  };

  const client = { query: run, release() {} };

  pool = {
    query: run,
    connect: async () => client,
    on() {},
    end: async () => pglite.close(),
  };

  // PGlite is a single in-process connection, so transactions must not overlap.
  let chain = Promise.resolve();
  withTransaction = (work) => {
    const next = chain.then(async () => {
      await pglite.query('BEGIN');
      try {
        const result = await work(client);
        await pglite.query('COMMIT');
        return result;
      } catch (err) {
        await pglite.query('ROLLBACK');
        throw err;
      }
    });
    chain = next.then(
      () => {},
      () => {}
    );
    return next;
  };

  console.warn(`[db] DB_DRIVER=pglite - using embedded Postgres at ${dataDir} (local dev only).`);
} else {
  const { DATABASE_URL } = process.env;

  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Configure it in .env, or set DB_DRIVER=pglite for local dev.'
    );
  }

  const { Pool } = require('pg');

  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected idle client error:', err.message);
  });

  withTransaction = async (work) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
}

function query(text, params) {
  return pool.query(text, params);
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, close };
