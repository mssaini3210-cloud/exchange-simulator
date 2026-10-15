const db = require('../db/orders');
const TradingHaltedError = require('./TradingHaltedError');
const halt = require('./halt');

// Cancels a user's open order. Must run inside the SerialQueue.
// Like placeOrder: the database first (release the reservation and mark
// the order cancelled, in one transaction), and only after COMMIT the
// engine.
//
// Returns 'cancelled', 'not found' (never existed, or no longer open)
// or 'forbidden' (someone else's order).
async function cancelOrder(pool, trading, { userId, symbol, orderId }) {
  if (trading.halted) {
    throw new TradingHaltedError();
  }

  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT user_id, status FROM orders WHERE id = $1 AND symbol = $2 FOR UPDATE', [
      orderId,
      symbol,
    ]);
    if (result.rows.length === 0 || result.rows[0].status !== 'open') {
      outcome = 'not found';
    } else if (result.rows[0].user_id !== userId) {
      outcome = 'forbidden';
    } else {
      await db.cancelAndRelease(client, orderId, 'cancelled by user');
      outcome = 'cancelled';
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (outcome !== 'cancelled') {
    return outcome;
  }

  // The order was open in the database, so it must be in the book.
  // If it isn't, the two disagree: halt.
  const removed = trading.engine.cancelOrder(symbol, orderId);
  if (!removed) {
    const err = new Error('Order ' + orderId + ' was open in the database but not in the book');
    halt(trading, err);
    throw err;
  }
  return outcome;
}

module.exports = cancelOrder;
