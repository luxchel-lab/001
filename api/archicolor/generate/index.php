<?php
/**
 * POST /api/archicolor/generate
 *
 * Визуализатор краски на стенах. Принимает фотографию комнаты и оттенок,
 * выбранный клиентом в палитре ArchiPaint, отдаёт её же — с перекрашенными
 * стенами. Мебель, пол и потолок остаются нетронутыми: этим занимается
 * Decor8.ai /change_wall_color, а не полная перегенерация комнаты.
 *
 * Результат сохраняется на нашем домене и разбирается на цвета: клиент видит,
 * как выбранная краска реально легла на стену и насколько картинка на
 * фотографии отличается от выкраса в каталоге.
 *
 * Поля формы (multipart/form-data):
 *   image          обязательное — фотография комнаты (JPG/PNG/WebP)
 *   color          цвет стен в HEX (#RRGGBB); можно не передавать, если есть code
 *   code           артикул ArchiPaint (AP-0118) — цвет берётся из каталога
 *
 * Ответ:
 *   {
 *     "ok": true,
 *     "jobId": "260826-ab12…",
 *     "resultImageUrl": "/upload/archicolor/out/2026/08/…-1.jpg",
 *     "sourceImageUrl": "/upload/archicolor/in/2026/08/….jpg",
 *     "wall": {
 *       "requested": { "hex": "#E6DBC8", "code": "AP-0118", "name": "Ванильный крем" },
 *       "rendered":  { "hex": "#DED2BE", "lrv": 66.2, … },
 *       "deltaE": 2.1, "quality": "Лёгкое отличие",
 *       "coverage": { "changedPct": 34.2, "fallback": false },
 *       "colors": [ … тона стены с ближайшими оттенками каталога … ]
 *     },
 *     "freeLeft": 9, "balance": 0, "pricePerImage": 149
 *   }
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Color;
use ArchiColor\Config;
use ArchiColor\Decor8Client;
use ArchiColor\ImageAnalyzer;
use ArchiColor\ImageFile;
use ArchiColor\Palette;
use ArchiColor\Quota;
use ArchiColor\Storage;

$startedAt = microtime(true);
$consumed = null;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    if (!Config::isConfigured()) {
        throw new AppException(
            'provider_not_configured',
            'Визуализатор пока не настроен на сервере. Загляните чуть позже.',
            503,
            'DECOR8AI_API_KEY не задан'
        );
    }
    if (!extension_loaded('gd')) {
        throw new AppException('gd_missing', 'Сервис временно недоступен.', 500, 'расширение php-gd не установлено');
    }

    /* ---------- цвет стен ----------
       Артикул каталога важнее присланного HEX: если клиент выбрал оттенок
       в палитре, красить надо ровно им, а не тем, что доехало из браузера. */

    $code = trim(Api::postAny(array('code', 'color_code'), ''));
    $hex  = trim(Api::postAny(array('color', 'hex', 'wall_color'), ''));

    $catalogColor = $code !== '' ? Palette::byCode($code) : null;
    if ($code !== '' && $catalogColor === null) {
        throw new AppException('color_unknown', 'Такого оттенка нет в палитре ArchiPaint.', 422, $code);
    }
    if ($catalogColor !== null) {
        $hex = $catalogColor['hex'];
    }

    $rgb = Color::hexToRgb($hex);
    if ($rgb === null) {
        throw new AppException(
            'color_missing',
            'Выберите цвет стен из палитры ArchiPaint.',
            422,
            $hex
        );
    }
    $hex = Color::rgbToHex($rgb[0], $rgb[1], $rgb[2]);

    /* ---------- фотография ---------- */

    if (empty($_FILES['image'])) {
        throw new AppException('upload_missing', 'Загрузите фотографию комнаты.', 400);
    }

    $jobId = Storage::newJobId();
    $input = Storage::inputTarget($jobId);
    $inputInfo = ImageFile::storeUpload($_FILES['image'], $input['path']);

    /* ---------- лимит: списываем до обращения к провайдеру ---------- */

    $consumed = Quota::consume();

    /* ---------- перекраска стен ---------- */

    $client = new Decor8Client();
    $generated = $client->changeWallColor(array(
        'input_image_path' => $input['path'],
        'input_image_url'  => $input['absoluteUrl'],
        'hex'              => $hex,
    ));

    /* ---------- забираем результат к себе ----------
       Картинка должна лежать на нашем домене: иначе клиент не скачает её без
       CORS, а мы не сможем показать её в галерее заказов. */

    $allowedHosts = (array) Config::get('result_allowed_hosts');
    $results = array();

    foreach ($generated['images'] as $index => $image) {
        $target = Storage::outputTarget($jobId, $index + 1);
        try {
            ImageFile::download($image['url'], $target['path'], $allowedHosts);
        } catch (AppException $e) {
            Storage::log('result_store_failed', array('jobId' => $jobId, 'detail' => $e->detail()));
            if ($index === 0 && count($generated['images']) === 1) {
                throw $e;
            }
            continue;
        }

        $size = @getimagesize($target['path']);
        $results[] = array(
            'url'    => $target['url'],
            'path'   => $target['path'],
            'width'  => $size ? (int) $size[0] : (int) $image['width'],
            'height' => $size ? (int) $size[1] : (int) $image['height'],
            'uuid'   => $image['uuid'],
        );
    }

    if (!$results) {
        throw new AppException('result_store_failed', 'Стены перекрашены, но результат не удалось сохранить. Попробуйте ещё раз.', 502);
    }

    /* ---------- разбор стены ----------
       Сравниваем с исходным фото: /change_wall_color меняет только стены,
       поэтому изменившиеся точки — и есть стена. Разбирать весь кадр здесь
       незачем: диван и пол остались прежними и к заказу краски отношения
       не имеют. */

    $wall = ImageAnalyzer::analyzeWall($results[0]['path'], $input['path'], $hex, array(
        'tones'   => (int) Config::get('wall_tones'),
        'matches' => (int) Config::get('matches_per_slot'),
        'code'    => $catalogColor ? $catalogColor['code'] : '',
    ));

    /* ---------- ответ ---------- */

    $urls = array();
    foreach ($results as $item) {
        $urls[] = $item['url'];
    }

    Storage::gc();

    $state = Quota::state();

    Storage::log('wall_color_ok', array(
        'jobId'      => $jobId,
        'mode'       => $generated['mode'],
        'colorKey'   => $generated['colorKey'],
        'hex'        => $hex,
        'code'       => $catalogColor ? $catalogColor['code'] : null,
        'changedPct' => $wall['coverage']['changedPct'],
        'deltaE'     => $wall['deltaE'],
        'elapsed'    => round(microtime(true) - $startedAt, 2),
    ));

    Api::send(array(
        'ok'              => true,
        'jobId'           => $jobId,
        'demo'            => false,
        'resultImageUrl'  => $urls[0],
        'resultImageUrls' => $urls,
        'result'          => array(
            'width'  => $results[0]['width'],
            'height' => $results[0]['height'],
        ),
        'sourceImageUrl'  => $input['url'],
        'source'          => array('width' => $inputInfo['width'], 'height' => $inputInfo['height']),
        'provider'        => array(
            'name'    => 'decor8.ai',
            'method'  => 'change_wall_color',
            'mode'    => $generated['mode'],
            'message' => $generated['message'],
        ),
        'wall'            => $wall,
        'colors'          => $wall['colors'],
        'freeLeft'        => $state['freeLeft'],
        'freeTotal'       => $state['freeTotal'],
        'balance'         => $state['balance'],
        'pricePerImage'   => $state['pricePerImage'],
        'elapsed'         => round(microtime(true) - $startedAt, 2),
    ));
} catch (AppException $e) {
    // Провайдер не выполнил работу — генерация клиенту возвращается.
    if ($consumed !== null && $e->errorCode() !== 'quota_exceeded' && $e->errorCode() !== 'rate_limited') {
        try {
            Quota::refund($consumed);
        } catch (\Exception $ignored) {
            Storage::log('refund_failed', array('message' => $ignored->getMessage()));
        }
    }
    Api::fail($e);
} catch (\Exception $e) {
    if ($consumed !== null) {
        try {
            Quota::refund($consumed);
        } catch (\Exception $ignored) {
            Storage::log('refund_failed', array('message' => $ignored->getMessage()));
        }
    }
    Api::failUnexpected($e);
}
