const ValidationError = require('./ValidationError');
const OrderBook = require('./OrderBook');

describe('OrderBook: validation', () => {
  test('rejects float prices', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 100.5, quantity: 10 })).toThrow(ValidationError);
  });

  test('rejects zero or negative prices', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 0, quantity: 10 })).toThrow(ValidationError);
    expect(() => book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: -100, quantity: 10 })).toThrow(ValidationError);
  });

  test('rejects bad quantities', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 0 })).toThrow(ValidationError);
    expect(() => book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 1.5 })).toThrow(ValidationError);
  });

  test('rejects an unknown side', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'hold', price: 10000, quantity: 10 })).toThrow(ValidationError);
  });

  test('rejects a missing id', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ userId: 'buyer', side: 'buy', price: 10000, quantity: 10 })).toThrow(ValidationError);
  });

  test('rejects a duplicate id that is still resting', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10100, quantity: 5 })).toThrow(ValidationError);
  });
});

describe('OrderBook: resting orders', () => {
  test('an empty book has no best prices', () => {
    const book = new OrderBook();
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
    expect(book.getDepth(5)).toEqual({ bids: [], asks: [] });
  });

  test('best bid is the highest buy price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 9900, quantity: 10 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 3, userId: 'buyer', side: 'buy', price: 9800, quantity: 10 });
    expect(book.getBestBid()).toBe(10000);
  });

  test('best ask is the lowest sell price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10200, quantity: 10 });
    book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10100, quantity: 10 });
    book.addOrder({ id: 3, userId: 'seller', side: 'sell', price: 10300, quantity: 10 });
    expect(book.getBestAsk()).toBe(10100);
  });

  test('addOrder returns the resting order with remaining and seq', () => {
    const book = new OrderBook();
    const first = book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    const second = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    expect(first.trades).toEqual([]);
    expect(first.restingOrder).toMatchObject({ id: 1, remaining: 10, seq: 1 });
    expect(second.restingOrder.seq).toBe(2);
  });

  test('depth adds up quantity per level, best price first', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 3, userId: 'buyer', side: 'buy', price: 9900, quantity: 7 });
    book.addOrder({ id: 4, userId: 'seller', side: 'sell', price: 10200, quantity: 3 });
    book.addOrder({ id: 5, userId: 'seller', side: 'sell', price: 10100, quantity: 4 });
    expect(book.getDepth(5)).toEqual({
      bids: [
        { price: 10000, quantity: 15 },
        { price: 9900, quantity: 7 },
      ],
      asks: [
        { price: 10100, quantity: 4 },
        { price: 10200, quantity: 3 },
      ],
    });
  });

  test('depth returns only the top n levels', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 9800, quantity: 1 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 9900, quantity: 1 });
    book.addOrder({ id: 3, userId: 'buyer', side: 'buy', price: 10000, quantity: 1 });
    expect(book.getDepth(2).bids.map((l) => l.price)).toEqual([10000, 9900]);
  });
});

describe('OrderBook: cancel', () => {
  test('cancelling an unknown id returns false', () => {
    const book = new OrderBook();
    expect(book.cancelOrder(42)).toBe(false);
  });

  test('cancelling the only order at the best price moves the best price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 9900, quantity: 10 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.getBestBid()).toBe(9900);
  });

  test('cancelling a non-best level removes it from depth', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10100, quantity: 10 });
    book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10200, quantity: 10 });
    book.addOrder({ id: 3, userId: 'seller', side: 'sell', price: 10300, quantity: 10 });
    book.cancelOrder(2);
    expect(book.getDepth(5).asks.map((l) => l.price)).toEqual([10100, 10300]);
  });

  test('cancelling one order at a level keeps the level and lowers its quantity', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.cancelOrder(1);
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 5 }]);
  });

  test('cancelling the same order twice returns false the second time', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.cancelOrder(1)).toBe(false);
    expect(book.getBestBid()).toBeNull();
  });
});

