<?php
/**
 * ЗАГЛУШКА · POST api/generate.php
 *
 * Главный эндпоинт: фотография комнаты + выбранный оттенок → изображение
 * с перекрашенными стенами и разбор результата на цвета.
 *
 * Приём (multipart/form-data): image, code (артикул оттенка).
 *
 * ── ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ БЭКЕНД ──────────────────────────────
 *
 * 1. ДОСТУП
 *    Только для авторизованных. Порядок списания:
 *      — сначала бесплатная примерка (3 в сутки по МСК);
 *      — кончились — списать 20 баллов;
 *      — баллов не хватает → 402, до провайдера дело не доходит.
 *    Оба списания атомарны, через UPDATE с условием и проверкой числа
 *    затронутых строк:
 *      UPDATE ac_daily_usage SET used = used + 1
 *       WHERE user_id = ? AND usage_date = ? AND used < 3;
 *      UPDATE user_balance  SET balance = balance - 20
 *       WHERE user_id = ? AND balance >= 20;
 *
 * 2. ФОТОГРАФИЯ
 *    Проверить тип и размер, снять EXIF (там геометки), развернуть по
 *    ориентации камеры, ужать до ~1600 px и сохранить.
 *
 * 3. ВЫЗОВ DECOR8
 *    POST https://api.decor8.ai/change_wall_color
 *      Authorization: Bearer <ключ с сервера, в браузер он не попадает>
 *      { "input_image_url": "...", "wall_color_hex_code": "#EBE1D6" }
 *    Метод перекрашивает ТОЛЬКО стены: мебель, пол и потолок остаются.
 *    HEX брать из каталога по артикулу, а не из тела запроса: клиент
 *    выбрал оттенок в палитре, красить надо ровно им.
 *
 * 4. РЕЗУЛЬТАТ
 *    Скачать картинку с CDN провайдера на свой домен — иначе браузер
 *    не даст ни скачать её, ни прочитать пиксели (CORS).
 *
 * 5. РАЗБОР НА ЦВЕТА
 *    Сравнить результат с исходным фото: change_wall_color меняет только
 *    стены, значит изменившиеся точки — это и есть стена. По ним k-means
 *    в CIE Lab → как краска легла, и ΔE2000 до выкраса каталога.
 *
 * 6. ОТКАТ
 *    Провайдер не справился — вернуть списанное: бесплатную примерку
 *    в счётчик суток, баллы на счёт. Клиент не платит за чужую неудачу.
 *
 * ── ЧТО ДЕЛАЕТ ЗАГЛУШКА ─────────────────────────────────────────────
 * Тонирует верхнюю часть кадра выбранным цветом средствами GD. Это не
 * распознавание стен, а имитация — ровно чтобы фронт было что показать.
 * ────────────────────────────────────────────────────────────────────
 */

require __DIR__ . '/_stub.php';
archi_ai_boot();

/* ---------- проверки, которые останутся и в настоящем бэкенде ---------- */

$state = &archi_ai_state();

if (!$state['authorized']) {
    archi_ai_fail('auth_required', 'Войдите по номеру телефона, чтобы пользоваться визуализатором.', 401);
}

$color = archi_ai_find_color(archi_ai_input('code'));
if ($color === null) {
    archi_ai_fail('color_missing', 'Выберите цвет стен из палитры ArchiPaint.', 422);
}

if (empty($_FILES['image']['tmp_name'])) {
    archi_ai_fail('upload_missing', 'Загрузите фотографию комнаты.', 400);
}

/* ---------- списание: в заглушке те же правила, без атомарности ---------- */

$freeLeft = max(0, ARCHI_AI_FREE_PER_DAY - (int) $state['usedToday']);
$charged = 'free';

