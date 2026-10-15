const express = require('express');
const bcrypt = require('bcrypt');
const ValidationError = require('../engine/ValidationError');
const { createUser } = require('../db/users');

const BCRYPT_ROUNDS = 10;
const UNIQUE_VIOLATION = '23505'; // pg error code

function createAuthRouter(pool) {
  const router = express.Router();

  router.post('/signup', async (req, res) => {
    const body = req.body || {};
    validateUsername(body.username);
    validatePassword(body.password);

    const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    try {
      const user = await createUser(pool, body.username, passwordHash);
      res.status(201).json({ id: user.id, username: user.username });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }
      throw err;
    }
  });

  return router;
}

function validateUsername(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    throw new ValidationError('Username must be 3 to 30 letters, digits or underscores');
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters');
  }
  // bcrypt ignores everything after 72 bytes, so a longer password would
  // only look stronger than it is.
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new ValidationError('Password must be at most 72 bytes');
  }
}

module.exports = createAuthRouter;