describe('OrderBook: matching', () => {
  test('orders that do not cross both rest in the book', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10100, quantity: 10 });
    const result = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([]);
    expect(book.getBestBid()).toBe(10000);
    expect(book.getBestAsk()).toBe(10100);
  });

  test('full fill at the same quantity empties both sides', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([
      { buyOrderId: 2, sellOrderId: 1, buyUserId: 'buyer', sellUserId: 'seller', price: 10000, quantity: 10 },
    ]);
    expect(result.restingOrder).toBeNull();
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
  });

  test('trade happens at the resting order price (price improvement)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10100, quantity: 10 });
    expect(result.trades[0].price).toBe(10000);
  });

  test('incoming sell also trades at the resting bid price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10100, quantity: 10 });
    const result = book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([
      { buyOrderId: 1, sellOrderId: 2, buyUserId: 'buyer', sellUserId: 'seller', price: 10100, quantity: 10 },
    ]);
  });

  test('incoming smaller than resting: resting order is partly filled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 4 });
    expect(result.trades[0].quantity).toBe(4);
    expect(result.restingOrder).toBeNull();
    expect(book.getDepth(1).asks).toEqual([{ price: 10000, quantity: 6 }]);
  });

  test('incoming larger than resting: remainder rests in the book', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 4 });
    const result = book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades[0].quantity).toBe(4);
    expect(result.restingOrder).toMatchObject({ id: 2, quantity: 10, remaining: 6 });
    expect(book.getBestAsk()).toBeNull();
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 6 }]);
  });

  test('same price fills in arrival order (time priority)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'first', userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'second', userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 's', userId: 'seller', side: 'sell', price: 10000, quantity: 7 });
    expect(result.trades).toEqual([
      { buyOrderId: 'first', sellOrderId: 's', buyUserId: 'buyer', sellUserId: 'seller', price: 10000, quantity: 5 },
      { buyOrderId: 'second', sellOrderId: 's', buyUserId: 'buyer', sellUserId: 'seller', price: 10000, quantity: 2 },
    ]);
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 3 }]);
  });

  test('better price fills before an older order at a worse price (price priority)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'old', userId: 'seller', side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 'better', userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'b', userId: 'buyer', side: 'buy', price: 10100, quantity: 5 });
    expect(result.trades[0].sellOrderId).toBe('better');
  });

  test('large order sweeps 3 levels and the remainder rests', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 3, userId: 'seller', side: 'sell', price: 10200, quantity: 5 });
    book.addOrder({ id: 4, userId: 'seller', side: 'sell', price: 10300, quantity: 5 }); // too expensive
    const result = book.addOrder({ id: 'big', userId: 'buyer', side: 'buy', price: 10200, quantity: 20 });

    expect(result.trades.map((t) => [t.price, t.quantity])).toEqual([
      [10000, 5],
      [10100, 5],
      [10200, 5],
    ]);
    expect(result.restingOrder).toMatchObject({ id: 'big', price: 10200, remaining: 5 });
    expect(book.getBestBid()).toBe(10200);
    expect(book.getBestAsk()).toBe(10300);
  });

  test('a filled order can no longer be cancelled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    expect(book.cancelOrder(1)).toBe(false);
  });

  test('a partly filled order can be cancelled and leaves no quantity behind', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 4 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.getBestAsk()).toBeNull();
    expect(book.getDepth(5).asks).toEqual([]);
  });

  test('cancelling the middle order keeps FIFO for the rest', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'a', userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'b', userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'c', userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    book.cancelOrder('b');
    const result = book.addOrder({ id: 's', userId: 'seller', side: 'sell', price: 10000, quantity: 10 });
    expect(result.trades.map((t) => t.buyOrderId)).toEqual(['a', 'c']);
  });
});

