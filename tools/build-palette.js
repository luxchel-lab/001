/**
 * Генератор колеровочной палитры ArchiPaint.
 *
 * Строит веер оттенков по 12 цветовым семьям в пространстве CIE LCh (D65):
 * 8 ступеней светлоты × 3 ступени насыщенности = 24 цвета на семью.
 * Цвета, выходящие за пределы sRGB, «подтягиваются» снижением хромы,
 * поэтому итоговые Lab-координаты пересчитываются из фактического HEX.
 *
 * Имена внутри семьи разложены тремя прогонами по восемь: каждый прогон
 * идёт от самого светлого оттенка к самому тёмному, поэтому «Полярный день»
 * достаётся светлой ступени, а «Тёмный сланец» — глубокой.
 *
 * Результат: assets/js/podbor.palette.js  (window.ARCHIPAINT_PALETTE)
 *
 * Запуск: node tools/build-palette.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ---------- цветовая математика (дублируется, чтобы скрипт был автономным) ---------- */

const WHITE_D65 = { x: 95.047, y: 100.0, z: 108.883 };

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, v * 255)));
}
function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  return {
    x: (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100,
    y: (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) * 100,
    z: (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) * 100,
  };
}
function xyzToRgb(x, y, z) {
  const X = x / 100, Y = y / 100, Z = z / 100;
  return {
    r: linearToSrgb(X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314),
    g: linearToSrgb(X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560),
    b: linearToSrgb(X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252),
  };
}
const f = (t) => (t > 0.008856451679 ? Math.cbrt(t) : t / (3 * 0.20689655172 ** 2) + 4 / 29);
const fInv = (t) => (t > 0.20689655172 ? t * t * t : 3 * 0.20689655172 ** 2 * (t - 4 / 29));

