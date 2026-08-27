<?php
/**
 * POST /api/archicolor/balance/topup
 *
 * Создаёт платёж в ЮKassa и возвращает ссылку на оплату (СБП).
 * Баллы здесь НЕ начисляются — только после вебхука payment.succeeded.
 *
 * Поля: amount — сумма в рублях.
 *
 * Ответ: {"ok":true,"paymentId":"…","confirmationUrl":"https://…","points":500}
 */

require_once __DIR__ . '/../../_bootstrap.php';

use ArchiColor\Api;
use ArchiColor\AppException;
use ArchiColor\Auth;
use ArchiColor\YooKassa;

try {
    Api::requireMethod('POST');
    Api::requireSameOrigin();

    $user = Auth::requireUser();
    $amount = str_replace(',', '.', Api::postAny(array('amount', 'sum', 'rub'), ''));

    if ($amount === '' || !is_numeric($amount)) {
        throw new AppException('amount_invalid', 'Укажите сумму пополнения.', 422);
    }

    $payment = YooKassa::createPayment($user, (float) $amount);

    Api::send(array(
        'ok'              => true,
        'paymentId'       => $payment['paymentId'],
        'confirmationUrl' => $payment['confirmationUrl'],
        'points'          => $payment['points'],
        'amountRub'       => $payment['amountRub'],
    ));
} catch (AppException $e) {
    Api::fail($e);
} catch (\Exception $e) {
    Api::failUnexpected($e);
}
