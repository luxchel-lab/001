<?php
/**
 * POST /api/archicolor/webhook/yookassa
 *
 * Уведомления ЮKassa. Единственное место, где баллы попадают на счёт после
 * оплаты: нажатие «оплатить» и возврат на сайт ничего не начисляют.
 *
 * Что делаем с уведомлением:
 *   1. проверяем, что оно пришло с адреса ЮKassa;
 *   2. берём из тела только payment_id — остальному телу не верим;
 *   3. перечитываем платёж через API и смотрим статус и сумму там;
 *   4. начисляем баллы; повтор того же payment_id отсекает уникальный
 *      индекс (type, source_id) в balance_transactions.
 *
 * Отвечаем 200 почти всегда: для ЮKassa любой не-200 значит «повтори»,
 * и она будет слать уведомление ещё сутки. Настоящие ошибки уходят в лог.
 *
 * Адрес этого обработчика нужно указать в личном кабинете ЮKassa
 * (Интеграция → HTTP-уведомления), событие payment.succeeded.
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\Quota;
use ArchiColor\Storage;
use ArchiColor\YooKassa;

try {
    Api::requireMethod('POST');
    // Origin здесь не проверяем: уведомление приходит не из браузера.

    $ip = Quota::clientIp();
    if (!YooKassa::isTrustedIp($ip)) {
        Storage::log('yookassa_untrusted_ip', array('ip' => $ip));
        Api::send(array('ok' => false, 'error' => array('code' => 'forbidden', 'message' => 'Неизвестный отправитель.')), 403);
    }

    $raw = file_get_contents('php://input');
    $notification = json_decode((string) $raw, true);

    if (!is_array($notification)) {
        Storage::log('yookassa_bad_body', array('raw' => substr((string) $raw, 0, 300)));
        Api::send(array('ok' => false, 'error' => array('code' => 'bad_request', 'message' => 'Некорректное тело.')), 400);
    }

    $result = YooKassa::handleNotification($notification);

    Api::send(array(
        'ok'        => true,
        'credited'  => !empty($result['credited']),
        'duplicate' => !empty($result['duplicate']),
        'reason'    => $result['reason'],
    ));
} catch (\Exception $e) {
    // 200 с пометкой в логе: повторные попытки ЮKassa нам не помогут,
    // если проблема на нашей стороне, а сутки ретраев засорят очередь.
    Storage::log('yookassa_webhook_failed', array('message' => $e->getMessage()));
    Api::send(array('ok' => false, 'error' => array('code' => 'internal', 'message' => 'Ошибка обработки.')), 200);
}
