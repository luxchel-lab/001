/*!
 * ArchiPaint · podbor.color.js
 * Ядро цветовой математики сервиса подбора краски.
 *
 * Всё считается в CIE Lab / LCh для источника света D65, наблюдатель 2°.
 * Файл не зависит от DOM и jQuery — его можно использовать и на сервере.
 *
 * Экспортирует глобальный объект ArchiPaintColor.
 */
(function (global) {
  'use strict';

  /* ============================================================
   *  Опорные белые точки
   * ============================================================ */

  var ILLUMINANTS = {
    D65: { x: 95.047, y: 100.0, z: 108.883 },  // дневной свет, стандарт для ЛКМ
    D50: { x: 96.422, y: 100.0, z: 82.521 },   // полиграфический стандарт
    A:   { x: 109.850, y: 100.0, z: 35.585 },  // лампа накаливания
    F2:  { x: 99.187, y: 100.0, z: 67.395 },   // холодный люминесцентный
    F11: { x: 100.966, y: 100.0, z: 64.370 }   // трёхполосный люминесцентный
  };

  var WHITE = ILLUMINANTS.D65;
  var EPS = 216 / 24389;     // 0.008856
  var KAPPA = 24389 / 27;    // 903.3

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp255(v) { return clamp(Math.round(v), 0, 255); }
  function round(v, n) { var p = Math.pow(10, n == null ? 2 : n); return Math.round(v * p) / p; }
  function degToRad(d) { return (d * Math.PI) / 180; }
  function radToDeg(r) { return (r * 180) / Math.PI; }

  /* ============================================================
   *  sRGB ↔ XYZ ↔ Lab ↔ LCh
   * ============================================================ */

  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    var v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return clamp255(v * 255);
  }

  function rgbToXyz(r, g, b) {
    var R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    return {
      x: (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) * 100,
      y: (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) * 100,
      z: (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) * 100
    };
  }

  function xyzToRgb(x, y, z) {
    var X = x / 100, Y = y / 100, Z = z / 100;
    return {
      r: linearToSrgb(X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314),
      g: linearToSrgb(X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560),
      b: linearToSrgb(X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252)
    };
  }

  function fLab(t) { return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }
  function fLabInv(t) { var t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; }

  function xyzToLab(x, y, z, white) {
    var w = white || WHITE;
    var fx = fLab(x / w.x), fy = fLab(y / w.y), fz = fLab(z / w.z);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function labToXyz(l, a, b, white) {
    var w = white || WHITE;
    var fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    return { x: w.x * fLabInv(fx), y: w.y * fLabInv(fy), z: w.z * fLabInv(fz) };
  }

  function rgbToLab(r, g, b) { var c = rgbToXyz(r, g, b); return xyzToLab(c.x, c.y, c.z); }
  function labToRgb(l, a, b) { var c = labToXyz(l, a, b); return xyzToRgb(c.x, c.y, c.z); }

  function labToLch(l, a, b) {
    var C = Math.sqrt(a * a + b * b);
    var h = radToDeg(Math.atan2(b, a));
    if (h < 0) h += 360;
    return { l: l, c: C, h: C < 0.02 ? 0 : h };
  }

  function lchToLab(l, c, h) {
    var rad = degToRad(h);
    return { l: l, a: Math.cos(rad) * c, b: Math.sin(rad) * c };
  }

  /* ============================================================
   *  HSL — нужен для быстрых интерфейсных операций
   * ============================================================ */

  function rgbToHsl(r, g, b) {
    var R = r / 255, G = g / 255, B = b / 255;
    var max = Math.max(R, G, B), min = Math.min(R, G, B);
    var h = 0, s = 0, l = (max + min) / 2;
    var d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
      else if (max === G) h = (B - R) / d + 2;
      else h = (R - G) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: clamp255((t[0] + m) * 255), g: clamp255((t[1] + m) * 255), b: clamp255((t[2] + m) * 255) };
  }

  /* ============================================================
   *  HEX и разбор пользовательского ввода
   * ============================================================ */

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return clamp255(v).toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function hexToRgb(hex) {
    if (!hex) return null;
    var s = String(hex).trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    };
  }

  function isHex(value) { return hexToRgb(value) !== null; }

  function normalizeHex(value) {
    var rgb = hexToRgb(value);
    return rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : null;
  }

  function hexToLab(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToLab(rgb.r, rgb.g, rgb.b) : null;
  }

  function labToHex(l, a, b) {
    var rgb = labToRgb(l, a, b);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function lchToHex(l, c, h) {
    var lab = lchToLab(l, c, h);
    return labToHex(lab.l, lab.a, lab.b);
  }

  var NUM = '(-?\\d+(?:[.,]\\d+)?)';
  var SEP = '\\s*[,;\\s]\\s*';

  /**
   * Разбирает произвольную запись цвета: HEX, rgb(), «193, 91, 51»,
   * «Lab 46, 32, 28», «lch(...)», hsl(). Возвращает
   * { hex, rgb, lab, lch, format } либо null.
   *
   * mode: 'auto' | 'hex' | 'rgb' | 'lab' | 'lch' | 'hsl'
   */
  function parseColorInput(raw, mode) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    mode = mode || 'auto';

    var m;
    var wantsHex = mode === 'auto' || mode === 'hex';
    var wantsRgb = mode === 'auto' || mode === 'rgb';
    var wantsLab = mode === 'auto' || mode === 'lab';
    var wantsLch = mode === 'auto' || mode === 'lch';
    var wantsHsl = mode === 'auto' || mode === 'hsl';

    // явные префиксы имеют приоритет над режимом «авто»
    if (wantsLab && (m = s.match(new RegExp('^(?:cie)?lab\\s*\\(?\\s*' + NUM + SEP + NUM + SEP + NUM + '\\s*\\)?$', 'i')))) {
      return fromLab(num(m[1]), num(m[2]), num(m[3]), 'lab');
    }
    if (wantsLch && (m = s.match(new RegExp('^(?:cie)?lch\\s*\\(?\\s*' + NUM + SEP + NUM + SEP + NUM + '\\s*\\)?$', 'i')))) {
      var lab = lchToLab(num(m[1]), num(m[2]), num(m[3]));
      return fromLab(lab.l, lab.a, lab.b, 'lch');
    }
    if (wantsHsl && (m = s.match(new RegExp('^hsla?\\s*\\(?\\s*' + NUM + '(?:deg)?' + SEP + NUM + '%?' + SEP + NUM + '%?\\s*\\)?$', 'i')))) {
      var hr = hslToRgb(num(m[1]), num(m[2]), num(m[3]));
      return fromRgb(hr.r, hr.g, hr.b, 'hsl');
    }
    if (wantsRgb && (m = s.match(new RegExp('^rgba?\\s*\\(?\\s*' + NUM + SEP + NUM + SEP + NUM + '(?:' + SEP + NUM + ')?\\s*\\)?$', 'i')))) {
      return fromRgb(num(m[1]), num(m[2]), num(m[3]), 'rgb');
    }
    if (wantsHex && isHex(s)) {
      var rgb = hexToRgb(s);
      return fromRgb(rgb.r, rgb.g, rgb.b, 'hex');
    }

    // три числа без префикса — решаем по диапазонам
    m = s.match(new RegExp('^' + NUM + SEP + NUM + SEP + NUM + '$'));
    if (m) {
      var v1 = num(m[1]), v2 = num(m[2]), v3 = num(m[3]);
      var looksRgb = isIntish(v1) && isIntish(v2) && isIntish(v3) &&
                     v1 >= 0 && v1 <= 255 && v2 >= 0 && v2 <= 255 && v3 >= 0 && v3 <= 255 &&
                     v2 >= 0 && v3 >= 0;
      var looksLab = v1 >= 0 && v1 <= 100 && v2 >= -128 && v2 <= 128 && v3 >= -128 && v3 <= 128 &&
                     (v2 < 0 || v3 < 0 || !isIntish(v1) || !isIntish(v2) || !isIntish(v3));

      if (mode === 'rgb') return fromRgb(v1, v2, v3, 'rgb');
      if (mode === 'lab') return fromLab(v1, v2, v3, 'lab');
      if (mode === 'lch') { var l2 = lchToLab(v1, v2, v3); return fromLab(l2.l, l2.a, l2.b, 'lch'); }
      if (mode === 'hsl') { var h2 = hslToRgb(v1, v2, v3); return fromRgb(h2.r, h2.g, h2.b, 'hsl'); }

      // авто: отрицательные значения или дробные — почти наверняка Lab
      if (looksLab && !looksRgb) return fromLab(v1, v2, v3, 'lab');
      if (looksRgb) return fromRgb(v1, v2, v3, 'rgb');
      if (v1 >= 0 && v1 <= 100) return fromLab(v1, v2, v3, 'lab');
    }

    // «C15B33» без решётки
    if (wantsHex && /^[0-9a-fA-F]{6}$/.test(s)) {
      var r2 = hexToRgb(s);
      return fromRgb(r2.r, r2.g, r2.b, 'hex');
    }
    return null;

    function num(x) { return parseFloat(String(x).replace(',', '.')); }
    function isIntish(x) { return Math.abs(x - Math.round(x)) < 1e-9; }
  }

  function fromRgb(r, g, b, format) {
    r = clamp255(r); g = clamp255(g); b = clamp255(b);
    var lab = rgbToLab(r, g, b);
    return {
      hex: rgbToHex(r, g, b),
      rgb: { r: r, g: g, b: b },
      lab: lab,
      lch: labToLch(lab.l, lab.a, lab.b),
      format: format || 'rgb',
      inGamut: true
    };
  }

  function fromLab(l, a, b, format) {
    var gamut = isInSrgbGamut(l, a, b);
    var rgb = labToRgb(l, a, b);
    var actual = rgbToLab(rgb.r, rgb.g, rgb.b);
    return {
      hex: rgbToHex(rgb.r, rgb.g, rgb.b),
      rgb: rgb,
      lab: { l: l, a: a, b: b },
      labClipped: actual,
      lch: labToLch(l, a, b),
      format: format || 'lab',
      inGamut: gamut
    };
  }

  function fromHex(hex) {
    var rgb = hexToRgb(hex);
    return rgb ? fromRgb(rgb.r, rgb.g, rgb.b, 'hex') : null;
  }

  /* ============================================================
   *  Работа с цветовым охватом sRGB
   * ============================================================ */

  function isInSrgbGamut(l, a, b) {
    var xyz = labToXyz(l, a, b);
    var X = xyz.x / 100, Y = xyz.y / 100, Z = xyz.z / 100;
    var lin = [
      X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314,
      X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560,
      X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252
    ];
    for (var i = 0; i < 3; i++) if (lin[i] < -0.0015 || lin[i] > 1.0015) return false;
    return true;
  }

  /** Понижает хрому, сохраняя светлоту и тон, пока цвет не войдёт в sRGB. */
  function fitToGamut(l, c, h) {
    var lab = lchToLab(l, c, h);
    if (isInSrgbGamut(lab.l, lab.a, lab.b)) return lab;
    var lo = 0, hi = c;
    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi) / 2;
      var t = lchToLab(l, mid, h);
      if (isInSrgbGamut(t.l, t.a, t.b)) lo = mid; else hi = mid;
    }
    return lchToLab(l, lo, h);
  }

  /* ============================================================
   *  Формулы цветового различия ΔE
   * ============================================================ */

  function deltaE76(l1, l2) {
    var dl = l1.l - l2.l, da = l1.a - l2.a, db = l1.b - l2.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  function deltaE94(l1, l2, graphics) {
    var kL = graphics ? 1 : 2, K1 = graphics ? 0.045 : 0.048, K2 = graphics ? 0.015 : 0.014;
    var dL = l1.l - l2.l;
    var C1 = Math.sqrt(l1.a * l1.a + l1.b * l1.b);
    var C2 = Math.sqrt(l2.a * l2.a + l2.b * l2.b);
    var dC = C1 - C2;
    var da = l1.a - l2.a, db = l1.b - l2.b;
    var dH2 = da * da + db * db - dC * dC;
    var dH = dH2 > 0 ? Math.sqrt(dH2) : 0;
    var sL = 1, sC = 1 + K1 * C1, sH = 1 + K2 * C1;
    var tL = dL / kL / sL, tC = dC / sC, tH = dH / sH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH);
  }

  /**
   * ΔE CMC(l:c) — именно эту формулу с параметрами 2:1 использует
   * большинство колеровочных сервисов для архитектурных красок.
   */
  function deltaECMC(l1, l2, lFactor, cFactor) {
    var lf = lFactor == null ? 2 : lFactor;
    var cf = cFactor == null ? 1 : cFactor;

    var C1 = Math.sqrt(l1.a * l1.a + l1.b * l1.b);
    var C2 = Math.sqrt(l2.a * l2.a + l2.b * l2.b);
    var dC = C1 - C2;
    var dL = l1.l - l2.l;
    var da = l1.a - l2.a, db = l1.b - l2.b;
    var dH2 = da * da + db * db - dC * dC;
    var dH = dH2 > 0 ? Math.sqrt(dH2) : 0;

    var sL = l1.l < 16 ? 0.511 : (0.040975 * l1.l) / (1 + 0.01765 * l1.l);
    var sC = (0.0638 * C1) / (1 + 0.0131 * C1) + 0.638;

    var h1 = radToDeg(Math.atan2(l1.b, l1.a));
    if (h1 < 0) h1 += 360;

    var T = (h1 >= 164 && h1 <= 345)
      ? 0.56 + Math.abs(0.2 * Math.cos(degToRad(h1 + 168)))
      : 0.36 + Math.abs(0.4 * Math.cos(degToRad(h1 + 35)));

    var C1_4 = Math.pow(C1, 4);
    var F = Math.sqrt(C1_4 / (C1_4 + 1900));
    var sH = sC * (F * T + 1 - F);

    var tL = dL / (lf * sL), tC = dC / (cf * sC), tH = dH / sH;
    return Math.sqrt(tL * tL + tC * tC + tH * tH);
  }

  /** ΔE CIEDE2000 — современный стандарт, лучше всего согласуется с глазом. */
  function deltaE2000(lab1, lab2, kL, kC, kH) {
    kL = kL == null ? 1 : kL; kC = kC == null ? 1 : kC; kH = kH == null ? 1 : kH;

    var L1 = lab1.l, a1 = lab1.a, b1 = lab1.b;
    var L2 = lab2.l, a2 = lab2.a, b2 = lab2.b;

    var C1 = Math.sqrt(a1 * a1 + b1 * b1);
    var C2 = Math.sqrt(a2 * a2 + b2 * b2);
    var Cbar = (C1 + C2) / 2;
    var Cbar7 = Math.pow(Cbar, 7);
    var G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

    var a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    var C1p = Math.sqrt(a1p * a1p + b1 * b1);
    var C2p = Math.sqrt(a2p * a2p + b2 * b2);

    var h1p = (a1p === 0 && b1 === 0) ? 0 : posDeg(radToDeg(Math.atan2(b1, a1p)));
    var h2p = (a2p === 0 && b2 === 0) ? 0 : posDeg(radToDeg(Math.atan2(b2, a2p)));

    var dLp = L2 - L1;
    var dCp = C2p - C1p;

    var dhp;
    if (C1p * C2p === 0) dhp = 0;
    else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
    else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
    else dhp = h2p - h1p + 360;
    var dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(degToRad(dhp) / 2);

    var Lbarp = (L1 + L2) / 2;
    var Cbarp = (C1p + C2p) / 2;

    var hbarp;
    if (C1p * C2p === 0) hbarp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;

    var T = 1
      - 0.17 * Math.cos(degToRad(hbarp - 30))
      + 0.24 * Math.cos(degToRad(2 * hbarp))
      + 0.32 * Math.cos(degToRad(3 * hbarp + 6))
      - 0.20 * Math.cos(degToRad(4 * hbarp - 63));

    var dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
    var Cbarp7 = Math.pow(Cbarp, 7);
    var Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
    var Lm50 = Math.pow(Lbarp - 50, 2);
    var Sl = 1 + (0.015 * Lm50) / Math.sqrt(20 + Lm50);
    var Sc = 1 + 0.045 * Cbarp;
    var Sh = 1 + 0.015 * Cbarp * T;
    var Rt = -Math.sin(degToRad(2 * dTheta)) * Rc;

    var tL = dLp / (kL * Sl), tC = dCp / (kC * Sc), tH = dHp / (kH * Sh);
    return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);

    function posDeg(d) { return d < 0 ? d + 360 : d; }
  }

  var DELTA_E_FORMULAS = {
    de2000: { id: 'de2000', label: 'CIEDE2000', short: 'ΔE₀₀', fn: deltaE2000,
      note: 'Современный стандарт CIE. Лучше всего согласуется с восприятием глаза.' },
    cmc21:  { id: 'cmc21', label: 'CMC 2:1', short: 'ΔE CMC', fn: function (a, b) { return deltaECMC(a, b, 2, 1); },
      note: 'Отраслевой стандарт для архитектурных красок: допуск по светлоте вдвое мягче.' },
    cmc11:  { id: 'cmc11', label: 'CMC 1:1', short: 'ΔE CMC', fn: function (a, b) { return deltaECMC(a, b, 1, 1); },
      note: 'Жёсткий вариант CMC — для контроля повторяемости колеровки.' },
    de94:   { id: 'de94', label: 'CIE94', short: 'ΔE₉₄', fn: function (a, b) { return deltaE94(a, b, false); },
      note: 'Формула 1994 года для текстиля и покрытий.' },
    de76:   { id: 'de76', label: 'CIE76', short: 'ΔE₇₆', fn: deltaE76,
      note: 'Простое евклидово расстояние в Lab. Историческая формула.' }
  };

  function deltaE(lab1, lab2, formulaId) {
    var f = DELTA_E_FORMULAS[formulaId] || DELTA_E_FORMULAS.de2000;
    return f.fn(lab1, lab2);
  }

  /** Словесная оценка совпадения — та же шкала, что на странице подбора. */
  function deltaEQuality(de) {
    if (de <= 0.5) return { level: 'perfect', label: 'Неотличимо', cls: 'good' };
    if (de <= 1.0) return { level: 'excellent', label: 'Неразличимо глазом', cls: 'good' };
    if (de <= 1.5) return { level: 'good', label: 'Точное совпадение', cls: 'good' };
    if (de <= 2.5) return { level: 'fair', label: 'Лёгкое отличие', cls: 'mid' };
    if (de <= 3.5) return { level: 'noticeable', label: 'Заметно при сравнении', cls: 'mid' };
    if (de <= 5) return { level: 'poor', label: 'Заметная разница', cls: 'poor' };
    return { level: 'different', label: 'Другой оттенок', cls: 'poor' };
  }

  /* ============================================================
   *  Контраст и читаемость (WCAG 2.1)
   * ============================================================ */

  function relativeLuminance(r, g, b) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  }

  function contrastRatio(hex1, hex2) {
    var c1 = hexToRgb(hex1), c2 = hexToRgb(hex2);
    if (!c1 || !c2) return 1;
    var l1 = relativeLuminance(c1.r, c1.g, c1.b);
    var l2 = relativeLuminance(c2.r, c2.g, c2.b);
    var hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function wcagLevel(ratio, large) {
    if (large) {
      if (ratio >= 4.5) return { level: 'AAA', pass: true };
      if (ratio >= 3) return { level: 'AA', pass: true };
      return { level: '—', pass: false };
    }
    if (ratio >= 7) return { level: 'AAA', pass: true };
    if (ratio >= 4.5) return { level: 'AA', pass: true };
    if (ratio >= 3) return { level: 'AA Large', pass: false };
    return { level: '—', pass: false };
  }

  /** Чёрный или белый текст читается лучше на данном фоне. */
  function readableTextColor(hex) {
    return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#111111') ? '#FFFFFF' : '#141414';
  }

  /* ============================================================
   *  Операции над цветом
   * ============================================================ */

  function adjustLab(hex, dL, dC, dH) {
    var lab = hexToLab(hex);
    if (!lab) return hex;
    var lch = labToLch(lab.l, lab.a, lab.b);
    var out = fitToGamut(
      clamp(lch.l + (dL || 0), 0, 100),
      Math.max(0, lch.c + (dC || 0)),
      ((lch.h + (dH || 0)) % 360 + 360) % 360
    );
    return labToHex(out.l, out.a, out.b);
  }

  function lighten(hex, amount) { return adjustLab(hex, amount, 0, 0); }
  function darken(hex, amount) { return adjustLab(hex, -amount, 0, 0); }
  function saturate(hex, amount) { return adjustLab(hex, 0, amount, 0); }
  function desaturate(hex, amount) { return adjustLab(hex, 0, -amount, 0); }
  function rotateHue(hex, deg) { return adjustLab(hex, 0, 0, deg); }

  /** Смешивание в Lab — визуально корректнее, чем в sRGB. */
  function mix(hex1, hex2, ratio) {
    var t = ratio == null ? 0.5 : clamp(ratio, 0, 1);
    var a = hexToLab(hex1), b = hexToLab(hex2);
    if (!a || !b) return hex1;
    return labToHex(a.l + (b.l - a.l) * t, a.a + (b.a - a.a) * t, a.b + (b.b - a.b) * t);
  }

  /** Тёплый / холодный / нейтральный — по положению тона в LCh. */
  function temperature(hex) {
    var lab = hexToLab(hex);
    if (!lab) return { id: 'neutral', label: 'Нейтральный' };
    var lch = labToLch(lab.l, lab.a, lab.b);
    if (lch.c < 6) return { id: 'neutral', label: 'Нейтральный', hue: lch.h, chroma: lch.c };
    var warm = lch.h < 110 || lch.h > 330;
    var cool = lch.h >= 160 && lch.h <= 300;
    return {
      id: warm ? 'warm' : cool ? 'cool' : 'balanced',
      label: warm ? 'Тёплый' : cool ? 'Холодный' : 'Сбалансированный',
      hue: lch.h,
      chroma: lch.c
    };
  }

  /** LRV — коэффициент отражения света, ключевой параметр для интерьера. */
  function lrv(hex) {
    var lab = hexToLab(hex);
    return lab ? round(clamp(labToXyz(lab.l, lab.a, lab.b).y, 0, 100), 1) : null;
  }

  function lrvAdvice(value) {
    if (value == null) return '';
    if (value >= 70) return 'Сильно отражает свет — визуально расширяет помещение, подходит для северных комнат.';
    if (value >= 50) return 'Хорошо отражает свет — универсальный выбор для стен жилых комнат.';
    if (value >= 30) return 'Средний уровень отражения — создаёт камерную атмосферу, требует хорошего освещения.';
    if (value >= 15) return 'Поглощает много света — эффектен на акцентной стене, требует дополнительных источников света.';
    return 'Глубокий тёмный тон — работает как акцент, в маленьких комнатах используйте фрагментарно.';
  }

  /* ============================================================
   *  Симуляция нарушений цветовосприятия
   *  Матрицы Brettel–Viénot–Mollon в приближении Machado et al.
   * ============================================================ */

  var CVD_MATRICES = {
    protanopia:   [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
    tritanopia:   [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
    achromatopsia:[0.212656, 0.715158, 0.072186, 0.212656, 0.715158, 0.072186, 0.212656, 0.715158, 0.072186]
  };

  var CVD_LABELS = {
    normal: 'Обычное зрение',
    protanopia: 'Протанопия (нет красных колбочек)',
    deuteranopia: 'Дейтеранопия (нет зелёных колбочек)',
    tritanopia: 'Тританопия (нет синих колбочек)',
    achromatopsia: 'Ахроматопсия (полная цветовая слепота)'
  };

  function simulateCVD(hex, type) {
    if (!type || type === 'normal') return normalizeHex(hex) || hex;
    var m = CVD_MATRICES[type];
    if (!m) return hex;
    var rgb = hexToRgb(hex);
    if (!rgb) return hex;
    var R = srgbToLinear(rgb.r), G = srgbToLinear(rgb.g), B = srgbToLinear(rgb.b);
    return rgbToHex(
      linearToSrgb(m[0] * R + m[1] * G + m[2] * B),
      linearToSrgb(m[3] * R + m[4] * G + m[5] * B),
      linearToSrgb(m[6] * R + m[7] * G + m[8] * B)
    );
  }

  /* ============================================================
   *  Предпросмотр цвета при разном освещении
   *  Хроматическая адаптация Брэдфорда D65 → выбранный источник.
   * ============================================================ */

  var BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  var BRADFORD_INV = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];

  function mul3(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2]
    ];
  }

  /**
   * Белая точка по цветовой температуре.
   * 1667–4000K — планковский локус (аппроксимация Kim et al.),
   * 4000–25000K — локус дневного света CIE.
   */
  function cctToWhite(cct) {
    var t = clamp(cct, 1667, 25000);
    var x;
    if (t <= 4000) {
      x = -0.2661239e9 / (t * t * t) - 0.2343589e6 / (t * t) + 0.8776956e3 / t + 0.179910;
    } else {
      x = -3.0258469e9 / (t * t * t) + 2.1070379e6 / (t * t) + 0.2226347e3 / t + 0.240390;
    }
    var y;
    if (t <= 2222) {
      y = -1.1063814 * x * x * x - 1.34811020 * x * x + 2.18555832 * x - 0.20219683;
    } else if (t <= 4000) {
      y = -0.9549476 * x * x * x - 1.37418593 * x * x + 2.09137015 * x - 0.16748867;
    } else {
      y = 3.0817580 * x * x * x - 5.87338670 * x * x + 3.75112997 * x - 0.37001483;
    }
    // Y = 100, как у стандартных осветителей
    return { x: (x / y) * 100, y: 100, z: ((1 - x - y) / y) * 100 };
  }

  var LIGHT_SOURCES = {
    warm2700: { id: 'warm2700', label: 'Лампа накаливания · 2700K', cct: 2700, gain: 0.93,
                note: 'Тёплый жёлтый свет: охра, терракота и бежевые тона становятся насыщеннее, синие и серые сереют.' },
    warm3000: { id: 'warm3000', label: 'Тёплый LED · 3000K', cct: 3000, gain: 0.95,
                note: 'Самый частый бытовой свет. Слегка «желтит» стены — учитывайте при выборе холодных оттенков.' },
    neutral4000: { id: 'neutral4000', label: 'Нейтральный LED · 4000K', cct: 4000, gain: 0.99,
                   note: 'Компромисс между теплом и нейтральностью, часто используется на кухнях и в ванных.' },
    d50: { id: 'd50', label: 'Утренний свет · 5000K', cct: 5000, gain: 1.0,
           note: 'Мягкий дневной свет из южных окон.' },
    d65: { id: 'd65', label: 'Дневной свет D65 · 6500K', cct: 6504, white: ILLUMINANTS.D65, gain: 1.0,
           note: 'Эталонное освещение, в котором измеряются образцы. Так цвет выглядит «по паспорту».' },
    cool7500: { id: 'cool7500', label: 'Холодный северный · 7500K', cct: 7500, gain: 1.02,
                note: 'Свет из северных окон и пасмурного неба: подчёркивает синие и зелёные, гасит тёплые.' },
    dusk: { id: 'dusk', label: 'Сумерки · низкая освещённость', cct: 6504, white: ILLUMINANTS.D65, gain: 0.55,
            note: 'Вечер без включённого света: тёмные оттенки теряют детали, контраст падает.' }
  };

  var LIGHT_ORDER = ['warm2700', 'warm3000', 'neutral4000', 'd50', 'd65', 'cool7500', 'dusk'];

  /**
   * Приблизительный предпросмотр оттенка под выбранным источником света.
   *
   * Это визуальная иллюстрация «во что окрашивает поверхность лампа»,
   * а не колориметрический расчёт метамерии: реальный сдвиг зависит
   * от спектра лампы и пигментной формулы, которых у браузера нет.
   */
  function underLight(hex, sourceId) {
    var src = LIGHT_SOURCES[sourceId];
    if (!src) return normalizeHex(hex) || hex;
    return underCct(hex, src.cct, src.gain, src.white);
  }

  /**
   * То же самое, но для произвольной цветовой температуры.
   *
   * Нужно там, где источник задаётся не пресетом, а числом: например,
   * трековые светильники в комнате с диапазонами 2700–3000 / 3900–4300 /
   * 6300–6700 K.
   *
   * @param {string} hex цвет краски
   * @param {number} cct температура света, K
   * @param {number} [gain] яркость источника относительно дневного (1 = дневной)
   * @param {object} [white] готовая белая точка, если она известна точнее CCT
   */
  function underCct(hex, cct, gain, white) {
    var base = normalizeHex(hex);
    if (!base) return hex;
    var g = gain == null ? 1 : gain;

    var rgb = hexToRgb(base);
    var xyz = rgbToXyz(rgb.r, rgb.g, rgb.b);
    var dstWhite = white || cctToWhite(cct);

    var srcCone = mul3(BRADFORD, [WHITE.x, WHITE.y, WHITE.z]);
    var dstCone = mul3(BRADFORD, [dstWhite.x, dstWhite.y, dstWhite.z]);
    var cone = mul3(BRADFORD, [xyz.x, xyz.y, xyz.z]);

    // Отношение берём как есть (без обратной адаптации): глаз, вошедший
    // в комнату, ещё не адаптировался — именно этот сдвиг и хочет увидеть клиент.
    var adapted = [
      cone[0] * (dstCone[0] / srcCone[0]),
      cone[1] * (dstCone[1] / srcCone[1]),
      cone[2] * (dstCone[2] / srcCone[2])
    ];
    var back = mul3(BRADFORD_INV, adapted);

    // нормируем на яркость белого под этим источником, иначе всё уезжает в тень
    var whiteBack = mul3(BRADFORD_INV, dstCone);
    var k = (WHITE.y / Math.max(1e-6, whiteBack[1])) * g;

    var out = xyzToRgb(back[0] * k, back[1] * k, back[2] * k);
    return rgbToHex(out.r, out.g, out.b);
  }

  /* ============================================================
   *  Извлечение доминирующих цветов из изображения
   *  k-means++ в пространстве Lab с отсевом «мусорных» пикселей.
   * ============================================================ */

  /**
   * @param {ImageData} imageData
   * @param {number} k количество кластеров
   * @param {object} [opts] { maxSamples, iterations, ignoreExtremes, minSaturation }
   * @returns {Array<{hex,lab,share,count}>} отсортировано по доле в кадре
   */
  function extractDominantColors(imageData, k, opts) {
    opts = opts || {};
    var maxSamples = opts.maxSamples || 24000;
    var iterations = opts.iterations || 24;
    var ignoreExtremes = opts.ignoreExtremes !== false;

    var data = imageData.data;
    var total = data.length / 4;
    var step = Math.max(1, Math.floor(total / maxSamples));

    var samples = [];
    for (var i = 0; i < total; i += step) {
      var o = i * 4;
      var a = data[o + 3];
      if (a < 125) continue;
      var r = data[o], g = data[o + 1], b = data[o + 2];
      if (ignoreExtremes) {
        // почти чёрные и выбитые в белое пиксели искажают кластеризацию
        var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (mx < 12) continue;
        if (mn > 249) continue;
      }
      var lab = rgbToLab(r, g, b);
      samples.push([lab.l, lab.a, lab.b]);
    }

    if (!samples.length) return [];
    k = Math.max(1, Math.min(k || 4, samples.length));

    var centers = kmeansPlusPlusInit(samples, k);
    var assign = new Array(samples.length).fill(0);

    for (var it = 0; it < iterations; it++) {
      var moved = false;
      for (var s = 0; s < samples.length; s++) {
        var best = 0, bestD = Infinity;
        for (var c = 0; c < centers.length; c++) {
          var d = sqDist(samples[s], centers[c]);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[s] !== best) { assign[s] = best; moved = true; }
      }
      var sums = centers.map(function () { return [0, 0, 0, 0]; });
      for (var s2 = 0; s2 < samples.length; s2++) {
        var t = sums[assign[s2]];
        t[0] += samples[s2][0]; t[1] += samples[s2][1]; t[2] += samples[s2][2]; t[3]++;
      }
      for (var c2 = 0; c2 < centers.length; c2++) {
        if (sums[c2][3] > 0) {
          centers[c2] = [sums[c2][0] / sums[c2][3], sums[c2][1] / sums[c2][3], sums[c2][2] / sums[c2][3]];
        }
      }
      if (!moved && it > 2) break;
    }

    var counts = centers.map(function () { return 0; });
    for (var s3 = 0; s3 < assign.length; s3++) counts[assign[s3]]++;

    var result = centers.map(function (c, idx) {
      var lab = { l: c[0], a: c[1], b: c[2] };
      return {
        hex: labToHex(lab.l, lab.a, lab.b),
        lab: lab,
        lch: labToLch(lab.l, lab.a, lab.b),
        count: counts[idx],
        share: counts[idx] / samples.length
      };
    }).filter(function (c) { return c.count > 0; });

    result.sort(function (a, b) { return b.share - a.share; });
    return result;

    function sqDist(p, q) {
      var d0 = p[0] - q[0], d1 = p[1] - q[1], d2 = p[2] - q[2];
      return d0 * d0 + d1 * d1 + d2 * d2;
    }

    function kmeansPlusPlusInit(pts, kk) {
      var cs = [pts[Math.floor(pts.length / 2)].slice()];
      var dist = new Array(pts.length).fill(Infinity);
      while (cs.length < kk) {
        var sum = 0;
        for (var i2 = 0; i2 < pts.length; i2++) {
          var d2v = sqDist(pts[i2], cs[cs.length - 1]);
          if (d2v < dist[i2]) dist[i2] = d2v;
          sum += dist[i2];
        }
        if (sum <= 0) break;
        // детерминированный выбор: сервис должен давать один и тот же результат
        var target = sum * ((cs.length * 0.6180339887) % 1);
        var acc = 0, pick = pts.length - 1;
        for (var i3 = 0; i3 < pts.length; i3++) {
          acc += dist[i3];
          if (acc >= target) { pick = i3; break; }
        }
        cs.push(pts[pick].slice());
      }
      return cs;
    }
  }

  /** Средний цвет области радиусом r вокруг точки — для «мягкой» пипетки. */
  function averageAt(imageData, x, y, radius) {
    var w = imageData.width, h = imageData.height, d = imageData.data;
    var r = radius == null ? 2 : radius;
    var sl = 0, sa = 0, sb = 0, n = 0;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        var px = x + dx, py = y + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        var o = (py * w + px) * 4;
        if (d[o + 3] < 125) continue;
        var lab = rgbToLab(d[o], d[o + 1], d[o + 2]);
        sl += lab.l; sa += lab.a; sb += lab.b; n++;
      }
    }
    if (!n) return null;
    var lab2 = { l: sl / n, a: sa / n, b: sb / n };
    return { hex: labToHex(lab2.l, lab2.a, lab2.b), lab: lab2, lch: labToLch(lab2.l, lab2.a, lab2.b) };
  }

  /* ============================================================
   *  Гармонические схемы
   * ============================================================ */

  /* ============================================================
   *  Круг Иттена
   *
   *  Схемы сочетаний придуманы для художественного круга RYB, где
   *  красный напротив зелёного, жёлтый напротив фиолетового, синий
   *  напротив оранжевого. Поворот тона прямо в LCh даёт другое:
   *  красному там противостоит голубой, синему — жёлто-зелёный.
   *  Поэтому углы схем откладываются по кругу Иттена, а потом
   *  переводятся в LCh, где считается всё остальное.
   *
   *  Опоры — двенадцать тонов круга в приближении sRGB. Их тон в LCh
   *  строго возрастает по кругу, поэтому перевод в обе стороны
   *  однозначен. Шаг между опорами неравномерен, и это свойство
   *  самого круга: голубую область он почти не различает, отводя ей
   *  один сектор «сине-зелёного».
   * ============================================================ */

  var ITTEN_WHEEL = [
    { a: 0,   hex: '#C1272D', label: 'красный' },
    { a: 30,  hex: '#E2551E', label: 'красно-оранжевый' },
    { a: 60,  hex: '#F28E1C', label: 'оранжевый' },
    { a: 90,  hex: '#FDBA0B', label: 'жёлто-оранжевый' },
    { a: 120, hex: '#FFE800', label: 'жёлтый' },
    { a: 150, hex: '#97C11F', label: 'жёлто-зелёный' },
    { a: 180, hex: '#3AA935', label: 'зелёный' },
    { a: 210, hex: '#10A08A', label: 'сине-зелёный' },
    { a: 240, hex: '#0B6FB4', label: 'синий' },
    { a: 270, hex: '#3B4B9E', label: 'сине-фиолетовый' },
    { a: 300, hex: '#663A82', label: 'фиолетовый' },
    { a: 330, hex: '#A0248C', label: 'красно-фиолетовый' }
  ];

  var ITTEN_HUES = ITTEN_WHEEL.map(function (w) {
    var lab = hexToLab(w.hex);
    return labToLch(lab.l, lab.a, lab.b).h;
  });

  function norm360(v) { return ((v % 360) + 360) % 360; }

  /** Угол на круге Иттена → тон в LCh. */
  function ittenToLch(angle) {
    var a = norm360(angle);
    var i = Math.floor(a / 30) % 12;
    var t = (a - i * 30) / 30;
    var h0 = ITTEN_HUES[i];
    var span = norm360(ITTEN_HUES[(i + 1) % 12] - h0);
    return norm360(h0 + span * t);
  }

  /** Тон в LCh → угол на круге Иттена. */
  function lchToItten(hue) {
    var h = norm360(hue);
    for (var i = 0; i < 12; i++) {
      var h0 = ITTEN_HUES[i];
      var span = norm360(ITTEN_HUES[(i + 1) % 12] - h0);
      var d = norm360(h - h0);
      if (d < span) return norm360(i * 30 + 30 * d / span);
    }
    return 0;
  }

  /** Повернуть тон на delta градусов по кругу Иттена. */
  function rotateHue(hue, delta) {
    if (!delta) return norm360(hue);
    return ittenToLch(lchToItten(hue) + delta);
  }

  var HARMONY_SCHEMES = [
    { id: 'monochrome', label: 'Монохромная', offsets: [0, 0, 0, 0],
      desc: 'Один тон в разной светлоте и насыщенности. Самая спокойная схема: интерьер читается цельным, ошибиться почти невозможно.' },
    { id: 'analogous', label: 'Аналоговая', offsets: [0, -30, 30, -60],
      desc: 'Соседние участки цветового круга. Мягкие природные переходы — так выглядят лес, песчаный берег, закат.' },
    { id: 'complementary', label: 'Комплементарная', offsets: [0, 180, 180, 0],
      desc: 'Противоположные тона круга. Максимальный контраст: основной цвет на стенах, дополнительный — в текстиле и декоре.' },
    { id: 'split_complementary', label: 'Раздельно-комплементарная', offsets: [0, 150, 210, 30],
      desc: 'Смягчённый контраст: вместо одного противоположного тона берутся два соседних с ним. Живее монохрома, спокойнее комплементарной.' },
    { id: 'triad', label: 'Триада', offsets: [0, 120, 240, 60],
      desc: 'Три равноудалённых тона. Насыщенная и уравновешенная схема — держите один цвет доминирующим.' },
    { id: 'tetrad', label: 'Прямоугольник', offsets: [0, 60, 180, 240],
      desc: 'Две комплементарные пары. Богатая палитра для просторных помещений и зонирования.' },
    { id: 'square', label: 'Квадрат', offsets: [0, 90, 180, 270],
      desc: 'Четыре тона через равные 90°. Динамичная схема для смелых интерьеров и детских.' },
    { id: 'accented_analogous', label: 'Аналоговая с акцентом', offsets: [0, -35, 35, 180],
      desc: 'Спокойная аналоговая база плюс один противоположный акцент — универсальный рецепт жилой комнаты.' }
  ];

  /**
   * Строит гармонию от базового цвета.
   * Светлота и хрома подстраиваются под роли 60/30/10,
   * поэтому схема сразу пригодна для интерьера, а не только «по кругу».
   */
  function buildHarmony(baseHex, schemeId, options) {
    options = options || {};
    var scheme = HARMONY_SCHEMES.filter(function (s) { return s.id === schemeId; })[0] || HARMONY_SCHEMES[0];
    var lab = hexToLab(baseHex);
    if (!lab) return null;
    var base = labToLch(lab.l, lab.a, lab.b);

    // Нейтральные цвета не имеют выраженного тона — даём ему опору,
    // иначе поворот на 120° или 180° не меняет ничего.
    var baseHue = base.c < 3 ? (options.fallbackHue == null ? 60 : options.fallbackHue) : base.h;

    // Производным цветам нужна рабочая хрома: у базы с C=3 все схемы
    // выродились бы в один и тот же серый, и раздел потерял бы смысл.
    var baseChroma = Math.max(base.c, 3);
    var workChroma = Math.max(baseChroma, options.minChroma == null ? 18 : options.minChroma);

    /*
     * Светлота производных цветов раскладывается по фактическому запасу:
     * у почти чёрной базы уходить «ещё темнее» некуда, у почти белой —
     * «ещё светлее». Поэтому основной ход всегда идёт в ту сторону,
     * где места больше, а четвёртый цвет возвращается назад, если там
     * остаётся хотя бы небольшой зазор.
     */
    var LO = 12, HI = 95;
    var roomUp = HI - base.l;
    var roomDown = base.l - LO;
    var far = roomUp >= roomDown ? 1 : -1;
    var farRoom = Math.max(roomUp, roomDown);
    var nearRoom = Math.min(roomUp, roomDown);

    function toFar(fraction) { return clamp(base.l + far * farRoom * fraction, LO, HI); }
    function toNear(fraction) {
      // зазора в обратную сторону нет — ставим цвет между базой и первым шагом
      if (nearRoom < 14) return toFar(fraction * 0.28);
      return clamp(base.l - far * nearRoom * fraction, LO - 2, HI + 1);
    }

    var plan = scheme.id === 'monochrome'
      ? [
          { dh: 0, l: base.l, c: baseChroma },
          { dh: 0, l: toFar(0.34), c: workChroma * 0.5 },
          { dh: 0, l: toFar(0.68), c: workChroma * 0.75 },
          { dh: 0, l: toNear(0.55), c: workChroma * 1.05 }
        ]
      : scheme.offsets.map(function (dh, i) {
          if (i === 0) return { dh: 0, l: base.l, c: baseChroma };
          if (i === 1) return { dh: dh, l: toFar(0.42), c: workChroma * 0.75 };
          if (i === 2) return { dh: dh, l: toFar(0.82), c: workChroma * 0.95 };
          return { dh: dh, l: toNear(0.7), c: workChroma * 1.1 };
        });

    var colors = plan.map(function (p, i) {
      var h = rotateHue(baseHue, p.dh);
      var out = i === 0 && !options.normalizeBase
        ? { l: lab.l, a: lab.a, b: lab.b }
        : fitToGamut(p.l, p.c, h);
      var hex = labToHex(out.l, out.a, out.b);
      return {
        hex: hex,
        lab: out,
        lch: labToLch(out.l, out.a, out.b),
        isBase: i === 0
      };
    });

    return { schemeId: scheme.id, label: scheme.label, desc: scheme.desc, baseHex: normalizeHex(baseHex), colors: colors };
  }

  /* ============================================================
   *  Поиск ближайших цветов в каталоге
   * ============================================================ */

  /**
   * @param {{l,a,b}} lab искомый цвет
   * @param {Array} catalog массив записей с полем lab: [l,a,b] либо {l,a,b}
   * @param {object} [opts] { limit, formula, collections, maxDeltaE, exclude }
   */
  function findNearest(lab, catalog, opts) {
    opts = opts || {};
    var limit = opts.limit || 3;
    var formula = opts.formula || 'de2000';
    var fn = (DELTA_E_FORMULAS[formula] || DELTA_E_FORMULAS.de2000).fn;
    var collections = opts.collections && opts.collections.length ? opts.collections : null;
    var maxDeltaE = opts.maxDeltaE == null ? Infinity : opts.maxDeltaE;
    var exclude = opts.exclude || null;
    // нижняя граница светлоты: потолку нельзя оказаться темнее стен,
    // а ближайший по ΔE цвет каталога об этом ничего не знает
    var minL = opts.minL == null ? -Infinity : opts.minL;

    var out = [];
    for (var i = 0; i < catalog.length; i++) {
      var item = catalog[i];
      if (collections && collections.indexOf(item.collection) === -1) continue;
      if (exclude && exclude.indexOf(item.code) !== -1) continue;
      var cl = item.lab;
      var candidate = Array.isArray(cl) ? { l: cl[0], a: cl[1], b: cl[2] } : cl;
      if (!candidate) continue;
      if (candidate.l < minL) continue;
      var de = fn(lab, candidate);
      if (de > maxDeltaE) continue;
      out.push({ color: item, deltaE: de });
    }
    out.sort(function (a, b) { return a.deltaE - b.deltaE; });
    return out.slice(0, limit);
  }

  /* ============================================================
   *  Расход краски
   * ============================================================ */

  /**
   * @param {object} p { area, coats, consumption, surfaceFactor, openings }
   *   area — площадь стен м², coats — число слоёв,
   *   consumption — расход м²/л на один слой, openings — вычитаемая площадь.
   */
  function paintCalculator(p) {
    var area = Math.max(0, p.area || 0) - Math.max(0, p.openings || 0);
    if (area <= 0) return null;
    var coats = Math.max(1, p.coats || 2);
    var perLitre = Math.max(1, p.consumption || 10);
    var factor = p.surfaceFactor == null ? 1 : p.surfaceFactor;
    var litres = (area * coats * factor) / perLitre;
    return {
      netArea: round(area, 1),
      coats: coats,
      litres: round(litres, 2),
      litresWithReserve: round(litres * 1.1, 2),
      cans: {
        l9: Math.ceil(litres * 1.1 / 9),
        l2_7: Math.ceil(litres * 1.1 / 2.7),
        l1: Math.ceil(litres * 1.1)
      }
    };
  }

  /* ============================================================
   *  Экспорт
   * ============================================================ */

  var API = {
    ILLUMINANTS: ILLUMINANTS,
    LIGHT_SOURCES: LIGHT_SOURCES,
    LIGHT_ORDER: LIGHT_ORDER,
    cctToWhite: cctToWhite,
    underCct: underCct,
    HARMONY_SCHEMES: HARMONY_SCHEMES,
    DELTA_E_FORMULAS: DELTA_E_FORMULAS,
    CVD_LABELS: CVD_LABELS,

    clamp: clamp, round: round,
    srgbToLinear: srgbToLinear, linearToSrgb: linearToSrgb,
    rgbToXyz: rgbToXyz, xyzToRgb: xyzToRgb,
    xyzToLab: xyzToLab, labToXyz: labToXyz,
    rgbToLab: rgbToLab, labToRgb: labToRgb,
    labToLch: labToLch, lchToLab: lchToLab,
    rgbToHsl: rgbToHsl, hslToRgb: hslToRgb,
    rgbToHex: rgbToHex, hexToRgb: hexToRgb,
    hexToLab: hexToLab, labToHex: labToHex, lchToHex: lchToHex,
    isHex: isHex, normalizeHex: normalizeHex,
    parseColorInput: parseColorInput, fromHex: fromHex, fromRgb: fromRgb, fromLab: fromLab,

    isInSrgbGamut: isInSrgbGamut, fitToGamut: fitToGamut,
    ITTEN_WHEEL: ITTEN_WHEEL,
    ittenToLch: ittenToLch, lchToItten: lchToItten, rotateHue: rotateHue,

    deltaE: deltaE, deltaE76: deltaE76, deltaE94: deltaE94,
    deltaECMC: deltaECMC, deltaE2000: deltaE2000, deltaEQuality: deltaEQuality,

    relativeLuminance: relativeLuminance, contrastRatio: contrastRatio,
    wcagLevel: wcagLevel, readableTextColor: readableTextColor,

    lighten: lighten, darken: darken, saturate: saturate,
    desaturate: desaturate, rotateHue: rotateHue, mix: mix, adjustLab: adjustLab,

    temperature: temperature, lrv: lrv, lrvAdvice: lrvAdvice,
    simulateCVD: simulateCVD, underLight: underLight,

    extractDominantColors: extractDominantColors, averageAt: averageAt,
    buildHarmony: buildHarmony, findNearest: findNearest,
    paintCalculator: paintCalculator
  };

  global.ArchiPaintColor = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
