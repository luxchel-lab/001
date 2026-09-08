# Контракт бэкенда (черновик, требует подтверждения)

Точные пути, формат тел и способ авторизации у владельца бэкенда пока
не получены (§4 и §9 ТЗ). Ниже — контракт, по которому уже написаны
приложение и мок-сервер. Правка контракта = правка `src/api/types.ts`
и `src/api/httpApi.ts`; экраны трогать не нужно.

Все ответы — JSON. Ошибка: `{ "message": "текст", "code": "..." }` с
соответствующим HTTP-статусом. Авторизация сейчас предполагается заголовком
`Authorization: Bearer <token>` — **это допущение**, см. вопрос 1.

## Авторизация

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/auth/otp` | `{ login }` | `{ sent, retryAfterSec }` |
| POST | `/api/auth/login` | `{ login, otp? , password? }` | `{ token, refreshToken?, expiresIn?, user }` |
| GET | `/api/auth/me` | — | `AuthUser` |
| POST | `/api/auth/logout` | — | `204` |

`login` — телефон `+7XXXXXXXXXX` или email. Аккаунт общий с сайтом.

## Подбор цвета по фото

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/color-match/photo` | multipart: `photo`, `prompt?`, `collection?` | `{ renderUrl, sourceUrl?, matches[], requestId }` |

Бэкенд сам ходит в Decor8 AI (`/change_wall_color`) и сам подбирает ближайший
оттенок ARCHI. Ключи Decor8 в приложение не попадают.

`matches[i] = { color: ArchiColor, deltaE: number, quality: 'exact'|'close'|'visible'|'far' }`

## Палитра

| Метод | Путь | Параметры | Ответ |
|---|---|---|---|
| POST | `/api/palette/nearest` | `{ rgb? , lab?, hex?, limit?, collection? }` | `{ matches[] }` |
| GET | `/api/palette` | `q`, `collection`, `brand`, `limit`, `offset` | `{ items[], total, collections[] }` |
| GET | `/api/palette/{code}` | — | `ArchiColor` |

`/api/palette/nearest` вызывается после каждого замера колориметра — сюда
уходит RGB или LAB прибора, обратно приходят ближайшие оттенки ARCHI.

`ArchiColor = { code, name, hex, rgb: [r,g,b], lab?: [l,a,b], collection?, family?, brandMatches? }`

Поиск по `q` должен покрывать: код ARCHI, название оттенка и код чужого
стандарта (`RAL 7016`) — в последнем случае возвращаются оттенки ARCHI,
которыми этот стандарт закрывается.

## Каталог товаров

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/catalog/products` | `{ items: Product[] }` |

`Product = { sku, name, line: 'Premium'|'Profi', coverageM2PerLiter, priceBase, packSizesL[], description?, surfaces?, tintable }`

`coverageM2PerLiter` и `packSizesL` — то, чем считает калькулятор; пока
приложение использует черновую таблицу (см. вопрос 3).

## Расчёт расхода

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/coverage-calc` | `{ areaM2, layers, productSku }` | `{ litersRequired, packs[], litersPurchased, price, product }` |

Формула: `литры = площадь × слои / расход`, дальше набор фасовки с округлением
вверх. Приложение умеет считать это само (офлайн и без входа), но ответ
бэкенда приоритетен.

## Корзина и заказ (Bitrix)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/cart` | — | `Cart` |
| POST | `/api/cart/items` | `{ productSku, packSizeL, quantity, colorCode? }` | `Cart` |
| PATCH | `/api/cart/items/{id}` | `{ quantity }` | `Cart` |
| DELETE | `/api/cart/items/{id}` | — | `Cart` |
| DELETE | `/api/cart` | — | `Cart` |
| GET | `/api/order/pickup-points` | — | `{ items: PickupPoint[] }` |
| POST | `/api/order` | `CreateOrderRequest` | `Order` |
| GET | `/api/order` | — | `{ items: Order[] }` |

`CreateOrderRequest = { deliveryType: 'courier'|'pickup', address?, pickupPointId?, paymentType: 'online'|'cash', name, phone, email?, comment? }`

`Order = { id, number, createdAt, status, statusText, total, items[], paymentUrl? }`

Приложение не считает скидки, доставку и наличие — всё это возвращает Bitrix,
как и сайту.

## Что нужно от владельца бэкенда

1. Реальные пути (эти или другие) и способ авторизации: JWT, API-ключ или
   сессионная кука.
2. Сценарий входа: одноразовый код или пароль.
3. Формат ошибок и коды.
4. Как называются поля корзины и заказа в существующем Bitrix-API — если
   они отличаются, адаптер напишем в `httpApi.ts`, контракт приложения
   останется прежним.
