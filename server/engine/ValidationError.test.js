const ValidationError = require('./ValidationError');

describe('ValidationError', () => {
  test('is an Error with its own name and the given message', () => {
    const err = new ValidationError('Price must be a positive integer in paise');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('Price must be a positive integer in paise');
  });

  test('a plain Error is not a ValidationError', () => {
    expect(new Error('boom')).not.toBeInstanceOf(ValidationError);
  });
});
