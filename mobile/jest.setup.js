/* Нативные модули в тестах заменяем заглушками. */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('react-native-ble-plx', () => ({
  BleManager: class {
    startDeviceScan() {}
    stopDeviceScan() {}
    destroy() {}
  },
}));

jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
