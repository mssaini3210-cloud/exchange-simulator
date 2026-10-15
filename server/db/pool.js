const { Pool, types } = require('pg');

// pg returns BIGINT (type id 20) as a string, because JavaScript numbers
// lose precision above 2^53. Our biggest values (paise) stay far below
// that, so convert them to normal numbers.
types.setTypeParser(20, (value) => Number(value));

function createPool(connectionString) {
  if (!connectionString) {
    throw new Error('Database URL is not set');
  }
  const pool = new Pool({ connectionString: connectionString });
  // An idle connection can fail (for example if PostgreSQL restarts).
  // Without this handler, that error would crash the whole server.
  pool.on('error', (err) => {
    console.error('Unexpected database error:', err.message);
  });
  return pool;
}

module.exports = { createPool };
