/**
 * Локальная реализация контракта — приложение работает без бэкенда вообще
 * (§4, §8.2 ТЗ). Данные держатся в памяти процесса, корзина и заказы
 * живут до перезапуска.
 *
 * Мок сознательно НЕ повторяет Decor8: визуализация имитируется — возвращаем
 * исходное фото и подобранный оттенок. Реальную картинку отдаёт бэкенд.
 */
import { ApiError } from './client';
import type { ApiClient } from './ApiClient';
import type {
  AddToCartRequest,
  ArchiColor,
  AuthResponse,
  AuthUser,
  Cart,
  CartItem,
  ColorMatch,
  CoverageCalcRequest,
  CoverageCalcResponse,
  CreateOrderRequest,
  LoginRequest,
  NearestColorRequest,
  NearestColorResponse,
  Order,
  OrdersResponse,
  PaletteQuery,
  PaletteResponse,
  PhotoColorMatchRequest,
  PhotoColorMatchResponse,
  PickupPoint,
  Product,
  RequestOtpRequest,
  RequestOtpResponse,
  UpdateCartItemRequest,
} from './types';
import { ARCHI_PALETTE, PALETTE_COLLECTIONS } from '../data/palette';
import { PRODUCTS, findProduct } from '../data/products';
import { calcCoverage } from '../services/coverage';
import { labFromRequest, nearestColors, searchPalette } from '../services/paletteSearch';

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Единственный код подтверждения в мок-режиме. */
export const MOCK_OTP = '0000';

const state = {
  user: null as AuthUser | null,
  cart: { items: [] as CartItem[], total: 0 } as Cart,
  orders: [] as Order[],
  seq: 1,
};

function recalcCart(): Cart {
  state.cart.total = state.cart.items.reduce(
    (sum, i) => sum + i.pricePerItem * i.quantity,
    0,
  );
  return { items: [...state.cart.items], total: state.cart.total };
}

function requireAuth(): AuthUser {
  if (!state.user) {
    throw new ApiError({ status: 401, message: 'Нужен вход в аккаунт' });
  }
  return state.user;
}

function priceFor(product: Product, packSizeL: number): number {
  // Крупная фасовка дешевле за литр — так же ведёт себя сайт.
  const discount = packSizeL >= 9 ? 0.85 : packSizeL >= 2.7 ? 0.92 : 1;
  return Math.round(product.priceBase * packSizeL * discount);
}

/** Псевдослучайный, но устойчивый выбор оттенка по строке (имя файла/подсказка). */
function pickByHash(seed: string, pool: ArchiColor[]): ArchiColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return pool[hash % pool.length];
}

