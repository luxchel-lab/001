/**
 * Цветовая математика для клиента.
 *
 * Важно (§4 ТЗ): боевой подбор считает бэкенд. Здесь — минимум,
 * который нужен самому приложению:
 *   • перевод RGB↔HEX↔Lab для показа значений и превью;
 *   • ΔE2000 для мок-адаптера и офлайн-режима палитры.
 * Формулы совпадают с assets/js/podbor.color.js на сайте.
 */
import type { Lab, MatchQuality, Rgb } from '../api/types';

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map(c => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map(v =>
        Math.round(clamp(v, 0, 255))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB → CIE Lab, D65, наблюдатель 2°. */
export function rgbToLab([r, g, b]: Rgb): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = (lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041) / 1.08883;

  const f = (t: number) =>
    t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116;

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(rgb) : null;
}

/** CIEDE2000 — та же формула, что на сайте. */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));

  const a1p = a1 * (1 + g);
  const a2p = a2 * (1 + g);
  const c1p = Math.sqrt(a1p * a1p + b1 * b1);
  const c2p = Math.sqrt(a2p * a2p + b2 * b2);

  const hp = (bb: number, aa: number) => {
    if (bb === 0 && aa === 0) {
      return 0;
    }
    const h = Math.atan2(bb, aa) * deg;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hp(b1, a1p);
  const h2p = hp(b2, a2p);

  const dLp = l2 - l1;
  const dCp = c2p - c1p;

  let dhp = 0;
  if (c1p * c2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) {
      dhp -= 360;
    } else if (dhp < -180) {
      dhp += 360;
    }
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * rad);

  const lBar = (l1 + l2) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBarP = h1p + h2p;
  if (c1p * c2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) {
      hBarP += h1p + h2p < 360 ? 360 : -360;
    }
    hBarP /= 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBarP - 30) * rad) +
    0.24 * Math.cos(2 * hBarP * rad) +
    0.32 * Math.cos((3 * hBarP + 6) * rad) -
    0.2 * Math.cos((4 * hBarP - 63) * rad);

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rc = 2 * Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7)));
  const sl =
    1 +
    (0.015 * Math.pow(lBar - 50, 2)) / Math.sqrt(20 + Math.pow(lBar - 50, 2));
  const sc = 1 + 0.045 * cBarP;
  const sh = 1 + 0.015 * cBarP * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;

  return Math.sqrt(
    Math.pow(dLp / sl, 2) +
      Math.pow(dCp / sc, 2) +
      Math.pow(dHp / sh, 2) +
      rt * (dCp / sc) * (dHp / sh),
  );
}

/** Оценка попадания понятными словами — используется в UI. */
export function matchQuality(deltaE: number): MatchQuality {
  if (deltaE < 1) {
    return 'exact';
  }
  if (deltaE < 2.3) {
    return 'close';
  }
  if (deltaE < 5) {
    return 'visible';
  }
  return 'far';
}

export const MATCH_QUALITY_TEXT: Record<MatchQuality, string> = {
  exact: 'Совпадение, глаз не различит',
  close: 'Очень близко',
  visible: 'Разница заметна при сравнении',
  far: 'Заметно другой оттенок',
};

/** Контрастный цвет текста поверх плашки. */
export function readableTextColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return '#20241F';
  }
  const [l] = rgbToLab(rgb);
  return l > 60 ? '#20241F' : '#FFFFFF';
}
