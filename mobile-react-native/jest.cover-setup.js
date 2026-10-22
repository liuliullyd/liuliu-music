const { NativeModules } = require('react-native');

// Ordinary component tests simulate the independent native decode boundary.
// The artwork contract suite replaces load with controlled unresolved requests.
NativeModules.LiuliuCover = {
  load: jest.fn(async uri => ({ uri, width: 256, height: 256 })),
  cancel: jest.fn(),
};
