const { SYMBOLS, STARTING_CASH, STARTING_SHARES } = require('../config');

// Creates a user with their starting cash and shares, all in one
// transaction: if any insert fails, none of them are kept.
// Throws pg error code '23505' if the username is taken.
async function createUser(pool, username, passwordHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
      [username, passwordHash]
    );
    const user = result.rows[0];
    await client.query('INSERT INTO balances (user_id, cash) VALUES ($1, $2)', [user.id, STARTING_CASH]);
    for (const symbol of SYMBOLS) {
      await client.query('INSERT INTO holdings (user_id, symbol, quantity) VALUES ($1, $2, $3)', [
        user.id,
        symbol,
        STARTING_SHARES,
      ]);
    }
    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// The user with this username, or null if there isn't one.
async function findUserByUsername(pool, username) {
  const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [
    username,
  ]);
  if (result.rows.length === 0) {
    return null;
  }
  return result.rows[0];
}

// A user's cash and holdings, or null if there is no such user.
async function getAccount(pool, userId) {
  const userResult = await pool.query(
    `SELECT users.id, users.username, balances.cash, balances.reserved_cash
     FROM users
     JOIN balances ON balances.user_id = users.id
     WHERE users.id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) {
    return null;
  }
  const user = userResult.rows[0];

  const holdingsResult = await pool.query(
    `SELECT symbol, quantity, reserved_quantity
     FROM holdings
     WHERE user_id = $1
     ORDER BY symbol`,
    [userId]
  );

  return {
    id: user.id,
    username: user.username,
    cash: user.cash,
    reservedCash: user.reserved_cash,
    holdings: holdingsResult.rows.map((row) => ({
      symbol: row.symbol,
      quantity: row.quantity,
      reservedQuantity: row.reserved_quantity,
    })),
  };
}

module.exports = { createUser, findUserByUsername, getAccount };
