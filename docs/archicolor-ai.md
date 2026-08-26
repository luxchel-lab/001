# ArchiColor AI — бэкенд Decor8.ai

Страница `/AI`: клиент загружает фотографию своей комнаты, пишет в свободной
форме, что с ней сделать, получает сгенерированный дизайн — и сразу же видит,
из каких цветов этот дизайн состоит и какими красками ArchiPaint их закрыть.

Генерация выполняется через [Decor8.ai](https://api-docs.decor8.ai/).
Ключ API живёт только на сервере: браузер обращается к нашим эндпоинтам,
а не к провайдеру.

## Как это работает

```
браузер  ──POST /api/archicolor/generate──►  PHP-бэкенд
                                              │
                    1. проверяет файл, снимает EXIF, ужимает до 1600 px
                    2. списывает генерацию с лимита пользователя
                    3. PromptMapper: «спальня в стиле лофт» → prompt + room_type + design_style
                    4. Decor8Client → POST https://api.decor8.ai/generate_designs_for_room
                    5. скачивает результат на наш домен (иначе не будет ни скачивания, ни CORS)
                    6. ImageAnalyzer: k-means в CIE Lab → 5 доминирующих цветов
                    7. Palette: к каждому — 3 ближайших оттенка ArchiPaint по ΔE2000
                                              │
браузер  ◄──────────── JSON: ссылка на картинку + палитра к заказу
```

Шаг 6–7 — та же математика, что на странице «Подбор цвета»
(`assets/js/podbor.color.js`), только выполненная в PHP: `lib/archicolor/Color.php`
повторяет матрицы sRGB↔XYZ, осветитель D65 и формулу CIEDE2000 один в один,
чтобы ΔE на двух страницах сайта совпадали.

Считаем на сервере намеренно: результат Decor8 лежит на их CDN, и `canvas`
в браузере «пачкается» кросс-доменной картинкой — прочитать пиксели он не даст.

## Файлы

```
ai/index.php                        страница /AI
api/archicolor/_bootstrap.php       подключение библиотеки
api/archicolor/generate/index.php   POST — генерация + разбор на цвета
api/archicolor/quota/index.php      GET  — остаток бесплатных генераций
api/archicolor/analyze/index.php    POST — разбор изображения без генерации

lib/archicolor/Config.php           настройки (env + config.local.php)
lib/archicolor/Decor8Client.php     клиент Decor8.ai: повторы, ошибки, два способа передачи фото
lib/archicolor/PromptMapper.php     русское задание → prompt / room_type / design_style
lib/archicolor/ImageFile.php        приём загрузки, EXIF, ужатие, скачивание результата
lib/archicolor/ImageAnalyzer.php    k-means в CIE Lab → доминирующие цвета
lib/archicolor/Palette.php          каталог ArchiPaint и поиск ближайших по ΔE2000
lib/archicolor/Color.php            цветовая математика (порт podbor.color.js)
lib/archicolor/Quota.php            лимиты, баланс, потолок на IP
lib/archicolor/Storage.php          хранилище генераций, сборка мусора, лог
lib/archicolor/Api.php              общая обвязка эндпоинтов
lib/archicolor/AppException.php     ошибка с кодом и текстом для клиента

assets/css/archicolor.css           стили страницы
assets/js/archicolor.js             интерфейс страницы

tools/archicolor-selftest.php       проверка готовности сервера
tools/archicolor-gc.php             удаление старых генераций (cron)
```

## Установка

1. Скопируйте на сайт `ai/`, `api/`, `lib/`, `assets/`.
2. Создайте ключ в личном кабинете Decor8.ai.
3. Задайте его переменной окружения — это надёжнее файла:

   ```
   DECOR8AI_API_KEY=sk-…
   ARCHICOLOR_PUBLIC_BASE_URL=https://archipaint.ru
   ```

   Либо скопируйте `lib/archicolor/config.local.php.example`
   в `lib/archicolor/config.local.php` и заполните его.
4. Убедитесь, что каталог `upload/archicolor` доступен веб-серверу на запись.
5. Проверьте окружение:

   ```bash
   php tools/archicolor-selftest.php
   php tools/archicolor-selftest.php --remote   # живой вызов, тратит генерацию
   ```

6. Поставьте уборку старых файлов в cron:

   ```
   17 4 * * * php /var/www/archipaint/tools/archicolor-gc.php
   ```

### Требования

PHP 7.0+, расширения `gd`, `curl`, `mbstring`; `exif` желательно — без него
фотографии с телефона могут прийти повёрнутыми.

В `php.ini` проверьте `upload_max_filesize` и `post_max_size` (не меньше 12 МБ)
и `max_execution_time` — генерация занимает до 60 секунд, а таймаут запроса к
Decor8 по умолчанию 180 секунд.

## Эндпоинты

### POST /api/archicolor/generate

`multipart/form-data`:

| поле | обяз. | описание |
|------|-------|----------|
| `image` | да | фотография комнаты, JPG/PNG/WebP до 12 МБ |
| `prompt` | да | задание в свободной форме; синонимы полей — `task`, `notes` |
| `room_type` | нет | тип комнаты, если он выбран в форме (`living_room`, `bedroom`, …) |
| `style` | нет | стиль, если он выбран в форме (`loft`, `scandinavian`, …) |
| `num_images` | нет | сколько вариантов сгенерировать, 1–4 |
| `seed` | нет | фиксация случайности, чтобы повторить результат |

Ответ:

```json
{
  "ok": true,
  "jobId": "260826-ab12cd34",
  "resultImageUrl": "/upload/archicolor/out/2026/08/260826-ab12cd34-1.jpg",
  "resultImageUrls": ["/upload/archicolor/out/2026/08/260826-ab12cd34-1.jpg"],
  "sourceImageUrl": "/upload/archicolor/in/2026/08/260826-ab12cd34.jpg",
  "prompt": {
    "text": "гостиная в скандинавском стиле, тёплые тона, много дерева",
    "sent": "Interior redesign of this living room in scandinavian style with warm palette, natural wood…",
    "roomType": "livingroom",
    "style": "scandinavian"
  },
  "colors": [
    {
      "hex": "#E2DACD", "sharePct": 40.2, "lrv": 70.7,
      "lab": [87.35, 0.52, 7.37], "role": "Основной тон стен",
      "matches": [
        { "code": "AP-0118", "name": "Ванильный крем", "hex": "#E6DBC8",
          "collection": "ArchiPaint Nord", "deltaE": 2.33,
          "quality": "Лёгкое отличие", "qualityCls": "mid", "lrv": 71.4 }
      ]
    }
  ],
  "freeLeft": 9, "balance": 0, "pricePerImage": 149, "elapsed": 34.8
}
```

`analysis` дублирует `colors` и добавляет размеры изображения и число
проанализированных точек.

### GET /api/archicolor/quota

```json
{ "ok": true, "freeLeft": 9, "freeTotal": 10, "pricePerImage": 149,
  "balance": 0, "canGenerate": true, "configured": true, "maxUploadMb": 12 }
```

Нужен только для подписи на кнопке. **Настоящая проверка лимита — в `generate`**,
фронтенду здесь верить нельзя.

### POST /api/archicolor/analyze

Разбор изображения на цвета без генерации: `jobId` готовой генерации либо
файл `image`. Генерации не тратит — это чистый расчёт по нашему каталогу.

### Ошибки

Единый формат, HTTP-код осмысленный:

```json
{ "ok": false, "error": { "code": "quota_exceeded", "message": "Бесплатные генерации закончились…" } }
```

| код | HTTP | когда |
|-----|------|-------|
| `prompt_missing` | 422 | клиент не написал задание |
| `upload_missing`, `upload_type`, `upload_too_large` | 400–415 | проблема с файлом |
| `quota_exceeded` | 402 | лимит исчерпан, платить нечем |
| `rate_limited` | 429 | слишком много запросов с одного IP |
| `provider_invalidinput` | 502 | Decor8 не смог разобрать фотографию |
| `provider_timeout` | 504 | генерация не уложилась в таймаут |
| `provider_not_configured` | 503 | не задан ключ |

Текст `message` написан для клиента — его можно показывать как есть.
Технические подробности уходят в `upload/archicolor/.state/archicolor.log`
и попадают в ответ только при `'debug' => true`.

## Как задание клиента превращается в запрос

Decor8 построен на диффузионной модели с англоязычным текстовым энкодером,
поэтому «спальня в скандинавском стиле» без обработки сработает плохо.
`PromptMapper` делает три вещи:

1. по ключевым словам определяет `room_type` и `design_style` — это
   перечисления Decor8, они отрабатывают надёжнее свободного текста;
2. собирает англоязычный промпт из распознанных признаков — цветов,
   материалов, мебели, настроения;
3. добавляет исходный текст клиента в конец.

```
«Хочу спальню в скандинавском стиле, тёплые бежевые тона, много дерева и растений, уютно»
   ↓
room_type    = bedroom
design_style = scandinavian
prompt       = "Interior redesign of this bedroom in scandinavian style with beige tones,
                warm palette, natural wood, indoor plants, cozy atmosphere.
                Keep the existing room geometry, windows and doors. Client request: …"
```

Качество заметно вырастет, если подключить настоящий перевод — задайте
`prompt_translator` в `config.local.php`, и русский текст уйдёт переведённым,
а не только в виде распознанных ключевых слов.

## Как фото попадает в Decor8

Два способа, выбор задаёт `decor8_input_mode`:

* **`url`** — фото сохраняется у нас и передаётся ссылкой `input_image_url`.
  Требует, чтобы сайт был доступен из интернета.
* **`multipart`** — файл уходит полем `input_image`. Работает всегда,
  в том числе на закрытом стенде.
* **`auto`** (по умолчанию) — `url`, если `public_base_url` похож на боевой
  домен, иначе `multipart`. Если провайдер отказался принимать фото,
  автоматически пробуется второй способ.

## Лимиты и оплата

По умолчанию 10 бесплатных генераций на пользователя за 30 дней плюс потолок
20 запросов в час на IP. Авторизованный пользователь Bitrix считается по своему
ID, гость — по метке в cookie; потолок на IP закрывает подбор cookie.

Генерация списывается **до** обращения к Decor8 и **возвращается**, если
провайдер её не выполнил: клиент не платит за чужую неудачу.

Платные генерации включаются двумя хуками в `config.local.php` —
`balance_provider` и `balance_charge`. Без них, когда бесплатные закончатся,
кнопка просто заблокируется.

## Что настроить перед запуском

- **Товары.** В `ai/index.php` варианты покупки (выкрас, пробник, банка) заданы
  примерными ценами, а корзина живёт в браузере. Подставьте реальные позиции
  каталога и определите `window.archicolorAddToBasket`, чтобы класть цвет
  в корзину Bitrix.
- **Модерация.** Загруженные фотографии и тексты заданий не модерируются на
  нашей стороне. Decor8 отклоняет часть материала сам, но если сервис публичный,
  добавьте свою проверку.
- **Каталог.** `assets/js/podbor.palette.js` — справочный набор из 288 оттенков,
  Lab рассчитан из sRGB. Для честного ΔE подставьте выгрузку спектрофотометра
  в `data/archipaint-palette.json` — формат записи тот же, PHP прочитает её первой.
