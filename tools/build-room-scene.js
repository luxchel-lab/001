/*!
 * tools/build-room-scene.js
 *
 * Генерирует демонстрационные «фотопластины» комнат и маски их
 * поверхностей — ровно в том формате, в каком движок примерки ждёт
 * настоящие фотографии.
 *
 * Пластины синтетические: их задача — показать, что конвейер работает,
 * пока не сняты реальные кадры. Перекраска в Lab к происхождению кадра
 * безразлична: ей нужны только светотень снимка и маска.
 *
 *   assets/rooms/<id>.photo.png  RGB, сама сцена
 *   assets/rooms/<id>.mask.png   серый + альфа: серый — номер поверхности,
 *                                альфа — покрытие пикселя этой поверхностью
 *
 * Запуск: node tools/build-room-scene.js [id …]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { encode } = require('./png');

/* ============================================================
 *  Номера поверхностей в маске
 * ============================================================ */

const S = {
  none:   0,   // не красится: окно, столешница, постель, ковёр
  wall:   1,
  accent: 2,
  ceiling: 3,
  trim:   4,
  furn:   5,
  door:   6,
  floor:  7
};

/* ============================================================
 *  Шум
 * ============================================================ */

function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smoothstep(t) { return t * t * (3 - 2 * t); }

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smoothstep(x - xi), yf = smoothstep(y - yi), zf = smoothstep(z - zi);
  let v = 0;
  for (let dz = 0; dz < 2; dz++) {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
        v += w * hash3(xi + dx, yi + dy, zi + dz);
      }
    }
  }
  return v;
}

function fbm(x, y, z, octaves) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < (octaves || 3); i++) {
    s += a * noise3(x * f, y * f, z * f);
    norm += a; a *= 0.5; f *= 2;
  }
  return s / norm;
}

/* ============================================================
 *  Кадр
 * ============================================================ */

const OUT_W = 1000, OUT_H = 660;
const SS = 2;
const RW = OUT_W * SS, RH = OUT_H * SS;
const FOCAL = RW * 0.62;
const CX = RW * 0.5, CY = RH * 0.46;

const TRIM_H = 0.11;     // плинтус
const RAIL_H = 0.07;     // карниз у потолка

/* ============================================================
 *  Материалы предметов
 *
 *  mat — номер в маске, alb — базовый цвет пластины, tex — фактура.
 *  Столешницы, техника и постель помечены `none`: краской их не красят,
 *  но в общем свете они живут наравне со всем остальным.
 * ============================================================ */

const MATERIALS = {
  fabric:  { mat: S.furn, alb: [0.55, 0.58, 0.54], tex: 'fabric' },
  fabricL: { mat: S.furn, alb: [0.58, 0.57, 0.53], tex: 'fabric' },
  panel:   { mat: S.furn, alb: [0.62, 0.58, 0.52], tex: 'panel'  },
  woodFur: { mat: S.furn, alb: [0.50, 0.38, 0.26], tex: 'wood'   },
  stone:   { mat: S.none, alb: [0.42, 0.42, 0.40], tex: 'stone'  },
  stoneL:  { mat: S.none, alb: [0.70, 0.69, 0.66], tex: 'stone'  },
  steel:   { mat: S.none, alb: [0.52, 0.54, 0.55], tex: 'plain'  },
  linen:   { mat: S.none, alb: [0.80, 0.78, 0.74], tex: 'fabric' },
  rugMat:  { mat: S.none, alb: [0.74, 0.69, 0.60], tex: 'rug'    },
  glassD:  { mat: S.none, alb: [0.18, 0.19, 0.20], tex: 'plain'  },
  paper:   { mat: S.none, alb: [0.86, 0.85, 0.82], tex: 'plain'  }
};

function prop(box, material) {
  const m = MATERIALS[material];
  return Object.assign({}, box, { mat: m.mat, alb: m.alb, tex: m.tex });
}

/* ============================================================
 *  Комнаты
 * ============================================================ */

