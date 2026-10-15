const formatIST = require('./formatIST');

describe('formatIST', () => {
  test('shows UTC + 5:30 in a readable format', () => {
    expect(formatIST(new Date('2026-10-15T05:10:12.345Z'))).toBe('15 Oct 2026, 10:40:12 am');
  });

  test('afternoon times use pm', () => {
    expect(formatIST(new Date('2026-10-15T09:00:00Z'))).toBe('15 Oct 2026, 2:30:00 pm');
  });

  test('IST midnight is 12 am on the next day', () => {
    expect(formatIST(new Date('2026-10-04T18:30:00Z'))).toBe('5 Oct 2026, 12:00:00 am');
  });

  test('IST noon is 12 pm', () => {
    expect(formatIST(new Date('2026-10-15T06:30:05Z'))).toBe('15 Oct 2026, 12:00:05 pm');
  });

  test('can roll over into the next year', () => {
    expect(formatIST(new Date('2026-12-31T20:00:00Z'))).toBe('1 Jan 2027, 1:30:00 am');
  });
});
