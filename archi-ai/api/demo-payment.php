<?php
/**
 * ЗАГЛУШКА · экран оплаты.
 *
 * Подменяет страницу ЮKassa: показывает сумму и две кнопки — «оплатить»
 * и «отменить». Кнопка оплаты дёргает webhook-yookassa.php, то есть
 * повторяет тот путь, которым баллы приходят на счёт в бою.
 *
 * В настоящем сервисе этой страницы нет: пользователь уходит на
 * confirmation_url ЮKassa, а вебхук приходит от неё на наш сервер.
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

$paymentId = isset($_GET['payment_id']) ? (string) $_GET['payment_id'] : '';
$amount = isset($_GET['amount']) ? (float) $_GET['amount'] : 0;
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Оплата · демо</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&display=swap" rel="stylesheet">
<style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#0E1512; font-family:"Manrope",system-ui,sans-serif; padding:20px; }
    .box { width:min(420px,100%); background:#fff; border-radius:20px; padding:32px 30px; text-align:center; }
    .tag { font-size:11px; font-weight:800; letter-spacing:.18em; text-transform:uppercase; color:#8A9B8F; }
    h1 { margin:14px 0 6px; font-size:34px; }
    p { margin:0 0 24px; color:#5C6660; font-size:14px; }
    button, a.cancel { display:block; width:100%; padding:14px; border-radius:12px; border:none;
           font:inherit; font-size:15px; font-weight:800; cursor:pointer; text-decoration:none; }
    button { background:#1B7F4B; color:#fff; }
    a.cancel { background:none; color:#5C6660; margin-top:10px; font-size:13px; }
    .note { margin-top:20px; font-size:11.5px; color:#8A9B8F; line-height:1.5; }
</style>
</head>
<body>
<div class="box">
    <span class="tag">Демо-оплата · СБП</span>
    <h1><?= number_format($amount, 0, ',', ' ') ?> ₽</h1>
    <p>Здесь была бы страница ЮKassa.<br>Баллов начислится: <?= (int) round($amount * ARCHI_AI_POINTS_PER_RUB) ?></p>

    <button type="button" id="pay">Оплатить</button>
    <a class="cancel" href="javascript:history.back()">Отмена</a>

    <p class="note">Кнопка вызывает webhook-yookassa.php — тот же путь,
       которым баллы приходят на счёт в бою. Начисление идемпотентно:
       повторный вебхук по этому платежу баланс не удвоит.</p>
</div>

<script>
document.getElementById('pay').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    button.textContent = 'Проводим платёж…';

    var body = new FormData();
    body.append('payment_id', <?= json_encode($paymentId) ?>);
    body.append('amount', <?= json_encode($amount) ?>);

    fetch('webhook-yookassa.php', { method: 'POST', body: body, credentials: 'same-origin' })
        .then(function (res) { return res.json(); })
        .then(function () { history.go(-1); })
        .catch(function () { button.disabled = false; button.textContent = 'Оплатить'; });
});
</script>
</body>
</html>
