/*!
 * tools/build-room-scene.js
 *
 * Генерирует демонстрационную «фотопластину» комнаты и маску её
 * поверхностей — ровно в том формате, в каком движок примерки ждёт
 * настоящие фотографии.
 *
 * Пластина синтетическая: её задача — показать, что конвейер работает,
 * пока не сняты реальные кадры. Перекраска в Lab к происхождению кадра
 * безразлична: ей нужны только светотень фотографии и маска.
 *
 *   assets/rooms/<id>.photo.png  RGB, сама сцена
 *   assets/rooms/<id>.mask.png   серый + альфа: серый — номер поверхности,
 *                                альфа — покрытие пикселя этой поверхностью
 *
 * Запуск: node tools/build-room-scene.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { encode } = require('./png');

/* ============================================================
 *  Номера поверхностей в маске
 * ============================================================ */

const SURFACE = {
  none:       0,   // не красится: окно, ковёр, растение
  wall:       1,
  accentWall: 2,
  ceiling:    3,
  trim:       4,
  furniture:  5,
  door:       6,
  floor:      7
};

/* ============================================================
 *  Шум: значения + фрактальная сумма
 * ============================================================ */

function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function smooth(t) { return t * t * (3 - 2 * t); }

function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
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

function fbm(x, y, z, octaves, lac, gain) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise3(x * f, y * f, z * f);
    norm += a;
    a *= gain == null ? 0.5 : gain;
    f *= lac == null ? 2 : lac;
  }
  return s / norm;
}

/* ============================================================
 *  Геометрия комнаты и камера
 * ============================================================ */

const W = 4.2;     // ширина, м
const H = 2.8;     // высота
const D = 5.2;     // глубина до задней стены
const EYE = 1.45;  // высота камеры
const CAM = 0.9;   // камера отстоит от передней плоскости

const OUT_W = 1000, OUT_H = 660;
const SS = 2;                       // суперсэмплинг
const RW = OUT_W * SS, RH = OUT_H * SS;
const FOCAL = RW * 0.62;
const CX = RW * 0.5, CY = RH * 0.46;

// Окно на левой стене
const WIN = { z0: 1.5, z1: 3.4, y0: 0.85, y1: 2.25 };
// Дверь на правой стене
const DOOR = { z0: 0.9, z1: 2.0, y0: 0, y1: 2.1 };
// Диван у задней стены: цоколь, сиденье, спинка и два подлокотника.
// Одна коробка читалась как тумба, а не как мебель.
const SOFA_PARTS = [
  { x0: 1.10, x1: 3.20, y0: 0.00, y1: 0.30, z0: 4.35, z1: 4.92 },  // цоколь
  { x0: 1.02, x1: 3.28, y0: 0.30, y1: 0.50, z0: 4.26, z1: 4.96 },  // сиденье
  { x0: 1.02, x1: 3.28, y0: 0.30, y1: 0.96, z0: 4.86, z1: 5.04 },  // спинка
  { x0: 1.02, x1: 3.28, y0: 0.50, y1: 0.86, z0: 4.72, z1: 4.90 },  // подушки спинки
  { x0: 1.02, x1: 1.26, y0: 0.30, y1: 0.68, z0: 4.26, z1: 5.04 },  // подлокотник слева
  { x0: 3.04, x1: 3.28, y0: 0.30, y1: 0.68, z0: 4.26, z1: 5.04 }   // подлокотник справа
];
// Для теней хватает общего габарита — так в разы меньше проверок.
const SOFA = { x0: 1.02, x1: 3.28, y0: 0.0, y1: 0.96, z0: 4.26, z1: 5.04 };
// Ковёр на полу
const RUG = { x0: 1.05, x1: 3.25, z0: 2.65, z1: 4.15 };
const TRIM_H = 0.11;           // плинтус
const RAIL_H = 0.07;           // карниз у потолка

