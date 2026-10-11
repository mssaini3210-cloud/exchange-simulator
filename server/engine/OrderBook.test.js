const OrderBook = require('./OrderBook');

describe('OrderBook: validation', () => {
  test('rejects float prices', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'buy', price: 100.5, quantity: 10 })).toThrow();
  });

  test('rejects zero or negative prices', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'buy', price: 0, quantity: 10 })).toThrow();
    expect(() => book.addOrder({ id: 2, side: 'buy', price: -100, quantity: 10 })).toThrow();
  });

  test('rejects bad quantities', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 0 })).toThrow();
    expect(() => book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 1.5 })).toThrow();
  });

  test('rejects an unknown side', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'hold', price: 10000, quantity: 10 })).toThrow();
  });

  test('rejects a missing id', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ side: 'buy', price: 10000, quantity: 10 })).toThrow();
  });

  test('rejects a duplicate id that is still resting', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    expect(() => book.addOrder({ id: 1, side: 'buy', price: 10100, quantity: 5 })).toThrow();
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
    book.addOrder({ id: 1, side: 'buy', price: 9900, quantity: 10 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 3, side: 'buy', price: 9800, quantity: 10 });
    expect(book.getBestBid()).toBe(10000);
  });

  test('best ask is the lowest sell price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10200, quantity: 10 });
    book.addOrder({ id: 2, side: 'sell', price: 10100, quantity: 10 });
    book.addOrder({ id: 3, side: 'sell', price: 10300, quantity: 10 });
    expect(book.getBestAsk()).toBe(10100);
  });

  test('addOrder returns the resting order with remaining and seq', () => {
    const book = new OrderBook();
    const first = book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    const second = book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 5 });
    expect(first.trades).toEqual([]);
    expect(first.restingOrder).toMatchObject({ id: 1, remaining: 10, seq: 1 });
    expect(second.restingOrder.seq).toBe(2);
  });

  test('depth adds up quantity per level, best price first', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 3, side: 'buy', price: 9900, quantity: 7 });
    book.addOrder({ id: 4, side: 'sell', price: 10200, quantity: 3 });
    book.addOrder({ id: 5, side: 'sell', price: 10100, quantity: 4 });
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
    book.addOrder({ id: 1, side: 'buy', price: 9800, quantity: 1 });
    book.addOrder({ id: 2, side: 'buy', price: 9900, quantity: 1 });
    book.addOrder({ id: 3, side: 'buy', price: 10000, quantity: 1 });
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
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, side: 'buy', price: 9900, quantity: 10 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.getBestBid()).toBe(9900);
  });

  test('cancelling a non-best level removes it from depth', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10100, quantity: 10 });
    book.addOrder({ id: 2, side: 'sell', price: 10200, quantity: 10 });
    book.addOrder({ id: 3, side: 'sell', price: 10300, quantity: 10 });
    book.cancelOrder(2);
    expect(book.getDepth(5).asks.map((l) => l.price)).toEqual([10100, 10300]);
  });

  test('cancelling one order at a level keeps the level and lowers its quantity', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 5 });
    book.cancelOrder(1);
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 5 }]);
  });

  test('cancelling the same order twice returns false the second time', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 10 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.cancelOrder(1)).toBe(false);
    expect(book.getBestBid()).toBeNull();
  });
});

describe('OrderBook: matching', () => {
  test('orders that do not cross both rest in the book', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10100, quantity: 10 });
    const result = book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([]);
    expect(book.getBestBid()).toBe(10000);
    expect(book.getBestAsk()).toBe(10100);
  });

  test('full fill at the same quantity empties both sides', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([
      { buyOrderId: 2, sellOrderId: 1, price: 10000, quantity: 10 },
    ]);
    expect(result.restingOrder).toBeNull();
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
  });

  test('trade happens at the resting order price (price improvement)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, side: 'buy', price: 10100, quantity: 10 });
    expect(result.trades[0].price).toBe(10000);
  });

  test('incoming sell also trades at the resting bid price', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10100, quantity: 10 });
    const result = book.addOrder({ id: 2, side: 'sell', price: 10000, quantity: 10 });
    expect(result.trades).toEqual([
      { buyOrderId: 1, sellOrderId: 2, price: 10100, quantity: 10 },
    ]);
  });

  test('incoming smaller than resting: resting order is partly filled', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 10 });
    const result = book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 4 });
    expect(result.trades[0].quantity).toBe(4);
    expect(result.restingOrder).toBeNull();
    expect(book.getDepth(1).asks).toEqual([{ price: 10000, quantity: 6 }]);
  });

  test('incoming larger than resting: remainder rests in the book', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 4 });
    const result = book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 10 });
    expect(result.trades[0].quantity).toBe(4);
    expect(result.restingOrder).toMatchObject({ id: 2, quantity: 10, remaining: 6 });
    expect(book.getBestAsk()).toBeNull();
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 6 }]);
  });

  test('same price fills in arrival order (time priority)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'first', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'second', side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 's', side: 'sell', price: 10000, quantity: 7 });
    expect(result.trades).toEqual([
      { buyOrderId: 'first', sellOrderId: 's', price: 10000, quantity: 5 },
      { buyOrderId: 'second', sellOrderId: 's', price: 10000, quantity: 2 },
    ]);
    expect(book.getDepth(1).bids).toEqual([{ price: 10000, quantity: 3 }]);
  });

  test('better price fills before an older order at a worse price (price priority)', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'old', side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 'better', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'b', side: 'buy', price: 10100, quantity: 5 });
    expect(result.trades[0].sellOrderId).toBe('better');
  });

  test('large order sweeps 3 levels and the remainder rests', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 3, side: 'sell', price: 10200, quantity: 5 });
    book.addOrder({ id: 4, side: 'sell', price: 10300, quantity: 5 }); // too expensive
    const result = book.addOrder({ id: 'big', side: 'buy', price: 10200, quantity: 20 });

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
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 5 });
    expect(book.cancelOrder(1)).toBe(false);
  });

  test('a partly filled order can be cancelled and leaves no quantity behind', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 10 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 4 });
    expect(book.cancelOrder(1)).toBe(true);
    expect(book.getBestAsk()).toBeNull();
    expect(book.getDepth(5).asks).toEqual([]);
  });

  test('cancelling the middle order keeps FIFO for the rest', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'a', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'b', side: 'buy', price: 10000, quantity: 5 });
    book.addOrder({ id: 'c', side: 'buy', price: 10000, quantity: 5 });
    book.cancelOrder('b');
    const result = book.addOrder({ id: 's', side: 'sell', price: 10000, quantity: 10 });
    expect(result.trades.map((t) => t.buyOrderId)).toEqual(['a', 'c']);
  });
});

