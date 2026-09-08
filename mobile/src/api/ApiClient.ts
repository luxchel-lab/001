import type {
  AddToCartRequest,
  ArchiColor,
  AuthResponse,
  AuthUser,
  Cart,
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

/**
 * Единый интерфейс бэкенда. Две реализации — httpApi (боевой/мок-сервер)
 * и mockApi (полностью локальная, работает без сети). Экраны знают только
 * про этот интерфейс, поэтому переключение источника данных ничего не ломает.
 */
export interface ApiClient {
  auth: {
    requestOtp(req: RequestOtpRequest): Promise<RequestOtpResponse>;
    login(req: LoginRequest): Promise<AuthResponse>;
    me(): Promise<AuthUser>;
    logout(): Promise<void>;
  };
  colorMatch: {
    byPhoto(req: PhotoColorMatchRequest): Promise<PhotoColorMatchResponse>;
  };
  palette: {
    nearest(req: NearestColorRequest): Promise<NearestColorResponse>;
    search(query: PaletteQuery): Promise<PaletteResponse>;
    byCode(code: string): Promise<ArchiColor>;
  };
  catalog: {
    products(): Promise<Product[]>;
  };
  coverage: {
    calc(req: CoverageCalcRequest): Promise<CoverageCalcResponse>;
  };
  cart: {
    get(): Promise<Cart>;
    add(req: AddToCartRequest): Promise<Cart>;
    update(req: UpdateCartItemRequest): Promise<Cart>;
    remove(itemId: string): Promise<Cart>;
    clear(): Promise<Cart>;
  };
  order: {
    pickupPoints(): Promise<PickupPoint[]>;
    create(req: CreateOrderRequest): Promise<Order>;
    list(): Promise<OrdersResponse>;
  };
}