function shelfRun(x, y0, y1, z0, z1, count, material) {
  // стеллаж: цоколь, задняя стенка и полки через равные промежутки
  const out = [
    prop({ x0: x, x1: x + 0.34, y0: 0, y1: y0, z0: z0, z1: z1 }, material),
    prop({ x0: x + 0.30, x1: x + 0.34, y0: y0, y1: y1 + 0.035, z0: z0, z1: z1 }, material)
  ];
  for (let i = 0; i <= count; i++) {
    const y = y0 + (y1 - y0) * i / count;
    out.push(prop({ x0: x, x1: x + 0.34, y0: y, y1: y + 0.035, z0: z0, z1: z1 }, material));
  }
  out.push(prop({ x0: x, x1: x + 0.34, y0: y0, y1: y1 + 0.035, z0: z0, z1: z0 + 0.03 }, material));
  out.push(prop({ x0: x, x1: x + 0.34, y0: y0, y1: y1 + 0.035, z0: z1 - 0.03, z1: z1 }, material));
  return out;
}

function chairsAround(cx, cz, material) {
  // четыре стула вокруг стола: сиденье плюс спинка
  const out = [];
  const put = function (x, z, backAlongX) {
    out.push(prop({ x0: x - 0.22, x1: x + 0.22, y0: 0.40, y1: 0.46, z0: z - 0.22, z1: z + 0.22 }, material));
    [[-0.20, -0.20], [0.16, -0.20], [-0.20, 0.16], [0.16, 0.16]].forEach(function (o) {
      out.push(prop({ x0: x + o[0], x1: x + o[0] + 0.04, y0: 0, y1: 0.40,
                      z0: z + o[1], z1: z + o[1] + 0.04 }, material));
    });
    if (backAlongX) {
      out.push(prop({ x0: x - 0.22, x1: x + 0.22, y0: 0.46, y1: 0.86, z0: z + 0.18, z1: z + 0.22 }, material));
    } else {
      out.push(prop({ x0: x + 0.18, x1: x + 0.22, y0: 0.46, y1: 0.86, z0: z - 0.22, z1: z + 0.22 }, material));
    }
  };
  put(cx - 0.82, cz, false);
  put(cx + 0.82, cz, false);
  put(cx, cz - 0.78, true);
  put(cx, cz + 0.78, true);
  return out;
}

