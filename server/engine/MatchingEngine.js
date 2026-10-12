const ValidationError = require('./ValidationError');
const OrderBook = require('./OrderBook');

// Holds one OrderBook per stock symbol and sends each request to the
// right book. Only the symbols given to the constructor can trade.
class MatchingEngine {
  constructor(symbols) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      throw new ValidationError('Symbols must be a non-empty array');
    }
    this.books = new Map(); // symbol -> OrderBook
    for (const symbol of symbols) {
      if (typeof symbol !== 'string' || symbol === '') {
        throw new ValidationError('Each symbol must be a non-empty string');
      }
      if (this.books.has(symbol)) {
        throw new ValidationError('Duplicate symbol: ' + symbol);
      }
      this.books.set(symbol, new OrderBook());
    }
  }

  // order is everything OrderBook.addOrder needs, plus a symbol.
  addOrder(order) {
    const book = this.getBook(order.symbol);
    return book.addOrder(order);
  }

  // Order ids are only unique within one book, so cancel needs the symbol.
  cancelOrder(symbol, id) {
    const book = this.getBook(symbol);
    return book.cancelOrder(id);
  }

  getOrder(symbol, id) {
    const book = this.getBook(symbol);
    return book.getOrder(id);
  }

  getSymbols() {
    return Array.from(this.books.keys());
  }

  hasSymbol(symbol) {
    return this.books.has(symbol);
  }

  getBook(symbol) {
    const book = this.books.get(symbol);
    if (book === undefined) {
      throw new ValidationError('Unknown symbol: ' + symbol);
    }
    return book;
  }
}

module.exports = MatchingEngine;