/* ---- пересечение луча с коробкой (метод плит) ---- */
function hitBox(ox, oy, oz, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  let axis = -1, sign = 1;
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

/** Загораживает ли коробка отрезок от точки к источнику. */
function blocked(px, py, pz, lx, ly, lz, b) {
  const dx = lx - px, dy = ly - py, dz = lz - pz;
  const h = hitBox(px + dx * 1e-4, py + dy * 1e-4, pz + dz * 1e-4, dx, dy, dz, b);
  return !!h && h.t > 1e-4 && h.t < 1;
}

/* ---- что видит пиксель ---- */
function trace(px, py) {
  const u = (px - CX) / FOCAL;
  const v = (CY - py) / FOCAL;
  // луч из камеры: точка = (W/2 + u*t, EYE + v*t, t - CAM)
  const ox = W / 2, oy = EYE, oz = -CAM;
  const dx = u, dy = v, dz = 1;

  let best = null;
  function consider(t, surf, nx, ny, nz) {
    if (t <= 1e-6) return;
    if (best && t >= best.t) return;
    best = { t: t, surf: surf, nx: nx, ny: ny, nz: nz,
             x: ox + dx * t, y: oy + dy * t, z: oz + dz * t };
  }

  // стены комнаты
  consider((D - oz) / dz, 'back', 0, 0, -1);
  if (dx < 0) consider((0 - ox) / dx, 'left', 1, 0, 0);
  if (dx > 0) consider((W - ox) / dx, 'right', -1, 0, 0);
  if (dy < 0) consider((0 - oy) / dy, 'floor', 0, 1, 0);
  if (dy > 0) consider((H - oy) / dy, 'ceil', 0, -1, 0);

  if (!best) return null;
  // за пределами комнаты попадание не считается
  const e = 1e-3;
  if (best.x < -e || best.x > W + e || best.y < -e || best.y > H + e || best.z < -e || best.z > D + e) return null;

  // мебель ближе стен
  for (let i = 0; i < SOFA_PARTS.length; i++) {
    const h = hitBox(ox, oy, oz, dx, dy, dz, SOFA_PARTS[i]);
    if (!h || h.t >= best.t) continue;
    const n = [0, 0, 0]; n[h.axis] = h.sign;
    best = { t: h.t, surf: 'sofa', nx: n[0], ny: n[1], nz: n[2],
             x: ox + dx * h.t, y: oy + dy * h.t, z: oz + dz * h.t };
  }
  return best;
}

/* ============================================================
 *  Классификация поверхности и её базовый цвет
 * ============================================================ */

function classify(p) {
  const s = p.surf;
  if (s === 'sofa') return SURFACE.furniture;
  if (s === 'ceil') return (H - p.y) < 0.01 && false ? SURFACE.trim : SURFACE.ceiling;
  if (s === 'floor') {
    if (p.x > RUG.x0 && p.x < RUG.x1 && p.z > RUG.z0 && p.z < RUG.z1) return SURFACE.none;
    return SURFACE.floor;
  }
  if (s === 'left') {
    if (p.z > WIN.z0 && p.z < WIN.z1 && p.y > WIN.y0 && p.y < WIN.y1) return SURFACE.none;
    // наличник окна
    if (p.z > WIN.z0 - 0.09 && p.z < WIN.z1 + 0.09 && p.y > WIN.y0 - 0.09 && p.y < WIN.y1 + 0.09) return SURFACE.trim;
    if (p.y < TRIM_H || p.y > H - RAIL_H) return SURFACE.trim;
    return SURFACE.wall;
  }
  if (s === 'right') {
    if (p.z > DOOR.z0 && p.z < DOOR.z1 && p.y < DOOR.y1) return SURFACE.door;
    if (p.z > DOOR.z0 - 0.09 && p.z < DOOR.z1 + 0.09 && p.y < DOOR.y1 + 0.09) return SURFACE.trim;
    if (p.y < TRIM_H || p.y > H - RAIL_H) return SURFACE.trim;
    return SURFACE.wall;
  }
  // задняя стена — акцентная
  if (p.y < TRIM_H || p.y > H - RAIL_H) return SURFACE.trim;
  return SURFACE.accentWall;
}

// Базовые цвета пластины в sRGB. Настоящая фотография принесёт свои.
const ALBEDO = {};
ALBEDO[SURFACE.wall]       = [0.91, 0.88, 0.83];
ALBEDO[SURFACE.accentWall] = [0.86, 0.82, 0.75];
ALBEDO[SURFACE.ceiling]    = [0.95, 0.95, 0.93];
ALBEDO[SURFACE.trim]       = [0.97, 0.96, 0.94];
ALBEDO[SURFACE.furniture]  = [0.55, 0.58, 0.54];
ALBEDO[SURFACE.door]       = [0.42, 0.34, 0.26];
ALBEDO[SURFACE.floor]      = [0.62, 0.45, 0.28];
const RUG_ALBEDO = [0.74, 0.69, 0.60];

/** Фактура поверхности: множитель к альбедо. */
function texture(idx, p) {
  if (idx === SURFACE.floor) {
    // доски вдоль глубины, у каждой свой оттенок, плюс продольная свилеватость
    const plank = Math.floor(p.x / 0.19);
    const seam = Math.abs((p.x / 0.19) % 1 - 0.5);
    const tone = 0.82 + 0.36 * hash3(plank, 7, 3);
    const grain = 0.82 + 0.36 * fbm(p.x * 34, p.z * 1.1, 11, 4);
    const joint = seam > 0.465 ? 0.6 : 1;
    // поперечные стыки досок
    const cut = Math.abs((p.z / 1.35 + hash3(plank, 3, 9)) % 1 - 0.5) > 0.492 ? 0.78 : 1;
    return tone * grain * joint * cut;
  }
  if (idx === SURFACE.furniture) {
    return 0.93 + 0.14 * fbm(p.x * 130, p.y * 130, p.z * 130, 2);
  }
  if (idx === SURFACE.none) return 1;
  if (idx === SURFACE.door) {
    return 0.9 + 0.2 * fbm(p.x * 8, p.y * 3, p.z * 40, 3);
  }
  // штукатурка: мягкая крупная фактура плюс мелкое зерно
  return 0.965 + 0.05 * fbm(p.x * 9, p.y * 9, p.z * 9, 4) + 0.022 * fbm(p.x * 90, p.y * 90, p.z * 90, 2);
}

/* ============================================================
 *  Свет
 * ============================================================ */

/**
 * Площадной источник: прямоугольник, параллельный осям.
 * axis — нормаль ('x' | 'y'), dir — в какую сторону она смотрит.
 */
function makeLight(spec) {
  const pts = [];
  const nu = spec.nu || 4, nv = spec.nv || 3;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = spec.u0 + (spec.u1 - spec.u0) * (i + 0.5) / nu;
      const b = spec.v0 + (spec.v1 - spec.v0) * (j + 0.5) / nv;
      pts.push(spec.axis === 'x' ? { x: spec.at, y: b, z: a } : { x: a, y: spec.at, z: b });
    }
  }
  const area = Math.abs((spec.u1 - spec.u0) * (spec.v1 - spec.v0));
  return {
    pts: pts,
    sampleArea: area / pts.length,
    nx: spec.axis === 'x' ? spec.dir : 0,
    ny: spec.axis === 'y' ? spec.dir : 0,
    nz: 0,
    power: spec.power,
    tint: spec.tint,
    shadow: !!spec.shadow,
    soft: area / pts.length * 0.9
  };
}

