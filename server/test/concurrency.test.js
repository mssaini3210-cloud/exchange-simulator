const request = require('supertest');
const createApp = require('../app');
const { STARTING_CASH } = require('../config');
const { createTestPool, resetDatabase, clearTables, createTestUser } = require('./helpers');

const pool = createTestPool();

beforeAll(async () => {
  await resetDatabase(pool);
});

beforeEach(async () => {
  await clearTables(pool);
});

afterAll(async () => {
  await pool.end();
});

// Sends all the orders at the same moment and waits for every answer.
function sendAllAtOnce(app, token, bodies) {
  return Promise.all(
    bodies.map((body) => request(app).post('/orders').set('Authorization', 'Bearer ' + token).send(body))
  );
}

function countBy(responses) {
  const counts = {};
  for (const res of responses) {
    const key = res.status + (res.body.error ? ' ' + res.body.error : '');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

test('20 buys at once, each costing a tenth of the cash: exactly 10 succeed', async () => {
  const app = createApp(pool);
  const alice = await createTestUser(pool, 'alice');
  // ₹10,000 × 10 shares = ₹1,00,000 each. Spread over all three symbols,
  // because cash is shared between them.
  const symbols = ['INFY', 'TCS', 'RELIANCE'];
  const bodies = [];
  for (let i = 0; i < 20; i++) {
    bodies.push({ symbol: symbols[i % 3], side: 'buy', price: 1000000, quantity: 10 });
  }

  const responses = await sendAllAtOnce(app, alice.token, bodies);

  expect(countBy(responses)).toEqual({ 201: 10, '400 Insufficient funds': 10 });
  const balance = await pool.query('SELECT cash, reserved_cash FROM balances WHERE user_id = $1', [alice.id]);
  expect(balance.rows[0]).toEqual({ cash: STARTING_CASH, reserved_cash: STARTING_CASH }); // nothing available
  const open = await pool.query("SELECT COUNT(*)::int AS count FROM orders WHERE status = 'open'");
  expect(open.rows[0].count).toBe(10);
});

test('20 sells of 10 shares at once, with only 100 shares: exactly 10 succeed', async () => {
  const app = createApp(pool);
  const alice = await createTestUser(pool, 'alice');
  const bodies = [];
  for (let i = 0; i < 20; i++) {
    bodies.push({ symbol: 'TCS', side: 'sell', price: 500000 + i * 100, quantity: 10 });
  }

  const responses = await sendAllAtOnce(app, alice.token, bodies);

  expect(countBy(responses)).toEqual({ 201: 10, '400 Insufficient shares': 10 });
  const holding = await pool.query(
    "SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND symbol = 'TCS'",
    [alice.id]
  );
  expect(holding.rows[0]).toEqual({ quantity: 100, reserved_quantity: 100 });
});

test('market buys at once can only spend the cash that exists', async () => {
  const app = createApp(pool);
  const alice = await createTestUser(pool, 'alice');
  const bob = await createTestUser(pool, 'bob');
  // Bob offers 100 RELIANCE at ₹40,000 each. Alice can afford 25 of them.
  await request(app)
    .post('/orders')
    .set('Authorization', 'Bearer ' + bob.token)
    .send({ symbol: 'RELIANCE', side: 'sell', price: 4000000, quantity: 100 });

  const bodies = [];
  for (let i = 0; i < 10; i++) {
    bodies.push({ symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 5 }); // ₹2,00,000 each
  }
  const responses = await sendAllAtOnce(app, alice.token, bodies);

  expect(countBy(responses)).toEqual({ 201: 5, '400 Insufficient funds': 5 });
  const balance = await pool.query('SELECT cash, reserved_cash FROM balances WHERE user_id = $1', [alice.id]);
  expect(balance.rows[0]).toEqual({ cash: 0, reserved_cash: 0 });
});
