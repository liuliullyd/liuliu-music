module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.cover-setup.js'],
  cacheDirectory: '<rootDir>/.verify/jest-cache',
};