if ($freeLeft > 0) {
    $state['usedToday']++;
} elseif ($state['balance'] >= ARCHI_AI_PRICE_POINTS) {
    $state['balance'] -= ARCHI_AI_PRICE_POINTS;
    $charged = 'points';
    archi_ai_push_history(-ARCHI_AI_PRICE_POINTS, 'spend', 'Примерка в визуализаторе');
} else {
    archi_ai_fail(
        'not_enough_points',
        'Бесплатные примерки на сегодня закончились, а на счету ' . $state['balance']
            . ' из ' . ARCHI_AI_PRICE_POINTS . ' баллов. Пополните баланс, чтобы продолжить.',
        402
    );
}

/* ---------- имитация работы провайдера ---------- */

archi_ai_delay(2.2);   // Decor8 отвечает за 5–20 с; на демо ждать столько незачем

$source = $_FILES['image']['tmp_name'];
$info = @getimagesize($source);

if (!$info) {
    archi_ai_fail('image_broken', 'Файл повреждён или это не изображение.', 415);
}

$image = null;
switch ($info[2]) {
    case IMAGETYPE_JPEG: $image = @imagecreatefromjpeg($source); break;
    case IMAGETYPE_PNG:  $image = @imagecreatefrompng($source);  break;
    case IMAGETYPE_WEBP: $image = function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($source) : false; break;
}
if (!$image) {
    archi_ai_fail('image_unsupported', 'Поддерживаются JPG, PNG и WebP.', 415);
}
if (!imageistruecolor($image)) {
    imagepalettetotruecolor($image);
}

$width = imagesx($image);
$height = imagesy($image);

/* Ужимаем — большая картинка в base64 раздует ответ. */
$maxSide = 1100;
if (max($width, $height) > $maxSide) {
    $scale = $maxSide / max($width, $height);
    $newW = max(1, (int) round($width * $scale));
    $newH = max(1, (int) round($height * $scale));
    $resized = imagecreatetruecolor($newW, $newH);
    imagecopyresampled($resized, $image, 0, 0, 0, 0, $newW, $newH, $width, $height);
    imagedestroy($image);
    $image = $resized;
    $width = $newW;
    $height = $newH;
}

/**
 * Имитация перекраски.
 *
 * Настоящий Decor8 сам находит стены нейросетью. Здесь — грубое
 * приближение: верхние 58% кадра смешиваются с выбранным цветом,
 * тёмные пиксели (мебель, тени) сохраняются сильнее светлых.
 */
list($tr, $tg, $tb) = sscanf($color['hex'], '#%02x%02x%02x');
$wallBottom = (int) ($height * 0.58);

for ($y = 0; $y < $wallBottom; $y++) {
    // ближе к линии пола эффект слабеет — так стык выглядит мягче
    $fade = 1 - pow($y / $wallBottom, 3) * 0.35;

    for ($x = 0; $x < $width; $x++) {
        $rgb = imagecolorat($image, $x, $y);
        $r = ($rgb >> 16) & 0xFF;
        $g = ($rgb >> 8) & 0xFF;
        $b = $rgb & 0xFF;

        $luma = (0.2126 * $r + 0.7152 * $g + 0.0722 * $b) / 255;
        if ($luma < 0.22) {
            continue;   // очень тёмные участки считаем мебелью и не трогаем
        }

        $mix = min(0.92, $luma * 1.05) * $fade;
        $shade = 0.72 + $luma * 0.38;   // сохраняем светотень исходной стены

        imagesetpixel($image, $x, $y, imagecolorallocate($image,
            (int) min(255, $r * (1 - $mix) + $tr * $shade * $mix),
            (int) min(255, $g * (1 - $mix) + $tg * $shade * $mix),
            (int) min(255, $b * (1 - $mix) + $tb * $shade * $mix)
        ));
    }
}

ob_start();
imagejpeg($image, null, 88);
$binary = ob_get_clean();
imagedestroy($image);

/* Отдаём картинку data-URI: заглушке некуда её сохранять, а фронту
   этого достаточно. Настоящий бэкенд вернёт ссылку на свой домен. */
$resultImage = 'data:image/jpeg;base64,' . base64_encode($binary);

