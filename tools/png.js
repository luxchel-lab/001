/*!
 * tools/png.js — минимальный кодировщик PNG на голом Node.
 *
 * Нужен, чтобы генератор демо-сцены не тянул зависимостей: zlib есть
 * в стандартной библиотеке, остальное — заголовок, CRC и фильтры строк.
 *
 * Поддерживает два типа, которые нужны сцене:
 *   colorType 2 — RGB, фотография;
 *   colorType 4 — серый + альфа, маска (серый = номер поверхности,
 *                 альфа = покрытие пикселя этой поверхностью).
 */
'use strict';

const zlib = require('zlib');

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Фильтры PNG: выбираем на строку тот, что даёт меньшую сумму модулей. */
function filterRows(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc(h * (stride + 1));
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < h; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      cand[0][x] = row[x];
      cand[1][x] = (row[x] - a) & 0xFF;
      cand[2][x] = (row[x] - b) & 0xFF;
      cand[3][x] = (row[x] - ((a + b) >> 1)) & 0xFF;
      // Paeth
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      cand[4][x] = (row[x] - pr) & 0xFF;
    }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let s = 0;
      for (let x = 0; x < stride; x++) { const v = cand[f][x]; s += v < 128 ? v : 256 - v; }
      if (s < bestSum) { bestSum = s; best = f; }
    }
    out[y * (stride + 1)] = best;
    cand[best].copy(out, y * (stride + 1) + 1);
    prev = row;
  }
  return out;
}

/**
 * @param {Uint8Array} pixels упакованные каналы
 * @param {number} w
 * @param {number} h
 * @param {number} colorType 2 — RGB, 4 — серый+альфа
 */
function encode(pixels, w, h, colorType) {
  const bpp = colorType === 2 ? 3 : 2;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;            // глубина канала
  ihdr[9] = colorType;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = zlib.deflateSync(filterRows(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.length), w, h, bpp), { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { encode };
