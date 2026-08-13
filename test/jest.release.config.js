const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: [
    '<rootDir>/test/release-versioning.test.js',
    '<rootDir>/test/release-validator.test.js',
  ],
  testPathIgnorePatterns: ['<rootDir>/test/node_modules/'],
};
