<?php
/**
 * ЗАГЛУШКА · POST api/webhook-yookassa.php
 *
 * Уведомление об оплате. Единственное место, где баллы попадают на счёт.
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 * Уведомления ЮKassa НИЧЕМ НЕ ПОДПИСАНЫ, поэтому телу запроса верить
 * нельзя. Уведомление — это только сигнал «сходи проверь»:
 *
 * 1. Проверить, что запрос пришёл с адресов ЮKassa (их подсети
 *    опубликованы в документации).
 * 2. Взять из тела ТОЛЬКО payment_id.
 * 3. Перечитать платёж: GET /v3/payments/{id} — и смотреть статус
 *    и сумму в ответе API, а не в теле вебхука.
 * 4. Начислить баллы по курсу 1 ₽ = 1 балл.
 *
 * ИДЕМПОТЕНТНОСТЬ. ЮKassa шлёт уведомление повторно при любой сетевой
 * ошибке, сутки подряд. Второе начисление должен отсекать уникальный
 * индекс на (type, source_id) в balance_transactions:
 *
 *   INSERT INTO balance_transactions (user_id, amount, type, source_id, ...)
 *   VALUES (?, ?, 'topup', :payment_id, ...);   ← упадёт на дубликате
 *   UPDATE user_balance SET balance = balance + ? WHERE user_id = ?;
 *
 * Строка журнала пишется ПЕРВОЙ: если сначала менять баланс, повторный
 * вебхук успеет удвоить счёт до того, как упрётся в индекс.
 *
 * Отвечать надо 200 почти всегда: для ЮKassa любой не-200 значит
 * «повтори», и очередь будет забита сутки.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$paymentId = (string) archi_ai_input('payment_id');
$amount = (float) archi_ai_input('amount');

if ($paymentId === '') {
    archi_ai_fail('notification_invalid', 'Нет payment_id.', 400);
}

$state = &archi_ai_state();

/* Имитация защиты от повторного начисления: в настоящем бэкенде эту
   роль играет уникальный индекс в базе, здесь — список в сессии. */
if (!isset($state['creditedPayments'])) {
    $state['creditedPayments'] = array();
}

if (in_array($paymentId, $state['creditedPayments'], true)) {
    archi_ai_send(array('ok' => true, 'demo' => true, 'credited' => false, 'duplicate' => true,
        'reason' => 'already_credited', 'quota' => archi_ai_quota()));
}

$points = (int) round($amount * ARCHI_AI_POINTS_PER_RUB);
$state['creditedPayments'][] = $paymentId;
$state['balance'] += $points;

archi_ai_push_history($points, 'topup', 'Пополнение',
    number_format($amount, 2, ',', ' ') . ' ₽ через ЮKassa');

archi_ai_send(array(
    'ok'        => true,
    'demo'      => true,
    'credited'  => true,
    'duplicate' => false,
    'points'    => $points,
    'quota'     => archi_ai_quota(),
));