const ROOMS = [
  /* ---------------- Гостиная ---------------- */
  {
    id: 'living', label: 'Гостиная',
    W: 4.2, H: 2.8, D: 5.2, eye: 1.45, cam: 0.9,
    win: { z0: 1.5, z1: 3.4, y0: 0.85, y1: 2.25 },
    door: { z0: 0.9, z1: 2.0, y1: 2.1 },
    floor: 'wood',
    rug: { x0: 1.05, x1: 3.25, z0: 2.65, z1: 4.15 },
    props: [
      prop({ x0: 1.10, x1: 3.20, y0: 0.00, y1: 0.30, z0: 4.35, z1: 4.92 }, 'panel'),
      prop({ x0: 1.02, x1: 3.28, y0: 0.30, y1: 0.50, z0: 4.26, z1: 4.96 }, 'fabric'),
      prop({ x0: 1.02, x1: 3.28, y0: 0.30, y1: 0.96, z0: 4.86, z1: 5.04 }, 'fabric'),
      prop({ x0: 1.02, x1: 3.28, y0: 0.50, y1: 0.86, z0: 4.72, z1: 4.90 }, 'fabric'),
      prop({ x0: 1.02, x1: 1.26, y0: 0.30, y1: 0.68, z0: 4.26, z1: 5.04 }, 'fabric'),
      prop({ x0: 3.04, x1: 3.28, y0: 0.30, y1: 0.68, z0: 4.26, z1: 5.04 }, 'fabric'),
      // низкий столик перед диваном
      prop({ x0: 1.72, x1: 2.58, y0: 0.36, y1: 0.42, z0: 2.85, z1: 3.55 }, 'woodFur'),
      prop({ x0: 1.78, x1: 1.90, y0: 0.00, y1: 0.36, z0: 2.92, z1: 3.04 }, 'woodFur'),
      prop({ x0: 2.40, x1: 2.52, y0: 0.00, y1: 0.36, z0: 2.92, z1: 3.04 }, 'woodFur'),
      prop({ x0: 1.78, x1: 1.90, y0: 0.00, y1: 0.36, z0: 3.36, z1: 3.48 }, 'woodFur'),
      prop({ x0: 2.40, x1: 2.52, y0: 0.00, y1: 0.36, z0: 3.36, z1: 3.48 }, 'woodFur')
    ],
    casters: [{ x0: 1.02, x1: 3.28, y0: 0, y1: 0.96, z0: 4.26, z1: 5.04 },
              { x0: 1.72, x1: 2.58, y0: 0, y1: 0.42, z0: 2.85, z1: 3.55 }]
  },

  /* ---------------- Столовая ---------------- */
  {
    id: 'dining', label: 'Столовая',
    W: 4.4, H: 2.9, D: 5.0, eye: 1.5, cam: 0.85,
    win: { z0: 1.4, z1: 3.5, y0: 0.9, y1: 2.35 },
    door: { z0: 0.8, z1: 1.9, y1: 2.1 },
    floor: 'wood',
    rug: null,
    props: [
      // стол
      prop({ x0: 1.28, x1: 3.12, y0: 0.72, y1: 0.78, z0: 2.95, z1: 4.05 }, 'woodFur'),
      prop({ x0: 1.42, x1: 1.56, y0: 0.00, y1: 0.72, z0: 3.06, z1: 3.20 }, 'woodFur'),
      prop({ x0: 2.84, x1: 2.98, y0: 0.00, y1: 0.72, z0: 3.06, z1: 3.20 }, 'woodFur'),
      prop({ x0: 1.42, x1: 1.56, y0: 0.00, y1: 0.72, z0: 3.80, z1: 3.94 }, 'woodFur'),
      prop({ x0: 2.84, x1: 2.98, y0: 0.00, y1: 0.72, z0: 3.80, z1: 3.94 }, 'woodFur')
    ].concat(chairsAround(2.2, 3.5, 'fabricL')).concat([
      // буфет у задней стены
      prop({ x0: 1.22, x1: 3.18, y0: 0.06, y1: 1.02, z0: 4.58, z1: 4.98 }, 'panel'),
      prop({ x0: 1.18, x1: 3.22, y0: 1.02, y1: 1.08, z0: 4.54, z1: 5.00 }, 'stoneL')
    ]),
    casters: [{ x0: 1.28, x1: 3.12, y0: 0, y1: 0.90, z0: 2.70, z1: 4.30 },
              { x0: 1.18, x1: 3.22, y0: 0, y1: 1.08, z0: 4.54, z1: 5.00 }]
  },

  /* ---------------- Кухня ---------------- */
  {
    id: 'kitchen', label: 'Кухня',
    W: 3.8, H: 2.8, D: 4.8, eye: 1.5, cam: 0.85,
    win: { z0: 1.6, z1: 3.3, y0: 1.0, y1: 2.2 },
    door: null,
    floor: 'tile',
    floorAlbedo: [0.72, 0.69, 0.64],
    rug: null,
    props: [
      // нижний ряд вдоль задней стены
      prop({ x0: 0.10, x1: 3.70, y0: 0.10, y1: 0.86, z0: 4.16, z1: 4.78 }, 'panel'),
      prop({ x0: 0.06, x1: 3.74, y0: 0.86, y1: 0.92, z0: 4.10, z1: 4.80 }, 'stoneL'),
      // фартук
      prop({ x0: 0.06, x1: 3.74, y0: 0.92, y1: 1.46, z0: 4.76, z1: 4.80 }, 'stoneL'),
      // верхние шкафы
      prop({ x0: 0.10, x1: 1.50, y0: 1.50, y1: 2.24, z0: 4.42, z1: 4.78 }, 'panel'),
      prop({ x0: 2.35, x1: 3.70, y0: 1.50, y1: 2.24, z0: 4.42, z1: 4.78 }, 'panel'),
      // вытяжка и плита
      prop({ x0: 1.58, x1: 2.28, y0: 1.72, y1: 2.06, z0: 4.48, z1: 4.78 }, 'steel'),
      prop({ x0: 1.58, x1: 2.28, y0: 0.90, y1: 0.93, z0: 4.22, z1: 4.72 }, 'glassD'),
      // мойка
      prop({ x0: 2.60, x1: 3.30, y0: 0.88, y1: 0.91, z0: 4.24, z1: 4.68 }, 'steel'),
      // остров
      prop({ x0: 1.05, x1: 2.75, y0: 0.10, y1: 0.86, z0: 2.20, z1: 2.95 }, 'panel'),
      prop({ x0: 0.98, x1: 2.82, y0: 0.86, y1: 0.93, z0: 2.13, z1: 3.02 }, 'stoneL')
    ],
    casters: [{ x0: 0.06, x1: 3.74, y0: 0, y1: 2.24, z0: 4.10, z1: 4.80 },
              { x0: 0.98, x1: 2.82, y0: 0, y1: 0.93, z0: 2.13, z1: 3.02 }]
  },

  /* ---------------- Спальня ---------------- */
  {
    id: 'bedroom', label: 'Спальня',
    W: 4.0, H: 2.75, D: 5.0, eye: 1.42, cam: 0.9,
    win: { z0: 1.6, z1: 3.4, y0: 0.9, y1: 2.2 },
    door: { z0: 0.8, z1: 1.9, y1: 2.05 },
    floor: 'wood',
    rug: { x0: 0.95, x1: 3.05, z0: 2.45, z1: 3.60 },
    props: [
      // изголовье
      prop({ x0: 1.05, x1: 2.95, y0: 0.20, y1: 1.15, z0: 4.78, z1: 4.96 }, 'panel'),
      // основание и матрас
      prop({ x0: 1.10, x1: 2.90, y0: 0.10, y1: 0.38, z0: 2.86, z1: 4.78 }, 'woodFur'),
      prop({ x0: 1.06, x1: 2.94, y0: 0.38, y1: 0.62, z0: 2.82, z1: 4.78 }, 'linen'),
      // одеяло поверх матраса, ближе к изножью
      prop({ x0: 1.06, x1: 2.94, y0: 0.62, y1: 0.68, z0: 2.82, z1: 4.10 }, 'linen'),
      // подушки
      prop({ x0: 1.18, x1: 1.94, y0: 0.62, y1: 0.80, z0: 4.36, z1: 4.74 }, 'linen'),
      prop({ x0: 2.06, x1: 2.82, y0: 0.62, y1: 0.80, z0: 4.36, z1: 4.74 }, 'linen'),
      // тумбы
      prop({ x0: 0.42, x1: 0.94, y0: 0.12, y1: 0.54, z0: 4.40, z1: 4.92 }, 'woodFur'),
      prop({ x0: 3.06, x1: 3.58, y0: 0.12, y1: 0.54, z0: 4.40, z1: 4.92 }, 'woodFur')
    ],
    casters: [{ x0: 1.05, x1: 2.95, y0: 0, y1: 1.15, z0: 2.82, z1: 4.96 }]
  },

  /* ---------------- Кабинет ---------------- */
  {
    id: 'office', label: 'Кабинет',
    W: 3.9, H: 2.8, D: 4.6, eye: 1.48, cam: 0.85,
    win: { z0: 1.5, z1: 3.2, y0: 0.95, y1: 2.2 },
    door: { z0: 0.7, z1: 1.8, y1: 2.05 },
    floor: 'wood',
    rug: null,
    props: [
      // стол у задней стены
      prop({ x0: 0.75, x1: 2.75, y0: 0.72, y1: 0.78, z0: 3.85, z1: 4.62 }, 'woodFur'),
      prop({ x0: 0.80, x1: 0.94, y0: 0.00, y1: 0.72, z0: 3.95, z1: 4.09 }, 'woodFur'),
      prop({ x0: 2.56, x1: 2.70, y0: 0.00, y1: 0.72, z0: 3.95, z1: 4.09 }, 'woodFur'),
      prop({ x0: 0.80, x1: 2.70, y0: 0.10, y1: 0.62, z0: 4.46, z1: 4.60 }, 'panel'),
      // монитор
      prop({ x0: 1.48, x1: 2.06, y0: 0.78, y1: 0.86, z0: 4.30, z1: 4.42 }, 'steel'),
      prop({ x0: 1.32, x1: 2.22, y0: 0.86, y1: 1.32, z0: 4.34, z1: 4.38 }, 'glassD'),
      // бумаги на столе
      prop({ x0: 0.98, x1: 1.26, y0: 0.78, y1: 0.79, z0: 4.00, z1: 4.22 }, 'paper'),
      // кресло
      prop({ x0: 1.50, x1: 2.04, y0: 0.42, y1: 0.50, z0: 3.28, z1: 3.82 }, 'fabric'),
      prop({ x0: 1.50, x1: 2.04, y0: 0.50, y1: 1.10, z0: 3.28, z1: 3.38 }, 'fabric'),
      prop({ x0: 1.72, x1: 1.82, y0: 0.00, y1: 0.42, z0: 3.50, z1: 3.60 }, 'steel')
    ].concat(shelfRun(3.54, 0.35, 1.95, 2.60, 3.95, 4, 'panel')),
    casters: [{ x0: 0.75, x1: 2.75, y0: 0, y1: 0.86, z0: 3.85, z1: 4.62 },
              { x0: 1.50, x1: 2.04, y0: 0, y1: 1.10, z0: 3.28, z1: 3.82 },
              { x0: 3.54, x1: 3.88, y0: 0.35, y1: 1.99, z0: 2.60, z1: 3.95 }]
  }
];

