<?php
/**
 * Личный кабинет — баллы ArchiPaint.
 *
 * Баланс, пополнение и история операций: чем начислено, сколько и когда.
 * Данные подтягиваются с /api/archicolor/me — страница ничего не считает сама.
 *
 * Ставится в раздел /personal/balance/. Если у сайта уже есть свой личный
 * кабинет, этот файл можно не заводить отдельной страницей, а перенести
 * разметку и вызов archicolorAccount() в существующий шаблон.
 */

$bitrixHeader = isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] . '/bitrix/header.php' : '';
$hasBitrix = $bitrixHeader !== '' && file_exists($bitrixHeader);

if ($hasBitrix) {
    require($bitrixHeader);

    $APPLICATION->SetPageProperty('title', 'Баллы ArchiPaint — баланс и история операций');
    $APPLICATION->SetPageProperty('description', 'Баланс баллов ArchiPaint, пополнение через СБП и история начислений: кэшбэк с заказов краски и списания за примерки в визуализаторе.');
    $APPLICATION->SetTitle('Баллы и история');

    \Bitrix\Main\Page\Asset::getInstance()->addCss('/assets/css/archicolor.css');
    \Bitrix\Main\Page\Asset::getInstance()->addJs('/assets/js/archicolor.account.js', true);
} else {
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<title>Баллы ArchiPaint</title>'
       . '<link rel="stylesheet" href="/assets/css/archicolor.css">'
       . '<style>body{font-family:"Manrope",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style>'
       . '<script src="/assets/js/archicolor.account.js" defer></script>'
       . '</head><body style="margin:0;background:#FAFAF7">';
}
?>
<div class="ac-page" data-archicolor-balance>
    <div class="ac-wrap">

        <section class="ac-hero">
            <p class="ac-kicker">Личный кабинет</p>
            <h1>Баллы ArchiPaint</h1>
            <p>Баллами оплачиваются примерки в визуализаторе сверх трёх бесплатных в сутки. Начисляются кэшбэком с заказов краски — 1000 ₽ заказа дают 1 балл — и пополнением: 1 ₽ = 1 балл.</p>
        </section>

        <!-- гость -->
        <section class="ac-card" id="acbGuest" hidden>
            <h2>Войдите, чтобы увидеть баланс</h2>
            <p class="ac-card-note">Вход по номеру телефона — пришлём код в SMS, пароль придумывать не нужно.</p>
            <div class="ac-btn-row">
                <button class="ac-btn ac-btn--accent" id="acbLogin" type="button">Войти по телефону</button>
            </div>
        </section>

        <!-- баланс -->
        <section class="ac-card" id="acbSummary" hidden>
            <div class="acb-head">
                <div>
                    <p class="acb-label">Текущий баланс</p>
                    <p class="acb-value" id="acbBalance">0</p>
                    <p class="acb-note" id="acbFree"></p>
                </div>
                <div class="acb-actions">
                    <span class="ac-account-text" id="acbPhone"></span>
                    <button class="ac-account-btn" id="acbLogout" type="button">Выйти</button>
                </div>
            </div>

            <h2 style="margin-top:22px">Пополнить баланс</h2>
            <p class="ac-card-note">Оплата картой или через СБП. Баллы придут на счёт сразу после подтверждения оплаты банком.</p>
            <div class="ac-topup-btns" id="acbTopup"></div>
            <p class="ac-auth-error" id="acbError" hidden></p>
        </section>

        <!-- история -->
        <section class="ac-card" id="acbHistoryCard" hidden>
            <h2>История операций</h2>
            <p class="ac-card-note" id="acbHistoryNote"></p>
            <div class="acb-table" id="acbHistory"></div>
            <div class="ac-btn-row">
                <button class="ac-btn ac-btn--ghost" id="acbMore" type="button" hidden>Показать ещё</button>
                <a class="ac-btn ac-btn--ghost" href="/ai/">Открыть визуализатор</a>
            </div>
        </section>

    </div>
</div>

<style>
.acb-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.acb-label { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--ink-3); }
.acb-value { margin: 6px 0 4px; font-size: 40px; font-weight: 700; line-height: 1; }
.acb-note { margin: 0; font-size: 13px; color: var(--ink-3); }
.acb-actions { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.acb-table { display: flex; flex-direction: column; gap: 8px; }
.acb-row {
  display: grid; grid-template-columns: 1fr auto auto; gap: 14px; align-items: center;
  padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper);
}
.acb-row b { font-size: 13.5px; }
.acb-row small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--ink-3); }
.acb-date { font-size: 12.5px; color: var(--ink-3); white-space: nowrap; }
.acb-amount { font-size: 15px; font-weight: 800; white-space: nowrap; }
.acb-amount--plus { color: var(--good); }
.acb-amount--minus { color: var(--ink-2); }
.acb-empty { padding: 32px 8px; text-align: center; color: var(--ink-3); font-size: 13.5px; }
@media (max-width: 520px) {
  .acb-row { grid-template-columns: 1fr auto; }
  .acb-date { grid-column: 1 / -1; }
}
</style>

