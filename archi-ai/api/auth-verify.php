<?php
/**
 * ЗАГЛУШКА · POST api/auth-verify.php
 *
 * Приём: phone, code. Ответ: пользователь и состояние лимита.
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 * 1. Найти последний неиспользованный код для этого номера.
 * 2. АТОМАРНО увеличить счётчик попыток и сжечь код после 5-й:
 *    UPDATE ac_auth_code SET attempts = attempts + 1
 *     WHERE id = ? AND attempts < 5
 *    Проверять по числу затронутых строк, иначе четырёхзначный код
 *    подбирается параллельными запросами за секунды.
 * 3. Сверить хеши через hash_equals (не ==).
 * 4. Завести пользователя по номеру, если его ещё нет.
 * 5. Выдать сессию: в cookie — токен (httponly, secure, samesite=Lax),
 *    в базе — только его ХЕШ.
 *
 * Заглушка принимает код 1234 и любой шестизначный.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$phone = preg_replace('/\D+/', '', (string) archi_ai_input('phone'));
$code  = preg_replace('/\D+/', '', (string) archi_ai_input('code'));

archi_ai_delay(0.5);

if ($code === '') {
    archi_ai_fail('code_invalid', 'Введите код из SMS.', 422);
}
if ($code !== ARCHI_AI_DEMO_CODE && strlen($code) !== 6) {
    archi_ai_fail('code_wrong', 'Неверный код. В демо-режиме подойдёт ' . ARCHI_AI_DEMO_CODE . '.', 401);
}

$state = &archi_ai_state();
$state['authorized'] = true;
$state['phone'] = '+7' . substr($phone, -10, 3) . '***' . substr($phone, -4);

archi_ai_send(array(
    'ok'    => true,
    'demo'  => true,
    'user'  => array('phone' => $state['phone']),
    'quota' => archi_ai_quota(),
));
