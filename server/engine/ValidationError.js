// Thrown when the engine is given bad input (a float price, an unknown
// symbol, a missing user id...). Callers can tell it apart from a real
// bug with `err instanceof ValidationError`.
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

module.exports = ValidationError;
