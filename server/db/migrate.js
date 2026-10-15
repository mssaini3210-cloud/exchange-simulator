const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Runs every .sql file in db/migrations that hasn't run yet, in name
// order. Each file runs in its own transaction: if it fails, none of it
// is applied. schema_migrations remembers which files have run.
// Returns the names of the files it ran.
async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const result = await pool.query('SELECT name FROM schema_migrations');
  const alreadyRun = new Set(result.rows.map((row) => row.name));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const ran = [];
  for (const file of files) {
    if (alreadyRun.has(file)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      err.message = 'Migration ' + file + ' failed: ' + err.message;
      throw err;
    } finally {
      client.release();
    }
    ran.push(file);
  }
  return ran;
}

// `npm run migrate` runs this file directly, against DATABASE_URL.
if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const { createPool } = require('./pool');
  const pool = createPool(process.env.DATABASE_URL);
  runMigrations(pool)
    .then((ran) => {
      if (ran.length === 0) {
        console.log('Database is up to date.');
      } else {
        console.log('Applied: ' + ran.join(', '));
      }
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { runMigrations };
