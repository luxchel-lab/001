/**
 * Контракты бэкенда archipaint.ru (§4 ТЗ).
 *
 * ВНИМАНИЕ. Точные пути, формат тел и способ авторизации у владельца бэкенда
 * ещё не получены — см. §9 ТЗ и docs/API-CONTRACT.md. Эти типы зафиксированы
 * как предполагаемый контракт: приложение и мок-сервер разрабатываются по ним,
 * а при появлении реальных эндпоинтов правится только этот файл и src/api/*.
 *
 * Правило: клиент НЕ обращается к Decor8 AI напрямую и НЕ считает подбор сам —
 * ключи Decor8 и логика ΔE живут на бэкенде.
 */

/* ------------------------------------------------------------------ цвета */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export interface BrandMatch {
  brand: string; // RAL / NCS / Dulux ...
  code: string;
  name?: string;
  hex?: string;
  deltaE?: number;
}

export interface ArchiColor {
  code: string; // код цвета ARCHI, напр. AP-0224
  name: string;
  hex: string;
  rgb: Rgb;
  lab?: Lab;
  collection?: string;
  family?: string;
  brandMatches?: BrandMatch[];
}

/** Найденный оттенок вместе с оценкой близости. */
export interface ColorMatch {
  color: ArchiColor;
  deltaE: number;
  /** Человеческая оценка: 'exact' | 'close' | 'visible' | 'far'. */
  quality: MatchQuality;
}

export type MatchQuality = 'exact' | 'close' | 'visible' | 'far';

/* --------------------------------------------------------------- продукты */

export type ProductLine = 'Premium' | 'Profi';

export interface Product {
  sku: string;
  name: string; // «Premium Matt», «Профи Fasad»
  line: ProductLine;
  /** Расход, м² на литр. TBD: таблицу подтверждает товаровед (§9 ТЗ). */
  coverageM2PerLiter: number;
  priceBase: number; // цена за литр, ₽
  /** Доступная фасовка в литрах. TBD: подтвердить реальную линейку. */
  packSizesL: number[];
  description?: string;
  surfaces?: string[];
  tintable: boolean;
}

/* ------------------------------------------------------ /api/auth (§4, 5.1) */

export interface LoginRequest {
  /** Телефон в формате +7XXXXXXXXXX или email. */
  login: string;
  /** TBD: пароль или одноразовый код — зависит от того, что умеет сайт. */
  password?: string;
  otp?: string;
}

export interface AuthUser {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

export interface AuthResponse {
  /** TBD: JWT / сессионная кука / API-ключ — уточняется у владельца бэкенда. */
  token: string;
  refreshToken?: string;
  expiresIn?: number;
  user: AuthUser;
}

export interface RequestOtpRequest {
  login: string;
}

export interface RequestOtpResponse {
  sent: boolean;
  /** Через сколько секунд можно запросить код повторно. */
  retryAfterSec: number;
}

/* --------------------------------------- /api/color-match/photo (§4, 5.3) */

export interface PhotoColorMatchRequest {
  /** Фото интерьера. Передаётся multipart/form-data. */
  photo: {
    uri: string;
    name: string;
    type: string;
  };
  /** Необязательное текстовое описание желаемого стиля. */
  prompt?: string;
  /** Ограничить подбор коллекцией каталога. */
  collection?: string;
}

export interface PhotoColorMatchResponse {
  /** Ссылка на визуализацию Decor8 (стена перекрашена). */
  renderUrl: string;
  /** Исходное фото на стороне бэкенда — для показа «до/после». */
  sourceUrl?: string;
  /** Подобранные оттенки ARCHI, первый — основной. */
  matches: ColorMatch[];
  requestId: string;
}

/* ------------------------------------------ /api/palette/nearest (§4, 5.4) */

export interface NearestColorRequest {
  /** Одно из двух: измерение колориметра в RGB или в LAB. */
  rgb?: Rgb;
  lab?: Lab;
  hex?: string;
  limit?: number;
  collection?: string;
}

export interface NearestColorResponse {
  matches: ColorMatch[];
}

/* ------------------------------------------- /api/catalog (§5.6, палитра) */

export interface PaletteQuery {
  /** Поиск по коду ARCHI, названию или коду чужого стандарта (RAL 7016). */
  q?: string;
  collection?: string;
  brand?: string; // фильтр по бренду-эквиваленту
  limit?: number;
  offset?: number;
}

export interface PaletteResponse {
  items: ArchiColor[];
  total: number;
  collections: string[];
}

/* --------------------------------------- /api/coverage-calc (§4, 5.5, 6.3) */

export interface CoverageCalcRequest {
  areaM2: number;
  layers: number;
  productSku: string;
}

export interface CoverageCalcResponse {
  /** Чистая потребность до округления. */
  litersRequired: number;
  /** Округление вверх по доступной фасовке. */
  packs: { sizeL: number; count: number }[];
  litersPurchased: number;
  price: number;
  product: Product;
}

/* --------------------------------------------- /api/cart, /api/order (§4) */

export interface CartItem {
  id: string;
  productSku: string;
  productName: string;
  /** Оттенок колеровки, если товар колеруется. */
  colorCode?: string;
  colorHex?: string;
  packSizeL: number;
  quantity: number;
  pricePerItem: number;
}

export interface Cart {
  items: CartItem[];
  total: number;
}

export interface AddToCartRequest {
  productSku: string;
  packSizeL: number;
  quantity: number;
  colorCode?: string;
}

export interface UpdateCartItemRequest {
  itemId: string;
  quantity: number;
}

export type DeliveryType = 'courier' | 'pickup';
export type PaymentType = 'online' | 'cash';

export interface DeliveryAddress {
  city: string;
  street: string;
  house: string;
  apartment?: string;
  comment?: string;
}

export interface CreateOrderRequest {
  deliveryType: DeliveryType;
  address?: DeliveryAddress;
  pickupPointId?: string;
  paymentType: PaymentType;
  name: string;
  phone: string;
  email?: string;
  comment?: string;
}

export interface Order {
  id: string;
  number: string;
  createdAt: string; // ISO
  status: string;
  statusText: string;
  total: number;
  items: CartItem[];
  /** URL оплаты, если paymentType === 'online'. */
  paymentUrl?: string;
}

export interface OrdersResponse {
  items: Order[];
}

export interface PickupPoint {
  id: string;
  title: string;
  address: string;
  workingHours: string;
}

/* ------------------------------------------------------------ инфраструктура */

export interface ApiErrorShape {
  status: number;
  code?: string;
  message: string;
}