/* ============================================================
 *  Пересечения
 * ============================================================ */

function hitBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity, axis = -1, sign = 1;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let ta = (lo[i] - o[i]) / d[i], tb = (hi[i] - o[i]) / d[i], s = -1;
    if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
    if (ta > t0) { t0 = ta; axis = i; sign = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return null;
  }
  if (axis < 0) return null;
  return { t: t0, axis: axis, sign: sign };
}

/**
 * Загораживает ли что-нибудь отрезок от точки к источнику.
 *
 * Коробку, на поверхности которой лежит сама точка, пропускаем: иначе
 * предмет затеняет сам себя целиком и остаётся только на отражённом свете.
 * Из-за этого столешницы кухни и обивка дивана выходили серыми.
 */
const SELF = 3e-3;
function blocked(px, py, pz, lx, ly, lz, casters) {
  const dx = lx - px, dy = ly - py, dz = lz - pz;
  for (let i = 0; i < casters.length; i++) {
    const c = casters[i];
    if (px > c.x0 - SELF && px < c.x1 + SELF &&
        py > c.y0 - SELF && py < c.y1 + SELF &&
        pz > c.z0 - SELF && pz < c.z1 + SELF) continue;
    const h = hitBox(px + dx * 1e-4, py + dy * 1e-4, pz + dz * 1e-4, dx, dy, dz, c);
    if (h && h.t > 1e-4 && h.t < 1) return true;
  }
  return false;
}

