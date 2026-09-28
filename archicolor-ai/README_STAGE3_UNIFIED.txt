ARCHIPAINT · ArchiColor AI · Stage 3 Unified

Назначение
- Основа: ArchiColor AI UX Stage 2.
- Стандартные header.php/footer.php сайта сохранены.
- Visual Upgrade реализуется HTML/CSS; длинный концепт-макет не встроен в страницу как картинка.
- Старые вызовы color_service.php маршрутизируются через ai-stage3-core.js в /ajax/color_search_core.php.
- Карточка цвета получает реальные варианты через /ajax/get_product_options_v3.php.
- Добавление выполняется POST в /ajax/add_to_basket_v3.php с sessid и color_id.

Файлы
/index.php
/assets/css/ai-stage1.css
/assets/css/ai-stage2.css
/assets/css/ai-stage3.css
/assets/js/ai-stage3-core.js
/assets/js/ai.js
/assets/images/archicolor/hero-before-after.webp
/ajax/ai_generation.php
/ajax/color_search_core.php
/ajax/get_product_options_v3.php
/ajax/add_to_basket_v3.php

Важно
- color_search_core.php использует инфоблок цветов 49 и CIEDE2000.
- get_product_options_v3.php зависит от существующей FS\APILARA\Api на сервере ARCHIPAINT.
- Перед production-размещением проверить реальные свойства артикула цвета и тест корзины на тестовом URL.
