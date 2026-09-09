/**
 * Локальный поиск по каталогу — для мок-режима и офлайн-фолбэка.
 *
 * Боевой поиск по 800 000+ оттенкам делает бэкенд (§4 ТЗ). Здесь работает
 * справочный набор сайта (288 оттенков), закэшированный в приложении.
 */
import type {
  ArchiColor,
  ColorMatch,
  Lab,
  PaletteQuery,
  Rgb,
} from '../api/types';
import { ARCHI_PALETTE } from '../data/palette';
import { STANDARD_COLORS } from '../data/standards';
import { deltaE2000, hexToLab, matchQuality, rgbToLab } from './color';

function labOf(color: ArchiColor): Lab {
  return color.lab ?? rgbToLab(color.rgb);
}

export function nearestColors(
  target: Lab,
  limit = 5,
  source: ArchiColor[] = ARCHI_PALETTE,
  collection?: string,
): ColorMatch[] {
  const pool = collection
    ? source.filter(c => c.collection === collection)
    : source;

  return pool
    .map(color => {
      const deltaE = deltaE2000(target, labOf(color));
      return { color, deltaE: Math.round(deltaE * 100) / 100, quality: matchQuality(deltaE) };
    })
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, limit);
}

export function labFromRequest(input: {
  lab?: Lab;
  rgb?: Rgb;
  hex?: string;
}): Lab | null {
  if (input.lab) {
    return input.lab;
  }
  if (input.rgb) {
    return rgbToLab(input.rgb);
  }
  if (input.hex) {
    return hexToLab(input.hex);
  }
  return null;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Поиск по каталогу: код ARCHI, название, коллекция, а также код чужого
 * стандарта («RAL 7016» или «антрацит») — тогда сначала находим стандарт,
 * а потом ближайшие к нему оттенки ArchiPaint.
 */
export function searchPalette(query: PaletteQuery): {
  items: ArchiColor[];
  total: number;
} {
  const q = normalize(query.q ?? '');
  let items = ARCHI_PALETTE;

  if (query.collection) {
    items = items.filter(c => c.collection === query.collection);
  }
  if (query.brand) {
    items = items.filter(c =>
      c.brandMatches?.some(m => m.brand === query.brand),
    );
  }

  if (q) {
    const direct = items.filter(
      c =>
        normalize(c.code).includes(q) ||
        normalize(c.name).includes(q) ||
        normalize(c.collection ?? '').includes(q) ||
        c.brandMatches?.some(m => normalize(m.code).includes(q)),
    );

    if (direct.length) {
      items = direct;
    } else {
      const standard = STANDARD_COLORS.find(
        s => normalize(s.code).includes(q) || normalize(s.name).includes(q),
      );
      items = standard
        ? nearestColors(standard.lab, 12, items).map(m => m.color)
        : [];
    }
  }

  const offset = query.offset ?? 0;
  const limit = query.limit ?? 60;
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export function findStandard(q: string) {
  const n = normalize(q);
  return STANDARD_COLORS.find(
    s => normalize(s.code) === n || normalize(s.name) === n,
  );
}