/* ---------- имитация разбора на цвета ---------- */

$palette = archi_ai_palette();
$matches = array();

/* Настоящий бэкенд считает ΔE2000 между цветом стены на фотографии
   и каждым оттенком каталога. Заглушка берёт выбранный оттенок и
   двух соседей по списку, а ΔE выдумывает правдоподобным. */
$index = 0;
foreach ($palette as $i => $item) {
    if ($item['code'] === $color['code']) {
        $index = $i;
    }
}

$neighbours = array($index, ($index + 1) % count($palette), ($index + 2) % count($palette));
$fakeDeltas = array(0.84, 2.41, 3.96);

foreach ($neighbours as $n => $paletteIndex) {
    $item = $palette[$paletteIndex];
    $delta = $fakeDeltas[$n];
    $matches[] = array(
        'code'       => $item['code'],
        'name'       => $item['name'],
        'hex'        => $item['hex'],
        'collection' => 'ArchiPaint ' . $item['collection'],
        'deltaE'     => $delta,
        'quality'    => $delta <= 1.5 ? 'Точное совпадение' : ($delta <= 3.5 ? 'Заметно при сравнении' : 'Заметная разница'),
        'qualityCls' => $delta <= 1.5 ? 'good' : ($delta <= 3.5 ? 'mid' : 'poor'),
    );
}

$tones = array(
    array('hex' => $color['hex'], 'role' => 'Основной тон стены',  'sharePct' => 62.4, 'lrv' => 71.2),
    array('hex' => archi_ai_shift($color['hex'],  16), 'role' => 'Стена на свету', 'sharePct' => 24.8, 'lrv' => 78.5),
    array('hex' => archi_ai_shift($color['hex'], -22), 'role' => 'Стена в тени',   'sharePct' => 12.8, 'lrv' => 58.1),
);

foreach ($tones as $i => $tone) {
    $tones[$i]['matches'] = $matches;
    $tones[$i]['textOn'] = archi_ai_readable($tone['hex']);
}

archi_ai_send(array(
    'ok'      => true,
    'demo'    => true,
    'jobId'   => 'demo-' . substr(md5(microtime(true) . $color['code']), 0, 12),
    'image'   => $resultImage,
    'charged' => $charged,
    'chargedPoints' => $charged === 'points' ? ARCHI_AI_PRICE_POINTS : 0,
    'elapsed' => 2.2,
    'wall'    => array(
        'requested' => array(
            'code'       => $color['code'],
            'name'       => $color['name'],
            'hex'        => $color['hex'],
            'collection' => 'ArchiPaint ' . $color['collection'],
            'lrv'        => 71.2,
            'textOn'     => archi_ai_readable($color['hex']),
        ),
        'rendered' => array(
            'hex'    => archi_ai_shift($color['hex'], 6),
            'lrv'    => 73.4,
            'textOn' => archi_ai_readable(archi_ai_shift($color['hex'], 6)),
        ),
        'deltaE'     => 1.37,
        'quality'    => 'Точное совпадение',
        'qualityCls' => 'good',
        'coverage'   => array('changedPct' => 34.6),
        'colors'     => $tones,
    ),
    'quota'   => archi_ai_quota(),
));

/* ---------- мелкие помощники заглушки ---------- */

/** Осветляет или затемняет HEX на заданную величину. */
function archi_ai_shift($hex, $amount)
{
    list($r, $g, $b) = sscanf($hex, '#%02x%02x%02x');
    return sprintf('#%02X%02X%02X',
        max(0, min(255, $r + $amount)),
        max(0, min(255, $g + $amount)),
        max(0, min(255, $b + $amount))
    );
}

/** Цвет текста, читаемый на этом фоне. */
function archi_ai_readable($hex)
{
    list($r, $g, $b) = sscanf($hex, '#%02x%02x%02x');
    return (0.2126 * $r + 0.7152 * $g + 0.0722 * $b) > 150 ? '#1A1D19' : '#FFFFFF';
}