// Само окно — главный источник.
const L_WINDOW = makeLight({ axis: 'x', at: 0.02, dir: 1,
  u0: WIN.z0, u1: WIN.z1, v0: WIN.y0, v1: WIN.y1,
  nu: 6, nv: 4, power: 13.5, tint: [1.0, 1.06, 1.18], shadow: true });

// Отскок от освещённого пола: он и поднимает свет на потолок и левую стену.
// Без этих двух источников стена с окном уходит в чёрное — в жизни так не бывает.
const L_FLOOR = makeLight({ axis: 'y', at: 0.02, dir: 1,
  u0: 0, u1: W, v0: Math.max(0, WIN.z0 - 0.9), v1: Math.min(D, WIN.z1 + 1.4),
  nu: 6, nv: 6, power: 2.3, tint: [1.10, 1.00, 0.86] });

// Отскок от противоположной стены, на которую и падает основной свет.
const L_WALL = makeLight({ axis: 'x', at: W - 0.02, dir: -1,
  u0: WIN.z0 - 0.5, u1: WIN.z1 + 0.5, v0: 0.3, v1: H - 0.2,
  nu: 4, nv: 3, power: 1.9, tint: [1.03, 1.00, 0.95] });

const LIGHTS = [L_WINDOW, L_FLOOR, L_WALL];

