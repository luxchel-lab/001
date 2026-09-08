/**
 * Переменные окружения подставляются в бандл на этапе сборки,
 * поэтому переключение мок/бэкенд делается одной переменной (§4 ТЗ):
 *
 *   ARCHIPAINT_USE_MOCKS=0 ARCHIPAINT_API_BASE_URL=https://archipaint.ru \
 *     npm run android
 */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'transform-inline-environment-variables',
      {
        include: [
          'ARCHIPAINT_API_BASE_URL',
          'ARCHIPAINT_USE_MOCKS',
          'ARCHIPAINT_REAL_BLE',
        ],
      },
    ],
  ],
};
