require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { pool, close } = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

async function migrate() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    console.log('No migration files found.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(sql);

      const { rows } = await client.query(
        'SELECT checksum FROM schema_migrations WHERE version = $1',
        [file]
      );

      if (rows.length) {
        if (rows[0].checksum !== sum) {
          throw new Error(
            `Checksum mismatch for "${file}" - the file changed after it was applied. ` +
              'Create a new migration instead of editing an applied one.'
          );
        }
        console.log(`skip   ${file} (already applied)`);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [file, sum]
        );
        await client.query('COMMIT');
        console.log(`apply  ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration "${file}" failed: ${err.message}`);
      }
    }

    console.log('Migrations complete.');
  } finally {
    client.release();
  }
}

migrate()
  .then(close)
  .catch(async (err) => {
    console.error(err.message || err);
    try {
      await close();
    } catch (_) {
      /* pool already closed */
    }
    process.exit(1);
  });
