<?php
/**
 * POST /api/archicolor/cashback
 *
 * Начисление кэшбэка за покупку краски: 1000 ₽ суммы заказа = 1 балл,
 * округление обычное арифметическое (1500 ₽ → 2 балла, 1499 ₽ → 1 балл).
 *
 * Это служебный эндпоинт для магазина, а не для браузера. Вызывать его надо
 * в момент, когда заказ действительно оплачен, — иначе баллы уедут за
 * отменённые заказы.
 *
 * Поля (application/json или form-data):
 *   order_id  номер заказа — по нему работает защита от повторного начисления
 *   amount    сумма заказа в рублях
 *   phone     телефон покупателя (или user_id — если знаете наш идентификатор)
 *   ts        метка времени запроса, unix
 *   sign      HMAC-SHA256 от "order_id|amount|phone|ts" на общем секрете
 *
 * Секрет задаётся конфигом cashback_secret (env ARCHICOLOR_CASHBACK_SECRET).
 * Без него эндпоинт не работает: незащищённое начисление баллов — это
 * бесплатные баллы для всех, кто угадает адрес.
 *
 * Если магазин живёт на Bitrix, проще вызвать библиотеку напрямую из
 * обработчика события — пример в docs/archicolor-ai.md.
 */

require_once __DIR__ . '/../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\Balance;
use ArchiColor\Config;
use ArchiColor\Db;
use ArchiColor\Storage;

try {
    Api::requireMethod('POST');

    $secret = (string) Config::get('cashback_secret');
    if ($secret === '') {
        throw new AppException('cashback_not_configured', 'Начисление кэшбэка не настроено.', 503,
            'не задан ARCHICOLOR_CASHBACK_SECRET');
    }

    /* Тело может прийти и как JSON, и как форма — магазины шлют по-разному. */
    $input = $_POST;
    if (!$input) {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    }

    $orderId = isset($input['order_id']) ? trim((string) $input['order_id']) : '';
    $amount  = isset($input['amount']) ? str_replace(',', '.', (string) $input['amount']) : '';
    $phone   = isset($input['phone']) ? (string) $input['phone'] : '';
    $userId  = isset($input['user_id']) ? (int) $input['user_id'] : 0;
    $ts      = isset($input['ts']) ? (int) $input['ts'] : 0;
    $sign    = isset($input['sign']) ? (string) $input['sign'] : '';

    if ($orderId === '' || $amount === '' || !is_numeric($amount)) {
        throw new AppException('cashback_invalid', 'Нужны order_id и amount.', 422);
    }

    /* Окно в 5 минут: подпись без времени можно переиграть когда угодно. */
    if ($ts <= 0 || abs(time() - $ts) > 300) {
        throw new AppException('cashback_stale', 'Запрос устарел.', 401, 'ts=' . $ts);
    }

    $expected = hash_hmac('sha256', $orderId . '|' . $amount . '|' . $phone . '|' . $ts, $secret);
    if (!hash_equals($expected, $sign)) {
        Storage::log('cashback_bad_sign', array('orderId' => $orderId));
        throw new AppException('cashback_forbidden', 'Подпись не совпала.', 403);
    }

    /* Покупателя ищем по нашему id или по телефону. Заводить пользователя
       по факту покупки не станем: баллы нужны тому, кто зайдёт за ними
       в визуализатор, а он всё равно авторизуется по этому же номеру. */
    if ($userId <= 0) {
        $normalized = Auth::normalizePhone($phone);
        if ($normalized === null) {
            throw new AppException('cashback_no_user', 'Нужен телефон покупателя или user_id.', 422);
        }
        $userId = (int) Db::fetchValue('SELECT id FROM ac_user WHERE phone = :phone',
            array('phone' => $normalized), 0);

        if ($userId <= 0) {
            // Пользователь ещё не входил в визуализатор — заводим запись,
            // чтобы баллы дождались его первого входа по этому номеру.
            Db::insertIgnore('ac_user', array('phone' => $normalized, 'created_at' => Db::utcNow()));
            $userId = (int) Db::fetchValue('SELECT id FROM ac_user WHERE phone = :phone',
                array('phone' => $normalized), 0);
        }
    }

    if ($userId <= 0) {
        throw new AppException('cashback_no_user', 'Не нашли покупателя.', 422);
    }

    $result = Balance::cashbackForOrder($userId, (float) $amount, $orderId);

    Storage::log('cashback', array(
        'orderId'   => $orderId,
        'userId'    => $userId,
        'amount'    => (float) $amount,
        'points'    => $result['points'],
        'credited'  => $result['credited'],
        'duplicate' => $result['duplicate'],
    ));

    Api::send(array(
        'ok'        => true,
        'points'    => $result['points'],
        'credited'  => $result['credited'],
        'duplicate' => $result['duplicate'],
        'balance'   => $result['balance'],
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
