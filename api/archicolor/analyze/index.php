<?php
/**
 * POST /api/archicolor/analyze
 *
 * Разбирает изображение на доминирующие цвета и подбирает к каждому ближайшие
 * оттенки ArchiPaint — та же математика, что на странице «Подбор цвета».
 *
 * Работает в двух режимах:
 *   jobId=<id>   — пересчитать уже сгенерированный результат (файла в хранилище);
 *   image=<file> — разобрать произвольное фото, загруженное клиентом.
 *
 * Генерации не тратит: это чистый расчёт по нашему каталогу.
 *
 * Поля: slots (сколько цветов, 1..8), matches (сколько оттенков на цвет, 1..6).
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Config;
use ArchiColor\ImageAnalyzer;
use ArchiColor\ImageFile;
use ArchiColor\Storage;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    if (!extension_loaded('gd')) {
        throw new AppException('gd_missing', 'Сервис временно недоступен.', 500, 'расширение php-gd не установлено');
    }

    $slots   = (int) Api::post('slots', '0');
    $matches = (int) Api::post('matches', '0');
    $opts = array(
        'slots'   => $slots > 0 ? min(8, $slots) : (int) Config::get('palette_slots'),
        'matches' => $matches > 0 ? min(6, $matches) : (int) Config::get('matches_per_slot'),
    );

    $jobId = preg_replace('/[^0-9a-f\-]/', '', Api::post('jobId', ''));
    $temporary = null;

    if ($jobId !== '') {
        $index = max(1, (int) Api::post('index', '1'));
        $target = Storage::outputTarget($jobId, $index);
        if (!is_readable($target['path'])) {
            throw new AppException('job_not_found', 'Этот результат уже удалён из хранилища. Сгенерируйте заново.', 404);
        }
        $path = $target['path'];
        $sourceUrl = $target['url'];
    } elseif (!empty($_FILES['image'])) {
        $temporary = Storage::stateDir() . '/tmp-' . Storage::newJobId() . '.jpg';
        ImageFile::storeUpload($_FILES['image'], $temporary);
        $path = $temporary;
        $sourceUrl = null;
    } else {
        throw new AppException('input_missing', 'Передайте jobId готовой генерации или файл image.', 400);
    }

    try {
        $analysis = ImageAnalyzer::analyzeFile($path, $opts);
    } finally {
        if ($temporary !== null) {
            @unlink($temporary);
        }
    }

    Api::send(array(
        'ok'        => true,
        'jobId'     => $jobId !== '' ? $jobId : null,
        'sourceUrl' => $sourceUrl,
        'analysis'  => $analysis,
        'colors'    => $analysis['colors'],
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
