const express = require('express');
const bcrypt = require('bcrypt');
const ValidationError = require('../engine/ValidationError');
const { createUser, findUserByUsername } = require('../db/users');
const { createToken } = require('../auth/tokens');

const BCRYPT_ROUNDS = 10;
const UNIQUE_VIOLATION = '23505'; // pg error code

// Compared against when the username doesn't exist, so a wrong username
// takes as long as a wrong password. Otherwise the response time would
// tell an attacker which usernames are real.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

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

  router.post('/login', async (req, res) => {
    const body = req.body || {};
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw new ValidationError('Username and password are required');
    }

    const user = await findUserByUsername(pool, body.username);
    const hash = user === null ? DUMMY_HASH : user.password_hash;
    const passwordMatches = await bcrypt.compare(body.password, hash);
    if (user === null || !passwordMatches) {
      // Same answer for both, so login can't be used to find usernames.
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    res.json({ token: createToken(user.id) });
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
