const { verifyToken } = require('./tokens');

// Lets the request through only with a valid "Authorization: Bearer <token>"
// header, and sets req.userId from the token.
function requireAuth(req, res, next) {
  const header = req.get('Authorization');
  if (header === undefined) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }
  const match = /^Bearer (\S+)$/.exec(header);
  if (match === null) {
    res.status(401).json({ error: 'Authorization header must be "Bearer <token>"' });
    return;
  }
  try {
    req.userId = verifyToken(match[1]);
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  next();
}

module.exports = requireAuth;
