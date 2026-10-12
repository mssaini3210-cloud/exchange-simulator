const request = require('supertest');
const createApp = require('./app');
const MatchingEngine = require('./engine/MatchingEngine');

describe('x-user-id header', () => {
  test('a request without it is rejected with 401', async () => {
    const res = await request(createApp()).get('/symbols');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing x-user-id header' });
  });

  test('an empty header is rejected with 401', async () => {
    const res = await request(createApp()).get('/symbols').set('x-user-id', '  ');
    expect(res.status).toBe(401);
  });
});

describe('GET /symbols', () => {
  test('lists the three symbols', async () => {
    const res = await request(createApp()).get('/symbols').set('x-user-id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbols: ['INFY', 'TCS', 'RELIANCE'] });
  });
});

describe('unknown routes', () => {
  test('return 404 as JSON', async () => {
    const res = await request(createApp()).get('/nope').set('x-user-id', 'alice');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

function postOrder(app, userId, body) {
  return request(app).post('/orders').set('x-user-id', userId).send(body);
}

describe('POST /orders', () => {
  test('a limit order that does not match rests in the book', async () => {
    const app = createApp();
    const res = await postOrder(app, 'alice', { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      orderId: 1,
      symbol: 'INFY',
      trades: [],
      cancelledQuantity: 0,
      cancelReason: null,
    });
    expect(res.body.restingOrder).toMatchObject({ id: 1, userId: 'alice', price: 150000, remaining: 5 });
  });

  test('order ids come from one counter across all symbols', async () => {
    const app = createApp();
    const first = await postOrder(app, 'alice', { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    const second = await postOrder(app, 'alice', { symbol: 'TCS', side: 'buy', price: 350000, quantity: 5 });
    expect(first.body.orderId).toBe(1);
    expect(second.body.orderId).toBe(2);
  });

  test('a crossing order returns trades with symbol and timestamp', async () => {
    const app = createApp();
    await postOrder(app, 'alice', { symbol: 'TCS', side: 'sell', price: 350000, quantity: 5 });
    const res = await postOrder(app, 'bob', { symbol: 'TCS', side: 'buy', price: 350000, quantity: 3 });
    expect(res.status).toBe(201);
    expect(res.body.trades).toHaveLength(1);
    const trade = res.body.trades[0];
    expect(trade).toMatchObject({
      symbol: 'TCS',
      buyOrderId: 2,
      sellOrderId: 1,
      buyUserId: 'bob',
      sellUserId: 'alice',
      price: 350000,
      quantity: 3,
    });
    expect(new Date(trade.timestamp).toISOString()).toBe(trade.timestamp);
    expect(res.body.restingOrder).toBeNull();
  });

  test("a market order on an empty book is cancelled with 'no liquidity'", async () => {
    const app = createApp();
    const res = await postOrder(app, 'bob', { symbol: 'INFY', side: 'buy', type: 'market', quantity: 10 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ trades: [], restingOrder: null, cancelledQuantity: 10, cancelReason: 'no liquidity' });
  });

  test("an order stopped by the user's own order is cancelled with 'self-trade'", async () => {
    const app = createApp();
    await postOrder(app, 'alice', { symbol: 'INFY', side: 'sell', price: 150000, quantity: 5 });
    const res = await postOrder(app, 'alice', { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.body).toMatchObject({ trades: [], cancelledQuantity: 5, cancelReason: 'self-trade' });
  });

  test('id and userId in the body are ignored', async () => {
    const app = createApp();
    const res = await postOrder(app, 'alice', {
      symbol: 'INFY',
      side: 'sell',
      price: 150000,
      quantity: 5,
      id: 999,
      userId: 'mallory',
    });
    expect(res.body.orderId).toBe(1);
    expect(res.body.restingOrder).toMatchObject({ id: 1, userId: 'alice' });

    const buy = await postOrder(app, 'bob', { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(buy.body.trades[0]).toMatchObject({ sellOrderId: 1, sellUserId: 'alice' });
  });

  test('a float price is a 400 with the engine message', async () => {
    const res = await postOrder(createApp(), 'alice', { symbol: 'INFY', side: 'buy', price: 1500.5, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Price must be a positive integer in paise' });
  });

  test('a missing side is a 400', async () => {
    const res = await postOrder(createApp(), 'alice', { symbol: 'INFY', price: 150000, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Side must be "buy" or "sell"' });
  });

  test('a market order with a price is a 400', async () => {
    const res = await postOrder(createApp(), 'alice', {
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
    const res = await postOrder(createApp(), 'alice', { side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Symbol is required' });
  });

  test('an unknown symbol is a 404', async () => {
    const res = await postOrder(createApp(), 'alice', { symbol: 'WIPRO', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown symbol: WIPRO' });
  });

  test('malformed JSON is a 400', async () => {
    const res = await request(createApp())
      .post('/orders')
      .set('x-user-id', 'alice')
      .set('Content-Type', 'application/json')
      .send('{"symbol": "INFY",');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Request body is not valid JSON' });
  });

  test('a request without x-user-id is a 401', async () => {
    const res = await request(createApp())
      .post('/orders')
      .send({ symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    expect(res.status).toBe(401);
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

    const res = await postOrder(createApp(), 'alice', { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(consoleError).toHaveBeenCalledWith(bug);
  });
});
