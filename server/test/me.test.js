const request = require('supertest');
const createApp = require('../app');
const { createTestPool, resetDatabase, clearTables, authHeader } = require('./helpers');

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

// Sign up and log in through the API, and return the token.
async function signupAndLogin(app, username) {
  const password = 'password-for-' + username;
  await request(app).post('/auth/signup').send({ username: username, password: password });
  const res = await request(app).post('/auth/login').send({ username: username, password: password });
  return res.body.token;
}

describe('GET /me', () => {
  test("a new user sees their starting cash and holdings", async () => {
    const app = createApp(pool);
    const token = await signupAndLogin(app, 'alice');

    const res = await request(app).get('/me').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      username: 'alice',
      cash: 100000000,
      reservedCash: 0,
      holdings: [
        { symbol: 'INFY', quantity: 100, reservedQuantity: 0 },
        { symbol: 'RELIANCE', quantity: 100, reservedQuantity: 0 },
        { symbol: 'TCS', quantity: 100, reservedQuantity: 0 },
      ],
    });
  });

  test('each user sees only their own account', async () => {
    const app = createApp(pool);
    await signupAndLogin(app, 'alice');
    const bobToken = await signupAndLogin(app, 'bob');
    await pool.query('UPDATE balances SET cash = 5 WHERE user_id = 1'); // change Alice only

    const res = await request(app).get('/me').set('Authorization', 'Bearer ' + bobToken);
    expect(res.body).toMatchObject({ id: 2, username: 'bob', cash: 100000000 });
  });

  test('shows the values stored in the database', async () => {
    const app = createApp(pool);
    const token = await signupAndLogin(app, 'alice');
    await pool.query('UPDATE balances SET reserved_cash = 2500 WHERE user_id = 1');
    await pool.query("UPDATE holdings SET quantity = 40, reserved_quantity = 15 WHERE user_id = 1 AND symbol = 'TCS'");

    const res = await request(app).get('/me').set('Authorization', 'Bearer ' + token);
    expect(res.body.reservedCash).toBe(2500);
    expect(res.body.holdings).toContainEqual({ symbol: 'TCS', quantity: 40, reservedQuantity: 15 });
  });

  test('never includes the password hash', async () => {
    const app = createApp(pool);
    const token = await signupAndLogin(app, 'alice');
    const res = await request(app).get('/me').set('Authorization', 'Bearer ' + token);
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  test('needs a token', async () => {
    const res = await request(createApp(pool)).get('/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing Authorization header' });
  });

  test('a valid token for a user that does not exist is a 401', async () => {
    const res = await request(createApp(pool)).get('/me').set('Authorization', authHeader(999));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'User not found' });
  });
});
