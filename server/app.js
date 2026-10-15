const express = require('express');
const MatchingEngine = require('./engine/MatchingEngine');
const ValidationError = require('./engine/ValidationError');
const TradeLog = require('./tradeLog');
const { SYMBOLS } = require('./config');
const createAuthRouter = require('./routes/auth');
const createMarketDataRouter = require('./routes/marketData');
const createOrdersRouter = require('./routes/orders');

const MAX_TRADES_PER_SYMBOL = 100;

// Builds a new app with its own engine and in-memory state.
// Tests call this once per test so they never share state.
// pool is the PostgreSQL pool for users, balances and holdings.
function createApp(pool) {
  const engine = new MatchingEngine(SYMBOLS);
  const tradeLog = new TradeLog(SYMBOLS, MAX_TRADES_PER_SYMBOL);
  const app = express();

  app.use(express.json());

  app.use('/auth', createAuthRouter(pool)); // public
  app.use(createMarketDataRouter(engine, tradeLog)); // public
  app.use('/orders', createOrdersRouter(engine, tradeLog)); // needs a token

  // No route matched.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(handleError);

  return app;
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
