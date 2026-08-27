<?php
/**
 * Автотест лимитов и баллов.
 *
 *   php tools/archicolor-test-balance.php
 *
 * Гоняет логику на временной базе SQLite: московские сутки, атомарность
 * счётчика и списания, идемпотентность начислений, округление кэшбэка.
 * Рабочие запросы те же, что уйдут в MySQL, — отличается только диалект схемы.
 *
 * Проверку настоящей параллельности делает tools/archicolor-test-race.php.
 */

$root = dirname(__DIR__);
require_once $root . '/lib/archicolor/Config.php';
require_once $root . '/lib/archicolor/Db.php';
require_once $root . '/lib/archicolor/Limits.php';
require_once $root . '/lib/archicolor/Balance.php';

use ArchiColor\Balance;
use ArchiColor\Config;
use ArchiColor\Db;
use ArchiColor\Limits;

$dbFile = sys_get_temp_dir() . '/archicolor-test-' . getmypid() . '.sqlite';
@unlink($dbFile);
Config::override(array('db_dsn' => 'sqlite:' . $dbFile, 'free_per_day' => 3, 'price_points' => 20));

foreach (explode(";\n", file_get_contents($root . '/db/schema.sqlite.sql')) as $statement) {
    $lines = array();
    foreach (preg_split('/\r\n|\r|\n/', $statement) as $line) {
        if (strpos(ltrim($line), '--') !== 0) {
            $lines[] = $line;
        }
    }
    $statement = trim(implode("\n", $lines));
    if ($statement !== '') {
        Db::pdo()->exec($statement);
    }
}

$failed = 0;
$passed = 0;

function check($title, $actual, $expected)
{
    global $failed, $passed;
    $ok = $actual === $expected;
    $ok ? $passed++ : $failed++;
    $pad = max(1, 52 - mb_strlen($title, 'UTF-8'));
    echo ($ok ? '  OK  ' : ' FAIL '), $title, str_repeat(' ', $pad),
        $ok ? '' : ('получили ' . var_export($actual, true) . ', ждали ' . var_export($expected, true)), "\n";
}

function section($title)
{
    echo "\n", $title, "\n", str_repeat('-', 72), "\n";
}

$userId = 1;
Db::run('INSERT INTO ac_user (id, phone, created_at) VALUES (1, :phone, :now)',
    array('phone' => '+79990000001', 'now' => Db::utcNow()));

/* ---------------------------------------------------------------- */
section('Московские сутки');

// 20:59:59 UTC — это 23:59:59 МСК того же дня
check('23:59:59 МСК — ещё сегодня', Limits::today(gmmktime(20, 59, 59, 8, 27, 2026)), '2026-08-27');
// 21:00:00 UTC — уже 00:00:00 МСК следующего дня
check('00:00:00 МСК — уже завтра', Limits::today(gmmktime(21, 0, 0, 8, 27, 2026)), '2026-08-28');
check('полдень МСК', Limits::today(gmmktime(9, 0, 0, 8, 27, 2026)), '2026-08-27');

/* ---------------------------------------------------------------- */
section('Бесплатный лимит: 3 в сутки');

check('первая примерка', Limits::consume($userId), true);
check('вторая примерка', Limits::consume($userId), true);
check('третья примерка', Limits::consume($userId), true);
check('четвёртая — лимит исчерпан', Limits::consume($userId), false);
check('пятая тоже', Limits::consume($userId), false);

$state = Limits::state($userId);
check('использовано за сутки', $state['used'], 3);
check('осталось бесплатных', $state['left'], 0);

check('возврат примерки', Limits::refund($userId), true);
check('после возврата снова можно', Limits::consume($userId), true);

/* ---------------------------------------------------------------- */
section('Списание баллов');

check('баланс нового пользователя', Balance::get($userId), 0);
check('списать с пустого счёта нельзя', Balance::spend($userId, 20, 'job-empty'), false);

Balance::credit($userId, 50, Balance::TYPE_TOPUP, 'manual-1', 'тестовое начисление');
check('после начисления 50', Balance::get($userId), 50);

check('первое списание 20', Balance::spend($userId, 20, 'job-1'), true);
check('баланс 30', Balance::get($userId), 30);
check('второе списание 20', Balance::spend($userId, 20, 'job-2'), true);
check('баланс 10', Balance::get($userId), 10);
check('третье списание — не хватает', Balance::spend($userId, 20, 'job-3'), false);
check('баланс не ушёл в минус', Balance::get($userId), 10);

check('возврат за неудачную примерку', Balance::refundSpend($userId, 20, 'job-2'), true);
check('баланс после возврата', Balance::get($userId), 30);
check('повторный возврат по той же примерке', Balance::refundSpend($userId, 20, 'job-2'), false);
check('баланс не удвоился', Balance::get($userId), 30);

/* ---------------------------------------------------------------- */
section('Идемпотентность пополнения');

$first = Balance::topUp($userId, 500, 'yk-payment-abc');
check('первое зачисление платежа', $first['credited'], true);
check('начислено баллов (1 ₽ = 1 балл)', $first['points'], 500);
check('баланс', Balance::get($userId), 530);

$repeat = Balance::topUp($userId, 500, 'yk-payment-abc');
check('повторный вебхук — дубликат', $repeat['duplicate'], true);
check('повторный вебхук ничего не зачислил', $repeat['credited'], false);
check('баланс не изменился', Balance::get($userId), 530);

/* ---------------------------------------------------------------- */
section('Кэшбэк: 1000 ₽ = 1 балл, обычное округление');

$cases = array(
    array(1000, 1), array(1500, 2), array(1499, 1), array(2500, 3),
    array(500, 1),  array(499, 0),  array(400, 0),  array(12300, 12),
    array(0, 0),
);
foreach ($cases as $index => $case) {
    list($rub, $expected) = $case;
    $result = Balance::cashbackForOrder($userId, $rub, 'order-' . $index);
    check($rub . ' ₽ → ' . $expected . ' баллов', $result['points'], $expected);
}

$before = Balance::get($userId);
$again = Balance::cashbackForOrder($userId, 1500, 'order-1');
check('повторный кэшбэк за тот же заказ — дубликат', $again['duplicate'], true);
check('баланс не изменился', Balance::get($userId), $before);

/* ---------------------------------------------------------------- */
section('История операций');

$history = Balance::history($userId, 5);
check('история не пуста', count($history) > 0, true);
check('новые записи сверху', $history[0]['id'] > $history[1]['id'], true);
check('у списания отрицательная сумма', $history[count($history) - 1]['amount'] !== 0, true);

$types = array();
foreach (Balance::history($userId, 100) as $row) {
    $types[$row['type']] = true;
}
check('в истории есть все три типа', count($types), 3);

/* ---------------------------------------------------------------- */
echo "\n", str_repeat('=', 72), "\n";
echo "Пройдено: $passed, провалено: $failed\n";

Db::setPdo(null);
@unlink($dbFile);

exit($failed === 0 ? 0 : 1);
