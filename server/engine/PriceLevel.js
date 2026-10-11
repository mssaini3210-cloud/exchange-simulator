// All resting orders at one price, oldest first.
// A doubly linked list, so adding, taking the oldest, and removing
// any order (when we hold its node) are all O(1).
class PriceLevel {
  constructor(price) {
    this.price = price;
    this.head = null; // oldest order
    this.tail = null; // newest order
    this.size = 0;
    this.totalQuantity = 0; // sum of remaining quantity of all orders here
  }

  // Add an order at the back of the queue. Returns its node so the
  // caller can remove it later without searching.
  append(order) {
    const node = { order: order, prev: this.tail, next: null };
    if (this.tail === null) {
      this.head = node;
    } else {
      this.tail.next = node;
    }
    this.tail = node;
    this.size += 1;
    this.totalQuantity += order.remaining;
    return node;
  }

  // The oldest order, or null if the level is empty.
  peek() {
    if (this.head === null) {
      return null;
    }
    return this.head.order;
  }

  // Remove and return the oldest order, or null if the level is empty.
  shift() {
    if (this.head === null) {
      return null;
    }
    const order = this.head.order;
    this.remove(this.head);
    return order;
  }

  // Unlink a node from anywhere in the list.
  remove(node) {
    if (node.prev === null) {
      this.head = node.next;
    } else {
      node.prev.next = node.next;
    }
    if (node.next === null) {
      this.tail = node.prev;
    } else {
      node.next.prev = node.prev;
    }
    node.prev = null;
    node.next = null;
    this.size -= 1;
    this.totalQuantity -= node.order.remaining;
  }

  // Call this when an order at this level is partly filled, so
  // totalQuantity stays correct.
  reduceQuantity(amount) {
    this.totalQuantity -= amount;
  }

  isEmpty() {
    return this.size === 0;
  }

  // Orders from oldest to newest. Useful for tests and debugging.
  toArray() {
    const orders = [];
    let node = this.head;
    while (node !== null) {
      orders.push(node.order);
      node = node.next;
    }
    return orders;
  }
}

module.exports = PriceLevel;
