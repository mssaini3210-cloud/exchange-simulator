const express = require('express');
const requireAuth = require('../auth/requireAuth');
const placeOrder = require('../trading/placeOrder');
const rejectUnknownSymbol = require('./rejectUnknownSymbol');

// Placing and cancelling orders. Every route here needs a token.
// trading is { engine, queue, halted } (see app.js).
function createOrdersRouter(pool, trading) {
  const router = express.Router();
  const engine = trading.engine;

  router.use(requireAuth);

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

  router.delete('/:symbol/:id', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }
    if (!/^[0-9]+$/.test(req.params.id)) {
      res.status(400).json({ error: 'Order id must be a positive integer' });
      return;
    }
    const orderId = Number(req.params.id);

    const order = engine.getOrder(symbol, orderId);
    if (order === null) {
      // Never existed, already filled, or already cancelled.
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    if (order.userId !== req.userId) {
      res.status(403).json({ error: 'You can only cancel your own orders' });
      return;
    }

    engine.cancelOrder(symbol, orderId);
    res.json({ orderId: orderId, symbol: symbol, cancelled: true });
  });

  return router;
}

module.exports = createOrdersRouter;