function trace(R, px, py) {
  const u = (px - CX) / FOCAL, v = (CY - py) / FOCAL;
  const ox = R.W / 2, oy = R.eye, oz = -R.cam;
  const dx = u, dy = v, dz = 1;

  let best = null;
  const consider = function (t, surf, nx, ny, nz) {
    if (t <= 1e-6 || (best && t >= best.t)) return;
    best = { t: t, surf: surf, nx: nx, ny: ny, nz: nz,
             x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, prop: null };
  };

  consider((R.D - oz) / dz, 'back', 0, 0, -1);
  if (dx < 0) consider((0 - ox) / dx, 'left', 1, 0, 0);
  if (dx > 0) consider((R.W - ox) / dx, 'right', -1, 0, 0);
  if (dy < 0) consider((0 - oy) / dy, 'floor', 0, 1, 0);
  if (dy > 0) consider((R.H - oy) / dy, 'ceil', 0, -1, 0);
  if (!best) return null;

  const e = 1e-3;
  if (best.x < -e || best.x > R.W + e || best.y < -e || best.y > R.H + e ||
      best.z < -e || best.z > R.D + e) return null;

  for (let i = 0; i < R.props.length; i++) {
    const h = hitBox(ox, oy, oz, dx, dy, dz, R.props[i]);
    if (!h || h.t >= best.t) continue;
    const n = [0, 0, 0]; n[h.axis] = h.sign;
    best = { t: h.t, surf: 'prop', nx: n[0], ny: n[1], nz: n[2],
             x: ox + dx * h.t, y: oy + dy * h.t, z: oz + dz * h.t, prop: R.props[i] };
  }
  return best;
}

/* ============================================================
 *  Что это за поверхность и какого она цвета
 * ============================================================ */

const ALBEDO = {};
ALBEDO[S.wall]    = [0.91, 0.88, 0.83];
ALBEDO[S.accent]  = [0.86, 0.82, 0.75];
ALBEDO[S.ceiling] = [0.95, 0.95, 0.93];
ALBEDO[S.trim]    = [0.97, 0.96, 0.94];
ALBEDO[S.door]    = [0.42, 0.34, 0.26];
ALBEDO[S.floor]   = [0.62, 0.45, 0.28];
const RUG_ALBEDO  = [0.74, 0.69, 0.60];

