import { create } from 'zustand';
import { api } from '../api';
import type { AddToCartRequest, Cart, Order } from '../api/types';

/** Корзина и заказ (§5.7 ТЗ) — зеркалит сценарий сайта, логика на бэкенде. */
interface CartState {
  cart: Cart;
  loading: boolean;
  error: string | null;
  lastOrder: Order | null;

  refresh(): Promise<void>;
  add(req: AddToCartRequest): Promise<boolean>;
  setQuantity(itemId: string, quantity: number): Promise<void>;
  remove(itemId: string): Promise<void>;
  clear(): Promise<void>;
  setLastOrder(order: Order | null): void;
  clearError(): void;
}

const EMPTY: Cart = { items: [], total: 0 };

export const useCartStore = create<CartState>(set => ({
  cart: EMPTY,
  loading: false,
  error: null,
  lastOrder: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      set({ cart: await api.cart.get() });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка корзины' });
    } finally {
      set({ loading: false });
    }
  },

  async add(req) {
    set({ loading: true, error: null });
    try {
      set({ cart: await api.cart.add(req) });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка корзины' });
      return false;
    } finally {
      set({ loading: false });
    }
  },

  async setQuantity(itemId, quantity) {
    try {
      set({ cart: await api.cart.update({ itemId, quantity }) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка корзины' });
    }
  },

  async remove(itemId) {
    try {
      set({ cart: await api.cart.remove(itemId) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка корзины' });
    }
  },

  async clear() {
    try {
      set({ cart: await api.cart.clear() });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Ошибка корзины' });
    }
  },

  setLastOrder(order) {
    set({ lastOrder: order });
  },

  clearError() {
    set({ error: null });
  },
}));

export const selectCartCount = (s: CartState) =>
  s.cart.items.reduce((sum, i) => sum + i.quantity, 0);
