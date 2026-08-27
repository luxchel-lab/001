<?php
/**
 * Накатывает схему ArchiColor AI (баллы, лимиты, авторизация).
 *
 *   php tools/archicolor-migrate.php              боевая база (из конфига или настроек Bitrix)
 *   php tools/archicolor-migrate.php --dry-run    только показать, что будет выполнено
 *
 * Скрипт идемпотентен: все CREATE TABLE идут с IF NOT EXISTS, повторный
 * запуск ничего не ломает. Файл схемы выбирается по драйверу подключения.
 */

$root = dirname(__DIR__);
require_once $root . '/lib/archicolor/Db.php';
require_once $root . '/lib/archicolor/Config.php';

use ArchiColor\Db;

$dryRun = in_array('--dry-run', $argv, true);

try {
    $driver = Db::driver();
} catch (\Exception $e) {
    fwrite(STDERR, "Не удалось подключиться к базе: " . $e->getMessage() . "\n");
    fwrite(STDERR, "Задайте ARCHICOLOR_DB_DSN или положите библиотеку рядом с настройками Bitrix.\n");
    exit(1);
}

$file = $root . '/db/schema.' . ($driver === 'sqlite' ? 'sqlite' : 'mysql') . '.sql';
if (!is_readable($file)) {
    fwrite(STDERR, "Файл схемы не найден: $file\n");
    exit(1);
}

echo "Драйвер: $driver\n";
echo "Схема:   $file\n\n";

$sql = file_get_contents($file);

/* Режем по «;» в конце строки — в схеме нет ни процедур, ни триггеров,
   поэтому полноценный парсер здесь был бы лишним.

   Комментарии вычищаем построчно, а не отбрасываем куски, начинающиеся
   с «--»: перед CREATE TABLE в схеме стоит пояснение, и вместе с ним
   отбрасывалась бы сама таблица. */
$statements = array();
foreach (preg_split('/;\s*$/m', $sql) as $chunk) {
    $lines = array();
    // Именно '/\r\n|\r|\n/', а не '/\R/': без модификатора /u шаблон \R
    // матчит и байт 0x85, который встречается внутри UTF-8 кириллицы
    // (например, в «х» — D1 85), и режет строку посреди символа.
    foreach (preg_split('/\r\n|\r|\n/', $chunk) as $line) {
        if (strpos(ltrim($line), '--') !== 0) {
            $lines[] = $line;
        }
    }
    $chunk = trim(implode("\n", $lines));
    if ($chunk !== '') {
        $statements[] = $chunk;
    }
}

$applied = 0;
foreach ($statements as $statement) {
    $title = preg_match('/^(CREATE (?:UNIQUE )?(?:TABLE|INDEX)(?: IF NOT EXISTS)?)\s+`?(\w+)`?/i', $statement, $m)
        ? $m[1] . ' ' . $m[2]
        : substr(preg_replace('/\s+/', ' ', $statement), 0, 60);

    if ($dryRun) {
        echo "  [dry-run] $title\n";
        continue;
    }

    try {
        Db::pdo()->exec($statement);
        echo "  OK  $title\n";
        $applied++;
    } catch (\PDOException $e) {
        fwrite(STDERR, "  FAIL $title\n       " . $e->getMessage() . "\n");
        exit(1);
    }
}

echo "\n" . ($dryRun ? 'Проверка завершена, ничего не выполнено.' : "Готово, выполнено запросов: $applied.") . "\n";
