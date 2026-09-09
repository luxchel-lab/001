module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Пакеты навигации и BLE публикуются как ESM — их нужно прогнать через babel.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@react-navigation|react-native-ble-plx|react-native-image-picker|react-native-screens|react-native-safe-area-context|@react-native-async-storage)/)',
  ],
};
