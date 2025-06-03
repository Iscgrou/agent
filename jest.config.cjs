module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/sandbox-manager.test.js'],
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  clearMocks: true,
  resetMocks: true,
  verbose: true
};
