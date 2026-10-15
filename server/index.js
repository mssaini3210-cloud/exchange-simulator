const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const createApp = require('./app');
const { createPool } = require('./db/pool');
const { getJwtSecret } = require('./config');
const { cancelOpenOrders } = require('./trading/startup');

getJwtSecret(); // refuse to start without a JWT secret

const PORT = process.env.PORT || 3000;
const pool = createPool(process.env.DATABASE_URL);

async function start() {
  // The book starts empty, so orders left open by the last run are
  // cancelled and their cash and shares released before we accept requests.
  const cancelled = await cancelOpenOrders(pool);
  console.log('Cancelled ' + cancelled + ' open order(s) left from the last run.');

  createApp(pool).listen(PORT, () => {
    console.log('Exchange API listening on port ' + PORT);
  });
}

start().catch((err) => {
  console.error('Server failed to start:', err.message);
  process.exitCode = 1;
  pool.end();
});