describe('OrderBook: market orders', () => {
  test('market order against an empty book trades nothing and is cancelled', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 10 });
    expect(result.trades).toEqual([]);
    expect(result.restingOrder).toBeNull();
    expect(result.cancelledQuantity).toBe(10);
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
  });

  test('market order against an empty opposite side does not rest on its own side', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 10 });
    expect(result.cancelledQuantity).toBe(10);
    expect(book.getDepth(5).bids).toEqual([{ price: 10000, quantity: 5 }]);
  });

  test('market buy sweeps levels at each resting price, with no price limit', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 3, userId: 'seller', side: 'sell', price: 99900, quantity: 5 });
    const result = book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 12 });
    expect(result.trades.map((t) => [t.price, t.quantity])).toEqual([
      [10000, 5],
      [10100, 5],
      [99900, 2],
    ]);
    expect(result.cancelledQuantity).toBe(0);
    expect(result.restingOrder).toBeNull();
    expect(book.getDepth(5).asks).toEqual([{ price: 99900, quantity: 3 }]);
  });

  test('market order larger than the book: fills what it can, rest is cancelled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'seller', side: 'sell', price: 10000, quantity: 3 });
    book.addOrder({ id: 2, userId: 'seller', side: 'sell', price: 10100, quantity: 4 });
    const result = book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 10 });
    expect(result.trades.map((t) => t.quantity)).toEqual([3, 4]);
    expect(result.restingOrder).toBeNull();
    expect(result.cancelledQuantity).toBe(3);
    expect(book.getBestAsk()).toBeNull();
    expect(book.getBestBid()).toBeNull(); // the remainder never rested
    expect(book.cancelOrder('m')).toBe(false);
  });

  test('market sell fills against the highest bids first', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 9900, quantity: 5 });
    book.addOrder({ id: 2, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', userId: 'seller', side: 'sell', type: 'market', quantity: 7 });
    expect(result.trades).toEqual([
      { buyOrderId: 2, sellOrderId: 'm', buyUserId: 'buyer', sellUserId: 'seller', price: 10000, quantity: 5 },
      { buyOrderId: 1, sellOrderId: 'm', buyUserId: 'buyer', sellUserId: 'seller', price: 9900, quantity: 2 },
    ]);
    expect(book.getDepth(5).bids).toEqual([{ price: 9900, quantity: 3 }]);
  });

  test('market order fills same-price orders in arrival order', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'first', userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 'second', userId: 'seller', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 6 });
    expect(result.trades.map((t) => [t.sellOrderId, t.quantity])).toEqual([
      ['first', 5],
      ['second', 1],
    ]);
  });

  test('a market order with a price is rejected', () => {
    const book = new OrderBook();
    expect(() =>
      book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', price: 10000, quantity: 5 })
    ).toThrow(ValidationError);
  });

  test('a market order still needs a valid quantity', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 'm', userId: 'buyer', side: 'buy', type: 'market', quantity: 0 })).toThrow(ValidationError);
  });

  test('an unknown order type is rejected', () => {
    const book = new OrderBook();
    expect(() =>
      book.addOrder({ id: 1, userId: 'buyer', side: 'buy', type: 'stop', price: 10000, quantity: 5 })
    ).toThrow(ValidationError);
  });

  test('a limit order without a price is still rejected', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, userId: 'buyer', side: 'buy', type: 'limit', quantity: 5 })).toThrow(ValidationError);
  });

  test('limit orders report cancelledQuantity 0', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 1, userId: 'buyer', side: 'buy', price: 10000, quantity: 5 });
    expect(result.cancelledQuantity).toBe(0);
    expect(result.restingOrder.type).toBe('limit');
  });
});

describe('OrderBook: user ids', () => {
  test('rejects an order without a userId', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 5 })).toThrow(
      'User id is required'
    );
  });

  test('the resting order keeps its userId', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(result.restingOrder.userId).toBe('alice');
  });

  test('incoming buy: buyer is the incoming user, seller is the resting user', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'bob', side: 'buy', price: 10000, quantity: 5 });
    expect(result.trades[0]).toMatchObject({ buyUserId: 'bob', sellUserId: 'alice' });
  });

  test('incoming sell: seller is the incoming user, buyer is the resting user', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'bob', side: 'sell', price: 10000, quantity: 5 });
    expect(result.trades[0]).toMatchObject({ buyUserId: 'alice', sellUserId: 'bob' });
  });

  test('each trade in a sweep names the user of the order it filled against', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 2 });
    book.addOrder({ id: 2, userId: 'carol', side: 'sell', price: 10000, quantity: 2 });
    book.addOrder({ id: 3, userId: 'dave', side: 'sell', price: 10100, quantity: 2 });
    const result = book.addOrder({ id: 4, userId: 'bob', side: 'buy', type: 'market', quantity: 6 });
    expect(result.trades.map((t) => [t.buyUserId, t.sellUserId])).toEqual([
      ['bob', 'alice'],
      ['bob', 'carol'],
      ['bob', 'dave'],
    ]);
  });
});

