const SerialQueue = require('../trading/SerialQueue');

// Resolves after ms milliseconds.
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SerialQueue', () => {
  test('returns each job\'s result', async () => {
    const queue = new SerialQueue();
    await expect(queue.run(async () => 42)).resolves.toBe(42);
  });

  test('never runs two jobs at the same time', async () => {
    const queue = new SerialQueue();
    let running = 0;
    let mostAtOnce = 0;

    async function job() {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await wait(5); // like waiting for the database
      running -= 1;
    }

    await Promise.all([queue.run(job), queue.run(job), queue.run(job), queue.run(job)]);
    expect(mostAtOnce).toBe(1);
  });

  test('runs jobs in the order they were added, even if later ones are faster', async () => {
    const queue = new SerialQueue();
    const finished = [];
    await Promise.all([
      queue.run(async () => {
        await wait(20);
        finished.push('slow');
      }),
      queue.run(async () => {
        finished.push('fast');
      }),
    ]);
    expect(finished).toEqual(['slow', 'fast']);
  });

  test('a failing job rejects its own promise and does not stop later jobs', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(async () => {
      throw new Error('boom');
    });
    const next = queue.run(async () => 'still runs');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still runs');
  });

  test('a job that throws synchronously is handled the same way', async () => {
    const queue = new SerialQueue();
    const failing = queue.run(() => {
      throw new Error('sync boom');
    });
    await expect(failing).rejects.toThrow('sync boom');
    await expect(queue.run(() => 'ok')).resolves.toBe('ok');
  });
});
