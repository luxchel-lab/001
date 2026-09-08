import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api, setAuthToken, setUnauthorizedHandler } from '../api';
import { STORAGE_KEYS } from '../api/config';
import type { AuthUser } from '../api/types';

/**
 * Сессия пользователя (§5.1 ТЗ). Аккаунт общий с сайтом archipaint.ru.
 * Без авторизации доступны палитра и калькулятор, заказ и колориметр — нет.
 */
interface AuthState {
  user: AuthUser | null;
  token: string | null;
  hydrated: boolean;
  loading: boolean;
  error: string | null;
  /** Пользователь осознанно пропустил вход. */
  skipped: boolean;

  hydrate(): Promise<void>;
  requestOtp(login: string): Promise<boolean>;
  login(login: string, otp: string): Promise<boolean>;
  logout(): Promise<void>;
  skipAuth(): void;
  clearError(): void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  hydrated: false,
  loading: false,
  error: null,
  skipped: false,

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.auth);
      if (raw) {
        const saved = JSON.parse(raw) as { token: string; user: AuthUser };
        setAuthToken(saved.token);
        set({ token: saved.token, user: saved.user });
      }
    } catch {
      // повреждённый кэш сессии — просто просим войти заново
    } finally {
      set({ hydrated: true });
    }

    setUnauthorizedHandler(() => {
      get().logout();
    });
  },

  async requestOtp(login: string) {
    set({ loading: true, error: null });
    try {
      await api.auth.requestOtp({ login });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка входа' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async login(login: string, otp: string) {
    set({ loading: true, error: null });
    try {
      const result = await api.auth.login({ login, otp });
      setAuthToken(result.token);
      await AsyncStorage.setItem(
        STORAGE_KEYS.auth,
        JSON.stringify({ token: result.token, user: result.user }),
      );
      set({ token: result.token, user: result.user, skipped: false });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка входа' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    try {
      await api.auth.logout();
    } catch {
      // выходим локально, даже если сервер недоступен
    }
    setAuthToken(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.auth);
    set({ user: null, token: null, skipped: false });
  },

  skipAuth() {
    set({ skipped: true });
  },

  clearError() {
    set({ error: null });
  },
}));

export const selectIsAuthorized = (s: AuthState) => Boolean(s.token && s.user);