/** Освещённость точки одним площадным источником. */
function irradiance(p, L, out) {
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
    if (L.shadow && blocked(p.x, p.y, p.z, s.x, s.y, s.z, SOFA)) continue;
    // вблизи источника 1/r² взрывается на отдельных сэмплах и даёт пятна:
    // смягчаем знаменатель на размер одного сэмпла
    sum += cosP * cosL * L.sampleArea / (Math.PI * (r2 + L.soft));
  }
  const e = sum * L.power;
  out[0] += e * L.tint[0];
  out[1] += e * L.tint[1];
  out[2] += e * L.tint[2];
}

const LIT = new Float64Array(3);
/** Суммарный свет в точке: окно плюс два отскока. */
function lighting(p) {
  LIT[0] = LIT[1] = LIT[2] = 0;
  for (let i = 0; i < LIGHTS.length; i++) irradiance(p, LIGHTS[i], LIT);
  return LIT;
}

function softMin(d, k) { return 1 - Math.exp(-d / k); }

/**
 * Затенение в стыках и под мебелью.
 *
 * Берём минимум по расстояниям до вогнутых рёбер, а не произведение:
 * произведение трёх множителей загоняло угол в чистый чёрный, и комната
 * выглядела обведённой тушью. Снизу стоит порог — совсем неосвещённых
 * мест в комнате с окном не бывает.
 */
const AO_FLOOR = 0.46;
function occlusion(idx, p) {
  const k = 0.42;
  let raw = 1;
  const near = function (v) { if (v < raw) raw = v; };

  if (p.surf === 'floor') {
    near(softMin(p.x, k)); near(softMin(W - p.x, k)); near(softMin(D - p.z, k * 1.5));
    const dx = Math.max(SOFA.x0 - p.x, 0, p.x - SOFA.x1);
    const dz = Math.max(SOFA.z0 - p.z, 0, p.z - SOFA.z1);
    near(0.22 + 0.78 * softMin(Math.sqrt(dx * dx + dz * dz), 0.42));
  } else if (p.surf === 'ceil') {
    near(softMin(p.x, k)); near(softMin(W - p.x, k)); near(softMin(D - p.z, k));
  } else if (p.surf === 'sofa') {
    near(0.5 + 0.5 * softMin(p.y, 0.6));
  } else {
    near(softMin(p.y, k * 0.7)); near(softMin(H - p.y, k * 0.7));
    if (p.surf === 'back') { near(softMin(p.x, k)); near(softMin(W - p.x, k)); }
    else near(softMin(D - p.z, k));
  }
  return AO_FLOOR + (1 - AO_FLOOR) * raw;
}

/* ============================================================
 *  Рендер
 * ============================================================ */

const EXPOSURE = 0.82;
function toneMap(v) {
  // мягкое плечо, чтобы блики у окна не выгорали в плоский белый
  const x = v * EXPOSURE;
  return x / (1 + x * 0.34);
}
function gamma(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }
function srgbToLin(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }

