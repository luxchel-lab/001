<?php
/**
 * Проверка параллельности: лимит и баланс под одновременной нагрузкой.
 *
 *   php tools/archicolor-test-race.php [число процессов]
 *
 * Запускает несколько настоящих процессов PHP, которые в один и тот же
 * момент бьются за последнюю бесплатную примерку, за последние баллы и за
 * зачисление одного и того же платежа. Проверяется не «примерно столько»,
 * а точные числа: три успеха на три бесплатные примерки, пять списаний
 * на сто баллов, одно зачисление на один payment_id.
 *
 * База — SQLite: она сериализует пишущие транзакции, поэтому проверяет
 * именно нашу логику (условие внутри UPDATE и разбор числа затронутых
 * строк), а не блокировки конкретной СУБД. В MySQL те же запросы защищены
 * построчными блокировками InnoDB.
 */

$root = dirname(__DIR__);

/* ------------------------- режим рабочего процесса ------------------------- */

if (isset($argv[1]) && $argv[1] === '--worker') {
    require_once $root . '/lib/archicolor/Config.php';
    require_once $root . '/lib/archicolor/Db.php';
    require_once $root . '/lib/archicolor/Limits.php';
    require_once $root . '/lib/archicolor/Balance.php';

    \ArchiColor\Config::override(array(
        'db_dsn'       => 'sqlite:' . $argv[3],
        'free_per_day' => 3,
        'price_points' => 20,
    ));

    $operation = $argv[2];
    $index = (int) $argv[4];

    // Все процессы стартуют по общему сигналу — иначе они просто выстроятся
    // в очередь по времени запуска и никакой гонки не получится.
    $startAt = (float) $argv[5];
    while (microtime(true) < $startAt) {
        usleep(200);
    }

    try {
        if ($operation === 'free') {
            $ok = \ArchiColor\Limits::consume(1);
        } elseif ($operation === 'spend') {
            $ok = \ArchiColor\Balance::spend(1, 20, 'race-job-' . $index);
        } else {
            $result = \ArchiColor\Balance::topUp(1, 500, 'race-payment');
            $ok = $result['credited'];
        }
        echo $ok ? '1' : '0';
    } catch (\Exception $e) {
        echo 'E' . $e->getMessage();
    }
    exit(0);
}

/* ----------------------------- режим сценария ----------------------------- */

require_once $root . '/lib/archicolor/Config.php';
require_once $root . '/lib/archicolor/Db.php';
require_once $root . '/lib/archicolor/Balance.php';

use ArchiColor\Balance;
use ArchiColor\Config;
use ArchiColor\Db;

$workers = isset($argv[1]) ? max(2, (int) $argv[1]) : 10;
$dbFile = sys_get_temp_dir() . '/archicolor-race-' . getmypid() . '.sqlite';
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

Db::run('INSERT INTO ac_user (id, phone, created_at) VALUES (1, :phone, :now)',
    array('phone' => '+79990000001', 'now' => Db::utcNow()));
Balance::credit(1, 100, Balance::TYPE_TOPUP, 'seed', 'стартовые баллы');

$failed = 0;

function check($title, $actual, $expected)
{
    global $failed;
    $ok = $actual === $expected;
    if (!$ok) {
        $failed++;
    }
    $pad = max(1, 54 - mb_strlen($title, 'UTF-8'));
    echo ($ok ? '  OK  ' : ' FAIL '), $title, str_repeat(' ', $pad),
        $ok ? $actual : ('получили ' . var_export($actual, true) . ', ждали ' . var_export($expected, true)), "\n";
}

/** Запускает $workers процессов разом и возвращает число успехов. */
function runRace($operation, $workers, $dbFile, $root)
{
    $startAt = microtime(true) + 0.6;   // фора на прогрев интерпретаторов
    $processes = array();
    $pipes = array();

    for ($i = 0; $i < $workers; $i++) {
        $cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($root . '/tools/archicolor-test-race.php')
            . ' --worker ' . escapeshellarg($operation) . ' ' . escapeshellarg($dbFile)
            . ' ' . $i . ' ' . $startAt;
        $spec = array(1 => array('pipe', 'w'), 2 => array('pipe', 'w'));
        $processes[$i] = proc_open($cmd, $spec, $pipes[$i]);
    }

    $successes = 0;
    $errors = array();
    for ($i = 0; $i < $workers; $i++) {
        $out = stream_get_contents($pipes[$i][1]);
        $err = stream_get_contents($pipes[$i][2]);
        fclose($pipes[$i][1]);
        fclose($pipes[$i][2]);
        proc_close($processes[$i]);

        if ($out === '1') {
            $successes++;
        } elseif ($out !== '0') {
            $errors[] = trim($out . ' ' . $err);
        }
    }

    if ($errors) {
        echo "  ! ошибки рабочих процессов: ", implode(' | ', array_slice($errors, 0, 3)), "\n";
    }
    return $successes;
}

echo "Параллельных процессов: $workers\n";

echo "\nБесплатный лимит (3 в сутки)\n", str_repeat('-', 72), "\n";
$granted = runRace('free', $workers, $dbFile, $root);
check('успешных бесплатных примерок', $granted, 3);
check('счётчик в базе', (int) Db::fetchValue('SELECT used FROM ac_daily_usage WHERE user_id = 1', array(), 0), 3);

echo "\nСписание баллов (баланс 100, цена 20)\n", str_repeat('-', 72), "\n";
$spent = runRace('spend', $workers, $dbFile, $root);
check('успешных списаний', $spent, 5);
check('остаток баллов', Balance::get(1), 0);
check('строк списания в журнале',
    (int) Db::fetchValue("SELECT COUNT(*) FROM balance_transactions WHERE type = 'spend'", array(), 0), 5);

echo "\nОдин платёж ЮKassa, много вебхуков\n", str_repeat('-', 72), "\n";
$credited = runRace('topup', $workers, $dbFile, $root);
check('успешных зачислений', $credited, 1);
check('баланс вырос ровно на один платёж', Balance::get(1), 500);
check('строк пополнения по этому платежу',
    (int) Db::fetchValue("SELECT COUNT(*) FROM balance_transactions WHERE source_id = 'race-payment'", array(), 0), 1);

echo "\n", str_repeat('=', 72), "\n";
echo $failed === 0 ? "Гонок не обнаружено.\n" : "Провалено проверок: $failed\n";

Db::setPdo(null);
@unlink($dbFile);
@unlink($dbFile . '-wal');
@unlink($dbFile . '-shm');

exit($failed === 0 ? 0 : 1);
