// Runs async jobs strictly one at a time, in the order they were added.
//
// Node runs one piece of JavaScript at a time, but a request that awaits
// the database pauses, and another request can run in the gap. Putting
// every order placement and cancel through this queue means one job's
// "read balance ... write balance" can never be interleaved with
// another's.
class SerialQueue {
  constructor() {
    this.tail = Promise.resolve(); // the end of the chain of jobs
  }

  // Adds fn to the queue. Returns a promise for fn's result (or error).
  run(fn) {
    const result = this.tail.then(() => fn());
    // The next job waits for this one, whether it succeeded or failed.
    this.tail = result.catch(() => {});
    return result;
  }
}

module.exports = SerialQueue;
