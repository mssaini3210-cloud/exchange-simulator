const express = require('express');
const requireAuth = require('../auth/requireAuth');
const { getAccount } = require('../db/users');

// The logged-in user's own account. Needs a token.
function createMeRouter(pool) {
  const router = express.Router();

  router.get('/', requireAuth, async (req, res) => {
    const account = await getAccount(pool, req.userId);
    if (account === null) {
      // A correctly signed token for a user that doesn't exist (any more).
      res.status(401).json({ error: 'User not found' });
      return;
    }
    res.json(account);
  });

  return router;
}

module.exports = createMeRouter;