describe('OrderBook: self-trade prevention', () => {
  test('limit order against its own resting order: no trade, remainder cancelled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(result.trades).toEqual([]);
    expect(result.restingOrder).toBeNull();
    expect(result.cancelledQuantity).toBe(5);
    expect(book.getBestBid()).toBeNull(); // the incoming order did not rest
    expect(book.getDepth(1).asks).toEqual([{ price: 10000, quantity: 5 }]); // resting order untouched
  });

  test('fills other users first, then stops at its own order in the same level', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 3 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10000, quantity: 3 });
    book.addOrder({ id: 3, userId: 'carol', side: 'sell', price: 10000, quantity: 3 });
    const result = book.addOrder({ id: 4, userId: 'alice', side: 'buy', price: 10000, quantity: 8 });
    expect(result.trades.map((t) => [t.sellUserId, t.quantity])).toEqual([['bob', 3]]);
    expect(result.cancelledQuantity).toBe(5);
    expect(result.restingOrder).toBeNull();
    expect(book.getDepth(1).asks).toEqual([{ price: 10000, quantity: 6 }]);
    // alice's and carol's sells are still waiting, in the same order
    const next = book.addOrder({ id: 5, userId: 'dave', side: 'buy', price: 10000, quantity: 4 });
    expect(next.trades.map((t) => [t.sellUserId, t.quantity])).toEqual([
      ['alice', 3],
      ['carol', 1],
    ]);
  });

  test('sweeps a level, then stops at its own order at the next price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10100, quantity: 5 });
    const result = book.addOrder({ id: 3, userId: 'alice', side: 'buy', price: 10100, quantity: 8 });
    expect(result.trades.map((t) => [t.price, t.quantity])).toEqual([[10000, 5]]);
    expect(result.cancelledQuantity).toBe(3);
    expect(book.getBestAsk()).toBe(10100);
    expect(book.getBestBid()).toBeNull();
  });

  test('incoming sell against its own resting buy is also prevented', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 9900, quantity: 4 });
    expect(result.trades).toEqual([]);
    expect(result.cancelledQuantity).toBe(4);
    expect(book.getBestAsk()).toBeNull();
    expect(book.getBestBid()).toBe(10000);
  });

  test('market order stops at its own order', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 2 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 3, userId: 'carol', side: 'sell', price: 10200, quantity: 5 });
    const result = book.addOrder({ id: 4, userId: 'alice', side: 'buy', type: 'market', quantity: 10 });
    expect(result.trades.map((t) => t.sellUserId)).toEqual(['bob']);
    expect(result.cancelledQuantity).toBe(8);
    expect(book.getDepth(5).asks).toEqual([
      { price: 10100, quantity: 5 },
      { price: 10200, quantity: 5 },
    ]);
  });

  test('own order at a price that does not cross is ignored, and the order rests', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10100, quantity: 5 });
    const result = book.addOrder({ id: 3, userId: 'alice', side: 'buy', price: 10000, quantity: 8 });
    expect(result.trades.map((t) => t.quantity)).toEqual([5]);
    expect(result.cancelledQuantity).toBe(0);
    expect(result.restingOrder).toMatchObject({ id: 3, remaining: 3 });
    expect(book.getBestBid()).toBe(10000);
    expect(book.getBestAsk()).toBe(10100);
  });

  test('filled before reaching its own order: nothing is cancelled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 3, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(result.trades.map((t) => t.sellUserId)).toEqual(['bob']);
    expect(result.cancelledQuantity).toBe(0);
    expect(result.restingOrder).toBeNull();
  });

  test('the resting order survives and can still be cancelled by its owner', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.getBestAsk()).toBeNull();
  });

  test('a cancelled incoming order is not in the book', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(book.cancelOrder(2)).toBe(false);
  });
});

