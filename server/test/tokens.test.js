const jwt = require('jsonwebtoken');
const { createToken, verifyToken } = require('../auth/tokens');

const SECRET = process.env.JWT_SECRET;

describe('createToken and verifyToken', () => {
  test('a token gives back the same user id', () => {
    expect(verifyToken(createToken(42))).toBe(42);
  });

  test('a token lasts exactly 1 day', () => {
    const payload = jwt.decode(createToken(42));
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  test('an expired token is rejected', () => {
    const expired = jwt.sign({ sub: '42', exp: Math.floor(Date.now() / 1000) - 10 }, SECRET);
    expect(() => verifyToken(expired)).toThrow('jwt expired');
  });

  test('a token signed with a different secret is rejected', () => {
    const forged = jwt.sign({ sub: '42' }, 'some-other-secret', { expiresIn: '1d' });
    expect(() => verifyToken(forged)).toThrow('invalid signature');
  });

  test('a token whose payload was changed is rejected', () => {
    const [header, , signature] = createToken(42).split('.');
    const fakePayload = Buffer.from(JSON.stringify({ sub: '1', exp: 9999999999 })).toString('base64url');
    expect(() => verifyToken(header + '.' + fakePayload + '.' + signature)).toThrow('invalid signature');
  });

  test('an unsigned token (alg "none") is rejected', () => {
    const unsigned = jwt.sign({ sub: '42' }, null, { algorithm: 'none' });
    expect(() => verifyToken(unsigned)).toThrow();
  });

  test('a token without a valid user id is rejected', () => {
    const noUser = jwt.sign({ sub: 'alice' }, SECRET, { expiresIn: '1d' });
    expect(() => verifyToken(noUser)).toThrow('Token has no valid user id');
  });

  test('garbage is rejected', () => {
    expect(() => verifyToken('not.a.token')).toThrow();
  });
});
