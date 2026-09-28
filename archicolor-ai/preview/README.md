# ArchiColor AI — автономное превью

Статическая копия страницы `archicolor-ai/index.php`, которая открывается без
Bitrix, PHP-сервера и интернета.

## Запуск

Откройте `preview/index.html` в браузере (двойным кликом, работает через `file://`)
или поднимите любой статический сервер:

```sh
cd archicolor-ai/preview && python3 -m http.server 8080   # http://localhost:8080
```

## Пересборка после правок `index.php`, CSS или JS

```sh
php archicolor-ai/preview/build.php
```

`build.php` рендерит `index.php` с заглушками Bitrix (header/footer, `$APPLICATION`,
`$USER` — авторизован, квота 0) и копирует ассеты в `preview/assets/`.

## Чем превью отличается от production

| Что | Production | Превью (`mock-api.js`) |
|---|---|---|
| `ai_generation.php` | Decor8 | цветокоррекция загруженного фото по выбранному стилю |
| `color_search_core.php`, `color_service.php` | инфоблок 49, CIEDE2000 | палитра `podbor.palette.js` (288 оттенков), CIEDE2000 |
| `catalog_search.php` | каталог Bitrix | та же палитра |
| `get_product_options_v3.php` | цены Bitrix / API колеровки | демо-цены |
| `add_to_basket_v3.php` | корзина Bitrix | всегда «добавлено» |
| `/assets/css/ai.css` | есть на сайте | нет в архиве → `ai-fallback.css` (восстановленные стили) |
| `/assets/js/magnific.js` | есть на сайте | `vendor/jquery.magnific-popup.min.js` 1.1.0 |

`ai-fallback.css` и `mock-api.js` нужны только превью — на сайт их не выкладывать.
