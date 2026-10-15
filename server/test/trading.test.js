const request = require('supertest');
const { Client } = require('pg');
const createApp = require('../app');
const MatchingEngine = require('../engine/MatchingEngine');
const { STARTING_CASH, STARTING_SHARES } = require('../config');
const { authHeader, createTestPool, resetDatabase, clearTables, createTestUser } = require('./helpers');

const pool = createTestPool();

const ALICE = 1;
const BOB = 2;
const CAROL = 3;
const DAVE = 4;
const ERIN = 5;

beforeAll(async () => {
  await resetDatabase(pool);
});

beforeEach(async () => {
  await clearTables(pool);
  for (const username of ['alice', 'bob', 'carol', 'dave', 'erin']) {
    await createTestUser(pool, username);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
});

function postOrder(app, userId, body) {
  return request(app).post('/orders').set('Authorization', authHeader(userId)).send(body);
}

// A user's cash from the database.
async function balanceOf(userId) {
  const result = await pool.query('SELECT cash, reserved_cash FROM balances WHERE user_id = $1', [userId]);
  return { cash: result.rows[0].cash, reserved: result.rows[0].reserved_cash };
}

// A user's shares of one symbol from the database.
async function sharesOf(userId, symbol) {
  const result = await pool.query(
    'SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND symbol = $2',
    [userId, symbol]
  );
  return { quantity: result.rows[0].quantity, reserved: result.rows[0].reserved_quantity };
}

async function orderRow(id) {
  const result = await pool.query(
    'SELECT user_id, side, type, price, quantity, remaining, status, cancel_reason, reserved_cash FROM orders WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

async function countRows(table) {
  const result = await pool.query('SELECT COUNT(*) AS count FROM ' + table);
  return result.rows[0].count;
}

describe('reservations', () => {
  test('a limit buy that rests reserves price × quantity of cash', async () => {
    const res = await postOrder(createApp(pool), ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 1500000 });
    expect(await orderRow(res.body.orderId)).toMatchObject({ status: 'open', remaining: 10, reserved_cash: 1500000 });
  });

  test('a limit sell that rests reserves the shares', async () => {
    const res = await postOrder(createApp(pool), ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 30 });
    expect(res.status).toBe(201);
    expect(await sharesOf(ALICE, 'TCS')).toEqual({ quantity: STARTING_SHARES, reserved: 30 });
    expect(await orderRow(res.body.orderId)).toMatchObject({ status: 'open', remaining: 30, reserved_cash: 0 });
  });

  test('a buy costing more than the cash is rejected, and nothing is saved', async () => {
    const app = createApp(pool);
    // ₹10,00,000.01 for one share: one paisa more than Alice has.
    const res = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: STARTING_CASH + 1, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Insufficient funds' });
    expect(await countRows('orders')).toBe(0);
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 0 });
    expect((await request(app).get('/book/INFY')).body.bids).toEqual([]);

    // Exactly all of her cash is fine.
    const exact = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: STARTING_CASH, quantity: 1 });
    expect(exact.status).toBe(201);
  });

  test('a sell of more shares than the user has is rejected, and nothing is saved', async () => {
    const res = await postOrder(createApp(pool), ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 101 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Insufficient shares' });
    expect(await countRows('orders')).toBe(0);
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 100, reserved: 0 });
  });

  test('available cash is cash minus what is already reserved', async () => {
    const app = createApp(pool);
    // ₹6,00,000 reserved, so only ₹4,00,000 is available.
    expect((await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 6000000, quantity: 10 })).status).toBe(201);
    const tooMuch = await postOrder(app, ALICE, { symbol: 'TCS', side: 'buy', price: 5000000, quantity: 10 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body).toEqual({ error: 'Insufficient funds' });
    const fits = await postOrder(app, ALICE, { symbol: 'TCS', side: 'buy', price: 4000000, quantity: 10 });
    expect(fits.status).toBe(201);
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: STARTING_CASH });
  });

  test('available shares are shares minus what is already reserved', async () => {
    const app = createApp(pool);
    expect((await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 60 })).status).toBe(201);
    const tooMany = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 151000, quantity: 41 });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toEqual({ error: 'Insufficient shares' });
    expect((await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 151000, quantity: 40 })).status).toBe(201);
  });

  test('a market buy reserves exactly the cost of filling against the book', async () => {
    const app = createApp(pool);
    // Bob sells 10 at ₹2,00,000 each: ₹20,00,000 in total, twice Alice's cash.
    await postOrder(app, BOB, { symbol: 'RELIANCE', side: 'sell', price: 20000000, quantity: 10 });

    const tooMuch = await postOrder(app, ALICE, { symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 6 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body).toEqual({ error: 'Insufficient funds' });

    // 5 shares cost exactly ₹10,00,000: allowed, and it spends everything.
    const fits = await postOrder(app, ALICE, { symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 5 });
    expect(fits.status).toBe(201);
    expect(fits.body.status).toBe('filled');
    expect(await balanceOf(ALICE)).toEqual({ cash: 0, reserved: 0 });
    expect(await orderRow(fits.body.orderId)).toMatchObject({ status: 'filled', reserved_cash: 0 });
  });

  test('a market sell needs all its shares available', async () => {
    const res = await postOrder(createApp(pool), ALICE, { symbol: 'INFY', side: 'sell', type: 'market', quantity: 101 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Insufficient shares' });
  });

  test('prices and quantities above the limits are rejected', async () => {
    const app = createApp(pool);
    const price = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 1000000001, quantity: 1 });
    expect(price.status).toBe(400);
    expect(price.body).toEqual({ error: 'Price must be at most 1000000000 paise' });
    const quantity = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 1, quantity: 1000001 });
    expect(quantity.status).toBe(400);
    expect(quantity.body).toEqual({ error: 'Quantity must be at most 1000000' });
  });
});

