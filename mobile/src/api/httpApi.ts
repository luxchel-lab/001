import { http } from './client';
import type { ApiClient } from './ApiClient';
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
 * Реализация поверх HTTP. Пути соответствуют схеме §4 ТЗ и мок-серверу
 * mock-server/index.js. Когда владелец бэкенда даст реальные адреса
 * (§9 ТЗ), правится только этот файл.
 */
export const httpApi: ApiClient = {
  auth: {
    async requestOtp(req: RequestOtpRequest): Promise<RequestOtpResponse> {
      const { data } = await http.post<RequestOtpResponse>(
        '/api/auth/otp',
        req,
      );
      return data;
    },
    async login(req: LoginRequest): Promise<AuthResponse> {
      const { data } = await http.post<AuthResponse>('/api/auth/login', req);
      return data;
    },
    async me(): Promise<AuthUser> {
      const { data } = await http.get<AuthUser>('/api/auth/me');
      return data;
    },
    async logout(): Promise<void> {
      await http.post('/api/auth/logout');
    },
  },

  colorMatch: {
    async byPhoto(
      req: PhotoColorMatchRequest,
    ): Promise<PhotoColorMatchResponse> {
      const form = new FormData();
      // React Native принимает такой объект как файл multipart.
      form.append('photo', req.photo as unknown as Blob);
      if (req.prompt) {
        form.append('prompt', req.prompt);
      }
      if (req.collection) {
        form.append('collection', req.collection);
      }
      const { data } = await http.post<PhotoColorMatchResponse>(
        '/api/color-match/photo',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 },
      );
      return data;
    },
  },

  palette: {
    async nearest(req: NearestColorRequest): Promise<NearestColorResponse> {
      const { data } = await http.post<NearestColorResponse>(
        '/api/palette/nearest',
        req,
      );
      return data;
    },
    async search(query: PaletteQuery): Promise<PaletteResponse> {
      const { data } = await http.get<PaletteResponse>('/api/palette', {
        params: query,
      });
      return data;
    },
    async byCode(code: string): Promise<ArchiColor> {
      const { data } = await http.get<ArchiColor>(
        `/api/palette/${encodeURIComponent(code)}`,
      );
      return data;
    },
  },

  catalog: {
    async products(): Promise<Product[]> {
      const { data } = await http.get<{ items: Product[] }>(
        '/api/catalog/products',
      );
      return data.items;
    },
  },

  coverage: {
    async calc(req: CoverageCalcRequest): Promise<CoverageCalcResponse> {
      const { data } = await http.post<CoverageCalcResponse>(
        '/api/coverage-calc',
        req,
      );
      return data;
    },
  },

  cart: {
    async get(): Promise<Cart> {
      const { data } = await http.get<Cart>('/api/cart');
      return data;
    },
    async add(req: AddToCartRequest): Promise<Cart> {
      const { data } = await http.post<Cart>('/api/cart/items', req);
      return data;
    },
    async update(req: UpdateCartItemRequest): Promise<Cart> {
      const { data } = await http.patch<Cart>(
        `/api/cart/items/${encodeURIComponent(req.itemId)}`,
        { quantity: req.quantity },
      );
      return data;
    },
    async remove(itemId: string): Promise<Cart> {
      const { data } = await http.delete<Cart>(
        `/api/cart/items/${encodeURIComponent(itemId)}`,
      );
      return data;
    },
    async clear(): Promise<Cart> {
      const { data } = await http.delete<Cart>('/api/cart');
      return data;
    },
  },

  order: {
    async pickupPoints(): Promise<PickupPoint[]> {
      const { data } = await http.get<{ items: PickupPoint[] }>(
        '/api/order/pickup-points',
      );
      return data.items;
    },
    async create(req: CreateOrderRequest): Promise<Order> {
      const { data } = await http.post<Order>('/api/order', req);
      return data;
    },
    async list(): Promise<OrdersResponse> {
      const { data } = await http.get<OrdersResponse>('/api/order');
      return data;
    },
  },
};
