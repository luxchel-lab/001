<?php
/**
 * ArchiColor AI — страница /AI.
 *
 * Сценарий клиента:
 *   1. загружает фотографию своей комнаты;
 *   2. пишет в свободной форме, что с ней сделать;
 *   3. получает сгенерированный Decor8.ai дизайн;
 *   4. видит, из каких цветов он состоит, и заказывает ближайшие оттенки
 *      ArchiPaint — той же математикой ΔE, что и на странице «Подбор цвета».
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

    $APPLICATION->SetPageProperty('title', 'ArchiColor AI — ИИ-дизайн интерьера по фото и подбор краски | ArchiPaint');
    $APPLICATION->SetPageProperty('description', 'Загрузите фото комнаты и опишите задачу своими словами — ИИ покажет новый интерьер, разложит его на цвета и подберёт ближайшие оттенки краски ArchiPaint с точностью ΔE.');
    $APPLICATION->SetTitle('ArchiColor AI');

    \Bitrix\Main\Page\Asset::getInstance()->addCss('/assets/css/archicolor.css');
    \Bitrix\Main\Page\Asset::getInstance()->addJs('/assets/js/archicolor.js', true);
} else {
    echo '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
       . '<meta name="viewport" content="width=device-width, initial-scale=1">'
       . '<title>ArchiColor AI — ИИ-дизайн интерьера и подбор краски</title>'
       . '<link rel="stylesheet" href="/assets/css/archicolor.css">'
       // на боевом сайте шрифт задаёт шаблон Bitrix; здесь — только запасной
       . '<style>body{font-family:"Manrope",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}</style>'
       . '<script src="/assets/js/archicolor.js" defer></script>'
       . '</head><body style="margin:0;background:#FAFAF7">';
}
?>
<div class="ac-page" data-archicolor>
    <div class="ac-wrap">

        <!-- ========================= ШАПКА ========================= -->
        <section class="ac-hero">
            <p class="ac-kicker">ArchiColor AI</p>
            <h1>Опишите комнату своими словами — покажем, как она может выглядеть</h1>
            <p>Загрузите фотографию, напишите задание в свободной форме — «спальня в скандинавском стиле, тёплые тона, много дерева». Нейросеть перерисует интерьер, а мы разложим результат на цвета и подберём к каждому ближайшую краску ArchiPaint с точностью ΔE.</p>
            <ol class="ac-steps">
                <li><b>1</b>Фотография комнаты</li>
                <li><b>2</b>Задание своими словами</li>
                <li><b>3</b>Дизайн и палитра к заказу</li>
            </ol>
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
                <h2>Что сделать с этой комнатой</h2>
                <p class="ac-card-note">Пишите так, как рассказали бы дизайнеру. Стиль, настроение, цвета, материалы, мебель — всё, что важно.</p>

                <label class="ac-visually-hidden" for="acPrompt">Задание для ИИ</label>
                <textarea id="acPrompt" maxlength="900" placeholder="Например: гостиная в скандинавском стиле, светлые стены, тёплое дерево, зелёный диван, много растений и мягкого света"></textarea>

                <div class="ac-field-foot">
                    <span id="acQuota" class="ac-quota" hidden></span>
                    <span id="acPromptCount">0 / 900</span>
                </div>

                <div class="ac-samples" id="acSamples">
                    <button class="ac-sample" type="button" data-sample="Гостиная в скандинавском стиле: светлые стены, тёплое дерево, зелёный диван, много растений">Скандинавская гостиная</button>
                    <button class="ac-sample" type="button" data-sample="Спальня в стиле джапанди, приглушённые тёплые тона, низкая кровать, лён и бумажные светильники">Спальня джапанди</button>
                    <button class="ac-sample" type="button" data-sample="Кухня в стиле лофт: кирпичная стена, бетон, тёмные фасады, латунные детали и барный остров">Кухня-лофт</button>
                    <button class="ac-sample" type="button" data-sample="Детская в пастельных тонах, мягкий ковёр, открытые полки, много естественного света">Светлая детская</button>
                </div>

                <div class="ac-error" id="acError" hidden>
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                        <circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.2v.1"/>
                    </svg>
                    <span id="acErrorText"></span>
                </div>

                <div class="ac-btn-row">
                    <button class="ac-btn ac-btn--accent" id="acSubmit" type="button" disabled>Сгенерировать дизайн</button>
                    <a class="ac-btn ac-btn--ghost" href="/podbor-kraski-po-foto/">Подобрать цвет без ИИ</a>
                </div>
            </section>
        </div>

        <!-- ========================= ПРОГРЕСС ========================= -->
        <section class="ac-card ac-progress" id="acProgress" hidden aria-live="polite">
            <div class="ac-progress-bar"><i id="acProgressFill"></i></div>
            <p id="acProgressText">Отправляем фотографию в генератор…</p>
            <small>Обычно занимает от 20 до 60 секунд. Не закрывайте вкладку.</small>
        </section>

        <!-- ========================= РЕЗУЛЬТАТ ========================= -->
        <section class="ac-card" id="acResult" hidden>
            <h2>Что получилось</h2>
            <p class="ac-card-note">Потяните ползунок, чтобы сравнить с исходной фотографией.</p>

            <div class="ac-compare" id="acCompare">
                <img id="acBefore" alt="Исходная фотография комнаты">
                <div class="ac-after-wrap"><img id="acAfter" alt="Сгенерированный дизайн интерьера"></div>
                <span class="ac-compare-label ac-compare-label--before">Было</span>
                <span class="ac-compare-label ac-compare-label--after">Стало</span>
            </div>

            <input class="ac-range" id="acRange" type="range" min="0" max="100" value="50" aria-label="Сравнение до и после">
            <p class="ac-result-note" id="acResultNote"></p>

            <div class="ac-btn-row">
                <a class="ac-btn ac-btn--accent" id="acDownload" href="#" download>Скачать изображение</a>
                <button class="ac-btn ac-btn--ghost" id="acAgain" type="button">Сгенерировать ещё вариант</button>
                <button class="ac-btn ac-btn--ghost" id="acNewPhoto" type="button">Другое фото</button>
            </div>
        </section>

        <!-- ========================= ЦВЕТА ========================= -->
        <section class="ac-card" id="acColorsCard" hidden>
            <h2>Цвета этого интерьера</h2>
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
