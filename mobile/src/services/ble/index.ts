import { MockBleColorimeterService } from './MockBleColorimeterService';
import { RealBleColorimeterService } from './RealBleColorimeterService';
import type { BleColorimeterService } from './types';

/**
 * Пока нет документации на модель колориметра, приложение работает
 * с заглушкой (§8.4 ТЗ). Переключение — переменной окружения:
 *
 *   ARCHIPAINT_REAL_BLE=1 npm run android
 */
const useRealBle = process.env.ARCHIPAINT_REAL_BLE === '1';

let instance: BleColorimeterService | null = null;

export function getBleColorimeterService(): BleColorimeterService {
  if (!instance) {
    instance = useRealBle
      ? new RealBleColorimeterService()
      : new MockBleColorimeterService();
  }
  return instance;
}

/** Нужно тестам и горячей перезагрузке. */
export function resetBleColorimeterService(): void {
  instance?.destroy();
  instance = null;
}

export * from './types';
export { COLORIMETER_PROTOCOL, parseReading } from './protocol';
