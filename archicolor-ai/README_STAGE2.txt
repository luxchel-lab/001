ARCHICOLOR AI — UX/UI STAGE 2

Назначение: новый экран результата после D8-генерации.

Что изменено:
- большой интерактивный До/После вместо двух отдельных картинок;
- сохранены исходные ID beforeImg/afterImg и существующая пипетка;
- автоматический анализ afterImg и поиск цветов продолжают работать существующим ai.js;
- блок результатов переименован в «Цвета нового интерьера»;
- добавлен переход от AI-визуализации к реальным цветам ARCHIPAINT;
- responsive/mobile стили.

Файлы:
/index.php
/assets/js/ai.js
/assets/css/ai-stage1.css
/assets/css/ai-stage2.css
/assets/images/archicolor/hero-before-after.webp
/ajax/ai_generation.php

Важно: Stage 2 пока использует существующий color_service.php страницы на сервере. На следующем этапе рекомендуется перевести ArchiColor AI на единое production-ядро color_search_core.php из сервиса «Подбор цвета».
