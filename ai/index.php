<?php
/**
 * ArchiColor AI — страница /AI, визуализатор краски на стенах.
 *
 * Сценарий клиента:
 *   1. загружает фотографию своей комнаты;
 *   2. выбирает оттенок в палитре ArchiPaint;
 *   3. видит свою комнату с перекрашенными стенами — мебель, пол и потолок
 *      остаются как были (Decor8.ai /change_wall_color);
 *   4. видит, как краска легла при его освещении, и заказывает выкрас.
 *
 * Вся работа с провайдером — на бэкенде: /api/archicolor/generate.
 * Ключ Decor8 в браузер не попадает.
 */

// Шапка Bitrix подключается, если страница стоит на сайте; без неё файл
// открывается как есть — это нужно для локальной проверки и демо.
$bitrixHeader = isset($_SERVER['DOCUMENT_ROOT']) ? $_SERVER['DOCUMENT_ROOT'] . '/bitrix/header.php' : '';
$hasBitrix = $bitrixHeader !== '' && file_exists($bitrixHeader);

if ($hasBitrix) {
    require($bitrixHeader);

    $APPLICATION->SetPageProperty('title', 'Визуализатор краски: примерьте цвет на стенах своей комнаты | ArchiPaint');
    $APPLICATION->SetPageProperty('description', 'Загрузите фото комнаты и выберите оттенок ArchiPaint — покажем, как краска ляжет на ваши стены. Мебель и пол останутся нетронутыми, а ΔE покажет расхождение с выкрасом.');
    $APPLICATION->SetTitle('Визуализатор краски');

    \Bitrix\Main\Page\Asset::getInstance()->addCss('/assets/css/archicolor.css');
    // Порядок важен: каталог должен попасть в window.ARCHIPAINT_PALETTE раньше,
    // чем страница начнёт рисовать плитки выбора цвета.
    \Bitrix\Main\Page\Asset::getInstance()->addJs('/assets/js/podbor.palette.js', true);
    \Bitrix\Main\Page\Asset::getInstance()->addJs('/assets/js/archicolor.account.js', true);
    \Bitrix\Main\Page\Asset::getInstance()->addJs('/assets/js/archicolor.js', true);
} else {
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<title>Визуализатор краски ArchiPaint</title>'
       . '<link rel="stylesheet" href="/assets/css/archicolor.css">'
       // на боевом сайте шрифт задаёт шаблон Bitrix; здесь — только запасной
       . '<style>body{font-family:"Manrope",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style>'
       . '<script src="/assets/js/podbor.palette.js" defer></script>'
       . '<script src="/assets/js/archicolor.account.js" defer></script>'
       . '<script src="/assets/js/archicolor.js" defer></script>'
       . '</head><body style="margin:0;background:#FAFAF7">';
}
?>
<div class="ac-page" data-archicolor>
    <div class="ac-wrap">

        <!-- ========================= ШАПКА ========================= -->
        <section class="ac-hero">
            <p class="ac-kicker">Визуализатор краски</p>
            <h1>Примерьте цвет на стенах своей комнаты</h1>
            <p>Загрузите фотографию и выберите оттенок ArchiPaint — покажем, как он ляжет именно на ваши стены. Мебель, пол и потолок останутся нетронутыми, а ΔE честно покажет, насколько картинка на снимке расходится с выкрасом из каталога.</p>
            <p class="ac-hero-note">Три примерки в сутки бесплатно после входа по номеру телефона. Дальше — 20 баллов за примерку; баллы можно пополнить или получить кэшбэком с заказов краски.</p>
            <ol class="ac-steps">
                <li><b>1</b>Фотография комнаты</li>
                <li><b>2</b>Оттенок из палитры</li>
                <li><b>3</b>Примерка и заказ выкраса</li>
            </ol>

            <div class="ac-account" id="acAccount" hidden>
                <span class="ac-account-text" id="acAccountText"></span>
                <button class="ac-account-btn" id="acAccountBtn" type="button"></button>
                <a class="ac-account-link" href="/personal/balance/">Баланс и история →</a>
            </div>
        </section>

        <!-- ========================= ФОРМА ========================= -->
        <div class="ac-grid" id="acForm">
            <section class="ac-card">
                <h2>Фотография комнаты</h2>
                <p class="ac-card-note">JPG, PNG или WebP до 12 МБ. Снимайте с уровня глаз, чтобы в кадр попали пол, стены и окно — так генератор точнее сохранит геометрию.</p>

                <div class="ac-drop" id="acDrop" tabindex="0" role="button" aria-label="Загрузить фотографию комнаты">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <path d="M17 8l-5-5-5 5"/><path d="M12 3v13"/>
                    </svg>
                    <b>Перетащите фотографию сюда</b>
                    <small>или нажмите, чтобы выбрать файл · Ctrl+V вставит из буфера</small>
                </div>

                <div class="ac-preview" id="acPreview" hidden>
                    <img id="acPreviewImg" alt="Загруженная фотография комнаты">
                    <button class="ac-preview-x" id="acReset" type="button" aria-label="Убрать фотографию">✕</button>
                </div>

                <input type="file" id="acFile" accept="image/jpeg,image/png,image/webp" hidden>
                <p class="ac-file-note" id="acFileNote"></p>
            </section>

            <section class="ac-card">
                <h2>Цвет стен</h2>
                <p class="ac-card-note">Выберите оттенок из палитры ArchiPaint — красим только стены, мебель и пол останутся нетронутыми.</p>

                <label class="ac-visually-hidden" for="acColorSearch">Поиск по палитре</label>
                <input class="ac-search" id="acColorSearch" type="search" autocomplete="off"
                       placeholder="Название, артикул или HEX: «глина», AP-0118, #E6DBC8">

                <div class="ac-picked" id="acPicked" hidden>
                    <span class="ac-picked-sw" id="acPickedSw"></span>
                    <span class="ac-picked-txt">
                        <b id="acPickedName"></b>
                        <small id="acPickedCode"></small>
                    </span>
                </div>

                <div class="ac-swatches" id="acColorGrid"></div>

                <div class="ac-field-foot">
                    <span id="acQuota" class="ac-quota" hidden></span>
                    <span id="acColorCount"></span>
                </div>

                <div class="ac-error" id="acError" hidden>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.1"/>
                    </svg>
                    <span id="acErrorText"></span>
                </div>

                <div class="ac-topup" id="acTopup" hidden>
                    <p id="acTopupText"></p>
                    <div class="ac-topup-btns" id="acTopupBtns"></div>
                    <small>Оплата картой или через СБП. 1 ₽ = 1 балл, баллы не сгорают.</small>
                </div>

                <div class="ac-btn-row">
                    <button class="ac-btn ac-btn--accent" id="acSubmit" type="button" disabled>Примерить на стенах</button>
                    <a class="ac-btn ac-btn--ghost" href="/podbor-kraski-po-foto/">Подобрать цвет по фото</a>
                </div>
            </section>
        </div>

        <!-- ========================= ПРОГРЕСС ========================= -->
        <section class="ac-card ac-progress" id="acProgress" hidden aria-live="polite">
            <div class="ac-progress-bar"><i id="acProgressFill"></i></div>
            <p id="acProgressText">Отправляем фотографию…</p>
            <small>Обычно занимает от 5 до 20 секунд. Не закрывайте вкладку.</small>
        </section>

        <!-- ========================= РЕЗУЛЬТАТ ========================= -->
        <section class="ac-card" id="acResult" hidden>
            <h2>Как это выглядит</h2>
            <p class="ac-card-note">Потяните ползунок, чтобы сравнить с исходной фотографией.</p>

            <div class="ac-compare" id="acCompare">
                <img id="acBefore" alt="Исходная фотография комнаты">
                <div class="ac-after-wrap"><img id="acAfter" alt="Сгенерированный дизайн интерьера"></div>
                <span class="ac-compare-label ac-compare-label--before">Было</span>
                <span class="ac-compare-label ac-compare-label--after">Стало</span>
            </div>

            <input class="ac-range" id="acRange" type="range" min="0" max="100" value="50" aria-label="Сравнение до и после">
            <p class="ac-result-note" id="acResultNote"></p>

            <div class="ac-verdict" id="acVerdict"></div>
            <p class="ac-warning" id="acWarning" hidden></p>

            <div class="ac-btn-row">
                <a class="ac-btn ac-btn--accent" id="acDownload" href="#" download>Скачать изображение</a>
                <button class="ac-btn ac-btn--ghost" id="acAgain" type="button">Примерить ещё раз</button>
                <button class="ac-btn ac-btn--ghost" id="acNewPhoto" type="button">Другое фото</button>
            </div>
        </section>

        <!-- ========================= ЦВЕТА ========================= -->
        <section class="ac-card" id="acColorsCard" hidden>
            <h2>Как краска легла на стену</h2>
            <p class="ac-card-note" id="acColorsIntro"></p>
            <div id="acColors"></div>
        </section>

    </div>

    <!-- ========================= СЛУЖЕБНОЕ ========================= -->
    <button class="ac-fab" id="acCartBtn" type="button">
        Список к заказу
        <span class="ac-fab-count" id="acCartCount" hidden>0</span>
    </button>

    <div class="ac-drawer-back" id="acDrawerBack"></div>
    <aside class="ac-drawer" id="acDrawer" aria-label="Список подобранных цветов">
        <div class="ac-drawer-head">
            <h3>Список к заказу</h3>
            <button class="ac-modal-x" id="acDrawerClose" type="button" style="position:static" aria-label="Закрыть">✕</button>
        </div>
        <div class="ac-drawer-body" id="acCartItems"></div>
        <div class="ac-drawer-foot">
            <div class="ac-total"><span>Итого</span><b id="acCartTotal">0 ₽</b></div>
            <a class="ac-btn ac-btn--accent" href="/personal/cart/">Перейти к оформлению</a>
        </div>
    </aside>

    <div class="ac-modal-back" id="acModalBack"><div class="ac-modal" id="acModal"></div></div>
    <div class="ac-toast" id="acToast"></div>
</div>

<script>
/* Настройки страницы. Замените ссылки и товары на реальные позиции каталога —
   остальное трогать не нужно. */
(function () {
    function start() {
        if (typeof archicolor !== 'function') { return; }
        archicolor({
            generateUrl: '/api/archicolor/generate',
            quotaUrl:    '/api/archicolor/quota',
            analyzeUrl:  '/api/archicolor/analyze',
            colorUrl:    '/podbor-kraski-po-foto/?color={code}'
        });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

/* Необязательный хук: если нужно класть цвет в корзину Bitrix, определите
   эту функцию — она получит выбранный оттенок и вариант покупки.
window.archicolorAddToBasket = function (color, option) {
    BX.ajax.post('/api/basket/add.php', { code: color.code, option: option.id });
};
*/
</script>
<?php
if ($hasBitrix) {
    require($_SERVER['DOCUMENT_ROOT'] . '/bitrix/footer.php');
} else {
    echo '</body></html>';
}
