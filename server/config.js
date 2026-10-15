// Settings shared by the API, signup and tests.

const SYMBOLS = ['INFY', 'TCS', 'RELIANCE'];

const STARTING_CASH = 100000000; // ₹10,00,000 in paise
const STARTING_SHARES = 100; // of each symbol

// Upper limits, so price × quantity (about 10^15 at most) always stays
// well inside the range JavaScript numbers can hold exactly (2^53).
const MAX_PRICE = 1000000000; // ₹1,00,00,000 in paise
const MAX_QUANTITY = 1000000;

// Read when needed, so the app never runs with a missing secret.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

module.exports = { SYMBOLS, STARTING_CASH, STARTING_SHARES, MAX_PRICE, MAX_QUANTITY, getJwtSecret };
