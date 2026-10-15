const express = require('express');
const MatchingEngine = require('./engine/MatchingEngine');
const ValidationError = require('./engine/ValidationError');
const SerialQueue = require('./trading/SerialQueue');
const TradingHaltedError = require('./trading/TradingHaltedError');
const { SYMBOLS } = require('./config');
const createAuthRouter = require('./routes/auth');
const createMarketDataRouter = require('./routes/marketData');
const createOrdersRouter = require('./routes/orders');
const createMeRouter = require('./routes/me');

// Builds a new app with its own engine and in-memory state.
// Tests call this once per test so they never share state.
// pool is the PostgreSQL pool: the database is the record of truth for
// users, money, orders and trades.
function createApp(pool) {
  // Everything order placement and cancelling share:
  //   engine: the in-memory order books
  //   queue: runs one order job at a time
  //   halted: set to true if the engine and database ever disagree
  const trading = {
    engine: new MatchingEngine(SYMBOLS),
    queue: new SerialQueue(),
    halted: false,
  };
  const app = express();

  app.use(express.json());

  app.use('/auth', createAuthRouter(pool)); // public
  app.use(createMarketDataRouter(pool, trading.engine)); // public
  app.use('/orders', createOrdersRouter(pool, trading)); // needs a token
  app.use('/me', createMeRouter(pool)); // needs a token

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
  if (err instanceof TradingHaltedError) {
    res.status(503).json({ error: err.message });
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
