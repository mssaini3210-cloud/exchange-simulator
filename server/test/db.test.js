const { runMigrations } = require('../db/migrate');
const { createTestPool, resetDatabase, clearTables } = require('./helpers');

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

// Insert a user with a balance row, and return the new user's id.
async function insertUser(username) {
  const result = await pool.query(
    "INSERT INTO users (username, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id",
    [username]
  );
  return result.rows[0].id;
}

describe('migrations', () => {
  test('create all five tables', async () => {
    const result = await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    expect(result.rows.map((row) => row.tablename)).toEqual([
      'balances',
      'holdings',
      'orders',
      'schema_migrations',
      'trades',
      'users',
    ]);
  });

  test('record which files ran, and do nothing the second time', async () => {
    const result = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
    expect(result.rows.map((row) => row.name)).toEqual([
      '001_create_users.sql',
      '002_create_balances.sql',
      '003_create_holdings.sql',
      '004_create_orders.sql',
      '005_create_trades.sql',
      '006_order_reservations.sql',
    ]);
    expect(await runMigrations(pool)).toEqual([]);
  });
});

describe('users table', () => {
  test('ids start at 1 and created_at is filled in', async () => {
    const id = await insertUser('alice');
    expect(id).toBe(1);
    const result = await pool.query('SELECT created_at FROM users WHERE id = $1', [id]);
    expect(result.rows[0].created_at).toBeInstanceOf(Date);
  });

  test('usernames are unique', async () => {
    await insertUser('alice');
    await expect(insertUser('alice')).rejects.toMatchObject({ code: '23505' });
  });
});