describe('OrderBook: cancelReason', () => {
  test('null when a limit order rests', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(result.cancelReason).toBeNull();
  });

  test('null when an order fills completely', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'bob', side: 'buy', type: 'market', quantity: 5 });
    expect(result.cancelledQuantity).toBe(0);
    expect(result.cancelReason).toBeNull();
  });

  test("'no liquidity' when a market order hits an empty book", () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 1, userId: 'bob', side: 'buy', type: 'market', quantity: 5 });
    expect(result.cancelReason).toBe('no liquidity');
  });

  test("'no liquidity' when a market order runs out part way", () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 3 });
    const result = book.addOrder({ id: 2, userId: 'bob', side: 'buy', type: 'market', quantity: 5 });
    expect(result.cancelledQuantity).toBe(2);
    expect(result.cancelReason).toBe('no liquidity');
  });

  test("'self-trade' for a limit order stopped by its own order", () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 2, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    expect(result.cancelReason).toBe('self-trade');
  });

  test("'self-trade', not 'no liquidity', for a market order stopped by its own order", () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'bob', side: 'sell', price: 10000, quantity: 2 });
    book.addOrder({ id: 2, userId: 'alice', side: 'sell', price: 10100, quantity: 5 });
    const result = book.addOrder({ id: 3, userId: 'alice', side: 'buy', type: 'market', quantity: 10 });
    expect(result.cancelledQuantity).toBe(8);
    expect(result.cancelReason).toBe('self-trade');
  });
});

describe('OrderBook: getOrder', () => {
  test('returns a copy of a resting order', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    const order = book.getOrder(1);
    expect(order).toMatchObject({ id: 1, userId: 'alice', side: 'buy', price: 10000, remaining: 5 });
    order.remaining = 999; // changing the copy must not change the book
    expect(book.getOrder(1).remaining).toBe(5);
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 5 }]);
  });

  test('shows the remaining quantity after a partial fill', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'bob', side: 'buy', price: 10000, quantity: 2 });
    expect(book.getOrder(1).remaining).toBe(3);
  });

  test('returns null for unknown, filled and cancelled orders', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, userId: 'bob', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 3, userId: 'carol', side: 'buy', price: 9900, quantity: 5 });
    book.cancelOrder(3);
    expect(book.getOrder(42)).toBeNull();
    expect(book.getOrder(1)).toBeNull(); // filled
    expect(book.getOrder(3)).toBeNull(); // cancelled
  });
});

