const ValidationError = require('./ValidationError');
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

  // type is 'limit' (the default) or 'market'. A market order has no
  // price: it fills at the best prices available, and whatever is left
  // is cancelled, never rested.
  //
  // Self-trade prevention: if the incoming order reaches a resting order
  // from the same user, matching stops and the rest of the incoming order
  // is cancelled (for limit orders too). cancelledQuantity reports it.
  //
  // cancelReason says why anything was cancelled: null (nothing was),
  // 'self-trade', or 'no liquidity' (a market order ran out of orders).
  addOrder({ id, userId, side, type = 'limit', price, quantity }) {
    validateOrder(id, userId, side, type, price, quantity);
    if (this.orderIndex.has(id)) {
      throw new ValidationError('Order id already in the book: ' + id);
    }

    const order = {
      id: id,
      userId: userId,
      side: side,
      type: type,
      price: type === 'market' ? null : price,
      quantity: quantity,
      remaining: quantity,
      seq: this.nextSeq,
    };
    this.nextSeq += 1;

    const { trades, stoppedBySelfTrade } = this.match(order);
    const outcome = decideRemainder(order.type, order.remaining, stoppedBySelfTrade);
    if (outcome.rests) {
      this.restOrder(order);
      return { trades: trades, restingOrder: { ...order }, cancelledQuantity: 0, cancelReason: null };
    }
    return {
      trades: trades,
      restingOrder: null,
      cancelledQuantity: outcome.cancelledQuantity,
      cancelReason: outcome.cancelReason,
    };
  }

  // Works out what addOrder would do with this order, WITHOUT changing
  // the book. No id is needed. Returns:
  //   fills: [{ restingOrderId, restingUserId, price, quantity }], in order
  //   cancelledQuantity, cancelReason: as addOrder would report them
  //   wouldRest, restingQuantity: whether (and how much) would rest
  // The API uses this to check balances and save everything to the
  // database before the book is touched.
  previewOrder({ userId, side, type = 'limit', price, quantity }) {
    validateOrderFields(userId, side, type, price, quantity);
    const incoming = {
      userId: userId,
      side: side,
      type: type,
      price: type === 'market' ? null : price,
      remaining: quantity,
    };
    const plan = this.planFills(incoming);
    const outcome = decideRemainder(type, plan.remaining, plan.stoppedBySelfTrade);
    return {
      fills: plan.fills,
      cancelledQuantity: outcome.cancelledQuantity,
      cancelReason: outcome.cancelReason,
      wouldRest: outcome.rests,
      restingQuantity: outcome.rests ? plan.remaining : 0,
    };
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

  // A copy of a resting order, or null if it isn't in the book
  // (never existed, already filled, or cancelled).
  getOrder(id) {
    const node = this.orderIndex.get(id);
    if (node === undefined) {
      return null;
    }
    return { ...node.order };
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

  // Read-only: the fills an incoming order would get, best price first,
  // oldest order first within a price. Stops when the order is filled,
  // the next price doesn't cross, or it reaches the same user's order
  // (self-trade prevention). Changes nothing.
  //
  // Both previewOrder and match use this, so a preview and the real
  // matching can never disagree.
  planFills(incoming) {
    const opposite = incoming.side === 'buy' ? this.asks : this.bids;
    const fills = [];
    let remaining = incoming.remaining;
    let stoppedBySelfTrade = false;

    // The best price is at the end of the array, so walk it backwards.
    for (let i = opposite.prices.length - 1; i >= 0; i--) {
      if (remaining === 0 || stoppedBySelfTrade) {
        break;
      }
      const price = opposite.prices[i];
      if (!crosses(incoming, price)) {
        break; // every price after this one is worse
      }
      let node = opposite.levels.get(price).head; // oldest order first
      while (node !== null && remaining > 0) {
        const resting = node.order;
        if (resting.userId === incoming.userId) {
          stoppedBySelfTrade = true; // never trade a user with themselves
          break;
        }
        const quantity = Math.min(remaining, resting.remaining);
        fills.push({
          restingOrderId: resting.id,
          restingUserId: resting.userId,
          price: price,
          quantity: quantity,
        });
        remaining -= quantity;
        node = node.next;
      }
    }

    return { fills: fills, remaining: remaining, stoppedBySelfTrade: stoppedBySelfTrade };
  }

  // Fill an incoming order: plan the fills, then apply them to the book.
  // Trades happen at the resting order's price. Changes incoming.remaining
  // and returns the trades, plus whether matching stopped because of a
  // self-trade.
  match(incoming) {
    const isBuy = incoming.side === 'buy';
    const opposite = isBuy ? this.asks : this.bids;
    const plan = this.planFills(incoming);
    const trades = [];

    for (const fill of plan.fills) {
      const level = opposite.levels.get(fill.price);
      // Every fill except the last empties its resting order, so the
      // next fill's order is always at the front of its level.
      const resting = level.peek();
      if (resting.id !== fill.restingOrderId) {
        throw new Error('Engine bug: planned fill does not match the book');
      }

      resting.remaining -= fill.quantity;
      incoming.remaining -= fill.quantity;
      level.reduceQuantity(fill.quantity);

      trades.push({
        buyOrderId: isBuy ? incoming.id : resting.id,
        sellOrderId: isBuy ? resting.id : incoming.id,
        buyUserId: isBuy ? incoming.userId : resting.userId,
        sellUserId: isBuy ? resting.userId : incoming.userId,
        price: fill.price,
        quantity: fill.quantity,
      });

      if (resting.remaining === 0) {
        level.shift();
        this.orderIndex.delete(resting.id);
      }
      if (level.isEmpty()) {
        removePrice(opposite, fill.price);
      }
    }

    return { trades: trades, stoppedBySelfTrade: plan.stoppedBySelfTrade };
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

// Does the incoming order accept this resting price?
function crosses(incoming, price) {
  if (incoming.type === 'market') {
    return true; // a market order accepts any price
  }
  if (incoming.side === 'buy') {
    return price <= incoming.price;
  }
  return price >= incoming.price;
}

// What happens to whatever is left after matching. One rule, used by
// both addOrder and previewOrder.
function decideRemainder(type, remaining, stoppedBySelfTrade) {
  if (remaining === 0) {
    return { rests: false, cancelledQuantity: 0, cancelReason: null };
  }
  if (stoppedBySelfTrade) {
    return { rests: false, cancelledQuantity: remaining, cancelReason: 'self-trade' };
  }
  if (type === 'market') {
    return { rests: false, cancelledQuantity: remaining, cancelReason: 'no liquidity' };
  }
  return { rests: true, cancelledQuantity: 0, cancelReason: null };
}

function validateOrder(id, userId, side, type, price, quantity) {
  if (id === undefined || id === null) {
    throw new ValidationError('Order id is required');
  }
  validateOrderFields(userId, side, type, price, quantity);
}

// Everything except the id, so previewOrder can check an order that
// doesn't have an id yet.
function validateOrderFields(userId, side, type, price, quantity) {
  if (userId === undefined || userId === null) {
    throw new ValidationError('User id is required');
  }
  if (side !== 'buy' && side !== 'sell') {
    throw new ValidationError('Side must be "buy" or "sell"');
  }
  if (type !== 'limit' && type !== 'market') {
    throw new ValidationError('Type must be "limit" or "market"');
  }
  if (type === 'market') {
    if (price !== undefined && price !== null) {
      throw new ValidationError('A market order must not have a price');
    }
  } else if (!Number.isInteger(price) || price <= 0) {
    throw new ValidationError('Price must be a positive integer in paise');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('Quantity must be a positive integer');
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
