// The most recent trades for each symbol, kept in memory.
class TradeLog {
  constructor(symbols, maxPerSymbol) {
    this.maxPerSymbol = maxPerSymbol;
    this.tradesBySymbol = new Map(); // symbol -> trades, oldest first
    for (const symbol of symbols) {
      this.tradesBySymbol.set(symbol, []);
    }
  }

  add(symbol, trades) {
    const list = this.tradesBySymbol.get(symbol);
    for (const trade of trades) {
      list.push(trade);
      if (list.length > this.maxPerSymbol) {
        list.shift(); // drop the oldest
      }
    }
  }

  newestFirst(symbol) {
    return this.tradesBySymbol.get(symbol).slice().reverse();
  }
}

module.exports = TradeLog;
