<?php
/**
 * ArchiColor AI — ЗАГЛУШКИ БЭКЕНДА.
 *
 * ================================================================
 *  ЭТО НЕ РАБОЧИЙ БЭКЕНД. Здесь имитация: правдоподобные ответы
 *  нужного формата, чтобы фронтенд можно было показать и потрогать.
 *  Ни Decor8.ai, ни ЮKassa, ни база данных отсюда не вызываются.
 * ================================================================
 *
 * В каждом файле-заглушке под комментарием «ЧТО ДОЛЖЕН ДЕЛАТЬ НАСТОЯЩИЙ
 * БЭКЕНД» описано, чем именно её заменить. Формат ответов совпадает с тем,
 * что ждёт фронтенд, поэтому подмена заглушки на реализацию не потребует
 * править JS.
 *
 * Состояние демо (вход, счётчик примерок, баланс) живёт в PHP-сессии:
 * у каждого посетителя своё, перезагрузка страницы его не сбрасывает,
 * а перезапуск браузера — сбрасывает. Для показа этого достаточно,
 * для настоящего сервиса нужна БД.
 */

/* ---------------------------------------------------------------- */
/*  Общие настройки демо                                            */
/* ---------------------------------------------------------------- */

const ARCHI_AI_FREE_PER_DAY   = 3;      // бесплатных примерок в сутки
const ARCHI_AI_PRICE_POINTS   = 20;     // баллов за примерку сверх лимита
const ARCHI_AI_POINTS_PER_RUB = 1;      // 1 ₽ = 1 балл
const ARCHI_AI_DEMO_CODE      = '1234'; // код «из SMS» для демонстрации

/* ---------------------------------------------------------------- */
/*  Служебное                                                        */
/* ---------------------------------------------------------------- */

function archi_ai_boot()
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');

    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_start();
    }

    if (!isset($_SESSION['archi_ai'])) {
        $_SESSION['archi_ai'] = array(
            'authorized' => false,
            'phone'      => null,
            'usedToday'  => 0,
            'balance'    => 0,
            'history'    => array(),
        );
    }
}

function &archi_ai_state()
{
    return $_SESSION['archi_ai'];
}