describe('balances table', () => {
  test('BIGINT values come back as numbers, not strings', async () => {
    const id = await insertUser('alice');
    await pool.query('INSERT INTO balances (user_id, cash) VALUES ($1, 100000000)', [id]);
    const result = await pool.query('SELECT cash, reserved_cash FROM balances WHERE user_id = $1', [id]);
    expect(result.rows[0]).toEqual({ cash: 100000000, reserved_cash: 0 });
  });

  test('cash cannot go negative', async () => {
    const id = await insertUser('alice');
    await expect(
      pool.query('INSERT INTO balances (user_id, cash) VALUES ($1, -1)', [id])
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('reserved cash cannot be more than cash', async () => {
    const id = await insertUser('alice');
    await expect(
      pool.query('INSERT INTO balances (user_id, cash, reserved_cash) VALUES ($1, 100, 101)', [id])
    ).rejects.toMatchObject({ code: '23514' });
  });

  test('a balance needs a real user', async () => {
    await expect(
      pool.query('INSERT INTO balances (user_id, cash) VALUES (999, 100)')
    ).rejects.toMatchObject({ code: '23503' });
  });
});

describe('holdings table', () => {
  test('one row per user per symbol', async () => {
    const id = await insertUser('alice');
    await pool.query("INSERT INTO holdings (user_id, symbol, quantity) VALUES ($1, 'INFY', 100)", [id]);
    await expect(
      pool.query("INSERT INTO holdings (user_id, symbol, quantity) VALUES ($1, 'INFY', 5)", [id])
    ).rejects.toMatchObject({ code: '23505' });
  });

  test('reserved quantity cannot be more than quantity', async () => {
    const id = await insertUser('alice');
    await expect(
      pool.query(
        "INSERT INTO holdings (user_id, symbol, quantity, reserved_quantity) VALUES ($1, 'INFY', 10, 11)",
        [id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('orders table', () => {
  async function insertOrder(userId, type, price) {
    return pool.query(
      `INSERT INTO orders (user_id, symbol, side, type, price, quantity, remaining, status)
       VALUES ($1, 'INFY', 'buy', $2, $3, 10, 10, 'open') RETURNING id`,
      [userId, type, price]
    );
  }

  test('a limit order needs a price and a market order must not have one', async () => {
    const id = await insertUser('alice');
    await expect(insertOrder(id, 'limit', 150000)).resolves.toBeDefined();
    await expect(insertOrder(id, 'market', null)).resolves.toBeDefined();
    await expect(insertOrder(id, 'limit', null)).rejects.toMatchObject({ code: '23514' });
    await expect(insertOrder(id, 'market', 150000)).rejects.toMatchObject({ code: '23514' });
  });

  test('side must be buy or sell', async () => {
    const id = await insertUser('alice');
    await expect(
      pool.query(
        `INSERT INTO orders (user_id, symbol, side, type, price, quantity, remaining, status)
         VALUES ($1, 'INFY', 'hold', 'limit', 100, 10, 10, 'open')`,
        [id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('trades table', () => {
  test('a user cannot be on both sides of a trade', async () => {
    const id = await insertUser('alice');
    const order = await pool.query(
      `INSERT INTO orders (user_id, symbol, side, type, price, quantity, remaining, status)
       VALUES ($1, 'INFY', 'buy', 'limit', 100, 10, 10, 'open') RETURNING id`,
      [id]
    );
    const orderId = order.rows[0].id;
    await expect(
      pool.query(
        `INSERT INTO trades (symbol, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity)
         VALUES ('INFY', $1, $1, $2, $2, 100, 1)`,
        [orderId, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('clearTables', () => {
  test('restarts ids at 1', async () => {
    await insertUser('alice');
    await insertUser('bob');
    await clearTables(pool);
    expect(await insertUser('carol')).toBe(1);
  });
});

describe('orders table: reservations and status (migration 006)', () => {
  // Insert an order with the given column values, on top of sensible defaults.
  async function insertOrder(userId, values) {
    const order = {
      side: 'buy',
      quantity: 10,
      remaining: 10,
      status: 'open',
      cancel_reason: null,
      reserved_cash: 0,
      ...values,
    };
    return pool.query(
      `INSERT INTO orders (user_id, symbol, side, type, price, quantity, remaining, status, cancel_reason, reserved_cash)
       VALUES ($1, 'INFY', $2, 'limit', 100, $3, $4, $5, $6, $7)`,
      [userId, order.side, order.quantity, order.remaining, order.status, order.cancel_reason, order.reserved_cash]
    );
  }

  test('a buy order can hold reserved cash, a sell order cannot', async () => {
    const id = await insertUser('alice');
    await expect(insertOrder(id, { side: 'buy', reserved_cash: 1000 })).resolves.toBeDefined();
    await expect(insertOrder(id, { side: 'sell', reserved_cash: 1000 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertOrder(id, { reserved_cash: -1 })).rejects.toMatchObject({ code: '23514' });
  });

  test("'filled' exactly when remaining is 0", async () => {
    const id = await insertUser('alice');
    await expect(insertOrder(id, { status: 'filled', remaining: 0 })).resolves.toBeDefined();
    await expect(insertOrder(id, { status: 'filled', remaining: 3 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertOrder(id, { status: 'open', remaining: 0 })).rejects.toMatchObject({ code: '23514' });
  });

  test("'cancelled' exactly when there is a cancel reason", async () => {
    const id = await insertUser('alice');
    await expect(
      insertOrder(id, { status: 'cancelled', cancel_reason: 'cancelled by user' })
    ).resolves.toBeDefined();
    await expect(insertOrder(id, { status: 'cancelled', cancel_reason: null })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insertOrder(id, { status: 'open', cancel_reason: 'self-trade' })).rejects.toMatchObject({
      code: '23514',
    });
  });

  test('only the four known cancel reasons are allowed', async () => {
    const id = await insertUser('alice');
    for (const reason of ['cancelled by user', 'self-trade', 'no liquidity', 'server restart']) {
      await expect(insertOrder(id, { status: 'cancelled', cancel_reason: reason })).resolves.toBeDefined();
    }
    await expect(insertOrder(id, { status: 'cancelled', cancel_reason: 'felt like it' })).rejects.toMatchObject({
      code: '23514',
    });
  });
});
