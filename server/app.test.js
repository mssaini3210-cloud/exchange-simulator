const request = require('supertest');
const createApp = require('./app');

describe('x-user-id header', () => {
  test('a request without it is rejected with 401', async () => {
    const res = await request(createApp()).get('/symbols');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Missing x-user-id header' });
  });

  test('an empty header is rejected with 401', async () => {
    const res = await request(createApp()).get('/symbols').set('x-user-id', '  ');
    expect(res.status).toBe(401);
  });
});

describe('GET /symbols', () => {
  test('lists the three symbols', async () => {
    const res = await request(createApp()).get('/symbols').set('x-user-id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ symbols: ['INFY', 'TCS', 'RELIANCE'] });
  });
});

describe('unknown routes', () => {
  test('return 404 as JSON', async () => {
    const res = await request(createApp()).get('/nope').set('x-user-id', 'alice');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