describe('settlement', () => {
  test('a trade moves cash and shares and fills both orders', async () => {
    const app = createApp(pool);
    const sell = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const buy = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(buy.body.status).toBe('filled');

    // 5 × ₹1,500 = ₹7,500 = 750000 paise
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH + 750000, reserved: 0 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 95, reserved: 0 });
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 750000, reserved: 0 });
    expect(await sharesOf(BOB, 'INFY')).toEqual({ quantity: 105, reserved: 0 });

    expect(await orderRow(sell.body.orderId)).toMatchObject({ status: 'filled', remaining: 0 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ status: 'filled', remaining: 0, reserved_cash: 0 });

    const trades = await pool.query(
      'SELECT symbol, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity FROM trades'
    );
    expect(trades.rows).toEqual([
      {
        symbol: 'INFY',
        buy_order_id: buy.body.orderId,
        sell_order_id: sell.body.orderId,
        buy_user_id: BOB,
        sell_user_id: ALICE,
        price: 150000,
        quantity: 5,
      },
    ]);
  });

  test('a partly filled resting order stays open with the rest still reserved', async () => {
    const app = createApp(pool);
    const sell = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 10 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 4 });
    expect(await orderRow(sell.body.orderId)).toMatchObject({ status: 'open', remaining: 6 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 96, reserved: 6 });
  });

  test('an incoming sell is paid by the resting buyer', async () => {
    const app = createApp(pool);
    await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 350000, quantity: 2 });
    const sell = await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 340000, quantity: 2 });
    expect(sell.body.trades.map((t) => t.price)).toEqual([350000]); // the resting buyer's price
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH + 700000, reserved: 0 });
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 700000, reserved: 0 });
    expect(await sharesOf(BOB, 'TCS')).toEqual({ quantity: 102, reserved: 0 });
  });

  test('a sweep across three levels settles each trade with its own seller', async () => {
    const app = createApp(pool);
    await postOrder(app, CAROL, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 2 });
    await postOrder(app, DAVE, { symbol: 'INFY', side: 'sell', price: 150100, quantity: 2 });
    await postOrder(app, ERIN, { symbol: 'INFY', side: 'sell', price: 150200, quantity: 2 });
    const buy = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150200, quantity: 6 });

    expect(buy.body.trades.map((t) => [t.price, t.quantity])).toEqual([
      [150000, 2],
      [150100, 2],
      [150200, 2],
    ]);
    expect((await balanceOf(CAROL)).cash).toBe(STARTING_CASH + 300000);
    expect((await balanceOf(DAVE)).cash).toBe(STARTING_CASH + 300200);
    expect((await balanceOf(ERIN)).cash).toBe(STARTING_CASH + 300400);
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 900600, reserved: 0 });
    expect(await countRows('trades')).toBe(3);
  });

  test('GET /me shows the real numbers after trading', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 100000, quantity: 3 }); // rests

    const me = await request(app).get('/me').set('Authorization', authHeader(BOB));
    expect(me.body).toMatchObject({ cash: STARTING_CASH - 750000, reservedCash: 300000 });
    expect(me.body.holdings).toContainEqual({ symbol: 'INFY', quantity: 105, reservedQuantity: 0 });
  });
});