export const mockApi: ApiClient = {
  auth: {
    async requestOtp(req: RequestOtpRequest): Promise<RequestOtpResponse> {
      await delay(400);
      if (!req.login.trim()) {
        throw new ApiError({ status: 400, message: 'Укажите телефон или email' });
      }
      return { sent: true, retryAfterSec: 60 };
    },
    async login(req: LoginRequest): Promise<AuthResponse> {
      await delay(500);
      if (req.otp && req.otp !== MOCK_OTP) {
        throw new ApiError({ status: 400, message: 'Неверный код подтверждения' });
      }
      state.user = {
        id: 'mock-user',
        name: 'Гость ArchiPaint',
        phone: req.login.includes('@') ? undefined : req.login,
        email: req.login.includes('@') ? req.login : undefined,
      };
      return { token: 'mock-token', expiresIn: 3600, user: state.user };
    },
    async me(): Promise<AuthUser> {
      await delay(150);
      return requireAuth();
    },
    async logout(): Promise<void> {
      await delay(150);
      state.user = null;
    },
  },

  colorMatch: {
    async byPhoto(req: PhotoColorMatchRequest): Promise<PhotoColorMatchResponse> {
      requireAuth();
      await delay(1600); // имитация похода на Decor8
      const seed = `${req.photo.name}|${req.prompt ?? ''}`;
      const pool = req.collection
        ? ARCHI_PALETTE.filter(c => c.collection === req.collection)
        : ARCHI_PALETTE;
      const base = pickByHash(seed, pool.length ? pool : ARCHI_PALETTE);
      const matches: ColorMatch[] = nearestColors(
        base.lab ?? [50, 0, 0],
        4,
        pool.length ? pool : ARCHI_PALETTE,
      );
      return {
        renderUrl: req.photo.uri,
        sourceUrl: req.photo.uri,
        matches,
        requestId: `mock-${Date.now()}`,
      };
    },
  },

  palette: {
    async nearest(req: NearestColorRequest): Promise<NearestColorResponse> {
      await delay(200);
      const lab = labFromRequest(req);
      if (!lab) {
        throw new ApiError({
          status: 400,
          message: 'Передайте цвет в rgb, lab или hex',
        });
      }
      return {
        matches: nearestColors(lab, req.limit ?? 5, ARCHI_PALETTE, req.collection),
      };
    },
    async search(query: PaletteQuery): Promise<PaletteResponse> {
      await delay(200);
      const { items, total } = searchPalette(query);
      return { items, total, collections: PALETTE_COLLECTIONS };
    },
    async byCode(code: string): Promise<ArchiColor> {
      await delay(120);
      const found = ARCHI_PALETTE.find(c => c.code === code);
      if (!found) {
        throw new ApiError({ status: 404, message: `Оттенок ${code} не найден` });
      }
      return found;
    },
  },

  catalog: {
    async products(): Promise<Product[]> {
      await delay(200);
      return PRODUCTS;
    },
  },

  coverage: {
    async calc(req: CoverageCalcRequest): Promise<CoverageCalcResponse> {
      await delay(150);
      const product = findProduct(req.productSku);
      if (!product) {
        throw new ApiError({ status: 404, message: 'Товар не найден' });
      }
      return calcCoverage(req.areaM2, req.layers, product);
    },
  },

  cart: {
    async get(): Promise<Cart> {
      await delay(120);
      return recalcCart();
    },
    async add(req: AddToCartRequest): Promise<Cart> {
      requireAuth();
      await delay(250);
      const product = findProduct(req.productSku);
      if (!product) {
        throw new ApiError({ status: 404, message: 'Товар не найден' });
      }
      const color = req.colorCode
        ? ARCHI_PALETTE.find(c => c.code === req.colorCode)
        : undefined;
      const existing = state.cart.items.find(
        i =>
          i.productSku === req.productSku &&
          i.packSizeL === req.packSizeL &&
          i.colorCode === req.colorCode,
      );
      if (existing) {
        existing.quantity += req.quantity;
      } else {
        state.cart.items.push({
          id: `item-${state.seq++}`,
          productSku: product.sku,
          productName: product.name,
          colorCode: color?.code,
          colorHex: color?.hex,
          packSizeL: req.packSizeL,
          quantity: req.quantity,
          pricePerItem: priceFor(product, req.packSizeL),
        });
      }
      return recalcCart();
    },
    async update(req: UpdateCartItemRequest): Promise<Cart> {
      await delay(150);
      const item = state.cart.items.find(i => i.id === req.itemId);
      if (!item) {
        throw new ApiError({ status: 404, message: 'Позиция не найдена' });
      }
      if (req.quantity <= 0) {
        state.cart.items = state.cart.items.filter(i => i.id !== req.itemId);
      } else {
        item.quantity = req.quantity;
      }
      return recalcCart();
    },
    async remove(itemId: string): Promise<Cart> {
      await delay(150);
      state.cart.items = state.cart.items.filter(i => i.id !== itemId);
      return recalcCart();
    },
    async clear(): Promise<Cart> {
      await delay(120);
      state.cart.items = [];
      return recalcCart();
    },
  },

  order: {
    async pickupPoints(): Promise<PickupPoint[]> {
      await delay(200);
      return MOCK_PICKUP_POINTS;
    },
    async create(req: CreateOrderRequest): Promise<Order> {
      requireAuth();
      await delay(700);
      if (!state.cart.items.length) {
        throw new ApiError({ status: 400, message: 'Корзина пуста' });
      }
      const order: Order = {
        id: `order-${state.seq++}`,
        number: `AP-${100000 + state.orders.length + 1}`,
        createdAt: new Date().toISOString(),
        status: req.paymentType === 'online' ? 'pending_payment' : 'new',
        statusText:
          req.paymentType === 'online' ? 'Ожидает оплаты' : 'Принят в работу',
        total: state.cart.total,
        items: [...state.cart.items],
        paymentUrl:
          req.paymentType === 'online'
            ? 'https://archipaint.ru/payment/mock'
            : undefined,
      };
      state.orders.unshift(order);
      state.cart.items = [];
      recalcCart();
      return order;
    },
    async list(): Promise<OrdersResponse> {
      requireAuth();
      await delay(250);
      return { items: state.orders };
    },
  },
};

export const MOCK_PICKUP_POINTS: PickupPoint[] = [
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

/** Сброс состояния — нужен тестам. */
export function resetMockState(): void {
  state.user = null;
  state.cart = { items: [], total: 0 };
  state.orders = [];
  state.seq = 1;
}
