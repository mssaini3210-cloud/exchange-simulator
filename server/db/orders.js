// SQL for orders, trades and the balance changes they cause.
// Every function that changes money takes `client`: a connection that is
// inside a transaction (BEGIN ... COMMIT), so its changes are all-or-nothing.

// Runs an UPDATE that must change exactly one row. If it changes none,
// a row we rely on is missing, which is a bug: fail loudly so the
// transaction rolls back, instead of silently skipping money.
async function updateOne(client, sql, params) {
  const result = await client.query(sql, params);
  if (result.rowCount !== 1) {
    throw new Error('Expected to update 1 row, updated ' + result.rowCount + ': ' + sql);
  }
}

// A user's cash, locked until the transaction ends (FOR UPDATE), so
// nothing else can change it in between.
async function lockBalance(client, userId) {
  const result = await client.query(
    'SELECT cash, reserved_cash FROM balances WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  if (result.rows.length === 0) {
    throw new Error('No balance row for user ' + userId);
  }
  return result.rows[0];
}

// A user's shares of one symbol, locked; { quantity: 0 } if they have none.
async function lockHolding(client, userId, symbol) {
  const result = await client.query(
    'SELECT quantity, reserved_quantity FROM holdings WHERE user_id = $1 AND symbol = $2 FOR UPDATE',
    [userId, symbol]
  );
  if (result.rows.length === 0) {
    return { quantity: 0, reserved_quantity: 0 };
  }
  return result.rows[0];
}

async function changeReservedCash(client, userId, amount) {
  await updateOne(client, 'UPDATE balances SET reserved_cash = reserved_cash + $2 WHERE user_id = $1', [
    userId,
    amount,
  ]);
}

async function changeReservedShares(client, userId, symbol, amount) {
  await updateOne(
    client,
    'UPDATE holdings SET reserved_quantity = reserved_quantity + $3 WHERE user_id = $1 AND symbol = $2',
    [userId, symbol, amount]
  );
}

// Saves a new open order and returns its id.
async function insertOrder(client, order) {
  const result = await client.query(
    `INSERT INTO orders (user_id, symbol, side, type, price, quantity, remaining, status, reserved_cash)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'open', $7)
     RETURNING id`,
    [order.userId, order.symbol, order.side, order.type, order.price, order.quantity, order.reservedCash]
  );
  return result.rows[0].id;
}

// One fill of an order: less remaining, less reserved cash (buy orders),
// and 'filled' once nothing remains. In SET, "remaining" means the old value.
async function fillOrder(client, orderId, quantity, releasedCash) {
  await updateOne(
    client,
    `UPDATE orders
     SET remaining = remaining - $2,
         reserved_cash = reserved_cash - $3,
         status = CASE WHEN remaining - $2 = 0 THEN 'filled' ELSE status END,
         updated_at = now()
     WHERE id = $1 AND status = 'open'`,
    [orderId, quantity, releasedCash]
  );
}

// Moves money and shares for one trade, updates both orders, and saves
// the trade. buyerReleases is how much of the buy order's reserved cash
// this fill uses up: limit price × quantity for a limit buy (so a better
// fill price frees the difference), the actual cost for a market buy.
async function settleTrade(client, trade) {
  const cost = trade.price * trade.quantity;

  // Buyer pays and gets the shares.
  await updateOne(
    client,
    'UPDATE balances SET cash = cash - $2, reserved_cash = reserved_cash - $3 WHERE user_id = $1',
    [trade.buyUserId, cost, trade.buyerReleases]
  );
  await client.query(
    `INSERT INTO holdings (user_id, symbol, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, symbol) DO UPDATE SET quantity = holdings.quantity + EXCLUDED.quantity`,
    [trade.buyUserId, trade.symbol, trade.quantity]
  );

  // Seller gives the (reserved) shares and gets paid.
  await updateOne(
    client,
    `UPDATE holdings SET quantity = quantity - $3, reserved_quantity = reserved_quantity - $3
     WHERE user_id = $1 AND symbol = $2`,
    [trade.sellUserId, trade.symbol, trade.quantity]
  );
  await updateOne(client, 'UPDATE balances SET cash = cash + $2 WHERE user_id = $1', [trade.sellUserId, cost]);

  await fillOrder(client, trade.buyOrderId, trade.quantity, trade.buyerReleases);
  await fillOrder(client, trade.sellOrderId, trade.quantity, 0);

  const result = await client.query(
    `INSERT INTO trades (symbol, buy_order_id, sell_order_id, buy_user_id, sell_user_id, price, quantity)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING executed_at`,
    [
      trade.symbol,
      trade.buyOrderId,
      trade.sellOrderId,
      trade.buyUserId,
      trade.sellUserId,
      trade.price,
      trade.quantity,
    ]
  );
  return result.rows[0].executed_at;
}

// Cancels whatever is left of an open order and gives back what it still
// holds: its reserved cash (buy) or its remaining shares (sell).
async function cancelAndRelease(client, orderId, reason) {
  const result = await client.query(
    "SELECT user_id, symbol, side, remaining, reserved_cash FROM orders WHERE id = $1 AND status = 'open' FOR UPDATE",
    [orderId]
  );
  if (result.rows.length === 0) {
    throw new Error('Order ' + orderId + ' is not open');
  }
  const order = result.rows[0];
  if (order.side === 'buy') {
    await changeReservedCash(client, order.user_id, -order.reserved_cash);
  } else {
    await changeReservedShares(client, order.user_id, order.symbol, -order.remaining);
  }
  await updateOne(
    client,
    `UPDATE orders SET status = 'cancelled', cancel_reason = $2, reserved_cash = 0, updated_at = now()
     WHERE id = $1`,
    [orderId, reason]
  );
}

// The most recent trades for a symbol, newest first: only public fields.
async function recentTrades(pool, symbol, limit) {
  const result = await pool.query(
    `SELECT price, quantity, executed_at FROM trades
     WHERE symbol = $1
     ORDER BY executed_at DESC, id DESC
     LIMIT $2`,
    [symbol, limit]
  );
  return result.rows;
}

// A user's orders, newest first. status is 'open', 'filled', 'cancelled'
// or null for all of them.
async function listOrders(pool, userId, status, limit) {
  const result = await pool.query(
    `SELECT id, symbol, side, type, price, quantity, remaining, status, cancel_reason, created_at, updated_at
     FROM orders
     WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
     ORDER BY id DESC
     LIMIT $3`,
    [userId, status, limit]
  );
  return result.rows;
}

module.exports = {
  listOrders,
  lockBalance,
  lockHolding,
  changeReservedCash,
  changeReservedShares,
  insertOrder,
  settleTrade,
  cancelAndRelease,
  recentTrades,
};
