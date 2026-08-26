<?php
/**
 * GET /api/archicolor/quota
 *
 * Остаток бесплатных генераций, цена платной и баланс клиента.
 * Фронтенд использует это только для подписи на кнопке — настоящая проверка
 * лимита живёт в /api/archicolor/generate.
 *
 * Ответ: {"ok":true,"freeLeft":9,"freeTotal":10,"pricePerImage":149,"balance":0,
 *         "canGenerate":true,"configured":true,"resetAt":"2026-09-25T…"}
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Config;
use ArchiColor\Quota;

try {
    Api::requireMethod('GET');

    $state = Quota::state();

    Api::send(array(
        'ok'            => true,
        'freeLeft'      => $state['freeLeft'],
        'freeTotal'     => $state['freeTotal'],
        'used'          => $state['used'],
        'pricePerImage' => $state['pricePerImage'],
        'balance'       => $state['balance'],
        'canGenerate'   => $state['canGenerate'],
        'resetAt'       => $state['resetAt'],
        'configured'    => Config::isConfigured(),
        'maxUploadMb'   => round(((int) Config::get('max_upload_bytes')) / 1048576, 1),
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
