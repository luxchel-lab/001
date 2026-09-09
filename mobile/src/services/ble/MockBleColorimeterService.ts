import type {
  BleColorimeterService,
  BleStatus,
  ColorimeterDevice,
  ColorimeterReading,
} from './types';
import { rgbToHex, rgbToLab } from '../color';
import { ARCHI_PALETTE } from '../../data/palette';
import type { Lab, Rgb } from '../../api/types';

/**
 * Заглушка колориметра (§6.2, §8.4 ТЗ).
 *
 * Возвращает оттенки из каталога с небольшим шумом — как если бы прибор
 * измерил выкраску. Позволяет разрабатывать экран, сопоставление с палитрой
 * и историю измерений до получения документации на реальную модель.
 */
const MOCK_DEVICES: ColorimeterDevice[] = [
  { id: 'mock-colorimeter-1', name: 'ARCHI Colorimeter (демо)', rssi: -46 },
  { id: 'mock-colorimeter-2', name: 'ARCHI Spectro (демо)', rssi: -71 },
];

function noisyReading(): ColorimeterReading {
  const base = ARCHI_PALETTE[Math.floor(Math.random() * ARCHI_PALETTE.length)];
  const noise = () => Math.round((Math.random() - 0.5) * 10);
  const rgb = base.rgb.map(v => Math.min(255, Math.max(0, v + noise()))) as Rgb;
  const lab = rgbToLab(rgb).map(v => Math.round(v * 100) / 100) as Lab;

  return {
    at: new Date().toISOString(),
    hex: rgbToHex(rgb),
    rgb,
    lab,
    raw: `mock:${base.code}`,
  };
}

export class MockBleColorimeterService implements BleColorimeterService {
  readonly isMock = true;

  private status: BleStatus = { state: 'idle' };
  private readingListeners = new Set<(r: ColorimeterReading) => void>();
  private statusListeners = new Set<(s: BleStatus) => void>();
  private scanTimers: ReturnType<typeof setTimeout>[] = [];

  async ensurePermissions(): Promise<boolean> {
    return true;
  }

  async scan(onDevice: (device: ColorimeterDevice) => void): Promise<void> {
    this.setStatus({ state: 'scanning' });
    this.scanTimers = MOCK_DEVICES.map((device, index) =>
      setTimeout(() => onDevice(device), 400 * (index + 1)),
    );
  }

  stopScan(): void {
    this.scanTimers.forEach(clearTimeout);
    this.scanTimers = [];
    if (this.status.state === 'scanning') {
      this.setStatus({ state: 'idle' });
    }
  }

  async connect(deviceId: string): Promise<ColorimeterDevice> {
    this.stopScan();
    const device = MOCK_DEVICES.find(d => d.id === deviceId) ?? MOCK_DEVICES[0];
    this.setStatus({ state: 'connecting', device });
    await new Promise<void>(resolve => setTimeout(() => resolve(), 700));
    this.setStatus({ state: 'connected', device });
    return device;
  }

  async disconnect(): Promise<void> {
    this.setStatus({ state: 'disconnected', device: this.status.device });
  }

  async requestMeasurement(): Promise<void> {
    if (this.status.state !== 'connected') {
      throw new Error('Колориметр не подключён');
    }
    await new Promise<void>(resolve => setTimeout(() => resolve(), 900));
    const reading = noisyReading();
    this.readingListeners.forEach(l => l(reading));
  }

  onReading(listener: (reading: ColorimeterReading) => void): () => void {
    this.readingListeners.add(listener);
    return () => {
      this.readingListeners.delete(listener);
    };
  }

  onStatus(listener: (status: BleStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): BleStatus {
    return this.status;
  }

  destroy(): void {
    this.stopScan();
    this.readingListeners.clear();
    this.statusListeners.clear();
  }

  private setStatus(status: BleStatus): void {
    this.status = status;
    this.statusListeners.forEach(l => l(status));
  }
}
