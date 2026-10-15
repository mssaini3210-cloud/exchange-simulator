// Thrown for every order and cancel after the engine and the database
// have disagreed. The API answers 503 until the server is restarted.
class TradingHaltedError extends Error {
  constructor() {
    super('Trading halted, restart required');
    this.name = 'TradingHaltedError';
  }
}

module.exports = TradingHaltedError;
