module.exports = {
  // Load .env before any test file runs.
  setupFiles: ['<rootDir>/test/setupEnv.js'],
  // Run test files one at a time: database tests reset the same test
  // database, and two files doing that at once would break each other.
  maxWorkers: 1,
};
