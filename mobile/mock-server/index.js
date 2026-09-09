#!/usr/bin/env node
/**
 * Мок-сервер бэкенда archipaint.ru (§4, §8.2 ТЗ).
 *
 * Отдаёт ровно те эндпоинты, которые описаны в src/api/types.ts, чтобы
 * приложение можно было разрабатывать и тестировать по HTTP до появления
 * реального API. Каталог и цветовая математика берутся из кода сайта
 * (assets/js/podbor.*.js) — один источник данных для веба и приложения.
 *
 *   node mock-server/index.js            # http://localhost:4000
 *   PORT=5000 node mock-server/index.js
 *
 * Запуск приложения против него:
 *   ARCHIPAINT_USE_MOCKS=0 ARCHIPAINT_API_BASE_URL=http://10.0.2.2:4000 npm run android
 */
const path = require('path');
const express = require('express');
const cors = require('cors');

const webRoot = path.resolve(__dirname, '..', '..', 'assets', 'js');
const colorMath = require(path.join(webRoot, 'podbor.color.js'));
global.window = global.window || {};
require(path.join(webRoot, 'podbor.palette.js'));
const PALETTE = global.window.ARCHIPAINT_PALETTE;

const { PRODUCTS } = require('./products');

const PORT = Number(process.env.PORT || 4000);
const OTP = '0000';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* ------------------------------------------------------------- состояние */

const state = { users: new Map(), carts: new Map(), orders: new Map(), seq: 1 };
const TOKEN_PREFIX = 'mock-token-';

function userIdFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  return token.startsWith(TOKEN_PREFIX) ? token.slice(TOKEN_PREFIX.length) : null;
}

function requireAuth(req, res) {
  const userId = userIdFromRequest(req);
  if (!userId || !state.users.has(userId)) {
    res.status(401).json({ message: 'Нужен вход в аккаунт' });
    return null;
  }
  return userId;
}

function cartOf(userId) {
  if (!state.carts.has(userId)) {
    state.carts.set(userId, { items: [], total: 0 });
  }
  return state.carts.get(userId);
}

function recalc(cart) {
  cart.total = cart.items.reduce((sum, i) => sum + i.pricePerItem * i.quantity, 0);
  return cart;
}

/* ---------------------------------------------------------------- утилиты */

/** Математика сайта работает с объектами {l, a, b}, а контракт API — с массивами. */
const toLab = ([l, a, b]) => ({ l, a, b });

const quality = de => (de < 1 ? 'exact' : de < 2.3 ? 'close' : de < 5 ? 'visible' : 'far');

function toArchiColor(item) {
  const rgb = colorMath.hexToRgb(item.hex);
  return {
    code: item.code,
    name: item.name,
    hex: item.hex,
    rgb: [rgb.r, rgb.g, rgb.b],
    lab: item.lab,
    collection: item.collection,
    family: item.family,
  };
}

function nearest(lab, limit, collection) {
  const pool = collection ? PALETTE.filter(c => c.collection === collection) : PALETTE;
  return pool
    .map(item => {
      const de = colorMath.deltaE2000(toLab(lab), toLab(item.lab));
      return { color: toArchiColor(item), deltaE: Math.round(de * 100) / 100, quality: quality(de) };
    })
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, limit || 5);
}

function labFrom(body) {
  if (Array.isArray(body.lab)) {
    return body.lab;
  }
  if (Array.isArray(body.rgb)) {
    const lab = colorMath.rgbToLab(body.rgb[0], body.rgb[1], body.rgb[2]);
    return [lab.l, lab.a, lab.b];
  }
  if (typeof body.hex === 'string') {
    const lab = colorMath.hexToLab(body.hex);
    return lab ? [lab.l, lab.a, lab.b] : null;
  }
  return null;
}

const packsFor = (liters, sizes) => {
  const sorted = [...new Set(sizes)].sort((a, b) => b - a);
  const result = [];
  let rest = liters;
  sorted.forEach((size, index) => {
    const isLast = index === sorted.length - 1;
    const count = isLast ? Math.ceil(rest / size - 1e-9) : Math.floor(rest / size + 1e-9);
    if (count > 0) {
      result.push({ sizeL: size, count });
      rest -= count * size;
    }
  });
  return result;
};

