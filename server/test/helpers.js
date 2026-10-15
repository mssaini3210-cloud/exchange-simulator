const { createPool } = require('../db/pool');
const { runMigrations } = require('../db/migrate');

// A pool for the test database. Refuses to run against the real database,
// because resetDatabase drops every table.
function createTestPool() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must be different from DATABASE_URL');
  }
  return createPool(url);
}

// Drop every table and run all migrations again. Call once per test file.
async function resetDatabase(pool) {
  const result = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const row of result.rows) {
    await pool.query('DROP TABLE IF EXISTS "' + row.tablename + '" CASCADE');
  }
  await runMigrations(pool);
}

// Empty the data tables and restart ids at 1. Call before each test.
async function clearTables(pool) {
  await pool.query('TRUNCATE users, balances, holdings, orders, trades RESTART IDENTITY CASCADE');
}

module.exports = { createTestPool, resetDatabase, clearTables };
