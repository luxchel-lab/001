/**
 * Переключение мок/боевой бэкенд одной переменной окружения (§4 ТЗ).
 *
 *   ARCHIPAINT_USE_MOCKS=0 ARCHIPAINT_API_BASE_URL=https://archipaint.ru npm run android
 *
 * Значения подставляются на этапе сборки babel-плагином
 * transform-inline-environment-variables (см. babel.config.js).
 */

const env = process.env;

/** Адрес бэкенда archipaint.ru. */
export const API_BASE_URL: string =
  env.ARCHIPAINT_API_BASE_URL || 'http://10.0.2.2:4000';

/**
 * true — запросы обслуживает встроенный мок-адаптер (без сети вообще),
 * false — идём в реальный/локальный HTTP-бэкенд по API_BASE_URL.
 *
 * Мок-сервер (mock-server/index.js) — промежуточный вариант: USE_MOCKS=0
 * плюс API_BASE_URL, указывающий на него, даёт тот же контракт по HTTP.
 */
export const USE_MOCKS: boolean = env.ARCHIPAINT_USE_MOCKS !== '0';

export const REQUEST_TIMEOUT_MS = 20000;

/** Ключи AsyncStorage. */
export const STORAGE_KEYS = {
  auth: 'archipaint.auth',
  palette: 'archipaint.palette.cache',
  savedColors: 'archipaint.colors.saved',
  cart: 'archipaint.cart',
} as const;
