const request = require('supertest');
const jwt = require('jsonwebtoken');
const createApp = require('../app');
const MatchingEngine = require('../engine/MatchingEngine');
const formatIST = require('../formatIST');
const { authHeader } = require('./helpers');

// Orders aren't saved to the database until Day 5, so no pool is needed.
function newApp() {
  return createApp(null);
}

const ALICE = 1;
const BOB = 2;
const DAVE = 4;

function postOrder(app, userId, body) {
  return request(app).post('/orders').set('Authorization', authHeader(userId)).send(body);
}

function cancelOrder(app, userId, symbol, id) {
  return request(app)
    .delete('/orders/' + symbol + '/' + id)
    .set('Authorization', authHeader(userId));
}

function getBook(app, symbol) {
  return request(app).get('/book/' + symbol);
}

describe('order routes need a valid token', () => {
  const body = { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 };

  test('no Authorization header is a 401', async () => {
    const res = await request(newApp()).post('/orders').send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing Authorization header' });
  });

  test('a header that is not "Bearer <token>" is a 401', async () => {
    const app = newApp();
    for (const header of ['Basic abc', 'Bearer', 'Bearer a b', 'bearer ' + jwt.sign({ sub: '1' }, 'x')]) {
      const res = await request(app).post('/orders').set('Authorization', header).send(body);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Authorization header must be "Bearer <token>"' });
    }
  });

  test('a forged token is a 401', async () => {
    const forged = jwt.sign({ sub: '1' }, 'not-the-real-secret', { expiresIn: '1d' });
    const res = await request(newApp()).post('/orders').set('Authorization', 'Bearer ' + forged).send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('an expired token is a 401', async () => {
    const expired = jwt.sign({ sub: '1', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
    const res = await request(newApp()).post('/orders').set('Authorization', 'Bearer ' + expired).send(body);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid or expired token' });
  });

  test('the old x-user-id header no longer works', async () => {
    const res = await request(newApp()).post('/orders').set('x-user-id', '1').send(body);
    expect(res.status).toBe(401);
  });

  test('cancelling needs a token too, and the order stays', async () => {
    const app = newApp();
    await postOrder(app, ALICE, body);
    const res = await request(app).delete('/orders/INFY/1');
    expect(res.status).toBe(401);
    expect((await getBook(app, 'INFY')).body.bids).toHaveLength(1);
  });
});

describe('POST /orders', () => {
  test('a limit order that does not match rests in the book', async () => {
    const res = await postOrder(newApp(), ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orderId: 1,
      symbol: 'INFY',
      trades: [],
      cancelledQuantity: 0,
      cancelReason: null,
    });
    expect(res.body.restingOrder).toMatchObject({ id: 1, userId: ALICE, price: 150000, remaining: 5 });
  });

  test('order ids come from one counter across all symbols', async () => {
    const app = newApp();
    const first = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const second = await postOrder(app, ALICE, { symbol: 'TCS', side: 'buy', price: 350000, quantity: 5 });
    expect(first.body.orderId).toBe(1);
    expect(second.body.orderId).toBe(2);
  });

  test('a crossing order returns public trades: symbol, price, quantity, UTC and IST time', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 5 });
    const res = await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 350000, quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.trades).toHaveLength(1);
    const trade = res.body.trades[0];
    expect(Object.keys(trade).sort()).toEqual(['price', 'quantity', 'symbol', 'timeIST', 'timestamp']);
    expect(trade).toMatchObject({ symbol: 'TCS', price: 350000, quantity: 3 });
    expect(new Date(trade.timestamp).toISOString()).toBe(trade.timestamp);
    expect(trade.timestamp.endsWith('Z')).toBe(true); // still UTC
    expect(trade.timeIST).toBe(formatIST(new Date(trade.timestamp))); // same moment
    expect(res.body.restingOrder).toBeNull();
  });

  test("a market order on an empty book is cancelled with 'no liquidity'", async () => {
    const res = await postOrder(newApp(), BOB, { symbol: 'INFY', side: 'buy', type: 'market', quantity: 10 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trades: [], restingOrder: null, cancelledQuantity: 10, cancelReason: 'no liquidity' });
  });

  test("an order stopped by the user's own order is cancelled with 'self-trade'", async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const res = await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.body).toMatchObject({ trades: [], cancelledQuantity: 5, cancelReason: 'self-trade' });
  });

  test('the user comes from the token: id and userId in the body are ignored', async () => {
    const app = newApp();
    const res = await postOrder(app, ALICE, {
      symbol: 'INFY',
      side: 'sell',
      price: 150000,
      quantity: 5,
      id: 999,
      userId: DAVE,
    });
    expect(res.body.orderId).toBe(1);
    expect(res.body.restingOrder).toMatchObject({ id: 1, userId: ALICE });

    // Alice owns it, so Dave can't cancel it.
    expect((await cancelOrder(app, DAVE, 'INFY', 1)).status).toBe(403);
  });

  test('a float price is a 400 with the engine message', async () => {
    const res = await postOrder(newApp(), ALICE, { symbol: 'INFY', side: 'buy', price: 1500.5, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Price must be a positive integer in paise' });
  });

  test('a missing side is a 400', async () => {
    const res = await postOrder(newApp(), ALICE, { symbol: 'INFY', price: 150000, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Side must be "buy" or "sell"' });
  });

  test('a market order with a price is a 400', async () => {
    const res = await postOrder(newApp(), ALICE, {
      symbol: 'INFY',
      side: 'buy',
      type: 'market',
      price: 150000,
      quantity: 5,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'A market order must not have a price' });
  });

  test('a missing symbol is a 400', async () => {
    const res = await postOrder(newApp(), ALICE, { side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Symbol is required' });
  });

  test('an unknown symbol is a 404', async () => {
    const res = await postOrder(newApp(), ALICE, { symbol: 'WIPRO', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown symbol: WIPRO' });
  });

  test('malformed JSON is a 400', async () => {
    const res = await request(newApp())
      .post('/orders')
      .set('Authorization', authHeader(ALICE))
      .set('Content-Type', 'application/json')
      .send('{"symbol": "INFY",');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
  });
});

describe('unexpected errors', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a non-validation error is a 500 with a generic message, and is logged', async () => {
    const bug = new Error('secret internal detail');
    jest.spyOn(MatchingEngine.prototype, 'addOrder').mockImplementation(() => {
      throw bug;
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await postOrder(newApp(), ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(consoleError).toHaveBeenCalledWith(bug);
  });
});

describe('DELETE /orders/:symbol/:id', () => {
  test('a user can cancel their own resting order', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const res = await cancelOrder(app, ALICE, 'INFY', 1);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ orderId: 1, symbol: 'INFY', cancelled: true });
    expect((await getBook(app, 'INFY')).body.bids).toEqual([]);
  });

  test("cancelling someone else's order is a 403 and the order stays", async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const res = await cancelOrder(app, BOB, 'INFY', 1);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'You can only cancel your own orders' });
    expect((await getBook(app, 'INFY')).body.bids).toEqual([{ price: 150000, quantity: 5 }]);
  });

  test('a partly filled order can be cancelled', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 2 });
    const res = await cancelOrder(app, ALICE, 'INFY', 1);
    expect(res.status).toBe(200);
    expect((await getBook(app, 'INFY')).body.asks).toEqual([]);
  });

  test('cancelling a filled order is a 404', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const res = await cancelOrder(app, ALICE, 'INFY', 1);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Order not found' });
  });

  test('cancelling the same order twice is a 404 the second time', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    await cancelOrder(app, ALICE, 'INFY', 1);
    const res = await cancelOrder(app, ALICE, 'INFY', 1);
    expect(res.status).toBe(404);
  });

  test('an order id that never existed is a 404', async () => {
    const res = await cancelOrder(newApp(), ALICE, 'INFY', 42);
    expect(res.status).toBe(404);
  });

  test('the right id with the wrong symbol is a 404', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const res = await cancelOrder(app, ALICE, 'TCS', 1);
    expect(res.status).toBe(404);
    expect((await getBook(app, 'INFY')).body.bids).toHaveLength(1);
  });

  test('an id that is not a positive integer is a 400', async () => {
    const app = newApp();
    for (const badId of ['abc', '1.5', '-1']) {
      const res = await cancelOrder(app, ALICE, 'INFY', badId);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Order id must be a positive integer' });
    }
  });

  test('an unknown symbol is a 404', async () => {
    const res = await cancelOrder(newApp(), ALICE, 'WIPRO', 1);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown symbol: WIPRO' });
  });
});