const priceFor = (product, sizeL) => {
  const discount = sizeL >= 9 ? 0.85 : sizeL >= 2.7 ? 0.92 : 1;
  return Math.round(product.priceBase * sizeL * discount);
};

/* ------------------------------------------------------------------ /auth */

app.post('/api/auth/otp', (req, res) => {
  if (!req.body?.login) {
    return res.status(400).json({ message: 'Укажите телефон или email' });
  }
  return res.json({ sent: true, retryAfterSec: 60 });
});

app.post('/api/auth/login', (req, res) => {
  const { login, otp } = req.body || {};
  if (!login) {
    return res.status(400).json({ message: 'Укажите телефон или email' });
  }
  if (otp && otp !== OTP) {
    return res.status(400).json({ message: 'Неверный код подтверждения' });
  }
  const id = `user-${state.seq++}`;
  const user = {
    id,
    name: 'Гость ArchiPaint',
    phone: String(login).includes('@') ? undefined : login,
    email: String(login).includes('@') ? login : undefined,
  };
  state.users.set(id, user);
  return res.json({ token: `${TOKEN_PREFIX}${id}`, expiresIn: 3600, user });
});

app.get('/api/auth/me', (req, res) => {
  const userId = requireAuth(req, res);
  if (userId) {
    res.json(state.users.get(userId));
  }
});

app.post('/api/auth/logout', (req, res) => {
  const userId = userIdFromRequest(req);
  if (userId) {
    state.users.delete(userId);
  }
  res.status(204).end();
});

/* ----------------------------------------------------------- color-match */

app.post('/api/color-match/photo', (req, res) => {
  if (!requireAuth(req, res)) {
    return;
  }
  // Реальный бэкенд здесь ходит в Decor8 AI /change_wall_color.
  const base = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  setTimeout(() => {
    res.json({
      renderUrl: 'https://archipaint.ru/mock/render.jpg',
      matches: nearest(base.lab, 4),
      requestId: `mock-${Date.now()}`,
    });
  }, 800);
});

/* --------------------------------------------------------------- palette */

app.post('/api/palette/nearest', (req, res) => {
  const lab = labFrom(req.body || {});
  if (!lab) {
    return res.status(400).json({ message: 'Передайте цвет в rgb, lab или hex' });
  }
  return res.json({ matches: nearest(lab, req.body.limit, req.body.collection) });
});

app.get('/api/palette', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  const collections = [...new Set(PALETTE.map(c => c.collection))];
  let items = PALETTE;
  if (req.query.collection) {
    items = items.filter(c => c.collection === req.query.collection);
  }
  if (q) {
    items = items.filter(
      c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }
  const offset = Number(req.query.offset || 0);
  const limit = Number(req.query.limit || 60);
  res.json({
    items: items.slice(offset, offset + limit).map(toArchiColor),
    total: items.length,
    collections,
  });
});

app.get('/api/palette/:code', (req, res) => {
  const found = PALETTE.find(c => c.code === req.params.code);
  if (!found) {
    return res.status(404).json({ message: `Оттенок ${req.params.code} не найден` });
  }
  return res.json(toArchiColor(found));
});

/* --------------------------------------------------------------- catalog */

app.get('/api/catalog/products', (_req, res) => res.json({ items: PRODUCTS }));

/* --------------------------------------------------------- coverage-calc */

app.post('/api/coverage-calc', (req, res) => {
  const { areaM2, layers, productSku } = req.body || {};
  const product = PRODUCTS.find(p => p.sku === productSku);
  if (!product) {
    return res.status(404).json({ message: 'Товар не найден' });
  }
  const litersRequired =
    Math.round((Math.max(0, areaM2) * Math.max(1, layers)) / product.coverageM2PerLiter * 100) / 100;
  const packs = packsFor(litersRequired, product.packSizesL);
  const litersPurchased =
    Math.round(packs.reduce((sum, p) => sum + p.sizeL * p.count, 0) * 100) / 100;
  return res.json({
    litersRequired,
    packs,
    litersPurchased,
    price: Math.round(litersPurchased * product.priceBase),
    product,
  });
});