function classify(R, p) {
  if (p.surf === 'prop') return p.prop.mat;
  if (p.surf === 'ceil') return S.ceiling;
  if (p.surf === 'floor') {
    if (R.rug && p.x > R.rug.x0 && p.x < R.rug.x1 && p.z > R.rug.z0 && p.z < R.rug.z1) return S.none;
    return S.floor;
  }
  if (p.surf === 'left') {
    const w = R.win;
    if (p.z > w.z0 && p.z < w.z1 && p.y > w.y0 && p.y < w.y1) return S.none;
    if (p.z > w.z0 - 0.09 && p.z < w.z1 + 0.09 && p.y > w.y0 - 0.09 && p.y < w.y1 + 0.09) return S.trim;
    if (p.y < TRIM_H || p.y > R.H - RAIL_H) return S.trim;
    return S.wall;
  }
  if (p.surf === 'right') {
    const d = R.door;
    if (d) {
      if (p.z > d.z0 && p.z < d.z1 && p.y < d.y1) return S.door;
      if (p.z > d.z0 - 0.09 && p.z < d.z1 + 0.09 && p.y < d.y1 + 0.09) return S.trim;
    }
    if (p.y < TRIM_H || p.y > R.H - RAIL_H) return S.trim;
    return S.wall;
  }
  if (p.y < TRIM_H || p.y > R.H - RAIL_H) return S.trim;
  return S.accent;                     // задняя стена — акцентная
}

function albedoOf(R, idx, p) {
  if (p.surf === 'prop') return p.prop.alb;
  if (idx === S.none) return RUG_ALBEDO;
  if (idx === S.floor && R.floorAlbedo) return R.floorAlbedo;
  return ALBEDO[idx];
}

function texture(R, idx, p) {
  const kind = p.surf === 'prop' ? p.prop.tex
    : idx === S.floor ? R.floor
    : idx === S.none ? 'rug'
    : idx === S.door ? 'door' : 'plaster';

  switch (kind) {
    case 'wood': {
      const plank = Math.floor(p.x / 0.19);
      const seam = Math.abs((p.x / 0.19) % 1 - 0.5);
      const tone = 0.82 + 0.36 * hash3(plank, 7, 3);
      const grain = 0.82 + 0.36 * fbm(p.x * 34, p.z * 1.1, 11, 4);
      const cut = Math.abs((p.z / 1.35 + hash3(plank, 3, 9)) % 1 - 0.5) > 0.492 ? 0.6 : 1;
      return tone * grain * (seam > 0.465 ? 0.6 : 1) * cut;
    }
    case 'tile': {
      // крупная плитка со швом
      const sx = Math.abs((p.x / 0.42) % 1 - 0.5), sz = Math.abs((p.z / 0.42) % 1 - 0.5);
      const joint = (sx > 0.47 || sz > 0.47) ? 0.7 : 1;
      const tile = 0.93 + 0.12 * hash3(Math.floor(p.x / 0.42), 5, Math.floor(p.z / 0.42));
      return joint * tile * (0.97 + 0.05 * fbm(p.x * 22, 4, p.z * 22, 2));
    }
    case 'fabric': return 0.93 + 0.14 * fbm(p.x * 130, p.y * 130, p.z * 130, 2);
    case 'panel': {
      // филёнка: рамка по краю дверцы
      const u = Math.abs((p.x / 0.46) % 1 - 0.5);
      return (u > 0.44 ? 0.9 : 1) * (0.96 + 0.07 * fbm(p.x * 30, p.y * 30, p.z * 30, 3));
    }
    case 'stone': return 0.9 + 0.2 * fbm(p.x * 18, p.y * 18, p.z * 18, 4);
    case 'rug': return 0.88 + 0.24 * fbm(p.x * 46, 3, p.z * 46, 4);
    case 'door': return 0.9 + 0.2 * fbm(p.x * 8, p.y * 3, p.z * 40, 3);
    case 'plain': return 1;
    default:
      return 0.965 + 0.05 * fbm(p.x * 9, p.y * 9, p.z * 9, 4)
                   + 0.022 * fbm(p.x * 90, p.y * 90, p.z * 90, 2);
  }
}

/* ============================================================
 *  Свет: окно плюс два отскока
 * ============================================================ */

