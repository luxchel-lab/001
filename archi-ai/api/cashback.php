<?php
/**
 * ЗАГЛУШКА · POST api/cashback.php
 *
 * Кэшбэк за покупку краски: 1000 ₽ суммы заказа = 1 балл.
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 * 1. Проверить подпись запроса (HMAC-SHA256 на общем секрете) и её
 *    срок годности. Незащищённое начисление баллов — это бесплатные
 *    баллы для всех, кто угадает адрес эндпоинта.
 * 2. Считать баллы обычным арифметическим округлением:
 *      $points = (int) round($amountRub / 1000);
 *    1500 ₽ → 2 балла, 1499 ₽ → 1 балл, 400 ₽ → 0.
 *    Именно round(), не floor и не ceil.
 * 3. Начислить идемпотентно по НОМЕРУ ЗАКАЗА (source_id) — тем же
 *    уникальным индексом, что и пополнение.
 * 4. Вызывать по факту ОПЛАТЫ заказа, а не создания: иначе баллы
 *    уедут за отменённые заказы.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$orderId = (string) archi_ai_input('order_id');
$amount = (float) archi_ai_input('amount');

if ($orderId === '' || $amount <= 0) {
    archi_ai_fail('cashback_invalid', 'Нужны order_id и amount.', 422);
}

$state = &archi_ai_state();
if (!isset($state['cashbackOrders'])) {
    $state['cashbackOrders'] = array();
}
if (in_array($orderId, $state['cashbackOrders'], true)) {
    archi_ai_send(array('ok' => true, 'demo' => true, 'credited' => false, 'duplicate' => true,
        'points' => 0, 'quota' => archi_ai_quota()));
}

$points = (int) round($amount / 1000);
$state['cashbackOrders'][] = $orderId;

if ($points > 0) {
    $state['balance'] += $points;
    archi_ai_push_history($points, 'cashback', 'Кэшбэк за заказ', 'Заказ №' . $orderId);
}

archi_ai_send(array(
    'ok'        => true,
    'demo'      => true,
    'credited'  => $points > 0,
    'duplicate' => false,
    'points'    => $points,
    'quota'     => archi_ai_quota(),
));
