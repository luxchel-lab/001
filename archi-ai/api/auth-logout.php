<?php
/**
 * ЗАГЛУШКА · POST api/auth-logout.php
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 * Удалить строку сессии по хешу токена из cookie и погасить сам cookie.
 * Счётчик бесплатных примерок при этом НЕ сбрасывается: он привязан
 * к пользователю, а не к сессии.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$state = &archi_ai_state();
$state['authorized'] = false;
$state['phone'] = null;

archi_ai_send(array('ok' => true, 'demo' => true, 'quota' => archi_ai_quota()));
