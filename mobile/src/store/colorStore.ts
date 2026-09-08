import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { STORAGE_KEYS } from '../api/config';
import type { ArchiColor } from '../api/types';
import type { ColorimeterReading } from '../services/ble';

/**
 * Сохранённые цвета (§5.8) и история измерений колориметра (§5.4).
 *
 * История живёт в рамках сессии — так написано в ТЗ; сохранённые цвета
 * переживают перезапуск и лежат в AsyncStorage.
 */
export interface MeasurementEntry {
  reading: ColorimeterReading;
  match?: { code: string; name: string; hex: string; deltaE: number };
}

interface ColorState {
  saved: ArchiColor[];
  measurements: MeasurementEntry[];
  hydrated: boolean;

  hydrate(): Promise<void>;
  toggleSaved(color: ArchiColor): Promise<void>;
  isSaved(code: string): boolean;
  addMeasurement(entry: MeasurementEntry): void;
  clearMeasurements(): void;
}

const MEASUREMENT_LIMIT = 20;

export const useColorStore = create<ColorState>((set, get) => ({
  saved: [],
  measurements: [],
  hydrated: false,

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.savedColors);
      if (raw) {
        set({ saved: JSON.parse(raw) as ArchiColor[] });
      }
    } catch {
      // кэш повреждён — начинаем с пустого списка
    } finally {
      set({ hydrated: true });
    }
  },

  async toggleSaved(color) {
    const exists = get().saved.some(c => c.code === color.code);
    const saved = exists
      ? get().saved.filter(c => c.code !== color.code)
      : [color, ...get().saved];
    set({ saved });
    await AsyncStorage.setItem(STORAGE_KEYS.savedColors, JSON.stringify(saved));
  },

  isSaved(code) {
    return get().saved.some(c => c.code === code);
  },

  addMeasurement(entry) {
    set({
      measurements: [entry, ...get().measurements].slice(0, MEASUREMENT_LIMIT),
    });
  },

  clearMeasurements() {
    set({ measurements: [] });
  },
}));