function makeLight(spec) {
  const pts = [];
  const nu = spec.nu, nv = spec.nv;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = spec.u0 + (spec.u1 - spec.u0) * (i + 0.5) / nu;
      const b = spec.v0 + (spec.v1 - spec.v0) * (j + 0.5) / nv;
      pts.push(spec.axis === 'x' ? { x: spec.at, y: b, z: a } : { x: a, y: spec.at, z: b });
    }
  }
  const area = Math.abs((spec.u1 - spec.u0) * (spec.v1 - spec.v0));
  return {
    pts: pts, sampleArea: area / pts.length,
    nx: spec.axis === 'x' ? spec.dir : 0,
    ny: spec.axis === 'y' ? spec.dir : 0,
    nz: 0,
    power: spec.power, tint: spec.tint, shadow: !!spec.shadow,
    soft: area / pts.length * 0.9
  };
}

function buildLights(R) {
  const w = R.win;
  return [
    makeLight({ axis: 'x', at: 0.02, dir: 1, u0: w.z0, u1: w.z1, v0: w.y0, v1: w.y1,
                nu: 6, nv: 4, power: 13.5, tint: [1.0, 1.06, 1.18], shadow: true }),
    // отскок от освещённого пола поднимает свет на потолок и на стену с окном
    makeLight({ axis: 'y', at: 0.02, dir: 1, u0: 0, u1: R.W,
                v0: Math.max(0, w.z0 - 0.9), v1: Math.min(R.D, w.z1 + 1.4),
                nu: 6, nv: 6, power: 2.3, tint: [1.10, 1.00, 0.86] }),
    // отскок от противоположной стены, на которую и падает основной свет
    makeLight({ axis: 'x', at: R.W - 0.02, dir: -1,
                u0: w.z0 - 0.5, u1: w.z1 + 0.5, v0: 0.3, v1: R.H - 0.2,
                nu: 4, nv: 3, power: 1.9, tint: [1.03, 1.00, 0.95] }),
    // Отскок от потолка. Без него все горизонтальные поверхности — стол,
    // столешница, кровать — уходят в тень: свет из бокового окна падает на
    // них почти вскользь, а отскок от пола для них идёт снизу и не считается.
    makeLight({ axis: 'y', at: R.H - 0.02, dir: -1, u0: 0, u1: R.W,
                v0: Math.max(0, w.z0 - 1.2), v1: Math.min(R.D, w.z1 + 1.8),
                nu: 5, nv: 5, power: 1.7, tint: [1.00, 1.01, 1.03] })
  ];
}

const LIT = new Float64Array(3);
function lighting(R, p) {
  LIT[0] = LIT[1] = LIT[2] = 0;
  for (let k = 0; k < R.lights.length; k++) {
    const L = R.lights[k];
    let sum = 0;
    for (let i = 0; i < L.pts.length; i++) {
      const s = L.pts[i];
      const dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < 1e-6) continue;
      const r = Math.sqrt(r2);
      const cosP = (p.nx * dx + p.ny * dy + p.nz * dz) / r;
      if (cosP <= 0) continue;
      const cosL = -(L.nx * dx + L.ny * dy + L.nz * dz) / r;
      if (cosL <= 0) continue;
      if (L.shadow && blocked(p.x, p.y, p.z, s.x, s.y, s.z, R.casters)) continue;
      // вблизи источника 1/r² взрывается на отдельных сэмплах и даёт пятна
      sum += cosP * cosL * L.sampleArea / (Math.PI * (r2 + L.soft));
    }
    const e = sum * L.power;
    LIT[0] += e * L.tint[0]; LIT[1] += e * L.tint[1]; LIT[2] += e * L.tint[2];
  }
  return LIT;
}

/* ============================================================
 *  Затенение
 * ============================================================ */

function softMin(d, k) { return 1 - Math.exp(-d / k); }
const AO_FLOOR = 0.46;

function occlusion(R, p) {
  const k = 0.42;
  let raw = 1;
  const near = function (v) { if (v < raw) raw = v; };

  if (p.surf === 'floor') {
    near(softMin(p.x, k)); near(softMin(R.W - p.x, k)); near(softMin(R.D - p.z, k * 1.5));
    // контактная тень под предметами
    for (let i = 0; i < R.casters.length; i++) {
      const c = R.casters[i];
      const dx = Math.max(c.x0 - p.x, 0, p.x - c.x1);
      const dz = Math.max(c.z0 - p.z, 0, p.z - c.z1);
      near(0.22 + 0.78 * softMin(Math.sqrt(dx * dx + dz * dz), 0.42));
    }
  } else if (p.surf === 'ceil') {
    near(softMin(p.x, k)); near(softMin(R.W - p.x, k)); near(softMin(R.D - p.z, k));
  } else if (p.surf === 'prop') {
    near(0.5 + 0.5 * softMin(p.y, 0.6));
  } else {
    near(softMin(p.y, k * 0.7)); near(softMin(R.H - p.y, k * 0.7));
    if (p.surf === 'back') { near(softMin(p.x, k)); near(softMin(R.W - p.x, k)); }
    else near(softMin(R.D - p.z, k));
  }
  return AO_FLOOR + (1 - AO_FLOOR) * raw;
}

