// Runs once when the server starts, before it accepts requests.
//
// The in-memory book starts empty, so any order still 'open' in the
// database can't be matched any more. Cancel all of them and give back
// what they hold, in one transaction. (Rebuilding the book from the
// database instead comes later.) Returns how many orders were cancelled.
async function cancelOpenOrders(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Each user's open buy orders hold some of their cash.
    await client.query(`
      UPDATE balances
      SET reserved_cash = balances.reserved_cash - held.total
      FROM (
        SELECT user_id, SUM(reserved_cash) AS total
        FROM orders
        WHERE status = 'open' AND side = 'buy'
        GROUP BY user_id
      ) AS held
      WHERE balances.user_id = held.user_id
    `);

    // Each user's open sell orders hold some of their shares.
    await client.query(`
      UPDATE holdings
      SET reserved_quantity = holdings.reserved_quantity - held.total
      FROM (
        SELECT user_id, symbol, SUM(remaining) AS total
        FROM orders
        WHERE status = 'open' AND side = 'sell'
        GROUP BY user_id, symbol
      ) AS held
      WHERE holdings.user_id = held.user_id AND holdings.symbol = held.symbol
    `);

    const result = await client.query(`
      UPDATE orders
      SET status = 'cancelled', cancel_reason = 'server restart', reserved_cash = 0, updated_at = now()
      WHERE status = 'open'
    `);

    await client.query('COMMIT');
    return result.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { cancelOpenOrders };
