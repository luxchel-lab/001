import { USE_MOCKS } from './config';
import { httpApi } from './httpApi';
import { mockApi } from './mockApi';
import type { ApiClient } from './ApiClient';

/**
 * Точка входа в бэкенд. Источник выбирается переменной окружения
 * ARCHIPAINT_USE_MOCKS (см. src/api/config.ts) — экраны об этом не знают.
 */
export const api: ApiClient = USE_MOCKS ? mockApi : httpApi;

export { USE_MOCKS, API_BASE_URL } from './config';
export { ApiError, setAuthToken, setUnauthorizedHandler } from './client';
export * from './types';
export type { ApiClient } from './ApiClient';
