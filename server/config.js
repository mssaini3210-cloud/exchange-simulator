// Settings shared by the API, signup and tests.

const SYMBOLS = ['INFY', 'TCS', 'RELIANCE'];

const STARTING_CASH = 100000000; // ₹10,00,000 in paise
const STARTING_SHARES = 100; // of each symbol

// Read when needed, so the app never runs with a missing secret.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

module.exports = { SYMBOLS, STARTING_CASH, STARTING_SHARES, getJwtSecret };