function archi_ai_send(array $payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function archi_ai_fail($code, $message, $status = 400)
{
    archi_ai_send(array('ok' => false, 'error' => array('code' => $code, 'message' => $message)), $status);
}

/** Поле формы или JSON-тела — демо-фронт шлёт и так, и так. */
function archi_ai_input($key, $default = '')
{
    if (isset($_POST[$key])) {
        return is_string($_POST[$key]) ? $_POST[$key] : $default;
    }

    static $json = null;
    if ($json === null) {
        $decoded = json_decode((string) file_get_contents('php://input'), true);
        $json = is_array($decoded) ? $decoded : array();
    }

    return isset($json[$key]) ? $json[$key] : $default;
}

/**
 * Имитация задержки.
 *
 * Настоящая генерация у Decor8 занимает 5–20 секунд, и интерфейс должен
 * достойно переживать это ожидание. Если убрать паузу совсем, прогресс-бар
 * и скелетоны на демо просто не успеют показаться.
 */
function archi_ai_delay($seconds)
{
    usleep((int) ($seconds * 1000000));
}

/** Текущее состояние лимита и баланса — им отвечают сразу несколько заглушек. */
function archi_ai_quota()
{
    $state = archi_ai_state();
    $left = max(0, ARCHI_AI_FREE_PER_DAY - (int) $state['usedToday']);

    return array(
        'authorized'  => (bool) $state['authorized'],
        'phone'       => $state['phone'],
        'freePerDay'  => ARCHI_AI_FREE_PER_DAY,
        'freeLeft'    => $left,
        'usedToday'   => (int) $state['usedToday'],
        'balance'     => (int) $state['balance'],
        'pricePoints' => ARCHI_AI_PRICE_POINTS,
        'canGenerate' => $state['authorized'] && ($left > 0 || $state['balance'] >= ARCHI_AI_PRICE_POINTS),
        // В настоящем бэкенде это ближайшая полночь по МСК
        'resetAt'     => gmdate('c', strtotime('tomorrow 00:00 +03:00')),
    );
}

/** Добавляет операцию в демо-историю. */
function archi_ai_push_history($amount, $type, $label, $comment = null)
{
    $state = &archi_ai_state();
    array_unshift($state['history'], array(
        'amount'    => (int) $amount,
        'type'      => $type,
        'typeLabel' => $label,
        'comment'   => $comment,
        'createdAt' => gmdate('c'),
    ));
    $state['history'] = array_slice($state['history'], 0, 50);
}

/** Демонстрационная палитра ArchiPaint. */
function archi_ai_palette()
{
    return array(
        array('code' => 'AP-0101', 'name' => 'Полярный день',      'hex' => '#F6F3F0', 'collection' => 'Nord'),
        array('code' => 'AP-0110', 'name' => 'Молочный туман',     'hex' => '#EFE9E1', 'collection' => 'Nord'),
        array('code' => 'AP-0118', 'name' => 'Ванильный крем',     'hex' => '#EBE1D6', 'collection' => 'Nord'),
        array('code' => 'AP-0126', 'name' => 'Льняное полотно',    'hex' => '#DDD3C4', 'collection' => 'Nord'),
        array('code' => 'AP-0204', 'name' => 'Серый кашемир',      'hex' => '#C9C7C1', 'collection' => 'Minerals'),
        array('code' => 'AP-0212', 'name' => 'Пыль дороги',        'hex' => '#9CA1A5', 'collection' => 'Minerals'),
        array('code' => 'AP-0219', 'name' => 'Титановый корпус',   'hex' => '#8D959B', 'collection' => 'Minerals'),
        array('code' => 'AP-0224', 'name' => 'Кремень',            'hex' => '#2C3136', 'collection' => 'Minerals'),
        array('code' => 'AP-0314', 'name' => 'Пустынный ветер',    'hex' => '#C9AB8C', 'collection' => 'Terra'),
        array('code' => 'AP-0322', 'name' => 'Латте',              'hex' => '#A9866B'        , 'collection' => 'Terra'),
        array('code' => 'AP-0407', 'name' => 'Пряничная корка',    'hex' => '#7A6450', 'collection' => 'Terra'),
        array('code' => 'AP-0415', 'name' => 'Терракотовый сад',   'hex' => '#9C5F45', 'collection' => 'Terra'),
        array('code' => 'AP-0913', 'name' => 'Грозовое небо',      'hex' => '#4F6076', 'collection' => 'Pigments'),
        array('code' => 'AP-0921', 'name' => 'Ультрамарин',        'hex' => '#33507E', 'collection' => 'Pigments'),
        array('code' => 'AP-1003', 'name' => 'Мятный лёд',         'hex' => '#B7CCC4', 'collection' => 'Pigments'),
        array('code' => 'AP-1106', 'name' => 'Лесной мох',         'hex' => '#5A6E56', 'collection' => 'Minerals'),
        array('code' => 'AP-1107', 'name' => 'Хвойная тень',       'hex' => '#414F45', 'collection' => 'Minerals'),
        array('code' => 'AP-1115', 'name' => 'Бутылочное стекло',  'hex' => '#2F4033', 'collection' => 'Minerals'),
        array('code' => 'AP-1202', 'name' => 'Тростниковая циновка','hex' => '#D6CBB4', 'collection' => 'Minerals'),
        array('code' => 'AP-1222', 'name' => 'Зелёная умбра',      'hex' => '#626D3C', 'collection' => 'Minerals'),
        array('code' => 'AP-0605', 'name' => 'Пудровый шёлк',      'hex' => '#E2C9C4', 'collection' => 'Terra'),
        array('code' => 'AP-0712', 'name' => 'Винный погреб',      'hex' => '#6B3A42', 'collection' => 'Pigments'),
        array('code' => 'AP-0808', 'name' => 'Медный всадник',     'hex' => '#A86B4A', 'collection' => 'Terra'),
        array('code' => 'AP-0230', 'name' => 'Графитовый чертёж',  'hex' => '#3A3F44', 'collection' => 'Minerals'),
    );
}

function archi_ai_find_color($code)
{
    foreach (archi_ai_palette() as $color) {
        if (strcasecmp($color['code'], (string) $code) === 0) {
            return $color;
        }
    }
    return null;
}
