<?php
/**
 * POST /api/archicolor/generate
 *
 * Принимает фотографию комнаты и задание клиента в свободной форме,
 * отправляет их в Decor8.ai, сохраняет результат на нашем домене и сразу же
 * раскладывает его на цвета с подбором ближайших оттенков ArchiPaint.
 *
 * Поля формы (multipart/form-data):
 *   image          обязательное — фотография комнаты (JPG/PNG/WebP)
 *   prompt         задание в свободной форме («сделай спальню в стиле лофт…»)
 *                  синонимы полей: task, notes — для совместимости со старой формой
 *   room_type      необязательное — тип комнаты, если клиент выбрал его в форме
 *   style          необязательное — стиль, если клиент выбрал его в форме
 *   num_images     необязательное — сколько вариантов сгенерировать (1..4)
 *   seed           необязательное — фиксация случайности, чтобы повторить результат
 *
 * Ответ:
 *   {
 *     "ok": true,
 *     "jobId": "260826-ab12…",
 *     "resultImageUrl": "/upload/archicolor/out/2026/08/…-1.jpg",
 *     "resultImageUrls": ["…"],
 *     "sourceImageUrl": "/upload/archicolor/in/2026/08/….jpg",
 *     "analysis": { "colors": [ { "hex": "#…", "share": …, "matches": [ … ] } ] },
 *     "freeLeft": 9, "balance": 0, "pricePerImage": 149
 *   }
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Config;
use ArchiColor\Decor8Client;
use ArchiColor\ImageAnalyzer;
use ArchiColor\ImageFile;
use ArchiColor\PromptMapper;
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
            'Генерация пока не настроена на сервере. Загляните чуть позже.',
            503,
            'DECOR8AI_API_KEY не задан'
        );
    }
    if (!extension_loaded('gd')) {
        throw new AppException('gd_missing', 'Сервис временно недоступен.', 500, 'расширение php-gd не установлено');
    }

    /* ---------- задание клиента ---------- */

    $freeText  = Api::postAny(array('prompt', 'task', 'notes', 'description'), '');
    $roomHint  = Api::post('room_type', '');
    $styleHint = Api::postAny(array('style', 'design_style'), '');

    if (trim($freeText) === '' && trim($roomHint) === '' && trim($styleHint) === '') {
        throw new AppException(
            'prompt_missing',
            'Напишите, что сделать с фотографией: например «спальня в скандинавском стиле, тёплые тона».',
            422
        );
    }

    $plan = PromptMapper::build($freeText, $roomHint, $styleHint);

    /* ---------- фотография ---------- */

    if (empty($_FILES['image'])) {
        throw new AppException('upload_missing', 'Загрузите фотографию комнаты.', 400);
    }

    $jobId = Storage::newJobId();
    $input = Storage::inputTarget($jobId);
    $inputInfo = ImageFile::storeUpload($_FILES['image'], $input['path']);

    /* ---------- лимит: списываем до обращения к провайдеру ---------- */

    $consumed = Quota::consume();

    /* ---------- генерация ---------- */

    $numImages = (int) Api::post('num_images', '0');
    if ($numImages < 1) {
        $numImages = (int) Config::get('decor8_num_images');
    }

    $client = new Decor8Client();
    $generated = $client->generateDesignsForRoom(array(
        'input_image_path' => $input['path'],
        'input_image_url'  => $input['absoluteUrl'],
        'prompt'           => $plan['prompt'],
        'room_type'        => $plan['room_type'],
        'design_style'     => $plan['design_style'],
        'num_images'       => $numImages,
        'seed'             => Api::post('seed', '') !== '' ? (int) Api::post('seed') : null,
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
        throw new AppException('result_store_failed', 'Дизайн сгенерирован, но его не удалось сохранить. Попробуйте ещё раз.', 502);
    }

    /* ---------- разбор на цвета ---------- */

    $analysis = ImageAnalyzer::analyzeFile($results[0]['path'], array(
        'slots'   => (int) Config::get('palette_slots'),
        'matches' => (int) Config::get('matches_per_slot'),
    ));

    /* ---------- ответ ---------- */

    $urls = array();
    foreach ($results as $item) {
        $urls[] = $item['url'];
    }

    Storage::gc();

    $state = Quota::state();

    Storage::log('generate_ok', array(
        'jobId'    => $jobId,
        'mode'     => $generated['mode'],
        'images'   => count($results),
        'room'     => $plan['room_type'],
        'style'    => $plan['design_style'],
        'elapsed'  => round(microtime(true) - $startedAt, 2),
    ));

    Api::send(array(
        'ok'              => true,
        'jobId'           => $jobId,
        'demo'            => false,
        'resultImageUrl'  => $urls[0],
        'resultImageUrls' => $urls,
        'result'          => $results[0]['width'] ? array(
            'width'  => $results[0]['width'],
            'height' => $results[0]['height'],
        ) : null,
        'sourceImageUrl'  => $input['url'],
        'source'          => array('width' => $inputInfo['width'], 'height' => $inputInfo['height']),
        'prompt'          => array(
            'text'     => $plan['userText'],
            'sent'     => $plan['prompt'],
            'roomType' => $plan['room_type'],
            'style'    => $plan['design_style'],
            'detected' => $plan['detected'],
        ),
        'provider'        => array(
            'name'    => 'decor8.ai',
            'mode'    => $generated['mode'],
            'message' => $generated['message'],
        ),
        'analysis'        => $analysis,
        'colors'          => $analysis['colors'],
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
