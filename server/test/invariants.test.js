const request = require('supertest');
const createApp = require('../app');
const { SYMBOLS, STARTING_CASH, STARTING_SHARES } = require('../config');
const { createTestPool, resetDatabase, clearTables, createTestUser } = require('./helpers');
const { createRandom } = require('./random');

// Change with INVARIANT_SEED=123 npm test -- invariants, to try other runs.
// The seed is in the test name, so a failure can be replayed exactly.
const SEED = Number(process.env.INVARIANT_SEED || 20261015);
const USER_COUNT = 5;
const OPERATIONS = 300;
const BATCH_SIZE = 10; // operations sent at the same time with Promise.all

const pool = createTestPool();

beforeAll(async () => {
  await resetDatabase(pool);
  await clearTables(pool);
});

afterAll(async () => {
  await pool.end();
});

async function query(sql, params) {
  return (await pool.query(sql, params)).rows;
}

test(`seed ${SEED}: money and shares are never created or lost`, async () => {
  const random = createRandom(SEED);
  const app = createApp(pool);
  const users = [];
  for (let i = 1; i <= USER_COUNT; i++) {
    users.push(await createTestUser(pool, 'user' + i));
  }
  const placedIds = new Map(users.map((u) => [u.id, []])); // user id -> their order ids

  // One random operation: usually place an order, sometimes cancel one.
  function randomOperation() {
    const user = random.pick(users);
    const myOrders = placedIds.get(user.id);
    if (random.next() < 0.2 && myOrders.length > 0) {
      const id = random.pick(myOrders);
      const symbol = random.pick(SYMBOLS); // often the wrong symbol: should be a harmless 404
      return { kind: 'cancel', user: user, symbol: symbol, id: id };
    }
    const body = {
      symbol: random.pick(SYMBOLS),
      side: random.pick(['buy', 'sell']),
      quantity: random.int(1, 20),
    };
    if (random.next() < 0.2) {
      body.type = 'market';
    } else {
      body.price = random.int(1490, 1510) * 100; // ₹1,490 to ₹1,510: orders cross often
    }
    return { kind: 'place', user: user, body: body };
  }

  function send(op) {
    const auth = 'Bearer ' + op.user.token;
    if (op.kind === 'cancel') {
      return request(app).delete('/orders/' + op.symbol + '/' + op.id).set('Authorization', auth);
    }
    return request(app).post('/orders').set('Authorization', auth).send(op.body);
  }

  const statusCounts = {};
  for (let done = 0; done < OPERATIONS; done += BATCH_SIZE) {
    const batch = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      batch.push(randomOperation());
    }
    const responses = await Promise.all(batch.map(send));
    responses.forEach((res, i) => {
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      // Only these are acceptable: placed, rejected for funds or shares,
      // cancelled, or "not found" for an order that already filled.
      expect([200, 201, 400, 404]).toContain(res.status);
      if (res.status === 400) {
        expect(['Insufficient funds', 'Insufficient shares']).toContain(res.body.error);
      }
      if (res.status === 201) {
        placedIds.get(batch[i].user.id).push(res.body.orderId);
      }
    });
  }

  // The run must actually have traded, or the checks below prove nothing.
  const tradeCount = (await query('SELECT COUNT(*)::int AS count FROM trades'))[0].count;
  expect(tradeCount).toBeGreaterThan(50);

  // 1. Total cash is exactly what everyone started with.
  const cash = await query('SELECT SUM(cash)::bigint AS total FROM balances');
  expect(cash[0].total).toBe(USER_COUNT * STARTING_CASH);

  // 2. Total shares of each symbol are exactly what everyone started with.
  const shares = await query('SELECT symbol, SUM(quantity)::bigint AS total FROM holdings GROUP BY symbol ORDER BY symbol');
  expect(shares).toEqual(
    SYMBOLS.slice()
      .sort()
      .map((symbol) => ({ symbol: symbol, total: USER_COUNT * STARTING_SHARES }))
  );

  // 3. Nothing is negative.
  const lowest = await query(`
    SELECT
      (SELECT MIN(cash) FROM balances) AS cash,
      (SELECT MIN(reserved_cash) FROM balances) AS reserved_cash,
      (SELECT MIN(quantity) FROM holdings) AS quantity,
      (SELECT MIN(reserved_quantity) FROM holdings) AS reserved_quantity
  `);
  for (const value of Object.values(lowest[0])) {
    expect(value).toBeGreaterThanOrEqual(0);
  }

  // 4. Each user's reserved cash = what their open buy orders hold
  //    = price × remaining of those orders.
  const reservedCash = await query(`
    SELECT b.user_id, b.reserved_cash,
           COALESCE(SUM(o.reserved_cash), 0)::bigint AS held_by_orders,
           COALESCE(SUM(o.price * o.remaining), 0)::bigint AS price_times_remaining
    FROM balances b
    LEFT JOIN orders o ON o.user_id = b.user_id AND o.status = 'open' AND o.side = 'buy'
    GROUP BY b.user_id, b.reserved_cash
  `);
  for (const row of reservedCash) {
    expect({ user: row.user_id, reserved: row.reserved_cash }).toEqual({ user: row.user_id, reserved: row.held_by_orders });
    expect({ user: row.user_id, reserved: row.reserved_cash }).toEqual({
      user: row.user_id,
      reserved: row.price_times_remaining,
    });
  }

  // 5. Each user's reserved shares = remaining of their open sell orders.
  const reservedShares = await query(`
    SELECT h.user_id, h.symbol, h.reserved_quantity,
           COALESCE(SUM(o.remaining), 0)::bigint AS held_by_orders
    FROM holdings h
    LEFT JOIN orders o ON o.user_id = h.user_id AND o.symbol = h.symbol AND o.status = 'open' AND o.side = 'sell'
    GROUP BY h.user_id, h.symbol, h.reserved_quantity
  `);
  for (const row of reservedShares) {
    expect({ user: row.user_id, symbol: row.symbol, reserved: row.reserved_quantity }).toEqual({
      user: row.user_id,
      symbol: row.symbol,
      reserved: row.held_by_orders,
    });
  }

  // 6. Closed orders hold nothing.
  const closedHolding = await query("SELECT COUNT(*)::int AS count FROM orders WHERE status <> 'open' AND reserved_cash <> 0");
  expect(closedHolding[0].count).toBe(0);

  // 7. Each order's filled amount = the sum of its trades.
  const fills = await query(`
    SELECT o.id, (o.quantity - o.remaining) AS filled,
           COALESCE((SELECT SUM(t.quantity) FROM trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id), 0)::bigint AS traded
    FROM orders o
  `);
  for (const row of fills) {
    expect({ order: row.id, filled: row.filled }).toEqual({ order: row.id, filled: row.traded });
  }

  // 8. Each user's cash and shares = start + what they sold − what they bought.
  const accounts = await query(`
    SELECT b.user_id, b.cash,
           COALESCE((SELECT SUM(price * quantity) FROM trades WHERE sell_user_id = b.user_id), 0)::bigint AS received,
           COALESCE((SELECT SUM(price * quantity) FROM trades WHERE buy_user_id = b.user_id), 0)::bigint AS paid
    FROM balances b
  `);
  for (const row of accounts) {
    expect({ user: row.user_id, cash: row.cash }).toEqual({
      user: row.user_id,
      cash: STARTING_CASH + row.received - row.paid,
    });
  }
  const positions = await query(`
    SELECT h.user_id, h.symbol, h.quantity,
           COALESCE((SELECT SUM(quantity) FROM trades WHERE buy_user_id = h.user_id AND symbol = h.symbol), 0)::bigint AS bought,
           COALESCE((SELECT SUM(quantity) FROM trades WHERE sell_user_id = h.user_id AND symbol = h.symbol), 0)::bigint AS sold
    FROM holdings h
  `);
  for (const row of positions) {
    expect({ user: row.user_id, symbol: row.symbol, quantity: row.quantity }).toEqual({
      user: row.user_id,
      symbol: row.symbol,
      quantity: STARTING_SHARES + row.bought - row.sold,
    });
  }

  // 9. The in-memory book shows exactly the database's open orders
  //    (top 10 price levels of each side, which is what /book shows).
  for (const symbol of SYMBOLS) {
    const book = (await request(app).get('/book/' + symbol)).body;
    const bids = await query(
      `SELECT price, SUM(remaining)::bigint AS quantity FROM orders
       WHERE symbol = $1 AND status = 'open' AND side = 'buy'
       GROUP BY price ORDER BY price DESC LIMIT 10`,
      [symbol]
    );
    const asks = await query(
      `SELECT price, SUM(remaining)::bigint AS quantity FROM orders
       WHERE symbol = $1 AND status = 'open' AND side = 'sell'
       GROUP BY price ORDER BY price ASC LIMIT 10`,
      [symbol]
    );
    expect({ symbol: symbol, bids: book.bids, asks: book.asks }).toEqual({ symbol: symbol, bids: bids, asks: asks });
  }

  // For the record, in the test output.
  console.log(`seed ${SEED}: ${OPERATIONS} operations, ${tradeCount} trades, responses by status:`, statusCounts);
});