<script>
(function () {
    function start() {
        if (typeof archicolorAccount !== 'function') { return; }

        var account = archicolorAccount();
        var el = {
            guest: document.getElementById('acbGuest'),
            summary: document.getElementById('acbSummary'),
            historyCard: document.getElementById('acbHistoryCard'),
            balance: document.getElementById('acbBalance'),
            free: document.getElementById('acbFree'),
            phone: document.getElementById('acbPhone'),
            topup: document.getElementById('acbTopup'),
            history: document.getElementById('acbHistory'),
            historyNote: document.getElementById('acbHistoryNote'),
            more: document.getElementById('acbMore'),
            error: document.getElementById('acbError')
        };

        var shown = 0;

        function plural(count, one, few, many) {
            var n = Math.abs(count) % 100, n1 = n % 10;
            if (n > 10 && n < 20) { return many; }
            if (n1 > 1 && n1 < 5) { return few; }
            return n1 === 1 ? one : many;
        }

        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function formatDate(iso) {
            var date = new Date(iso);
            if (isNaN(date.getTime())) { return iso; }
            return date.toLocaleString('ru-RU', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        }

        document.getElementById('acbLogin').addEventListener('click', function () { account.openLogin(); });
        document.getElementById('acbLogout').addEventListener('click', function () { account.logout(); });

        el.topup.innerHTML = account.presets.map(function (sum) {
            return '<button class="ac-btn ac-btn--ghost" type="button" data-topup="' + sum + '">' + sum + ' ₽</button>';
        }).join('');

        el.topup.addEventListener('click', function (e) {
            var button = e.target.closest('[data-topup]');
            if (!button) { return; }
            el.error.hidden = true;
            button.disabled = true;
            account.topUp(button.getAttribute('data-topup')).catch(function (error) {
                button.disabled = false;
                el.error.textContent = error.message;
                el.error.hidden = false;
            });
        });

        el.more.addEventListener('click', function () {
            shown += 20;
            renderHistory(account.state);
        });

        function renderHistory(state) {
            var items = state.history || [];
            var limit = shown || 20;
            var visible = items.slice(0, limit);

            if (!items.length) {
                el.history.innerHTML = '<p class="acb-empty">Операций пока нет. Баллы появятся после первого заказа краски или пополнения.</p>';
                el.more.hidden = true;
                el.historyNote.textContent = '';
                return;
            }

            el.history.innerHTML = visible.map(function (row) {
                var sign = row.amount > 0 ? '+' : '';
                return '<div class="acb-row">' +
                    '<span><b>' + escapeHtml(row.typeLabel) + '</b>' +
                      (row.comment ? '<small>' + escapeHtml(row.comment) + '</small>' : '') + '</span>' +
                    '<span class="acb-date">' + escapeHtml(formatDate(row.createdAt)) + '</span>' +
                    '<span class="acb-amount acb-amount--' + (row.amount > 0 ? 'plus' : 'minus') + '">' +
                      sign + row.amount + '</span>' +
                '</div>';
            }).join('');

            el.historyNote.textContent = 'Показаны ' + visible.length + ' из ' + (state.total || items.length) + '.';
            el.more.hidden = visible.length >= items.length;
        }

        account.onChange(function (state) {
            var authorized = state.authorized;
            el.guest.hidden = authorized;
            el.summary.hidden = !authorized;
            el.historyCard.hidden = !authorized;

            if (!authorized) { return; }

            el.balance.textContent = state.balance + ' ' + plural(state.balance, 'балл', 'балла', 'баллов');
            el.phone.textContent = state.user.phone;

            var quota = state.quota || {};
            el.free.textContent = quota.freeLeft > 0
                ? 'Сегодня доступно бесплатных примерок: ' + quota.freeLeft + ' из ' + quota.freePerDay + '.'
                : 'Бесплатные примерки на сегодня закончились — следующая примерка спишет '
                    + quota.pricePoints + ' ' + plural(quota.pricePoints, 'балл', 'балла', 'баллов') + '.';

            renderHistory(state);
        });

        account.load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
</script>
<?php
if ($hasBitrix) {
    require($_SERVER['DOCUMENT_ROOT'] . '/bitrix/footer.php');
} else {
    echo '</body></html>';
}
