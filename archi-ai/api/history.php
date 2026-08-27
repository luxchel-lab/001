<?php
/**
 * ЗАГЛУШКА · GET api/history.php
 *
 * История движений баллов для личного кабинета.
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 *   SELECT amount, type, comment, created_at
 *     FROM balance_transactions
 *    WHERE user_id = ?
 *    ORDER BY id DESC
 *    LIMIT ? OFFSET ?
 * Даты хранить в UTC, отдавать с часовым поясом.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$state = archi_ai_state();

archi_ai_send(array(
    'ok'      => true,
    'demo'    => true,
    'balance' => (int) $state['balance'],
    'items'   => $state['history'],
    'total'   => count($state['history']),
));
