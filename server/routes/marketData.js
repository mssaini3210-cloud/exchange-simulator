const express = require('express');
const formatIST = require('../formatIST');
const { recentTrades } = require('../db/orders');
const rejectUnknownSymbol = require('./rejectUnknownSymbol');

const MAX_TRADES = 100;

// Public routes: anyone can see the symbols, the books and recent trades.
function createMarketDataRouter(pool, engine) {
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

  router.get('/trades/:symbol', async (req, res) => {
    const symbol = req.params.symbol;
    if (rejectUnknownSymbol(engine, res, symbol)) {
      return;
    }
    const rows = await recentTrades(pool, symbol, MAX_TRADES);
    // Only public fields: no user ids or order ids.
    const trades = rows.map((row) => ({
      symbol: symbol,
      price: row.price,
      quantity: row.quantity,
      timestamp: row.executed_at.toISOString(), // UTC, for machines
      timeIST: formatIST(row.executed_at), // Indian time, for people
    }));
    res.json({ symbol: symbol, trades: trades });
  });

  return router;
}

module.exports = createMarketDataRouter;