/* ============================================================
 *  Рендер
 * ============================================================ */

const EXPOSURE = 0.82;
function toneMap(v) { const x = v * EXPOSURE; return x / (1 + x * 0.34); }
function gamma(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
function srgbToLin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

function render(R) {
  R.lights = buildLights(R);
  const photo = new Uint8Array(OUT_W * OUT_H * 3);
  const mask = new Uint8Array(OUT_W * OUT_H * 2);
  const acc = new Float64Array(3);
  const votes = new Map();

  for (let oy = 0; oy < OUT_H; oy++) {
    for (let ox = 0; ox < OUT_W; ox++) {
      acc[0] = acc[1] = acc[2] = 0;
      votes.clear();

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const p = trace(R, ox * SS + sx + 0.5, oy * SS + sy + 0.5);
          let idx = S.none, r = 0.04, g = 0.05, b = 0.06;

          if (p) {
            idx = classify(R, p);
            if (idx === S.none && p.surf === 'left') {
              const t = (p.y - R.win.y0) / (R.win.y1 - R.win.y0);
              const sky = 1.35 + 0.5 * t;
              r = sky * 0.92; g = sky * 0.97; b = sky * 1.06;
            } else {
              const alb = albedoOf(R, idx, p);
              const tex = texture(R, idx, p);
              const ao = occlusion(R, p);
              const L = lighting(R, p);
              const fill = 0.09 * ao;
              r = srgbToLin(alb[0]) * tex * (L[0] * ao + fill);
              g = srgbToLin(alb[1]) * tex * (L[1] * ao + fill);
              b = srgbToLin(alb[2]) * tex * (L[2] * ao + fill * 1.05);
            }
          }
          acc[0] += r; acc[1] += g; acc[2] += b;
          votes.set(idx, (votes.get(idx) || 0) + 1);
        }
      }

      const n = SS * SS, o3 = (oy * OUT_W + ox) * 3;
      const vx = (ox / OUT_W - 0.5) * 2, vy = (oy / OUT_H - 0.5) * 2;
      const vign = 1 - 0.17 * (vx * vx + vy * vy * 0.8);
      const grain = (hash3(ox, oy, 17) - 0.5) * 0.012;
      for (let c = 0; c < 3; c++) {
        photo[o3 + c] = Math.max(0, Math.min(255,
          Math.round((gamma(toneMap(acc[c] / n * vign)) + grain) * 255)));
      }

      let top = S.none, topN = 0;
      votes.forEach(function (cnt, id) { if (cnt > topN) { topN = cnt; top = id; } });
      const o2 = (oy * OUT_W + ox) * 2;
      mask[o2] = top;
      mask[o2 + 1] = Math.round(topN / n * 255);
    }
  }
  return { photo: photo, mask: mask };
}

/* ============================================================ */

const dir = path.join(__dirname, '..', 'assets', 'rooms');
fs.mkdirSync(dir, { recursive: true });

const only = process.argv.slice(2);
const list = only.length ? ROOMS.filter(function (r) { return only.indexOf(r.id) !== -1; }) : ROOMS;
if (!list.length) { console.error('Неизвестная комната. Доступны: ' + ROOMS.map(r => r.id).join(', ')); process.exit(1); }

list.forEach(function (R) {
  const t0 = Date.now();
  const out = render(R);
  fs.writeFileSync(path.join(dir, R.id + '.photo.png'), encode(out.photo, OUT_W, OUT_H, 2));
  fs.writeFileSync(path.join(dir, R.id + '.mask.png'), encode(out.mask, OUT_W, OUT_H, 4));
  const kb = function (f) { return Math.round(fs.statSync(path.join(dir, f)).size / 1024) + ' КБ'; };
  console.log(R.label.padEnd(10) + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с  ' +
    R.id + '.photo.png ' + kb(R.id + '.photo.png') + '  ·  ' +
    R.id + '.mask.png ' + kb(R.id + '.mask.png'));
});