/* ------------------------------------------------------------------ cart */

app.get('/api/cart', (req, res) => {
  const userId = userIdFromRequest(req);
  res.json(userId ? recalc(cartOf(userId)) : { items: [], total: 0 });
});

app.post('/api/cart/items', (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) {
    return;
  }
  const { productSku, packSizeL, quantity, colorCode } = req.body || {};
  const product = PRODUCTS.find(p => p.sku === productSku);
  if (!product) {
    return res.status(404).json({ message: 'Товар не найден' });
  }
  const color = colorCode ? PALETTE.find(c => c.code === colorCode) : null;
  const cart = cartOf(userId);
  const existing = cart.items.find(
    i => i.productSku === productSku && i.packSizeL === packSizeL && i.colorCode === colorCode,
  );
  if (existing) {
    existing.quantity += quantity;
  } else {
    cart.items.push({
      id: `item-${state.seq++}`,
      productSku: product.sku,
      productName: product.name,
      colorCode: color ? color.code : undefined,
      colorHex: color ? color.hex : undefined,
      packSizeL,
      quantity,
      pricePerItem: priceFor(product, packSizeL),
    });
  }
  return res.json(recalc(cart));
});

app.patch('/api/cart/items/:id', (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) {
    return;
  }
  const cart = cartOf(userId);
  const item = cart.items.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ message: 'Позиция не найдена' });
  }
  const quantity = Number(req.body?.quantity ?? 0);
  if (quantity <= 0) {
    cart.items = cart.items.filter(i => i.id !== req.params.id);
  } else {
    item.quantity = quantity;
  }
  return res.json(recalc(cart));
});

app.delete('/api/cart/items/:id', (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) {
    return;
  }
  const cart = cartOf(userId);
  cart.items = cart.items.filter(i => i.id !== req.params.id);
  res.json(recalc(cart));
});

app.delete('/api/cart', (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) {
    return;
  }
  const cart = cartOf(userId);
  cart.items = [];
  res.json(recalc(cart));
});

/* ----------------------------------------------------------------- order */

const PICKUP_POINTS = [
  {
    id: 'pvz-1',
    title: 'ArchiPaint на Ленинском',
    address: 'Москва, Ленинский пр-т, 42',
    workingHours: 'Пн–Сб 10:00–20:00',
  },
  {
    id: 'pvz-2',
    title: 'ArchiPaint на Дыбенко',
    address: 'Санкт-Петербург, ул. Дыбенко, 15',
    workingHours: 'Ежедневно 10:00–21:00',
  },
];

app.get('/api/order/pickup-points', (_req, res) => res.json({ items: PICKUP_POINTS }));

app.post('/api/order', (req, res) => {
  const userId = requireAuth(req, res);
  if (!userId) {
    return;
  }
  const cart = cartOf(userId);
  if (!cart.items.length) {
    return res.status(400).json({ message: 'Корзина пуста' });
  }
  const orders = state.orders.get(userId) || [];
  const online = req.body?.paymentType === 'online';
  const order = {
    id: `order-${state.seq++}`,
    number: `AP-${100000 + orders.length + 1}`,
    createdAt: new Date().toISOString(),
    status: online ? 'pending_payment' : 'new',
    statusText: online ? 'Ожидает оплаты' : 'Принят в работу',
    total: cart.total,
    items: [...cart.items],
    paymentUrl: online ? 'https://archipaint.ru/payment/mock' : undefined,
  };
  orders.unshift(order);
  state.orders.set(userId, orders);
  cart.items = [];
  recalc(cart);
  return res.json(order);
});

app.get('/api/order', (req, res) => {
  const userId = requireAuth(req, res);
  if (userId) {
    res.json({ items: state.orders.get(userId) || [] });
  }
});

/* ----------------------------------------------------------------- start */

app.use((req, res) => res.status(404).json({ message: `Нет обработчика ${req.method} ${req.path}` }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Мок-бэкенд ArchiPaint: http://localhost:${PORT}`);
    console.log(`Оттенков в каталоге: ${PALETTE.length}. Код подтверждения: ${OTP}`);
  });
}

module.exports = app;
