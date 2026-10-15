const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const createApp = require('./app');
const { createPool } = require('./db/pool');
const { getJwtSecret } = require('./config');

getJwtSecret(); // refuse to start without a JWT secret

const PORT = process.env.PORT || 3000;
const pool = createPool(process.env.DATABASE_URL);

createApp(pool).listen(PORT, () => {
  console.log('Exchange API listening on port ' + PORT);
});
