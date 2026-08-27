<?php
/**
 * GET /api/archicolor/quota
 *
 * Состояние доступа к визуализатору: авторизован ли пользователь, сколько
 * бесплатных примерок осталось сегодня, баланс баллов и цена примерки.
 *
 * Это данные для подписи на кнопке. Настоящая проверка — в
 * /api/archicolor/generate, фронтенду здесь верить нельзя.
 *
 * Ответ:
 *   {"ok":true,"authorized":true,"phone":"+7999***4455",
 *    "freePerDay":3,"freeLeft":2,"usedToday":1,"resetAt":"2026-08-28T00:00:00+03:00",
 *    "balance":140,"pricePoints":20,"canGenerate":true,"configured":true}
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Config;
use ArchiColor\Quota;

try {
    Api::requireMethod('GET');

    $state = Quota::state();
    $state['ok'] = true;
    $state['configured'] = Config::isConfigured();
    $state['maxUploadMb'] = round(((int) Config::get('max_upload_bytes')) / 1048576, 1);

    Api::send($state);
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
