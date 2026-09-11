/*!
 * ArchiPaint · podbor.photo.js
 * Перекраска поверхностей на фотографии комнаты.
 *
 * Идея та же, что у визуализаторов производителей краски: светотень берём
 * у снимка, а тон и насыщенность подменяем на те, что в банке. Пиксель
 * переводится в CIE Lab, его светлота масштабируется к светлоте краски,
 * а координаты a и b заменяются целиком. В кадре остаются складки света,
 * падающие тени, фактура штукатурки и затемнение в углах — и при этом цвет
 * на стене ровно тот, который заколеруют.
 *
 * Формат сцены:
 *   фото  — обычная картинка;
 *   маска — PNG «серый + альфа»: серый = номер поверхности, альфа =
 *           покрытие пикселя этой поверхностью (сглаживает края).
 *
 * Файл не зависит ни от DOM-библиотек, ни от остальных модулей сервиса.
 * Экспортирует ArchiPaintPhoto.
 */
(function (global) {
  'use strict';

  /* ============================================================
   *  Номера поверхностей в маске
   *
   *  Ключи совпадают с поверхностями примерки, поэтому палитра
   *  раскладывается по фотографии тем же кодом, что и по схеме.
   * ============================================================ */

  var SURFACE_BY_INDEX = {
    0: null,            // не красится: окно, ковёр, стекло
    1: 'wall',
    2: 'accentWall',
    3: 'ceiling',
    4: 'trim',
    5: 'furniture',
    6: 'door',
    7: 'floor'
  };

  var SCENES = [
    {
      id: 'living_photo',
      label: 'Гостиная',
      photo: 'living.photo.png',
      mask: 'living.mask.png',
      note: 'Демонстрационная пластина: сгенерирована tools/build-room-scene.js. ' +
            'Движок к происхождению кадра безразличен — настоящая фотография ' +
            'подставляется вместо неё без единой правки в коде.'
    }
  ];

  var config = {
    base: '/assets/rooms/',
    // Сборка в автономную страницу подменяет файлы на data-URI,
    // чтобы страница оставалась одним файлом без внешних запросов.
    urls: null
  };

  function urlFor(file) {
    if (config.urls && config.urls[file]) return config.urls[file];
    return config.base + file;
  }

  /* ============================================================
   *  Цветовая математика: ровно то, что нужно для попиксельного прохода
   *
   *  Здесь не переиспользуется podbor.color.js намеренно: там функции
   *  возвращают объекты, а на полумиллионе пикселей это полмиллиона
   *  аллокаций на каждую перерисовку.
   * ============================================================ */

  var WX = 95.047, WY = 100.0, WZ = 108.883;
  var EPS = 216 / 24389, KAPPA = 24389 / 27;

  // Линейное значение → 8 бит sRGB. Возведение в степень на каждый канал
  // каждого пикселя заметно дороже таблицы.
  var GAMMA_LUT = (function () {
    var n = 4096, lut = new Uint8Array(n + 1);
    for (var i = 0; i <= n; i++) {
      var v = i / n;
      var s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      lut[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
    }
    return lut;
  })();

  function linToByte(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 255;
    return GAMMA_LUT[(v * 4096) | 0];
  }

  var SRGB_LUT = (function () {
    var lut = new Float32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i / 255;
      lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return lut;
  })();

  function fLab(t) { return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }
  function fLabInv(t) { var t3 = t * t * t; return t3 > EPS ? t3 : (116 * t - 16) / KAPPA; }

  /* ============================================================
   *  Подготовка сцены
   * ============================================================ */

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Не загрузилось изображение: ' + src)); };
      img.decoding = 'sync';
      img.src = src;
    });
  }

  function readPixels(img, w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }

  /**
   * Разбирает кадр и маску в типизированные массивы.
   *
   * Опорная светлота поверхности — 92-й процентиль её светлот: среднее
   * увело бы вниз из-за теней, а максимум — вверх из-за случайного блика.
   * Именно к ней приводится светлота краски, поэтому освещённая часть
   * стены получает ровно тот цвет, что в каталоге, а тени и углы
   * сохраняют свой перепад.
   */
  function prepare(photoImg, maskImg) {
    var w = photoImg.naturalWidth || photoImg.width;
    var h = photoImg.naturalHeight || photoImg.height;
    var n = w * h;

    var px = readPixels(photoImg, w, h);
    var mk = readPixels(maskImg, w, h);

    var L = new Float32Array(n);
    var A = new Float32Array(n);
    var B = new Float32Array(n);
    var idx = new Uint8Array(n);
    var cov = new Uint8Array(n);

    var sumA = new Float64Array(256), sumB = new Float64Array(256), cnt = new Float64Array(256);
    var hist = [];

    for (var i = 0; i < n; i++) {
      var p = i * 4;
      var r = SRGB_LUT[px[p]], g = SRGB_LUT[px[p + 1]], b = SRGB_LUT[px[p + 2]];
      var x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
      var y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100;
      var z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100;
      var fx = fLab(x / WX), fy = fLab(y / WY), fz = fLab(z / WZ);
      var l = 116 * fy - 16;
      L[i] = l;
      A[i] = 500 * (fx - fy);
      B[i] = 200 * (fy - fz);

      var si = mk[p];                 // серый канал маски
      idx[i] = si;
      cov[i] = mk[p + 3];             // альфа — покрытие
      if (!SURFACE_BY_INDEX[si]) continue;
      sumA[si] += A[i]; sumB[si] += B[i]; cnt[si]++;
      if (!hist[si]) hist[si] = [];
      // для процентиля хватает гистограммы по целым значениям L
      var bucket = l < 0 ? 0 : l > 100 ? 100 : Math.round(l);
      hist[si][bucket] = (hist[si][bucket] || 0) + 1;
    }

    var refL = new Float32Array(256);
    var meanA = new Float32Array(256);
    var meanB = new Float32Array(256);
    for (var s = 0; s < 256; s++) {
      if (!cnt[s]) continue;
      meanA[s] = sumA[s] / cnt[s];
      meanB[s] = sumB[s] / cnt[s];
      var need = cnt[s] * 0.92, acc = 0, k = 0;
      for (k = 0; k <= 100; k++) {
        acc += hist[s][k] || 0;
        if (acc >= need) break;
      }
      refL[s] = Math.max(6, k);
    }

    // Заранее считаем то, что не зависит от краски: во сколько раз пиксель
    // темнее освещённой части своей поверхности и насколько его собственный
    // оттенок отличается от среднего — это и есть фактура.
    var ratio = new Float32Array(n);
    var dA = new Float32Array(n);
    var dB = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var id = idx[i];
      if (!SURFACE_BY_INDEX[id] || !refL[id]) continue;
      ratio[i] = L[i] / refL[id];
      dA[i] = A[i] - meanA[id];
      dB[i] = B[i] - meanB[id];
    }

    return {
      width: w, height: h,
      src: px, idx: idx, cov: cov,
      ratio: ratio, dA: dA, dB: dB,
      out: new Uint8ClampedArray(n * 4)
    };
  }

  /* ============================================================
   *  Перекраска
   * ============================================================ */

  function hexToLab(hex) {
    var s = String(hex).trim().replace(/^#/, '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    var r = SRGB_LUT[parseInt(s.slice(0, 2), 16)];
    var g = SRGB_LUT[parseInt(s.slice(2, 4), 16)];
    var b = SRGB_LUT[parseInt(s.slice(4, 6), 16)];
    var x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
    var y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100;
    var z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100;
    var fx = fLab(x / WX), fy = fLab(y / WY), fz = fLab(z / WZ);
    return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  // Насколько сохраняется собственная пестрота снимка. Ноль дал бы
  // идеально гладкую заливку — стена перестала бы выглядеть стеной.
  var TEXTURE_KEEP = 0.55;

  /**
   * @param {object} scene результат prepare()
   * @param {object} colors { wall:'#RRGGBB', ceiling:'#…', … }
   * @param {CanvasRenderingContext2D} ctx
   */
  function paint(scene, colors, ctx) {
    var n = scene.width * scene.height;
    var src = scene.src, out = scene.out;
    var idx = scene.idx, cov = scene.cov, ratio = scene.ratio, dA = scene.dA, dB = scene.dB;

    // целевые Lab по номеру поверхности — считаем один раз на перерисовку
    var tL = new Float32Array(256), tA = new Float32Array(256), tB = new Float32Array(256);
    var on = new Uint8Array(256);
    Object.keys(SURFACE_BY_INDEX).forEach(function (key) {
      var s = +key, name = SURFACE_BY_INDEX[s];
      if (!name || !colors || !colors[name]) return;
      var lab = hexToLab(colors[name]);
      if (!lab) return;
      on[s] = 1; tL[s] = lab.l; tA[s] = lab.a; tB[s] = lab.b;
    });

    for (var i = 0; i < n; i++) {
      var p = i * 4;
      var s2 = idx[i];
      if (!on[s2]) {
        out[p] = src[p]; out[p + 1] = src[p + 1]; out[p + 2] = src[p + 2]; out[p + 3] = 255;
        continue;
      }

      var l = tL[s2] * ratio[i];
      if (l < 0) l = 0; else if (l > 100) l = 100;
      var a = tA[s2] + dA[i] * TEXTURE_KEEP;
      var b = tB[s2] + dB[i] * TEXTURE_KEEP;

      var fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
      var X = WX * fLabInv(fx), Y = WY * fLabInv(fy), Z = WZ * fLabInv(fz);
      X /= 100; Y /= 100; Z /= 100;
      var r = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314;
      var g = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560;
      var bb = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252;

      var R = linToByte(r), G = linToByte(g), Bv = linToByte(bb);

      // край маски: мягко смешиваем с исходным пикселем, иначе по контуру
      // поверхности идёт зубчатая лесенка
      var c = cov[i];
      if (c < 255) {
        var t = c / 255, u = 1 - t;
        R = R * t + src[p] * u;
        G = G * t + src[p + 1] * u;
        Bv = Bv * t + src[p + 2] * u;
      }
      out[p] = R; out[p + 1] = G; out[p + 2] = Bv; out[p + 3] = 255;
    }

    ctx.putImageData(new ImageData(out, scene.width, scene.height), 0, 0);
  }

  /** Загружает кадр и маску сцены. Результат кэшируется. */
  var cache = {};
  function load(scene) {
    if (cache[scene.id]) return cache[scene.id];
    cache[scene.id] = Promise.all([
      loadImage(urlFor(scene.photo)),
      loadImage(urlFor(scene.mask))
    ]).then(function (imgs) {
      return prepare(imgs[0], imgs[1]);
    }).catch(function (err) {
      delete cache[scene.id];   // даём следующему вызову шанс
      throw err;
    });
    return cache[scene.id];
  }

  global.ArchiPaintPhoto = {
    SCENES: SCENES,
    SURFACE_BY_INDEX: SURFACE_BY_INDEX,
    config: config,
    getScene: function (id) {
      return SCENES.filter(function (s) { return s.id === id; })[0] || null;
    },
    load: load,
    prepare: prepare,
    paint: paint
  };
})(typeof window !== 'undefined' ? window : globalThis);
