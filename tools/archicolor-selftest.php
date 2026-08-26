<?php
/**
 * Проверка готовности бэкенда ArchiColor AI.
 *
 *   php tools/archicolor-selftest.php            только локальные проверки
 *   php tools/archicolor-selftest.php --remote   плюс живой вызов Decor8.ai
 *                                                (тратит одну генерацию!)
 *
 * Запускайте после установки на сервер: скрипт скажет, чего не хватает,
 * до того как это увидит клиент.
 */

$root = dirname(__DIR__);
require_once $root . '/lib/archicolor/Config.php';
require_once $root . '/lib/archicolor/Palette.php';
require_once $root . '/lib/archicolor/ImageAnalyzer.php';
require_once $root . '/lib/archicolor/Decor8Client.php';
require_once $root . '/lib/archicolor/Storage.php';

use ArchiColor\Config;
use ArchiColor\Decor8Client;
use ArchiColor\ImageAnalyzer;
use ArchiColor\Palette;
use ArchiColor\Storage;

$failures = 0;

function check($title, $ok, $note = '')
{
    global $failures;
    if (!$ok) {
        $failures++;
    }
    // printf считает байты, а заголовки кириллические — выравниваем сами
    $pad = max(0, 44 - mb_strlen($title, 'UTF-8'));
    echo ($ok ? '  OK ' : ' FAIL'), '  ', $title, str_repeat(' ', $pad), $note, "\n";
}

echo "ArchiColor AI — проверка окружения\n";
echo str_repeat('-', 72), "\n";

check('PHP >= 7.0', PHP_VERSION_ID >= 70000, PHP_VERSION);
check('расширение gd', extension_loaded('gd'));
check('расширение curl', function_exists('curl_init'));
check('расширение mbstring', function_exists('mb_strtolower'));
check('расширение exif (желательно)', function_exists('exif_read_data'), function_exists('exif_read_data') ? '' : 'фото с телефона могут прийти повёрнутыми');

$catalog = Palette::all();
check('каталог ArchiPaint загружен', count($catalog) > 0, count($catalog) . ' оттенков');

$storage = Config::get('storage_dir');
$writable = is_dir($storage) ? is_writable($storage) : @mkdir($storage, 0775, true);
check('каталог хранения доступен', (bool) $writable, $storage);

check('ключ Decor8.ai задан', Config::isConfigured(), Config::isConfigured() ? '' : 'задайте DECOR8AI_API_KEY');

$base = Config::get('public_base_url');
$mode = Config::get('decor8_input_mode');
if ($mode === 'url') {
    check('public_base_url виден из интернета', Config::baseUrlIsPublic($base), $base !== '' ? $base : 'не задан');
} else {
    check('режим передачи фото', true, $mode . ($base !== '' ? ' · ' . $base : ''));
}

/* Разбор изображения на цвета — на синтетической картинке. */
$image = imagecreatetruecolor(600, 400);
imagefilledrectangle($image, 0, 0, 600, 240, imagecolorallocate($image, 226, 219, 205));
imagefilledrectangle($image, 0, 240, 600, 400, imagecolorallocate($image, 92, 74, 56));
imagefilledrectangle($image, 60, 140, 300, 300, imagecolorallocate($image, 74, 92, 78));
$sample = sys_get_temp_dir() . '/archicolor-selftest.jpg';
imagejpeg($image, $sample, 90);
imagedestroy($image);

try {
    $analysis = ImageAnalyzer::analyzeFile($sample, array('slots' => 3, 'matches' => 2));
    $first = $analysis['colors'][0];
    check(
        'разбор на цвета работает',
        count($analysis['colors']) >= 2 && !empty($first['matches']),
        $first['hex'] . ' → ' . $first['matches'][0]['code'] . ' (ΔE ' . $first['matches'][0]['deltaE'] . ')'
    );
} catch (\Exception $e) {
    check('разбор на цвета работает', false, $e->getMessage());
}
@unlink($sample);

/* Живой вызов провайдера — только по явному флагу. */
if (in_array('--remote', $argv, true)) {
    echo str_repeat('-', 72), "\n";
    if (!Config::isConfigured()) {
        check('вызов Decor8.ai', false, 'нет ключа');
    } else {
        try {
            $client = new Decor8Client();
            $result = $client->generateDesignsForRoom(array(
                'input_image_url' => 'https://prod-files.decor8.ai/test-images/sdk_test_image.png',
                'prompt'          => 'A bright scandinavian living room with natural wood and plants',
                'num_images'      => 1,
            ));
            check('вызов Decor8.ai', !empty($result['images']), $result['images'][0]['url']);
        } catch (\Exception $e) {
            check('вызов Decor8.ai', false, $e->getMessage());
        }
    }
}

echo str_repeat('-', 72), "\n";
if ($failures === 0) {
    echo "Всё готово. Страница /AI будет работать.\n";
    exit(0);
}
echo 'Не пройдено проверок: ', $failures, " — см. выше.\n";
exit(1);
