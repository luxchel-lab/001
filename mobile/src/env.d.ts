/**
 * Переменные окружения приложения (подставляются babel-плагином, см. babel.config.js).
 */
declare namespace NodeJS {
  interface ProcessEnv {
    /** Адрес бэкенда archipaint.ru. */
    ARCHIPAINT_API_BASE_URL?: string;
    /** '0' — ходить в реальный бэкенд, иначе работают моки. */
    ARCHIPAINT_USE_MOCKS?: string;
    /** '1' — использовать реальный BLE-протокол вместо заглушки. */
    ARCHIPAINT_REAL_BLE?: string;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
};
