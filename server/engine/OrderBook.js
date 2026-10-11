const PriceLevel = require('./PriceLevel');

// The order book for one stock. Prices are integers in paise.
//
// Each side keeps:
//   levels: Map of price -> PriceLevel
//   prices: the prices sorted so the BEST price is always at the END
//           (bids ascending, asks descending)
class OrderBook {
  constructor() {
    this.bids = { levels: new Map(), prices: [] };
    this.asks = { levels: new Map(), prices: [] };
    this.orderIndex = new Map(); // order id -> node in its PriceLevel
    this.nextSeq = 1;
  }

  addOrder({ id, side, price, quantity }) {
    validateOrder(id, side, price, quantity);
    if (this.orderIndex.has(id)) {
      throw new Error('Order id already in the book: ' + id);
    }

    const order = {
      id: id,
      side: side,
      price: price,
      quantity: quantity,
      remaining: quantity,
      seq: this.nextSeq,
    };
    this.nextSeq += 1;

    const trades = this.match(order);
    if (order.remaining === 0) {
      return { trades: trades, restingOrder: null };
    }
    this.restOrder(order);
    return { trades: trades, restingOrder: { ...order } };
  }

  cancelOrder(id) {
    const node = this.orderIndex.get(id);
    if (node === undefined) {
      return false;
    }
    const order = node.order;
    const book = this.sideOf(order.side);
    const level = book.levels.get(order.price);
    level.remove(node);
    this.orderIndex.delete(id);
    if (level.isEmpty()) {
      removePrice(book, order.price);
    }
    return true;
  }

  getBestBid() {
    return bestPrice(this.bids);
  }

  getBestAsk() {
    return bestPrice(this.asks);
  }

  // The top n levels of each side, best price first.
  getDepth(n) {
    return {
      bids: topLevels(this.bids, n),
      asks: topLevels(this.asks, n),
    };
  }

  // Fill an incoming order against the opposite side, best price first,
  // oldest order first within a price. Trades happen at the resting
  // order's price. Changes incoming.remaining and returns the trades.
  match(incoming) {
    const isBuy = incoming.side === 'buy';
    const opposite = isBuy ? this.asks : this.bids;
    const trades = [];

    while (incoming.remaining > 0 && opposite.prices.length > 0) {
      const price = bestPrice(opposite);
      const crosses = isBuy ? price <= incoming.price : price >= incoming.price;
      if (!crosses) {
        break;
      }

      const level = opposite.levels.get(price);
      while (incoming.remaining > 0 && !level.isEmpty()) {
        const resting = level.peek();
        const quantity = Math.min(incoming.remaining, resting.remaining);

        resting.remaining -= quantity;
        incoming.remaining -= quantity;
        level.reduceQuantity(quantity);

        trades.push({
          buyOrderId: isBuy ? incoming.id : resting.id,
          sellOrderId: isBuy ? resting.id : incoming.id,
          price: price,
          quantity: quantity,
        });

        if (resting.remaining === 0) {
          level.shift();
          this.orderIndex.delete(resting.id);
        }
      }

      if (level.isEmpty()) {
        removePrice(opposite, price);
      }
    }

    return trades;
  }

  // Put an order into the book on its own side.
  restOrder(order) {
    const book = this.sideOf(order.side);
    let level = book.levels.get(order.price);
    if (level === undefined) {
      level = new PriceLevel(order.price);
      book.levels.set(order.price, level);
      insertPrice(book.prices, order.price, order.side === 'buy');
    }
    const node = level.append(order);
    this.orderIndex.set(order.id, node);
  }

  sideOf(side) {
    if (side === 'buy') {
      return this.bids;
    }
    return this.asks;
  }
}

function validateOrder(id, side, price, quantity) {
  if (id === undefined || id === null) {
    throw new Error('Order id is required');
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new Error('Side must be "buy" or "sell"');
  }
  if (!Number.isInteger(price) || price <= 0) {
    throw new Error('Price must be a positive integer in paise');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive integer');
  }
}

function bestPrice(book) {
  if (book.prices.length === 0) {
    return null;
  }
  return book.prices[book.prices.length - 1];
}

// Insert a price into a sorted array using binary search.
// ascending = true for bids, false for asks.
function insertPrice(prices, price, ascending) {
  let low = 0;
  let high = prices.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const goesAfterMid = ascending ? prices[mid] < price : prices[mid] > price;
    if (goesAfterMid) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  prices.splice(low, 0, price);
}

// Remove an empty price level from a side.
function removePrice(book, price) {
  book.levels.delete(price);
  const last = book.prices.length - 1;
  if (book.prices[last] === price) {
    book.prices.pop(); // the common case: the best level emptied
  } else {
    book.prices.splice(book.prices.indexOf(price), 1);
  }
}

function topLevels(book, n) {
  const result = [];
  for (let i = book.prices.length - 1; i >= 0 && result.length < n; i--) {
    const level = book.levels.get(book.prices[i]);
    result.push({ price: level.price, quantity: level.totalQuantity });
  }
  return result;
}

module.exports = OrderBook;
