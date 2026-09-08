#!/usr/bin/env node
/**
 * Генерирует src/data/palette.ts из данных сайта (assets/js/podbor.*.js),
 * чтобы мок-бэкенд и офлайн-кэш приложения работали на том же каталоге,
 * что и веб-подбор. Бренд-эквиваленты (RAL) считаются по ΔE2000.
 *
 *   node tools/build-data.js
 */
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..', '..', 'assets', 'js');
const color = require(path.join(webRoot, 'podbor.color.js'));

global.window = global.window || {};
require(path.join(webRoot, 'podbor.palette.js'));
require(path.join(webRoot, 'podbor.standards.js'));

const palette = global.window.ARCHIPAINT_PALETTE;
const standards = global.window.ARCHIPAINT_STANDARDS;

if (!Array.isArray(palette) || !palette.length) {
  throw new Error('Каталог не загрузился — проверьте assets/js/podbor.palette.js');
}

/** Цветовая математика сайта работает с объектами {l, a, b}. */
const toLab = ([l, a, b]) => ({ l, a, b });

const MAX_BRAND_DELTA_E = 6;
const BRAND_MATCH_LIMIT = 3;

function brandMatchesFor(item) {
  return standards
    .map(std => ({
      brand: std.standard.replace(/\s+Classic$/, ''),
      code: std.code,
      name: std.name,
      hex: std.hex,
      deltaE:
        Math.round(color.deltaE2000(toLab(item.lab), toLab(std.lab)) * 100) / 100,
    }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .filter(m => m.deltaE <= MAX_BRAND_DELTA_E)
    .slice(0, BRAND_MATCH_LIMIT);
}

const colors = palette.map(item => {
  const rgb = color.hexToRgb(item.hex);
  return {
    code: item.code,
    name: item.name,
    hex: item.hex,
    rgb: [rgb.r, rgb.g, rgb.b],
    lab: item.lab.map(v => Math.round(v * 1000) / 1000),
    collection: item.collection,
    family: item.family,
    brandMatches: brandMatchesFor(item),
  };
});

const collections = [...new Set(colors.map(c => c.collection))];
const brands = [...new Set(standards.map(s => s.standard.replace(/\s+Classic$/, '')))];

const header = `/**
 * Каталог ArchiPaint для мок-бэкенда и офлайн-кэша.
 * Сгенерировано tools/build-data.js из assets/js/podbor.palette.js — не редактируйте вручную.
 *
 * Оттенков: ${colors.length}. Коллекций: ${collections.length}.
 * Бренд-эквиваленты: ${brands.join(', ')} (ΔE2000 ≤ ${MAX_BRAND_DELTA_E}, до ${BRAND_MATCH_LIMIT} штук).
 *
 * ВНИМАНИЕ: это справочный набор сайта, а не боевая база 800 000+ оттенков.
 * Боевые данные приходят с бэкенда — см. src/api/palette.ts.
 */
import type { ArchiColor } from '../api/types';

export const PALETTE_COLLECTIONS: string[] = ${JSON.stringify(collections)};
export const PALETTE_BRANDS: string[] = ${JSON.stringify(brands)};

export const ARCHI_PALETTE = `;

const body = JSON.stringify(colors, null, 0)
  .replace(/\},\{/g, '},\n  {')
  .replace(/^\[/, '[\n  ')
  .replace(/\]$/, ',\n] as ArchiColor[];\n');

fs.writeFileSync(
  path.resolve(__dirname, '..', 'src', 'data', 'palette.ts'),
  header + body,
  'utf8',
);

/* Стандарты — отдельным файлом: нужны экрану поиска по чужому коду. */
const stdBody0 = JSON.stringify(
  standards.map(s => ({
    brand: s.standard.replace(/\s+Classic$/, ''),
    standard: s.standard,
    code: s.code,
    name: s.name,
    hex: s.hex,
    lab: s.lab,
  })),
  null,
  0,
);
const stdBody = stdBody0
  .replace(/\},\{/g, '},\n  {')
  .replace(/^\[/, '[\n  ')
  .replace(/\]$/, ',\n] as StandardColor[];\n');

fs.writeFileSync(
  path.resolve(__dirname, '..', 'src', 'data', 'standards.ts'),
  `/**
 * Справочник внешних стандартов (RAL Classic).
 * Сгенерировано tools/build-data.js — не редактируйте вручную.
 *
 * HEX — экранные приближения, они не заменяют физический веер.
 */
export interface StandardColor {
  brand: string;
  standard: string;
  code: string;
  name: string;
  hex: string;
  lab: [number, number, number];
}

export const STANDARD_COLORS = ${stdBody}`,
  'utf8',
);

console.log(
  `Готово: ${colors.length} оттенков ArchiPaint, ${standards.length} стандартов.`,
);
