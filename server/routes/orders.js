const express = require('express');
const requireAuth = require('../auth/requireAuth');
const placeOrder = require('../trading/placeOrder');
const cancelOrder = require('../trading/cancelOrder');
const { listOrders } = require('../db/orders');
const rejectUnknownSymbol = require('./rejectUnknownSymbol');

const STATUSES = ['open', 'filled', 'cancelled'];
const MAX_ORDERS = 100;

// Placing and cancelling orders. Every route here needs a token.
// trading is { engine, queue, halted } (see app.js).
function createOrdersRouter(pool, trading) {
  const router = express.Router();
  const engine = trading.engine;

  router.use(requireAuth);

  // The logged-in user's own orders, newest first. Optional ?status=open,
  // filled or cancelled. A read, so it doesn't need the queue.
  router.get('/', async (req, res) => {
    const status = req.query.status;
    if (status !== undefined && !STATUSES.includes(status)) {
      res.status(400).json({ error: 'Status must be one of: ' + STATUSES.join(', ') });
      return;
    }
    const rows = await listOrders(pool, req.userId, status === undefined ? null : status, MAX_ORDERS);
    const orders = rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      type: row.type,
      price: row.price,
      quantity: row.quantity,
      remaining: row.remaining,
      filledQuantity: row.quantity - row.remaining,
      status: row.status,
      cancelReason: row.cancel_reason,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
    res.json({ orders: orders });
  });

  router.post('/', async (req, res) => {
    const body = req.body || {};
    const symbol = body.symbol;
    if (symbol === undefined) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }

    // Pick the fields one by one: id and userId never come from the body.
    const request = {
      userId: req.userId,
      symbol: symbol,
      side: body.side,
      type: body.type,
      price: body.price,
      quantity: body.quantity,
    };
    // One order at a time, so balances can't be read and written by two
    // orders at once.
    const result = await trading.queue.run(() => placeOrder(pool, trading, request));
    res.status(201).json(result);
  });

  router.delete('/:symbol/:id', async (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }
    if (!/^[0-9]+$/.test(req.params.id)) {
      res.status(400).json({ error: 'Order id must be a positive integer' });
      return;
    }
    const orderId = Number(req.params.id);

    const outcome = await trading.queue.run(() =>
      cancelOrder(pool, trading, { userId: req.userId, symbol: symbol, orderId: orderId })
    );
    if (outcome === 'not found') {
      // Never existed, already filled, or already cancelled.
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (outcome === 'forbidden') {
      res.status(403).json({ error: 'You can only cancel your own orders' });
      return;
    }
    res.json({ orderId: orderId, symbol: symbol, cancelled: true });
  });

  return router;
}

module.exports = createOrdersRouter;
