const request = require('supertest');
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const createApp = require('../app');
const { verifyToken } = require('../auth/tokens');
const { createTestPool, resetDatabase, clearTables } = require('./helpers');

const pool = createTestPool();

beforeAll(async () => {
  await resetDatabase(pool);
});

beforeEach(async () => {
  await clearTables(pool);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.end();
});

function signup(app, body) {
  return request(app).post('/auth/signup').send(body);
}

describe('POST /auth/signup', () => {
  test('creates a user and returns its id and username', async () => {
    const res = await signup(createApp(pool), { username: 'alice', password: 'correct-horse' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 1, username: 'alice' });
  });

  test('gives the new user ₹10,00,000 cash and 100 shares of each symbol', async () => {
    await signup(createApp(pool), { username: 'alice', password: 'correct-horse' });

    const balance = await pool.query('SELECT cash, reserved_cash FROM balances WHERE user_id = 1');
    expect(balance.rows).toEqual([{ cash: 100000000, reserved_cash: 0 }]);

    const holdings = await pool.query(
      'SELECT symbol, quantity, reserved_quantity FROM holdings WHERE user_id = 1 ORDER BY symbol'
    );
    expect(holdings.rows).toEqual([
      { symbol: 'INFY', quantity: 100, reserved_quantity: 0 },
      { symbol: 'RELIANCE', quantity: 100, reserved_quantity: 0 },
      { symbol: 'TCS', quantity: 100, reserved_quantity: 0 },
    ]);
  });

  test('stores a bcrypt hash, never the password itself', async () => {
    await signup(createApp(pool), { username: 'alice', password: 'correct-horse' });
    const result = await pool.query("SELECT password_hash FROM users WHERE username = 'alice'");
    const hash = result.rows[0].password_hash;
    expect(hash).not.toContain('correct-horse');
    expect(hash.startsWith('$2b$10$')).toBe(true);
    expect(await bcrypt.compare('correct-horse', hash)).toBe(true);
  });

  test('a taken username is a 409', async () => {
    const app = createApp(pool);
    await signup(app, { username: 'alice', password: 'correct-horse' });
    const res = await signup(app, { username: 'alice', password: 'another-password' });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Username already taken' });
  });

  test('if a later insert fails, the user is not created either', async () => {
    const originalQuery = Client.prototype.query;
    jest.spyOn(Client.prototype, 'query').mockImplementation(function (text, ...rest) {
      if (typeof text === 'string' && text.startsWith('INSERT INTO holdings')) {
        return Promise.reject(new Error('simulated failure'));
      }
      return originalQuery.call(this, text, ...rest);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await signup(createApp(pool), { username: 'alice', password: 'correct-horse' });
    expect(res.status).toBe(500);

    jest.restoreAllMocks();
    const users = await pool.query('SELECT COUNT(*) AS count FROM users');
    const balances = await pool.query('SELECT COUNT(*) AS count FROM balances');
    expect(users.rows[0].count).toBe(0);
    expect(balances.rows[0].count).toBe(0);
  });

  test('usernames must be 3 to 30 letters, digits or underscores', async () => {
    const app = createApp(pool);
    for (const username of ['ab', 'a'.repeat(31), 'has space', 'semi;colon', '', 42, undefined]) {
      const res = await signup(app, { username: username, password: 'correct-horse' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Username must be 3 to 30 letters, digits or underscores' });
    }
  });

  test('passwords must be at least 8 characters', async () => {
    const app = createApp(pool);
    for (const password of ['short', '', 12345678, undefined]) {
      const res = await signup(app, { username: 'alice', password: password });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Password must be at least 8 characters' });
    }
  });

  test('passwords longer than 72 bytes are rejected', async () => {
    const app = createApp(pool);
    const ok = await signup(app, { username: 'alice', password: 'a'.repeat(72) });
    expect(ok.status).toBe(201);
    const tooLong = await signup(app, { username: 'bob', password: 'a'.repeat(73) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ error: 'Password must be at most 72 bytes' });
    // 25 rupee signs are only 25 characters but 75 bytes in UTF-8.
    const multiByte = await signup(app, { username: 'carol', password: '₹'.repeat(25) });
    expect(multiByte.status).toBe(400);
  });

  test('signup does not need the x-user-id header', async () => {
    const res = await signup(createApp(pool), { username: 'alice', password: 'correct-horse' });
    expect(res.status).toBe(201);
  });
});

describe('POST /auth/login', () => {
  function login(app, body) {
    return request(app).post('/auth/login').send(body);
  }

  test('the right password returns a token for that user', async () => {
    const app = createApp(pool);
    await signup(app, { username: 'alice', password: 'correct-horse' });
    await signup(app, { username: 'bob', password: 'battery-staple' });

    const res = await login(app, { username: 'bob', password: 'battery-staple' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['token']);
    expect(verifyToken(res.body.token)).toBe(2);
  });

  test('a wrong password is a 401', async () => {
    const app = createApp(pool);
    await signup(app, { username: 'alice', password: 'correct-horse' });
    const res = await login(app, { username: 'alice', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid username or password' });
  });

  test('an unknown username gets exactly the same 401', async () => {
    const res = await login(createApp(pool), { username: 'nobody', password: 'correct-horse' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid username or password' });
  });

  test('usernames are case-sensitive', async () => {
    const app = createApp(pool);
    await signup(app, { username: 'alice', password: 'correct-horse' });
    const res = await login(app, { username: 'Alice', password: 'correct-horse' });
    expect(res.status).toBe(401);
  });

  test('missing username or password is a 400', async () => {
    const app = createApp(pool);
    for (const body of [{}, { username: 'alice' }, { password: 'correct-horse' }, { username: 1, password: 2 }]) {
      const res = await login(app, body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Username and password are required' });
    }
  });

  test('the response never includes the password hash', async () => {
    const app = createApp(pool);
    await signup(app, { username: 'alice', password: 'correct-horse' });
    const res = await login(app, { username: 'alice', password: 'correct-horse' });
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
  });
});
