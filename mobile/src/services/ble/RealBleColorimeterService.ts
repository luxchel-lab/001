import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import type {
  BleColorimeterService,
  BleStatus,
  ColorimeterDevice,
  ColorimeterReading,
} from './types';
import { COLORIMETER_PROTOCOL, parseReading } from './protocol';

/**
 * Реальный колориметр поверх react-native-ble-plx (§5.4, §6.2 ТЗ).
 *
 * Работает целиком через COLORIMETER_PROTOCOL: UUID и разбор кадра вынесены
 * в protocol.ts, поэтому при получении документации на модель правится
 * только он. До этого сервис нельзя считать проверенным — по умолчанию
 * приложение использует MockBleColorimeterService (см. index.ts).
 */
export class RealBleColorimeterService implements BleColorimeterService {
  readonly isMock = false;

  private manager = new BleManager();
  private status: BleStatus = { state: 'idle' };
  private device: Device | null = null;
  private monitor: Subscription | null = null;
  private readingListeners = new Set<(r: ColorimeterReading) => void>();
  private statusListeners = new Set<(s: BleStatus) => void>();

  async ensurePermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return true; // iOS спрашивает разрешение сам при первом сканировании
    }
    const api = Number(Platform.Version);
    const permissions =
      api >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every(
      p => result[p] === PermissionsAndroid.RESULTS.GRANTED,
    );
  }

  async scan(onDevice: (device: ColorimeterDevice) => void): Promise<void> {
    const granted = await this.ensurePermissions();
    if (!granted) {
      this.setStatus({
        state: 'error',
        error: 'Нет разрешения на Bluetooth. Выдайте его в настройках.',
      });
      return;
    }

    this.setStatus({ state: 'scanning' });
    this.manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        this.setStatus({ state: 'error', error: error.message });
        return;
      }
      if (!device) {
        return;
      }
      const name = device.name ?? device.localName ?? '';
      const matchesName = name
        .toUpperCase()
        .includes(COLORIMETER_PROTOCOL.nameFilter);
      const matchesService = device.serviceUUIDs?.some(
        uuid =>
          uuid.toLowerCase() === COLORIMETER_PROTOCOL.serviceUuid.toLowerCase(),
      );
      if (!matchesName && !matchesService) {
        return;
      }
      onDevice({ id: device.id, name: name || device.id, rssi: device.rssi ?? undefined });
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
    if (this.status.state === 'scanning') {
      this.setStatus({ state: 'idle' });
    }
  }

  async connect(deviceId: string): Promise<ColorimeterDevice> {
    this.stopScan();
    this.setStatus({ state: 'connecting' });
    try {
      const device = await this.manager.connectToDevice(deviceId);
      await device.discoverAllServicesAndCharacteristics();
      this.device = device;

      this.monitor = device.monitorCharacteristicForService(
        COLORIMETER_PROTOCOL.serviceUuid,
        COLORIMETER_PROTOCOL.measurementCharacteristicUuid,
        (error, characteristic) => {
          if (error) {
            this.setStatus({ state: 'error', error: error.message });
            return;
          }
          if (!characteristic?.value) {
            return;
          }
          const reading = parseReading(characteristic.value);
          if (reading) {
            this.readingListeners.forEach(l => l(reading));
          }
        },
      );

      const info: ColorimeterDevice = {
        id: device.id,
        name: device.name ?? device.localName ?? device.id,
      };
      this.setStatus({ state: 'connected', device: info });
      return info;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось подключиться';
      this.setStatus({ state: 'error', error: message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.monitor?.remove();
    this.monitor = null;
    if (this.device) {
      await this.manager.cancelDeviceConnection(this.device.id).catch(() => {});
      this.device = null;
    }
    this.setStatus({ state: 'disconnected' });
  }

  async requestMeasurement(): Promise<void> {
    if (!this.device) {
      throw new Error('Колориметр не подключён');
    }
    await this.device.writeCharacteristicWithResponseForService(
      COLORIMETER_PROTOCOL.serviceUuid,
      COLORIMETER_PROTOCOL.commandCharacteristicUuid,
      COLORIMETER_PROTOCOL.measureCommand,
    );
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
    this.monitor?.remove();
    this.readingListeners.clear();
    this.statusListeners.clear();
    this.manager.destroy();
  }

  private setStatus(status: BleStatus): void {
    this.status = status;
    this.statusListeners.forEach(l => l(status));
  }
}
