# Арчи — мобильное приложение ArchiPaint

Мобильный клиент к экосистеме archipaint.ru: подбор цвета по фото, колориметр
по Bluetooth, калькулятор расхода и заказ. Приложение не дублирует бизнес-логику
сайта — оно вызывает тот же бэкенд (§4 ТЗ).

Реализовано по ТЗ «Арчи (ArchiPaint)». Что ещё не закрыто и почему —
в [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md).

## Стек

React Native 0.87 (CLI, TypeScript) · React Navigation 7 (stack + bottom tabs) ·
Zustand · axios · react-native-ble-plx · react-native-image-picker ·
AsyncStorage.

Состояние — **Zustand**, один вариант на весь проект (выбор зафиксирован
по §3 ТЗ). Expo не используется: колориметру нужен низкоуровневый BLE,
а чистый CLI избавляет от прослойки при подключении нативного модуля
конкретной модели прибора.

## Быстрый старт

```bash
npm install
npm start                 # Metro
npm run android           # демо-режим: моки внутри приложения, сеть не нужна
npm test                  # 31 тест
npm run lint && npm run typecheck
```

По умолчанию приложение работает **на моках** — все экраны кликабельны без
бэкенда. Демо-код подтверждения при входе: `0000`.

### Работа против мок-сервера по HTTP

```bash
npm run mock-server       # http://localhost:4000
npm run android:backend   # приложение ходит на http://10.0.2.2:4000
```

Мок-сервер отдаёт те же эндпоинты, что описаны в контракте, и берёт каталог
и цветовую математику из кода сайта (`../assets/js/podbor.*.js`) — веб и
приложение считают ΔE одинаково.

### Переключение на реальный бэкенд

```bash
ARCHIPAINT_USE_MOCKS=0 ARCHIPAINT_API_BASE_URL=https://archipaint.ru npm run android
```

| Переменная | Значение | Что делает |
|---|---|---|
| `ARCHIPAINT_USE_MOCKS` | `0` | ходить в реальный HTTP-бэкенд (по умолчанию — моки) |
| `ARCHIPAINT_API_BASE_URL` | URL | адрес бэкенда |
| `ARCHIPAINT_REAL_BLE` | `1` | реальный BLE вместо заглушки колориметра |

Переменные подставляются в бандл на этапе сборки (`babel.config.js`),
менять код для переключения не нужно.

## Структура

```
src/
  api/            контракты бэкенда и два их исполнителя
    types.ts        ← единственное место, где описан формат API
    ApiClient.ts    интерфейс, который видят экраны
    httpApi.ts      реализация по HTTP (реальный бэкенд и мок-сервер)
    mockApi.ts      локальная реализация, работает без сети
    client.ts       axios + интерцептор авторизации
    config.ts       переменные окружения и ключи AsyncStorage
  components/     UI-кит (ui.tsx) и цветовые элементы (color.tsx)
  data/           каталог, стандарты RAL, таблица товаров  [генерируется/TBD]
  navigation/     стек и нижние вкладки
  screens/        по экрану на пункт §5 ТЗ
  services/
    ble/            колориметр: контракт, заглушка, реальный BLE, протокол
    color.ts        Lab/ΔE — ровно столько, сколько нужно клиенту
    coverage.ts     калькулятор расхода
    paletteSearch.ts локальный поиск по каталогу
  store/          Zustand: сессия, корзина, цвета, каталог
  theme/          фирменные токены (совпадают с CSS сайта)
mock-server/      Express-стенд по тому же контракту
tools/build-data.js генератор src/data/palette.ts и standards.ts
```

## Экраны

| ТЗ | Экран | Состояние |
|---|---|---|
| 5.1 | Вход / пропуск входа | готов |
| 5.2 | Главная: 3 сценария + линейки | готов |
| 5.3 | Подбор цвета по фото | готов, визуализацию отдаёт бэкенд |
| 5.4 | Колориметр (BLE) | готов на заглушке прибора |
| 5.5 | Калькулятор расхода | готов, таблица расходов предварительная |
| 5.6 | Палитра и поиск по коду | готов |
| 5.7 | Корзина, оформление, подтверждение | готов на контракте |
| 5.8 | Профиль, заказы, сохранённые цвета | готов |

Без входа доступны палитра и калькулятор; заказ и колориметр требуют аккаунта
(§5.1 ТЗ).

## Колориметр

`BleColorimeterService` — интерфейс (`scan`, `connect`, `disconnect`,
`requestMeasurement`, `onReading`, `onStatus`). Реализаций две:

* `MockBleColorimeterService` — по умолчанию, отдаёт тестовые измерения;
* `RealBleColorimeterService` — `react-native-ble-plx`, весь протокол вынесен
  в `src/services/ble/protocol.ts`.

UUID сервисов и формат кадра в `protocol.ts` — **плейсхолдеры**. Когда придёт
документация на модель, правится только этот файл; экраны и подбор по палитре
менять не нужно.

## Данные каталога

`src/data/palette.ts` и `standards.ts` генерируются из данных сайта:

```bash
npm run build-data        # 288 оттенков ArchiPaint + 213 RAL Classic
```

Это справочный набор для моков и офлайн-кэша, а не боевая база 800 000+
оттенков: её отдаёт бэкенд.

## Сборка

Android — основная платформа для итераций по BLE (§8.6 ТЗ):
разрешения `BLUETOOTH_SCAN/CONNECT`, `ACCESS_FINE_LOCATION` (до Android 12),
`CAMERA` уже в манифесте. Для iOS в `Info.plist` добавлены
`NSBluetoothAlwaysUsageDescription`, `NSCameraUsageDescription`,
`NSPhotoLibraryUsageDescription`; перед первой сборкой — `cd ios && pod install`.
