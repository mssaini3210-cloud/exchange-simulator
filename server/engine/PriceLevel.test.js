const PriceLevel = require('./PriceLevel');

function makeOrder(id, remaining) {
  return { id: id, side: 'buy', price: 10000, quantity: remaining, remaining: remaining };
}

function ids(level) {
  return level.toArray().map((order) => order.id);
}

describe('PriceLevel', () => {
  test('starts empty', () => {
    const level = new PriceLevel(10000);
    expect(level.price).toBe(10000);
    expect(level.isEmpty()).toBe(true);
    expect(level.size).toBe(0);
    expect(level.totalQuantity).toBe(0);
    expect(level.peek()).toBeNull();
    expect(level.shift()).toBeNull();
  });

  test('append keeps orders in arrival order', () => {
    const level = new PriceLevel(10000);
    level.append(makeOrder('a', 5));
    level.append(makeOrder('b', 3));
    level.append(makeOrder('c', 2));
    expect(ids(level)).toEqual(['a', 'b', 'c']);
    expect(level.size).toBe(3);
    expect(level.totalQuantity).toBe(10);
  });

  test('peek returns the oldest order without removing it', () => {
    const level = new PriceLevel(10000);
    level.append(makeOrder('a', 5));
    level.append(makeOrder('b', 3));
    expect(level.peek().id).toBe('a');
    expect(level.size).toBe(2);
  });

  test('shift removes the oldest order first (FIFO)', () => {
    const level = new PriceLevel(10000);
    level.append(makeOrder('a', 5));
    level.append(makeOrder('b', 3));
    expect(level.shift().id).toBe('a');
    expect(level.shift().id).toBe('b');
    expect(level.isEmpty()).toBe(true);
    expect(level.totalQuantity).toBe(0);
  });

  test('remove from the middle keeps the others in order', () => {
    const level = new PriceLevel(10000);
    level.append(makeOrder('a', 5));
    const middle = level.append(makeOrder('b', 3));
    level.append(makeOrder('c', 2));
    level.remove(middle);
    expect(ids(level)).toEqual(['a', 'c']);
    expect(level.size).toBe(2);
    expect(level.totalQuantity).toBe(7);
  });

  test('remove the head and the tail', () => {
    const level = new PriceLevel(10000);
    const first = level.append(makeOrder('a', 5));
    level.append(makeOrder('b', 3));
    const last = level.append(makeOrder('c', 2));
    level.remove(first);
    expect(ids(level)).toEqual(['b', 'c']);
    level.remove(last);
    expect(ids(level)).toEqual(['b']);
    expect(level.peek().id).toBe('b');
  });

  test('remove the only order leaves the level empty', () => {
    const level = new PriceLevel(10000);
    const only = level.append(makeOrder('a', 5));
    level.remove(only);
    expect(level.isEmpty()).toBe(true);
    expect(level.peek()).toBeNull();
    expect(ids(level)).toEqual([]);
  });

  test('append works again after the level was emptied', () => {
    const level = new PriceLevel(10000);
    level.append(makeOrder('a', 5));
    level.shift();
    level.append(makeOrder('b', 3));
    expect(ids(level)).toEqual(['b']);
    expect(level.totalQuantity).toBe(3);
  });

  test('reduceQuantity lowers the total after a partial fill', () => {
    const level = new PriceLevel(10000);
    const order = makeOrder('a', 5);
    level.append(order);
    order.remaining -= 2;
    level.reduceQuantity(2);
    expect(level.totalQuantity).toBe(3);
  });
});
