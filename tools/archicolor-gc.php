<?php
/**
 * Удаление старых генераций ArchiColor AI.
 *
 *   php tools/archicolor-gc.php
 *
 * Сгенерированные и загруженные изображения живут keep_files_days дней
 * (по умолчанию 14). Обработчик генерации подчищает хранилище сам, изредка
 * и по случайности; если хочется предсказуемости — поставьте этот скрипт в cron:
 *
 *   17 4 * * *  php /var/www/archipaint/tools/archicolor-gc.php >> /var/log/archicolor-gc.log
 */

require_once dirname(__DIR__) . '/lib/archicolor/Storage.php';

$removed = \ArchiColor\Storage::gc(true);
echo date('c'), ' удалено файлов: ', $removed, "\n";
