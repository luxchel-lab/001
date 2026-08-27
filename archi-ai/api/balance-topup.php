<?php
/**
 * ЗАГЛУШКА · POST api/balance-topup.php
 *
 * Приём: amount (рубли). Ответ: ссылка на оплату.
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 * 1. POST https://api.yookassa.ru/v3/payments
 *      Authorization: Basic base64(shopId:secretKey)
 *      Idempotence-Key: <uuid>   ← повтор из-за таймаута не создаст
 *                                  второй платёж
 *      {
 *        "amount": {"value": "500.00", "currency": "RUB"},
 *        "capture": true,
 *        "payment_method_data": {"type": "sbp"},
 *        "confirmation": {"type": "redirect", "return_url": "..."},
 *        "metadata": {"user_id": "42", "points": "500"}
 *      }
 * 2. Сохранить платёж у себя со статусом pending.
 * 3. Вернуть confirmation_url и увести на него пользователя.
 *
 * БАЛЛЫ ЗДЕСЬ НЕ НАЧИСЛЯЮТСЯ. Ни нажатие «оплатить», ни возврат на
 * страницу успеха ничего не доказывают — возврат можно открыть руками.
 * Начисление живёт только в webhook-yookassa.php.
 *
 * ── ЧТО ДЕЛАЕТ ЗАГЛУШКА ─────────────────────────────────────────────
 * Возвращает вымышленный id платежа и ссылку на demo-payment.php —
 * страницу, которая имитирует экран оплаты и дёргает вебхук.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$state = archi_ai_state();
if (!$state['authorized']) {
    archi_ai_fail('auth_required', 'Войдите, чтобы пополнить баланс.', 401);
}

$amount = (float) str_replace(',', '.', (string) archi_ai_input('amount'));
if ($amount < 100 || $amount > 50000) {
    archi_ai_fail('amount_invalid', 'Сумма пополнения — от 100 до 50 000 ₽.', 422);
}

archi_ai_delay(0.7);

$paymentId = 'demo-pay-' . substr(md5(microtime(true)), 0, 16);
$points = (int) round($amount * ARCHI_AI_POINTS_PER_RUB);

archi_ai_send(array(
    'ok'              => true,
    'demo'            => true,
    'paymentId'       => $paymentId,
    'points'          => $points,
    'amountRub'       => $amount,
    'confirmationUrl' => 'demo-payment.php?payment_id=' . urlencode($paymentId) . '&amount=' . $amount,
));
