const express = require('express');
const MatchingEngine = require('./engine/MatchingEngine');
const ValidationError = require('./engine/ValidationError');

const SYMBOLS = ['INFY', 'TCS', 'RELIANCE'];

// Builds a new app with its own engine and in-memory state.
// Tests call this once per test so they never share state.
function createApp() {
  const engine = new MatchingEngine(SYMBOLS);
  const app = express();

  app.use(express.json());
  app.use(requireUser);

  app.get('/symbols', (req, res) => {
    res.json({ symbols: engine.getSymbols() });
  });

  // No route matched.
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(handleError);

  return app;
}

// Until there is real auth, the user is whoever the x-user-id header says.
function requireUser(req, res, next) {
  const userId = req.get('x-user-id');
  if (userId === undefined || userId.trim() === '') {
    res.status(401).json({ error: 'Missing x-user-id header' });
    return;
  }
  req.userId = userId;
  next();
}

// Express calls this when a route throws. Bad input becomes a 400 with
// the engine's message. Anything else is a bug: log it, and send a
// generic 500 so internal details never reach the client.
function handleError(err, req, res, next) {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body is not valid JSON' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = createApp;
