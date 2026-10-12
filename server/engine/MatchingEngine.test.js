const ValidationError = require('./ValidationError');
const MatchingEngine = require('./MatchingEngine');
const OrderBook = require('./OrderBook');

describe('MatchingEngine: setup', () => {
  test('creates one OrderBook per symbol', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    expect(engine.getBook('INFY')).toBeInstanceOf(OrderBook);
    expect(engine.getBook('TCS')).toBeInstanceOf(OrderBook);
    expect(engine.getBook('INFY')).not.toBe(engine.getBook('TCS'));
  });

  test('rejects a missing or empty symbol list', () => {
    expect(() => new MatchingEngine()).toThrow(ValidationError);
    expect(() => new MatchingEngine([])).toThrow(ValidationError);
  });

  test('rejects empty or non-string symbols', () => {
    expect(() => new MatchingEngine(['INFY', ''])).toThrow(ValidationError);
    expect(() => new MatchingEngine(['INFY', 42])).toThrow(ValidationError);
  });

  test('rejects duplicate symbols', () => {
    expect(() => new MatchingEngine(['INFY', 'INFY'])).toThrow('Duplicate symbol: INFY');
  });
});

describe('MatchingEngine: unknown symbols', () => {
  test('addOrder rejects an unknown symbol', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() =>
      engine.addOrder({ symbol: 'WIPRO', id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 })
    ).toThrow('Unknown symbol: WIPRO');
  });

  test('addOrder rejects an order with no symbol', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() =>
      engine.addOrder({ id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 })
    ).toThrow('Unknown symbol');
  });

  test('symbols are case-sensitive', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() =>
      engine.addOrder({ symbol: 'infy', id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 })
    ).toThrow('Unknown symbol: infy');
  });

  test('cancelOrder rejects an unknown symbol', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() => engine.cancelOrder('WIPRO', 1)).toThrow('Unknown symbol: WIPRO');
  });

  test('getBook rejects an unknown symbol', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() => engine.getBook('WIPRO')).toThrow('Unknown symbol: WIPRO');
  });
});

describe('MatchingEngine: routing', () => {
  test('addOrder puts the order in its own symbol book only', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'buy', price: 150000, quantity: 5 });
    expect(engine.getBook('INFY').getBestBid()).toBe(150000);
    expect(engine.getBook('TCS').getBestBid()).toBeNull();
  });

  test('addOrder returns the trades from the right book', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'TCS', id: 1, userId: 'alice', side: 'sell', price: 350000, quantity: 5 });
    const result = engine.addOrder({ symbol: 'TCS', id: 2, userId: 'bob', side: 'buy', price: 350000, quantity: 3 });
    expect(result.trades).toEqual([
      { buyOrderId: 2, sellOrderId: 1, buyUserId: 'bob', sellUserId: 'alice', price: 350000, quantity: 3 },
    ]);
    expect(result.restingOrder).toBeNull();
    expect(engine.getBook('TCS').getDepth(1).asks).toEqual([{ price: 350000, quantity: 2 }]);
  });

  test('orders in different symbols never match each other', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = engine.addOrder({ symbol: 'TCS', id: 2, userId: 'bob', side: 'buy', price: 10000, quantity: 5 });
    expect(result.trades).toEqual([]);
    expect(engine.getBook('INFY').getBestAsk()).toBe(10000);
    expect(engine.getBook('TCS').getBestBid()).toBe(10000);
  });

  test('market orders are routed too', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'sell', price: 10000, quantity: 5 });
    const result = engine.addOrder({ symbol: 'TCS', id: 2, userId: 'bob', side: 'buy', type: 'market', quantity: 5 });
    expect(result.trades).toEqual([]);
    expect(result.cancelledQuantity).toBe(5);
  });

  test('cancelOrder only cancels in the given symbol, even with the same id elsewhere', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'buy', price: 10000, quantity: 5 });
    engine.addOrder({ symbol: 'TCS', id: 1, userId: 'bob', side: 'buy', price: 20000, quantity: 5 });
    expect(engine.cancelOrder('INFY', 1)).toBe(true);
    expect(engine.getBook('INFY').getBestBid()).toBeNull();
    expect(engine.getBook('TCS').getBestBid()).toBe(20000);
  });

  test('cancelOrder returns false for an unknown id in a known symbol', () => {
    const engine = new MatchingEngine(['INFY', 'TCS']);
    engine.addOrder({ symbol: 'TCS', id: 1, userId: 'bob', side: 'buy', price: 20000, quantity: 5 });
    expect(engine.cancelOrder('INFY', 1)).toBe(false);
  });

  test('OrderBook validation errors still come through', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() =>
      engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'buy', price: 100.5, quantity: 5 })
    ).toThrow('Price must be a positive integer in paise');
  });
});

describe('MatchingEngine: error types', () => {
  test('unknown symbols and bad orders throw ValidationError', () => {
    const engine = new MatchingEngine(['INFY']);
    expect(() => engine.getBook('WIPRO')).toThrow(ValidationError);
    expect(() =>
      engine.addOrder({ symbol: 'INFY', id: 1, userId: 'alice', side: 'buy', price: 100.5, quantity: 5 })
    ).toThrow(ValidationError);
  });
});
