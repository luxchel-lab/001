import { Buffer } from 'buffer';
import type { ColorimeterReading } from './types';
import type { Lab, Rgb } from '../../api/types';
import { rgbToHex, rgbToLab } from '../color';

/**
 * Протокол конкретной модели колориметра.
 *
 * ================== TBD (§5.4, §9 ТЗ) ==================
 * Ни UUID сервисов, ни формат кадра пока не подтверждены — документации на
 * модель нет. Значения ниже — ПЛЕЙСХОЛДЕРЫ. Когда придёт документация,
 * меняется только этот файл: RealBleColorimeterService и экраны его не знают.
 *
 * Что нужно получить от производителя:
 *   1. UUID сервиса и характеристик (измерение — notify, команда — write);
 *   2. формат кадра: RGB (3 байта) / Lab (float) / спектр (набор каналов);
 *   3. байт-порядок и способ упаковки Lab (масштаб, знак a/b);
 *   4. команду «сделать замер», если она нужна;
 *   5. нужна ли калибровка по белому и как она инициируется.
 * =======================================================
 */

export const COLORIMETER_PROTOCOL = {
  /** По этой подстроке фильтруем найденные устройства. */
  nameFilter: 'ARCHI',
  serviceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
  /** Характеристика с измерением (notify). */
  measurementCharacteristicUuid: '0000ff01-0000-1000-8000-00805f9b34fb',
  /** Характеристика команд (write). */
  commandCharacteristicUuid: '0000ff02-0000-1000-8000-00805f9b34fb',
  /** Команда «сделать замер». */
  measureCommand: Buffer.from([0x01]).toString('base64'),
} as const;

/** Формат кадра, который предполагает парсер до получения документации. */
export type FrameFormat = 'rgb8' | 'lab-int16';

export const FRAME_FORMAT: FrameFormat = 'rgb8';

/**
 * Разбирает base64-значение характеристики в измерение.
 * Возвращает null, если кадр не распознан — экран покажет это как ошибку,
 * а не как ложное измерение.
 */
export function parseReading(base64Value: string): ColorimeterReading | null {
  const bytes = Buffer.from(base64Value, 'base64');
  const at = new Date().toISOString();
  const raw = bytes.toString('hex');

  if (FRAME_FORMAT === 'rgb8') {
    if (bytes.length < 3) {
      return null;
    }
    const rgb: Rgb = [bytes[0], bytes[1], bytes[2]];
    const lab = rgbToLab(rgb).map(v => Math.round(v * 100) / 100) as Lab;
    return { at, hex: rgbToHex(rgb), rgb, lab, raw };
  }

  // lab-int16: L, a, b — знаковые int16 с масштабом 1/100.
  if (bytes.length < 6) {
    return null;
  }
  const lab: Lab = [
    bytes.readInt16LE(0) / 100,
    bytes.readInt16LE(2) / 100,
    bytes.readInt16LE(4) / 100,
  ];
  return { at, hex: '', lab, raw };
}
