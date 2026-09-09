import { mockApi, MOCK_OTP, resetMockState } from '../src/api/mockApi';
import { ApiError } from '../src/api/client';

/**
 * Мок повторяет контракт бэкенда (§4 ТЗ), поэтому его поведение проверяем
 * так же, как проверяли бы реальный API: сценарий «вход → корзина → заказ».
 */
describe('мок-бэкенд', () => {
  beforeEach(() => {
    resetMockState();
  });

  it('не пускает в корзину и заказ без входа', async () => {
    await expect(
      mockApi.cart.add({ productSku: 'AP-PREM-MATT', packSizeL: 0.9, quantity: 1 }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(mockApi.order.list()).rejects.toMatchObject({ status: 401 });
  });

  it('отклоняет неверный код подтверждения', async () => {
    await expect(
      mockApi.auth.login({ login: '+79000000000', otp: '1234' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('проводит сценарий вход → корзина → заказ', async () => {
    const auth = await mockApi.auth.login({
      login: '+79000000000',
      otp: MOCK_OTP,
    });
    expect(auth.token).toBeTruthy();

    const cart = await mockApi.cart.add({
      productSku: 'AP-PREM-MATT',
      packSizeL: 2.7,
      quantity: 2,
      colorCode: 'AP-0224',
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].colorHex).toBe('#2C3136');
    expect(cart.total).toBe(cart.items[0].pricePerItem * 2);

    const order = await mockApi.order.create({
      deliveryType: 'pickup',
      pickupPointId: 'pvz-1',
      paymentType: 'cash',
      name: 'Тест',
      phone: '+79000000000',
    });
    expect(order.number).toMatch(/^AP-/);
    expect(order.total).toBe(cart.total);

    // Корзина после заказа пуста, заказ виден в истории.
    expect((await mockApi.cart.get()).items).toHaveLength(0);
    expect((await mockApi.order.list()).items[0].id).toBe(order.id);
  });

  it('складывает одинаковые позиции, а не плодит строки', async () => {
    await mockApi.auth.login({ login: 'a@b.ru', otp: MOCK_OTP });
    await mockApi.cart.add({ productSku: 'AP-PROFI-FASAD', packSizeL: 9, quantity: 1 });
    const cart = await mockApi.cart.add({
      productSku: 'AP-PROFI-FASAD',
      packSizeL: 9,
      quantity: 2,
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  it('подбирает ближайший оттенок по измерению колориметра', async () => {
    const response = await mockApi.palette.nearest({ hex: '#2C3136', limit: 3 });
    expect(response.matches[0].color.code).toBe('AP-0224');
  });

  it('считает расход тем же кодом, что и калькулятор', async () => {
    const result = await mockApi.coverage.calc({
      areaM2: 24,
      layers: 2,
      productSku: 'AP-PREM-MATT',
    });
    expect(result.litersRequired).toBeCloseTo(4, 2);
    expect(result.product.name).toBe('Premium Matt');
  });
});