function render() {
  const photo = new Uint8Array(OUT_W * OUT_H * 3);
  const mask = new Uint8Array(OUT_W * OUT_H * 2);

  const accR = new Float64Array(3);
  const votes = new Map();

  for (let oy = 0; oy < OUT_H; oy++) {
    for (let ox = 0; ox < OUT_W; ox++) {
      accR[0] = accR[1] = accR[2] = 0;
      votes.clear();

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = ox * SS + sx + 0.5;
          const py = oy * SS + sy + 0.5;
          const p = trace(px, py);

          let idx = SURFACE.none;
          let r = 0.04, g = 0.05, b = 0.06;

          if (p) {
            idx = classify(p);
            if (idx === SURFACE.none && p.surf === 'left') {
              // окно: яркое небо с лёгким градиентом
              const t = (p.y - WIN.y0) / (WIN.y1 - WIN.y0);
              const sky = 1.35 + 0.5 * t;
              r = sky * 0.92; g = sky * 0.97; b = sky * 1.06;
            } else {
              const alb = idx === SURFACE.none ? RUG_ALBEDO : ALBEDO[idx];
              const tex = idx === SURFACE.none
                ? 0.88 + 0.24 * fbm(p.x * 46, 3, p.z * 46, 4)
                : texture(idx, p);
              const ao = occlusion(idx, p);
              const L = lighting(p);
              // остаточная межотражённая подсветка: в комнате нет мест,
              // куда не долетает совсем ничего
              const fill = 0.09 * ao;
              r = srgbToLin(alb[0]) * tex * (L[0] * ao + fill);
              g = srgbToLin(alb[1]) * tex * (L[1] * ao + fill);
              b = srgbToLin(alb[2]) * tex * (L[2] * ao + fill * 1.05);
            }
          }
          accR[0] += r; accR[1] += g; accR[2] += b;
          votes.set(idx, (votes.get(idx) || 0) + 1);
        }
      }

      const n = SS * SS;
      const o3 = (oy * OUT_W + ox) * 3;
      // виньетка объектива: к углам кадра света всегда меньше
      const vx = (ox / OUT_W - 0.5) * 2, vy = (oy / OUT_H - 0.5) * 2;
      const vign = 1 - 0.17 * (vx * vx + vy * vy * 0.8);
      // лёгкое зерно — как у любой съёмки
      const grain = (hash3(ox, oy, 17) - 0.5) * 0.012;
      photo[o3]     = Math.max(0, Math.min(255, Math.round((gamma(toneMap(accR[0] / n * vign)) + grain) * 255)));
      photo[o3 + 1] = Math.max(0, Math.min(255, Math.round((gamma(toneMap(accR[1] / n * vign)) + grain) * 255)));
      photo[o3 + 2] = Math.max(0, Math.min(255, Math.round((gamma(toneMap(accR[2] / n * vign)) + grain) * 255)));

      let top = SURFACE.none, topN = 0;
      votes.forEach(function (cnt, id) { if (cnt > topN) { topN = cnt; top = id; } });
      const o2 = (oy * OUT_W + ox) * 2;
      mask[o2] = top;
      mask[o2 + 1] = Math.round(topN / n * 255);
    }
  }
  return { photo: photo, mask: mask };
}

const dir = path.join(__dirname, '..', 'assets', 'rooms');
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const out = render();
fs.writeFileSync(path.join(dir, 'living.photo.png'), encode(out.photo, OUT_W, OUT_H, 2));
fs.writeFileSync(path.join(dir, 'living.mask.png'), encode(out.mask, OUT_W, OUT_H, 4));
const kb = function (f) { return Math.round(fs.statSync(path.join(dir, f)).size / 1024) + ' КБ'; };
console.log('Сцена собрана за ' + ((Date.now() - t0) / 1000).toFixed(1) + ' с');
console.log('  living.photo.png  ' + OUT_W + '×' + OUT_H + '  ' + kb('living.photo.png'));
console.log('  living.mask.png   ' + OUT_W + '×' + OUT_H + '  ' + kb('living.mask.png'));