describe('releases', () => {
  test('price improvement: a limit buy filled at a lower price gets the difference back', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    // Bob is willing to pay ₹1,510 but the seller only asks ₹1,500.
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 151000, quantity: 5 });
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 750000, reserved: 0 });
  });

  test('price improvement on the filled part; the rest stays reserved at the limit price', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const buy = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 151000, quantity: 8 });
    expect(buy.body.status).toBe('open');
    // Paid 5 × 150000; still holds 3 × 151000 for the 3 that rest.
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 750000, reserved: 453000 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ remaining: 3, reserved_cash: 453000 });
  });

  test('a self-trade cancel releases the incoming buy\'s cash', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(buy.body).toMatchObject({ status: 'cancelled', cancelReason: 'self-trade', cancelledQuantity: 5 });
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 0 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'self-trade',
      remaining: 5,
      reserved_cash: 0,
    });
    // Her resting sell is untouched and still holds its shares.
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 100, reserved: 5 });
  });

  test('a self-trade cancel releases the incoming sell\'s shares, after filling others first', async () => {
    const app = createApp(pool);
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 2 });
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 3 });
    const sell = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 10 });
    expect(sell.body.trades.map((t) => t.quantity)).toEqual([2]); // Bob's 2, then her own order stops it
    expect(sell.body).toMatchObject({ status: 'cancelled', cancelReason: 'self-trade', cancelledQuantity: 8 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 98, reserved: 0 });
  });

  test('a market buy that runs out of sellers releases nothing extra and cancels the rest', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 4 });
    const buy = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', type: 'market', quantity: 10 });
    expect(buy.body).toMatchObject({ status: 'cancelled', cancelReason: 'no liquidity', cancelledQuantity: 6 });
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH - 600000, reserved: 0 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ remaining: 6, reserved_cash: 0, cancel_reason: 'no liquidity' });
  });

  test('a market sell releases the shares it could not sell', async () => {
    const app = createApp(pool);
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 4 });
    const sell = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', type: 'market', quantity: 10 });
    expect(sell.body).toMatchObject({ status: 'cancelled', cancelReason: 'no liquidity', cancelledQuantity: 6 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 96, reserved: 0 });
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH + 600000, reserved: 0 });
  });

  test('a market order on an empty book is saved as cancelled with nothing reserved', async () => {
    const buy = await postOrder(createApp(pool), BOB, { symbol: 'TCS', side: 'buy', type: 'market', quantity: 5 });
    expect(buy.body).toMatchObject({ status: 'cancelled', cancelReason: 'no liquidity', trades: [] });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ type: 'market', price: null, status: 'cancelled' });
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH, reserved: 0 });
  });
});

describe('order ids and trades come from the database', () => {
  test('ids keep counting in a new app, and a rejected order uses no id', async () => {
    const first = createApp(pool);
    expect((await postOrder(first, ALICE, { symbol: 'INFY', side: 'buy', price: 100, quantity: 1 })).body.orderId).toBe(1);
    expect((await postOrder(first, ALICE, { symbol: 'INFY', side: 'sell', price: 999999, quantity: 500 })).status).toBe(400);
    expect((await postOrder(first, ALICE, { symbol: 'INFY', side: 'buy', price: 100, quantity: 1 })).body.orderId).toBe(2);

    const second = createApp(pool); // like a server restart
    expect((await postOrder(second, ALICE, { symbol: 'TCS', side: 'buy', price: 100, quantity: 1 })).body.orderId).toBe(3);
  });

  test('GET /trades reads saved trades, so a new app still sees them', async () => {
    const first = createApp(pool);
    await postOrder(first, ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 1 });
    const buy = await postOrder(first, BOB, { symbol: 'TCS', side: 'buy', price: 350000, quantity: 1 });

    const res = await request(createApp(pool)).get('/trades/TCS');
    expect(res.body.trades).toEqual([buy.body.trades[0]]);
    expect(Object.keys(res.body.trades[0]).sort()).toEqual(['price', 'quantity', 'symbol', 'timeIST', 'timestamp']);
  });
});

