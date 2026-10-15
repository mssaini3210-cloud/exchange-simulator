const express = require('express');
const rejectUnknownSymbol = require('./rejectUnknownSymbol');

// Public routes: anyone can see the symbols, the books and recent trades.
function createMarketDataRouter(engine, tradeLog) {
  const router = express.Router();

  router.get('/symbols', (req, res) => {
    res.json({ symbols: engine.getSymbols() });
  });

  router.get('/book/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }
    const depth = engine.getBook(symbol).getDepth(10);
    res.json({ symbol: symbol, bids: depth.bids, asks: depth.asks });
  });

  router.get('/trades/:symbol', (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }
    res.json({ symbol: symbol, trades: tradeLog.newestFirst(symbol) });
  });

  return router;
}

module.exports = createMarketDataRouter;
