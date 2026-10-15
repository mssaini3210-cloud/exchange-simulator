const { Pool, types } = require('pg');

// pg returns BIGINT (type id 20) as a string, because JavaScript numbers
// lose precision above 2^53. Our biggest values (paise) stay far below
// that, so convert them to normal numbers.
types.setTypeParser(20, (value) => Number(value));

function createPool(connectionString) {
  if (!connectionString) {
    throw new Error('Database URL is not set');
  }
  return new Pool({ connectionString: connectionString });
}

module.exports = { createPool };
