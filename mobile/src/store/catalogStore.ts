import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api } from '../api';
import { STORAGE_KEYS } from '../api/config';
import type { ArchiColor, PaletteQuery, Product } from '../api/types';

/**
 * Каталог: продукты (§5.2, 5.5) и палитра (§5.6).
 *
 * Палитра кэшируется в AsyncStorage последней выдачей — этого хватает,
 * чтобы экран открывался мгновенно и переживал короткую потерю сети.
 * Полный офлайн-кэш 800 000+ оттенков — открытый вопрос §9 ТЗ.
 */
interface CatalogState {
  products: Product[];
  productsLoading: boolean;
  colors: ArchiColor[];
  collections: string[];
  total: number;
  colorsLoading: boolean;
  error: string | null;

  loadProducts(): Promise<void>;
  searchColors(query: PaletteQuery): Promise<void>;
  hydratePaletteCache(): Promise<void>;
}

export const useCatalogStore = create<CatalogState>(set => ({
  products: [],
  productsLoading: false,
  colors: [],
  collections: [],
  total: 0,
  colorsLoading: false,
  error: null,

  async loadProducts() {
    set({ productsLoading: true, error: null });
    try {
      set({ products: await api.catalog.products() });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Не удалось загрузить товары',
      });
    } finally {
      set({ productsLoading: false });
    }
  },

  async searchColors(query) {
    set({ colorsLoading: true, error: null });
    try {
      const result = await api.palette.search(query);
      set({
        colors: result.items,
        collections: result.collections,
        total: result.total,
      });
      await AsyncStorage.setItem(
        STORAGE_KEYS.palette,
        JSON.stringify({ items: result.items, collections: result.collections }),
      );
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Не удалось загрузить палитру',
      });
    } finally {
      set({ colorsLoading: false });
    }
  },

  async hydratePaletteCache() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.palette);
      if (raw) {
        const cached = JSON.parse(raw) as {
          items: ArchiColor[];
          collections: string[];
        };
        set({ colors: cached.items, collections: cached.collections });
      }
    } catch {
      // кэш не обязателен
    }
  },
}));
