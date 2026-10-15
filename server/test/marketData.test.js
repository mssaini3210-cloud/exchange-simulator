const request = require('supertest');
const createApp = require('../app');
const formatIST = require('../formatIST');
const { authHeader } = require('./helpers');

// These routes don't use the database (yet), so no pool is needed.
function newApp() {
  return createApp(null);
}

const ALICE = 1;
const BOB = 2;
const CAROL = 3;
const DAVE = 4;
const ERIN = 5;

function postOrder(app, userId, body) {
  return request(app).post('/orders').set('Authorization', authHeader(userId)).send(body);
}

describe('GET /symbols', () => {
  test('is public and lists the three symbols', async () => {
    const res = await request(newApp()).get('/symbols');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbols: ['INFY', 'TCS', 'RELIANCE'] });
  });
});

describe('unknown routes', () => {
  test('return 404 as JSON', async () => {
    const res = await request(newApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('GET /book/:symbol', () => {
  test('is public: an empty book', async () => {
    const res = await request(newApp()).get('/book/INFY');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'INFY', bids: [], asks: [] });
  });

  test('shows resting orders by level, best price first, for that symbol only', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 5 });
    await postOrder(app, BOB, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 3 });
    await postOrder(app, CAROL, { symbol: 'INFY', side: 'buy', price: 149900, quantity: 2 });
    await postOrder(app, DAVE, { symbol: 'INFY', side: 'sell', price: 150100, quantity: 4 });
    await postOrder(app, ERIN, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 1 });

    const res = await request(app).get('/book/INFY');
    expect(res.body).toEqual({
      symbol: 'INFY',
      bids: [
        { price: 150000, quantity: 8 },
        { price: 149900, quantity: 2 },
      ],
      asks: [{ price: 150100, quantity: 4 }],
    });
  });

  test('shows at most 10 levels per side', async () => {
    const app = newApp();
    for (let i = 0; i < 12; i++) {
      await postOrder(app, ALICE, { symbol: 'INFY', side: 'buy', price: 150000 - i * 100, quantity: 1 });
    }
    const res = await request(app).get('/book/INFY');
    expect(res.body.bids).toHaveLength(10);
    expect(res.body.bids[0].price).toBe(150000);
  });

  test('an unknown symbol is a 404', async () => {
    const res = await request(newApp()).get('/book/WIPRO');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown symbol: WIPRO' });
  });
});

describe('GET /trades/:symbol', () => {
  test('is public: no trades yet', async () => {
    const res = await request(newApp()).get('/trades/TCS');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbol: 'TCS', trades: [] });
  });

  test('lists trades newest first, for that symbol only', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 1 });
    await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 350100, quantity: 1 });
    await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', type: 'market', quantity: 2 });
    await postOrder(app, CAROL, { symbol: 'INFY', side: 'sell', price: 150000, quantity: 1 });
    await postOrder(app, DAVE, { symbol: 'INFY', side: 'buy', price: 150000, quantity: 1 });

    const res = await request(app).get('/trades/TCS');
    expect(res.body.trades.map((t) => [t.symbol, t.price])).toEqual([
      ['TCS', 350100],
      ['TCS', 350000],
    ]);
    expect(res.body.trades[0].timeIST).toBe(formatIST(new Date(res.body.trades[0].timestamp)));
  });

  test('shows only symbol, price, quantity and times: no user ids or order ids', async () => {
    const app = newApp();
    await postOrder(app, ALICE, { symbol: 'TCS', side: 'sell', price: 350000, quantity: 1 });
    await postOrder(app, BOB, { symbol: 'TCS', side: 'buy', price: 350000, quantity: 1 });

    const res = await request(app).get('/trades/TCS');
    expect(Object.keys(res.body.trades[0]).sort()).toEqual(['price', 'quantity', 'symbol', 'timeIST', 'timestamp']);
  });

  test('keeps only the last 100 trades', async () => {
    const app = newApp();
    // 101 single-share trades, each at a different price so we can tell them apart.
    for (let i = 1; i <= 101; i++) {
      await postOrder(app, ALICE, { symbol: 'RELIANCE', side: 'sell', price: 100000 + i, quantity: 1 });
      await postOrder(app, BOB, { symbol: 'RELIANCE', side: 'buy', type: 'market', quantity: 1 });
    }
    const res = await request(app).get('/trades/RELIANCE');
    expect(res.body.trades).toHaveLength(100);
    expect(res.body.trades[0].price).toBe(100101); // newest
    expect(res.body.trades[99].price).toBe(100002); // the first trade (100001) was dropped
  });

  test('an unknown symbol is a 404', async () => {
    const res = await request(newApp()).get('/trades/WIPRO');
    expect(res.status).toBe(404);
  });
});