describe('when something fails', () => {
  test('a database failure rolls back everything, and the book is untouched', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const bookBefore = (await request(app).get('/book/INFY')).body;

    const originalQuery = Client.prototype.query;
    jest.spyOn(Client.prototype, 'query').mockImplementation(function (text, ...rest) {
      if (typeof text === 'string' && text.includes('INSERT INTO trades')) {
        return Promise.reject(new Error('simulated database failure'));
      }
      return originalQuery.call(this, text, ...rest);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(500);
    jest.restoreAllMocks();

    // Nothing from Bob's order was saved...
    expect(await countRows('orders')).toBe(1);
    expect(await countRows('trades')).toBe(0);
    expect(await balanceOf(BOB)).toEqual({ cash: STARTING_CASH, reserved: 0 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 100, reserved: 5 });
    // ...and the in-memory book never saw it.
    expect((await request(app).get('/book/INFY')).body).toEqual(bookBefore);

    // Trading carries on normally.
    const retry = await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('filled');
  });

  test('if the engine disagrees with the preview, trading halts with 503', async () => {
    const app = createApp(pool);
    // Make the engine "lose" this order: the preview said it would rest.
    jest.spyOn(MatchingEngine.prototype, 'addOrder').mockImplementationOnce(() => ({
      trades: [],
      restingOrder: null,
      cancelledQuantity: 0,
      cancelReason: null,
    }));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 1 });
    expect(res.status).toBe(500);
    expect(consoleError).toHaveBeenCalledWith('TRADING HALTED: engine and database disagree.', expect.any(Error));

    const next = await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 100, quantity: 1 });
    expect(next.status).toBe(503);
    expect(next.body).toEqual({ error: 'Trading halted, restart required' });
    // Reads still work.
    expect((await request(app).get('/book/INFY')).status).toBe(200);
  });
});

describe('cancelling releases what the order still holds', () => {
  function cancel(app, userId, symbol, id) {
    return request(app).delete('/orders/' + symbol + '/' + id).set('Authorization', authHeader(userId));
  }

  test('cancelling a resting buy releases all its cash', async () => {
    const app = createApp(pool);
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });
    const res = await cancel(app, ALICE, 'INFY', buy.body.orderId);
    expect(res.status).toBe(200);
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 0 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'cancelled by user',
      remaining: 10,
      reserved_cash: 0,
    });
    expect((await request(app).get('/book/INFY')).body.bids).toEqual([]);
  });

  test('cancelling a resting sell releases its shares', async () => {
    const app = createApp(pool);
    const sell = await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 30 });
    await cancel(app, ALICE, 'TCS', sell.body.orderId);
    expect(await sharesOf(ALICE, 'TCS')).toEqual({ quantity: 100, reserved: 0 });
    expect(await orderRow(sell.body.orderId)).toMatchObject({ status: 'cancelled', remaining: 30 });
  });

  test('cancelling a partly filled buy releases only what is left', async () => {
    const app = createApp(pool);
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 4 });
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH - 600000, reserved: 900000 });

    await cancel(app, ALICE, 'INFY', buy.body.orderId);
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH - 600000, reserved: 0 });
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 104, reserved: 0 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ status: 'cancelled', remaining: 6, reserved_cash: 0 });
  });

  test('cancelling a partly filled sell releases only the unsold shares', async () => {
    const app = createApp(pool);
    const sell = await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 10 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 3 });
    await cancel(app, ALICE, 'INFY', sell.body.orderId);
    expect(await sharesOf(ALICE, 'INFY')).toEqual({ quantity: 97, reserved: 0 });
  });

  test("someone else's order: 403, and nothing changes", async () => {
    const app = createApp(pool);
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });
    expect((await cancel(app, BOB, 'INFY', buy.body.orderId)).status).toBe(403);
    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 1500000 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ status: 'open' });
  });

  test('a database failure during cancel rolls back, and the order stays in the book', async () => {
    const app = createApp(pool);
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });

    const originalQuery = Client.prototype.query;
    jest.spyOn(Client.prototype, 'query').mockImplementation(function (text, ...rest) {
      if (typeof text === 'string' && text.includes("SET status = 'cancelled'")) {
        return Promise.reject(new Error('simulated database failure'));
      }
      return originalQuery.call(this, text, ...rest);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await cancel(app, ALICE, 'INFY', buy.body.orderId)).status).toBe(500);
    jest.restoreAllMocks();

    expect(await balanceOf(ALICE)).toEqual({ cash: STARTING_CASH, reserved: 1500000 });
    expect(await orderRow(buy.body.orderId)).toMatchObject({ status: 'open', reserved_cash: 1500000 });
    expect((await request(app).get('/book/INFY')).body.bids).toEqual([{ price: 150000, quantity: 10 }]);
    // A retry works.
    expect((await cancel(app, ALICE, 'INFY', buy.body.orderId)).status).toBe(200);
  });

  test('if the order is open in the database but missing from the book, trading halts', async () => {
    const app = createApp(pool);
    const buy = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 10 });
    jest.spyOn(MatchingEngine.prototype, 'cancelOrder').mockImplementationOnce(() => false);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await cancel(app, ALICE, 'INFY', buy.body.orderId)).status).toBe(500);
    const next = await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 100, quantity: 1 });
    expect(next.status).toBe(503);
    expect((await cancel(app, BOB, 'TCS', 1)).status).toBe(503);
  });
});

