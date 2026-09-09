import axios, { AxiosError, AxiosInstance } from 'axios';
import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config';
import type { ApiErrorShape } from './types';

/**
 * Единый HTTP-клиент с интерцептором авторизации.
 *
 * Токен кладётся сюда из authStore, чтобы api-слой не зависел от стора,
 * а стор — от axios. TBD: если бэкенд использует сессионную куку вместо
 * заголовка, меняется только setAuthToken/интерцептор.
 */

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error implements ApiErrorShape {
  status: number;
  code?: string;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.status = shape.status;
    this.code = shape.code;
  }
}

function toApiError(error: unknown): ApiError {
  const axiosError = error as AxiosError<{ message?: string; code?: string }>;
  if (axiosError?.isAxiosError) {
    if (!axiosError.response) {
      return new ApiError({
        status: 0,
        code: 'network',
        message: 'Нет связи с сервером. Проверьте интернет и попробуйте снова.',
      });
    }
    return new ApiError({
      status: axiosError.response.status,
      code: axiosError.response.data?.code,
      message:
        axiosError.response.data?.message ||
        `Сервер вернул ошибку ${axiosError.response.status}`,
    });
  }
  return new ApiError({
    status: 0,
    message: error instanceof Error ? error.message : 'Неизвестная ошибка',
  });
}

export const http: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

http.interceptors.request.use(config => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

http.interceptors.response.use(
  response => response,
  error => {
    const apiError = toApiError(error);
    if (apiError.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(apiError);
  },
);
