const express = require('express');
const requireAuth = require('../auth/requireAuth');
const formatIST = require('../formatIST');
const rejectUnknownSymbol = require('./rejectUnknownSymbol');

// Placing and cancelling orders. Every route here needs a token.
function createOrdersRouter(engine, tradeLog) {
  const router = express.Router();
  let nextOrderId = 1; // one counter for all symbols (moves to the database on Day 5)

  router.use(requireAuth);

  router.post('/', (req, res) => {
    const body = req.body || {};
    const symbol = body.symbol;
    if (symbol === undefined) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }

    const orderId = nextOrderId;
    nextOrderId += 1;

    // Pick the fields one by one: id and userId never come from the body.
    const result = engine.addOrder({
      symbol: symbol,
      id: orderId,
      userId: req.userId,
      side: body.side,
      type: body.type,
      price: body.price,
      quantity: body.quantity,
    });

    const trades = toPublicTrades(symbol, result.trades, new Date());
    tradeLog.add(symbol, trades);

    res.status(201).json({
      orderId: orderId,
      symbol: symbol,
      trades: trades,
      restingOrder: result.restingOrder,
      cancelledQuantity: result.cancelledQuantity,
      cancelReason: result.cancelReason,
    });
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

// Only what anyone may see about a trade. User ids and order ids are left
// out, so nobody can find out who traded with whom.
function toPublicTrades(symbol, engineTrades, time) {
  return engineTrades.map((trade) => ({
    symbol: symbol,
    price: trade.price,
    quantity: trade.quantity,
    timestamp: time.toISOString(), // UTC, for machines
    timeIST: formatIST(time), // Indian time, for people
  }));
}

module.exports = createOrdersRouter;