describe('GET /orders', () => {
  function getOrders(app, userId, query) {
    return request(app)
      .get('/orders' + (query || ''))
      .set('Authorization', authHeader(userId));
  }

  async function placeMixOfOrders(app) {
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 }); // 1: filled by Bob
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 }); // 2: Bob's, filled
    await postOrder(app, ALICE, { symbol: 'TCS', side: 'buy', price: 340000, quantity: 2 }); // 3: open
    const toCancel = await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 360000, quantity: 3 }); // 4
    await request(app).delete('/orders/TCS/' + toCancel.body.orderId).set('Authorization', authHeader(ALICE));
    await postOrder(app, ALICE, { symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 1 }); // 5: no liquidity
  }

  test("lists only the user's own orders, newest first, with all the fields", async () => {
    const app = createApp(pool);
    await placeMixOfOrders(app);
    const res = await getOrders(app, ALICE);
    expect(res.status).toBe(200);
    expect(res.body.orders.map((o) => [o.id, o.status, o.cancelReason])).toEqual([
      [5, 'cancelled', 'no liquidity'],
      [4, 'cancelled', 'cancelled by user'],
      [3, 'open', null],
      [1, 'filled', null],
    ]);
    expect(res.body.orders[3]).toMatchObject({
      id: 1,
      symbol: 'INFY',
      side: 'sell',
      type: 'limit',
      price: 150000,
      quantity: 5,
      remaining: 0,
      filledQuantity: 5,
    });
    expect(res.body.orders[0].price).toBeNull(); // market order
    expect(new Date(res.body.orders[0].createdAt).toISOString()).toBe(res.body.orders[0].createdAt);
  });

  test('filters by status', async () => {
    const app = createApp(pool);
    await placeMixOfOrders(app);
    expect((await getOrders(app, ALICE, '?status=open')).body.orders.map((o) => o.id)).toEqual([3]);
    expect((await getOrders(app, ALICE, '?status=filled')).body.orders.map((o) => o.id)).toEqual([1]);
    expect((await getOrders(app, ALICE, '?status=cancelled')).body.orders.map((o) => o.id)).toEqual([5, 4]);
    expect((await getOrders(app, BOB, '?status=filled')).body.orders.map((o) => o.id)).toEqual([2]);
  });

  test('a partly filled open order shows how much has filled', async () => {
    const app = createApp(pool);
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 10 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 4 });
    const res = await getOrders(app, ALICE, '?status=open');
    expect(res.body.orders[0]).toMatchObject({ remaining: 6, filledQuantity: 4, status: 'open' });
  });

  test('no orders yet is an empty list', async () => {
    const res = await getOrders(createApp(pool), ERIN);
    expect(res.body).toEqual({ orders: [] });
  });

  test('an unknown status is a 400', async () => {
    const res = await getOrders(createApp(pool), ALICE, '?status=pending');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Status must be one of: open, filled, cancelled' });
  });

  test('needs a token', async () => {
    const res = await request(createApp(pool)).get('/orders');
    expect(res.status).toBe(401);
  });
});