function xyzToLab(x, y, z) {
  const fx = f(x / WHITE_D65.x), fy = f(y / WHITE_D65.y), fz = f(z / WHITE_D65.z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}
function labToXyz(l, a, b) {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  return { x: WHITE_D65.x * fInv(fx), y: WHITE_D65.y * fInv(fy), z: WHITE_D65.z * fInv(fz) };
}
function rgbToLab(r, g, b) { const c = rgbToXyz(r, g, b); return xyzToLab(c.x, c.y, c.z); }
function labToRgb(l, a, b) { const c = labToXyz(l, a, b); return xyzToRgb(c.x, c.y, c.z); }
function lchToLab(L, C, h) {
  const rad = (h * Math.PI) / 180;
  return { l: L, a: Math.cos(rad) * C, b: Math.sin(rad) * C };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function inGamut(l, a, b) {
  const xyz = labToXyz(l, a, b);
  const X = xyz.x / 100, Y = xyz.y / 100, Z = xyz.z / 100;
  const lin = [
    X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314,
    X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560,
    X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252,
  ];
  return lin.every((c) => c >= -0.0015 && c <= 1.0015);
}
/** Снижаем хрому, пока цвет не попадёт в sRGB. */
function fitToGamut(L, C, h) {
  let lo = 0, hi = C;
  const lab0 = lchToLab(L, C, h);
  if (inGamut(lab0.l, lab0.a, lab0.b)) return lab0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const lab = lchToLab(L, mid, h);
    if (inGamut(lab.l, lab.a, lab.b)) lo = mid; else hi = mid;
  }
  return lchToLab(L, lo, h);
}

/* ---------- описание семей ---------- */

const LIGHTNESS_STEPS = [94, 86, 76, 66, 55, 44, 32, 20];

const FAMILIES = [
  {
    id: 'white', family: 'Тёплые нейтральные', collection: 'Демо · нейтральные и синие',
    hue: 82, chroma: [2.5, 5.5, 9], lightShift: 4,
  },
  {
    id: 'grey', family: 'Холодные нейтральные', collection: 'Демо · холодные и зелёные',
    hue: 250, chroma: [1.2, 3.2, 6], lightShift: 0,
  },
  {
    id: 'sand', family: 'Песочные и бежевые', collection: 'Демо · земляные',
    hue: 76, chroma: [7, 13, 20], lightShift: 2,
  },
  {
    id: 'ochre', family: 'Охра и золото', collection: 'Демо · земляные',
    hue: 66, chroma: [16, 30, 46], lightShift: 0,
  },
  {
    id: 'terracotta', family: 'Терракота и глина', collection: 'Демо · земляные',
    hue: 44, chroma: [14, 28, 44], lightShift: 0,
  },
  {
    id: 'red', family: 'Красные и винные', collection: 'Демо · насыщенные',
    hue: 26, chroma: [16, 34, 54], lightShift: -2,
  },
  {
    id: 'rose', family: 'Розовые и пудровые', collection: 'Демо · насыщенные',
    hue: 5, chroma: [9, 20, 34], lightShift: 3,
  },
  {
    id: 'violet', family: 'Фиолетовые и лиловые', collection: 'Демо · насыщенные',
    hue: 315, chroma: [10, 22, 38], lightShift: 0,
  },
  {
    id: 'blue', family: 'Синие', collection: 'Демо · нейтральные и синие',
    hue: 275, chroma: [12, 26, 42], lightShift: -1,
  },
  {
    id: 'aqua', family: 'Бирюзовые', collection: 'Демо · холодные и зелёные',
    hue: 210, chroma: [10, 22, 36], lightShift: 1,
  },
  {
    id: 'green', family: 'Зелёные', collection: 'Демо · холодные и зелёные',
    hue: 148, chroma: [10, 22, 38], lightShift: 0,
  },
  {
    id: 'olive', family: 'Оливковые и хаки', collection: 'Демо · холодные и зелёные',
    hue: 112, chroma: [8, 18, 30], lightShift: 0,
  },
];

/* ---------- сборка ---------- */

const colors = [];
let familyIndex = 0;

for (const fam of FAMILIES) {
  familyIndex += 1;
  let serial = 0;
  for (let ci = 0; ci < fam.chroma.length; ci++) {
    for (let li = 0; li < LIGHTNESS_STEPS.length; li++) {
      // хрома «выгорает» на светлых и тёмных краях — как в реальном веере
      const L = Math.max(14, Math.min(96, LIGHTNESS_STEPS[li] + fam.lightShift));
      const bell = 1 - Math.pow(Math.abs(L - 55) / 55, 1.7);
      const C = Math.max(0.8, fam.chroma[ci] * (0.42 + 0.58 * Math.max(0, bell)));
      // лёгкий дрейф тона по светлоте делает веер живым
      const h = (fam.hue + (li - 3.5) * 2.4 + 360) % 360;

      const lab = fitToGamut(L, C, h);
      const rgb = labToRgb(lab.l, lab.a, lab.b);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      const real = rgbToLab(rgb.r, rgb.g, rgb.b);

      serial += 1;

      // Название — измеренные светлота и хрома, а не придуманный образ:
      // такой веер невозможно принять за настоящую палитру, а разработчику
      // видно, какой оттенок он держит в руках.
      const realC = Math.sqrt(real.a * real.a + real.b * real.b);
      const name = fam.family + ' ' + Math.round(real.l) + '/' + Math.round(realC);

      colors.push({
        // DEMO- вместо артикула: заглушку нельзя случайно отправить в заказ
        code: 'DEMO-' + String(familyIndex).padStart(2, '0') + String(serial).padStart(2, '0'),
        name,
        hex,
        family: fam.family,
        familyId: fam.id,
        collection: fam.collection,
        lab: [round(real.l, 3), round(real.a, 3), round(real.b, 3)],
      });
    }
  }
}

function round(v, n) { const p = Math.pow(10, n); return Math.round(v * p) / p; }

// проверки целостности
const codes = new Set(colors.map((c) => c.code));
if (codes.size !== colors.length) throw new Error('Дубликаты кодов в палитре');
const byCollection = {};
colors.forEach((c) => { byCollection[c.collection] = (byCollection[c.collection] || 0) + 1; });

const header = `/*!
 * ArchiPaint — колеровочная палитра (справочный набор).
 * Сгенерировано tools/build-palette.js — не редактируйте вручную.
 * Всего оттенков: ${colors.length}
 * По коллекциям: ${Object.entries(byCollection).map(([k, v]) => k + ' — ' + v).join(', ')}
 *
 * Lab-координаты рассчитаны из sRGB для источника света D65, наблюдатель 2°.
 * Замените этот файл выгрузкой реальных спектрофотометрических данных,
 * либо подключите API через ArchiPaintData.setRemoteSource() — формат записи тот же.
 */
`;

const body = 'window.ARCHIPAINT_PALETTE = ' + JSON.stringify(colors, null, 0) + ';\n';

const out = path.join(__dirname, '..', 'assets', 'js', 'podbor.palette.js');
fs.writeFileSync(out, header + body, 'utf8');

console.log('Записано:', out);
console.log('Оттенков:', colors.length);
console.log(byCollection);
