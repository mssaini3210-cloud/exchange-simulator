const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('../config');

const TOKEN_LIFETIME = '1d';

// A signed token that says "this is user <userId>", valid for 1 day.
function createToken(userId) {
  return jwt.sign({ sub: String(userId) }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: TOKEN_LIFETIME,
  });
}

// Returns the user id inside a token. Throws if the token is malformed,
// was signed with a different secret, was changed, or has expired.
function verifyToken(token) {
  // Only accept HS256, so nobody can send a token that claims a weaker
  // algorithm (such as "none").
  const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  const userId = Number(payload.sub);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('Token has no valid user id');
  }
  return userId;
}

module.exports = { createToken, verifyToken };