describe('OrderBook: previewOrder', () => {
  function bookWithAsks() {
    const book = new OrderBook();
    book.addOrder({ id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 3 });
    book.addOrder({ id: 2, userId: 'carol', side: 'sell', price: 10000, quantity: 4 });
    book.addOrder({ id: 3, userId: 'dave', side: 'sell', price: 10100, quantity: 5 });
    return book;
  }

  test('lists the fills a crossing order would get, without an id', () => {
    const preview = bookWithAsks().previewOrder({ userId: 'bob', side: 'buy', price: 10100, quantity: 9 });
    expect(preview).toEqual({
      fills: [
        { restingOrderId: 1, restingUserId: 'alice', price: 10000, quantity: 3 },
        { restingOrderId: 2, restingUserId: 'carol', price: 10000, quantity: 4 },
        { restingOrderId: 3, restingUserId: 'dave', price: 10100, quantity: 2 },
      ],
      cancelledQuantity: 0,
      cancelReason: null,
      wouldRest: false,
      restingQuantity: 0,
    });
  });

  test('does not change the book at all', () => {
    const book = bookWithAsks();
    const depthBefore = book.getDepth(10);
    book.previewOrder({ userId: 'bob', side: 'buy', price: 10100, quantity: 9 });
    book.previewOrder({ userId: 'bob', side: 'buy', type: 'market', quantity: 100 });
    expect(book.getDepth(10)).toEqual(depthBefore);
    expect(book.getOrder(1).remaining).toBe(3);
    expect(book.getOrder(3).remaining).toBe(5);
  });

  test('a limit order that would partly fill reports what would rest', () => {
    const preview = bookWithAsks().previewOrder({ userId: 'bob', side: 'buy', price: 10000, quantity: 10 });
    expect(preview.fills.map((f) => f.quantity)).toEqual([3, 4]);
    expect(preview).toMatchObject({ wouldRest: true, restingQuantity: 3, cancelledQuantity: 0, cancelReason: null });
  });

  test('a market order larger than the book reports no liquidity', () => {
    const preview = bookWithAsks().previewOrder({ userId: 'bob', side: 'buy', type: 'market', quantity: 20 });
    expect(preview.fills.map((f) => f.quantity)).toEqual([3, 4, 5]);
    expect(preview).toMatchObject({ wouldRest: false, cancelledQuantity: 8, cancelReason: 'no liquidity' });
  });

  test('a market order on an empty side has no fills', () => {
    const preview = new OrderBook().previewOrder({ userId: 'bob', side: 'sell', type: 'market', quantity: 5 });
    expect(preview).toMatchObject({ fills: [], cancelledQuantity: 5, cancelReason: 'no liquidity' });
  });

  test('stops at the same user\'s order (self-trade)', () => {
    const preview = bookWithAsks().previewOrder({ userId: 'carol', side: 'buy', price: 10100, quantity: 9 });
    expect(preview.fills).toEqual([{ restingOrderId: 1, restingUserId: 'alice', price: 10000, quantity: 3 }]);
    expect(preview).toMatchObject({ wouldRest: false, cancelledQuantity: 6, cancelReason: 'self-trade' });
  });

  test('validates the order like addOrder does', () => {
    const book = new OrderBook();
    expect(() => book.previewOrder({ userId: 'bob', side: 'buy', price: 100.5, quantity: 1 })).toThrow(
      ValidationError
    );
    expect(() => book.previewOrder({ side: 'buy', price: 100, quantity: 1 })).toThrow('User id is required');
  });

  test('the preview equals what addOrder then does', () => {
    const book = bookWithAsks();
    const order = { userId: 'bob', side: 'buy', price: 10100, quantity: 9 };
    const preview = book.previewOrder(order);
    const result = book.addOrder({ id: 99, ...order });
    expect(result.trades.map((t) => [t.sellOrderId, t.sellUserId, t.price, t.quantity])).toEqual(
      preview.fills.map((f) => [f.restingOrderId, f.restingUserId, f.price, f.quantity])
    );
  });
});

describe('OrderBook: preview always equals addOrder (random)', () => {
  const { createRandom } = require('../test/random');

  // Turn addOrder's result into the same shape as a preview.
  function asPreview(side, result) {
    return {
      fills: result.trades.map((t) => ({
        restingOrderId: side === 'buy' ? t.sellOrderId : t.buyOrderId,
        restingUserId: side === 'buy' ? t.sellUserId : t.buyUserId,
        price: t.price,
        quantity: t.quantity,
      })),
      cancelledQuantity: result.cancelledQuantity,
      cancelReason: result.cancelReason,
      wouldRest: result.restingOrder !== null,
      restingQuantity: result.restingOrder === null ? 0 : result.restingOrder.remaining,
    };
  }

  test.each([1, 2, 3, 42, 2026])('seed %i: 2000 random orders and cancels', (seed) => {
    const random = createRandom(seed);
    const book = new OrderBook();
    let nextId = 1;

    for (let step = 0; step < 2000; step++) {
      if (random.next() < 0.15 && nextId > 1) {
        book.cancelOrder(random.int(1, nextId - 1)); // may already be gone; that's fine
        continue;
      }
      const side = random.pick(['buy', 'sell']);
      const order = { userId: random.pick(['u1', 'u2', 'u3', 'u4']), side: side, quantity: random.int(1, 20) };
      if (random.next() < 0.2) {
        order.type = 'market';
      } else {
        order.price = random.int(9900, 10100); // a narrow band, so orders cross often
      }

      const preview = book.previewOrder(order);
      const result = book.addOrder({ id: nextId, ...order });
      nextId += 1;
      expect(asPreview(side, result)).toEqual(preview);
    }
  });
});