describe('OrderBook: market orders', () => {
  test('market order against an empty book trades nothing and is cancelled', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 10 });
    expect(result.trades).toEqual([]);
    expect(result.restingOrder).toBeNull();
    expect(result.cancelledQuantity).toBe(10);
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
  });

  test('market order against an empty opposite side does not rest on its own side', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 10 });
    expect(result.cancelledQuantity).toBe(10);
    expect(book.getDepth(5).bids).toEqual([{ price: 10000, quantity: 5 }]);
  });

  test('market buy sweeps levels at each resting price, with no price limit', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 2, side: 'sell', price: 10100, quantity: 5 });
    book.addOrder({ id: 3, side: 'sell', price: 99900, quantity: 5 });
    const result = book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 12 });
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
    book.addOrder({ id: 1, side: 'sell', price: 10000, quantity: 3 });
    book.addOrder({ id: 2, side: 'sell', price: 10100, quantity: 4 });
    const result = book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 10 });
    expect(result.trades.map((t) => t.quantity)).toEqual([3, 4]);
    expect(result.restingOrder).toBeNull();
    expect(result.cancelledQuantity).toBe(3);
    expect(book.getBestAsk()).toBeNull();
    expect(book.getBestBid()).toBeNull(); // the remainder never rested
    expect(book.cancelOrder('m')).toBe(false);
  });

  test('market sell fills against the highest bids first', () => {
    const book = new OrderBook();
    book.addOrder({ id: 1, side: 'buy', price: 9900, quantity: 5 });
    book.addOrder({ id: 2, side: 'buy', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', side: 'sell', type: 'market', quantity: 7 });
    expect(result.trades).toEqual([
      { buyOrderId: 2, sellOrderId: 'm', price: 10000, quantity: 5 },
      { buyOrderId: 1, sellOrderId: 'm', price: 9900, quantity: 2 },
    ]);
    expect(book.getDepth(5).bids).toEqual([{ price: 9900, quantity: 3 }]);
  });

  test('market order fills same-price orders in arrival order', () => {
    const book = new OrderBook();
    book.addOrder({ id: 'first', side: 'sell', price: 10000, quantity: 5 });
    book.addOrder({ id: 'second', side: 'sell', price: 10000, quantity: 5 });
    const result = book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 6 });
    expect(result.trades.map((t) => [t.sellOrderId, t.quantity])).toEqual([
      ['first', 5],
      ['second', 1],
    ]);
  });

  test('a market order with a price is rejected', () => {
    const book = new OrderBook();
    expect(() =>
      book.addOrder({ id: 'm', side: 'buy', type: 'market', price: 10000, quantity: 5 })
    ).toThrow();
  });

  test('a market order still needs a valid quantity', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 'm', side: 'buy', type: 'market', quantity: 0 })).toThrow();
  });

  test('an unknown order type is rejected', () => {
    const book = new OrderBook();
    expect(() =>
      book.addOrder({ id: 1, side: 'buy', type: 'stop', price: 10000, quantity: 5 })
    ).toThrow();
  });

  test('a limit order without a price is still rejected', () => {
    const book = new OrderBook();
    expect(() => book.addOrder({ id: 1, side: 'buy', type: 'limit', quantity: 5 })).toThrow();
  });

  test('limit orders report cancelledQuantity 0', () => {
    const book = new OrderBook();
    const result = book.addOrder({ id: 1, side: 'buy', price: 10000, quantity: 5 });
    expect(result.cancelledQuantity).toBe(0);
    expect(result.restingOrder.type).toBe('limit');
  });
});
