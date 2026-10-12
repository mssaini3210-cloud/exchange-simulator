const express = require('express');
const MatchingEngine = require('./engine/MatchingEngine');
const ValidationError = require('./engine/ValidationError');

const SYMBOLS = ['INFY', 'TCS', 'RELIANCE'];
const MAX_TRADES_PER_SYMBOL = 100;

// Builds a new app with its own engine and in-memory state.
// Tests call this once per test so they never share state.
function createApp() {
  const engine = new MatchingEngine(SYMBOLS);
  let nextOrderId = 1; // one counter for all symbols, so ids are unique everywhere
  const tradesBySymbol = new Map(); // symbol -> last 100 trades, oldest first
  for (const symbol of SYMBOLS) {
    tradesBySymbol.set(symbol, []);
  }

  function recordTrades(symbol, trades) {
    const list = tradesBySymbol.get(symbol);
    for (const trade of trades) {
      list.push(trade);
      if (list.length > MAX_TRADES_PER_SYMBOL) {
        list.shift();
      }
    }
  }

  // Sends a 404 and returns true if the symbol isn't traded here.
  function rejectUnknownSymbol(res, symbol) {
    if (engine.hasSymbol(symbol)) {
      return false;
    }
    res.status(404).json({ error: 'Unknown symbol: ' + symbol });
    return true;
  }

  const app = express();

  app.use(express.json());
  app.use(requireUser);

  app.get('/symbols', (req, res) => {
    res.json({ symbols: engine.getSymbols() });
  });

  app.post('/orders', (req, res) => {
    const body = req.body || {};
    const symbol = body.symbol;
    if (symbol === undefined) {
      res.status(400).json({ error: 'Symbol is required' });
      return;
    }
    if (rejectUnknownSymbol(res, symbol)) {
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

    const timestamp = new Date().toISOString();
    const trades = result.trades.map((trade) => ({ symbol: symbol, ...trade, timestamp: timestamp }));
    recordTrades(symbol, trades);

    res.status(201).json({
      orderId: orderId,
      symbol: symbol,
      trades: trades,
      restingOrder: result.restingOrder,
      cancelledQuantity: result.cancelledQuantity,
      cancelReason: result.cancelReason,
    });
  });

  app.delete('/orders/:symbol/:id', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(res, symbol)) {
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

  app.get('/book/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(res, symbol)) {
      return;
    }
    const depth = engine.getBook(symbol).getDepth(10);
    res.json({ symbol: symbol, bids: depth.bids, asks: depth.asks });
  });

  app.get('/trades/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(res, symbol)) {
      return;
    }
    const newestFirst = tradesBySymbol.get(symbol).slice().reverse();
    res.json({ symbol: symbol, trades: newestFirst });
  });

  // No route matched.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(handleError);

  return app;
}

// Until there is real auth, the user is whoever the x-user-id header says.
function requireUser(req, res, next) {
  const userId = req.get('x-user-id');
  if (userId === undefined || userId.trim() === '') {
    res.status(401).json({ error: 'Missing x-user-id header' });
    return;
  }
  req.userId = userId;
  next();
}

// Express calls this when a route throws. Bad input becomes a 400 with
// the engine's message. Anything else is a bug: log it, and send a
// generic 500 so internal details never reach the client.
function handleError(err, req, res, next) {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = createApp;
