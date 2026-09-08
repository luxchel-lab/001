import type { Lab, Rgb } from '../../api/types';

export interface ColorimeterDevice {
  id: string;
  name: string;
  rssi?: number;
}

export interface ColorimeterReading {
  /** ISO-время измерения. */
  at: string;
  hex: string;
  rgb?: Rgb;
  lab?: Lab;
  /** Сырой кадр из характеристики — пригодится при отладке протокола. */
  raw?: string;
}

export type BleConnectionState =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface BleStatus {
  state: BleConnectionState;
  device?: ColorimeterDevice;
  error?: string;
}

/**
 * Контракт колориметра (§6.2 ТЗ).
 *
 * Протокол конкретной модели — заменяемая деталь: экраны работают только
 * с этим интерфейсом, поэтому переход с заглушки на реальное устройство
 * не задевает UI.
 */
export interface BleColorimeterService {
  /** true — заглушка с тестовыми значениями. */
  readonly isMock: boolean;
  /** Запросить разрешения ОС (Android 12+ требует BLUETOOTH_SCAN/CONNECT). */
  ensurePermissions(): Promise<boolean>;
  scan(onDevice: (device: ColorimeterDevice) => void): Promise<void>;
  stopScan(): void;
  connect(deviceId: string): Promise<ColorimeterDevice>;
  disconnect(): Promise<void>;
  /** Команда «сделать замер», если модель её поддерживает. */
  requestMeasurement(): Promise<void>;
  onReading(listener: (reading: ColorimeterReading) => void): () => void;
  onStatus(listener: (status: BleStatus) => void): () => void;
  getStatus(): BleStatus;
  destroy(): void;
}
