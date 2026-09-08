import { Buffer } from 'buffer';
import { MockBleColorimeterService } from '../src/services/ble/MockBleColorimeterService';
import { parseReading, COLORIMETER_PROTOCOL } from '../src/services/ble/protocol';

/**
 * Экраны зависят только от интерфейса BleColorimeterService (§6.2 ТЗ),
 * поэтому проверяем контракт заглушки и разбор кадра протокола.
 */
describe('колориметр', () => {
  it('заглушка проходит цикл поиск → подключение → замер', async () => {
    const service = new MockBleColorimeterService();
    const found: string[] = [];
    const readings: string[] = [];
    service.onReading(r => readings.push(r.hex));

    await service.scan(device => found.push(device.id));
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1200));
    expect(found.length).toBeGreaterThan(0);

    const device = await service.connect(found[0]);
    expect(device.id).toBe(found[0]);
    expect(service.getStatus().state).toBe('connected');

    await service.requestMeasurement();
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatch(/^#[0-9A-F]{6}$/);

    await service.disconnect();
    expect(service.getStatus().state).toBe('disconnected');
    service.destroy();
  }, 10000);

  it('не даёт делать замер без подключения', async () => {
    const service = new MockBleColorimeterService();
    await expect(service.requestMeasurement()).rejects.toThrow('не подключён');
    service.destroy();
  });

  it('отписка от событий работает', async () => {
    const service = new MockBleColorimeterService();
    const readings: unknown[] = [];
    const off = service.onReading(r => readings.push(r));
    await service.connect('mock-colorimeter-1');
    off();
    await service.requestMeasurement();
    expect(readings).toHaveLength(0);
    service.destroy();
  }, 10000);

  it('разбирает кадр RGB и отбрасывает короткий', () => {
    const frame = Buffer.from([44, 49, 54]).toString('base64');
    const reading = parseReading(frame);
    expect(reading?.hex).toBe('#2C3136');
    expect(reading?.rgb).toEqual([44, 49, 54]);
    expect(parseReading(Buffer.from([1]).toString('base64'))).toBeNull();
  });

  it('протокол задан плейсхолдерами до получения документации', () => {
    // Напоминание: UUID меняются вместе с документацией на модель (§9 ТЗ).
    expect(COLORIMETER_PROTOCOL.serviceUuid).toMatch(/^[0-9a-f-]{36}$/);
  });
});
