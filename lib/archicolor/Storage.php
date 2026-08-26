<?php
/**
 * ArchiColor AI — файловое хранилище генераций.
 *
 * Раскладка (относительно storage_dir):
 *   in/2026/08/<jobId>.jpg    исходное фото клиента после нормализации
 *   out/2026/08/<jobId>-1.jpg результат Decor8, скачанный на наш домен
 *   .state/                   служебные файлы: квоты, лог, кэш каталога
 *
 * Разбивка по годам и месяцам нужна, чтобы каталог не превращался
 * в директорию на сотни тысяч файлов.
 */

namespace ArchiColor;

require_once __DIR__ . '/Config.php';
require_once __DIR__ . '/ImageFile.php';

class Storage
{
    public static function newJobId()
    {
        try {
            $bytes = random_bytes(9);
        } catch (\Exception $e) {
            $bytes = pack('N', mt_rand()) . pack('N', mt_rand()) . chr(mt_rand(0, 255));
        }
        return date('ymd') . '-' . bin2hex($bytes);
    }

    /** @return array ['path' => string, 'url' => string, 'absoluteUrl' => string] */
    public static function inputTarget($jobId, $ext = 'jpg')
    {
        return self::target('in', $jobId, $jobId . '.' . $ext);
    }

    /** @return array ['path' => string, 'url' => string, 'absoluteUrl' => string] */
    public static function outputTarget($jobId, $index = 1, $ext = 'jpg')
    {
        return self::target('out', $jobId, $jobId . '-' . (int) $index . '.' . $ext);
    }

    /**
     * Год и месяц берём из самого jobId, а не из текущей даты: иначе
     * вчерашняя генерация, открытая сегодня, искалась бы в чужом каталоге —
     * и первого числа месяца весь архив стал бы «ненайденным».
     */
    private static function datePath($jobId)
    {
        if (preg_match('/^(\d{2})(\d{2})(\d{2})-/', (string) $jobId, $m)) {
            return '20' . $m[1] . '/' . $m[2];
        }
        return date('Y/m');
    }

    private static function target($bucket, $jobId, $name)
    {
        $sub  = $bucket . '/' . self::datePath($jobId);
        $dir  = rtrim(Config::get('storage_dir'), '/') . '/' . $sub;
        ImageFile::ensureDir($dir);
        self::protectStateDir();

        $path = $dir . '/' . $name;
        $url  = Config::get('storage_url') . '/' . $sub . '/' . $name;

        return array(
            'path'        => $path,
            'url'         => $url,
            'absoluteUrl' => Config::absoluteUrl($url),
        );
    }

    public static function stateDir()
    {
        $dir = Config::get('state_dir');
        ImageFile::ensureDir($dir);
        self::protectStateDir();
        return rtrim($dir, '/');
    }

    /**
     * .state лежит внутри веб-доступного upload/, поэтому закрываем его
     * от прямого чтения — там квоты и лог, не картинки.
     */
    private static function protectStateDir()
    {
        $dir = rtrim(Config::get('state_dir'), '/');
        if (!is_dir($dir)) {
            return;
        }
        $htaccess = $dir . '/.htaccess';
        if (!file_exists($htaccess)) {
            @file_put_contents($htaccess, "Require all denied\n<IfModule !mod_authz_core.c>\n    Deny from all\n</IfModule>\n");
        }
        $index = $dir . '/index.html';
        if (!file_exists($index)) {
            @file_put_contents($index, '');
        }
    }

    /**
     * Удаляет файлы старше keep_files_days.
     *
     * Вызывается с малой вероятностью из обработчика генерации — отдельный
     * cron не нужен, но если он есть, зовите gc() из него и передайте $force.
     *
     * @return int сколько файлов удалено
     */
    public static function gc($force = false)
    {
        $days = (int) Config::get('keep_files_days');
        if ($days <= 0) {
            return 0;
        }
        if (!$force && mt_rand(1, 50) !== 1) {
            return 0;
        }

        $root = rtrim(Config::get('storage_dir'), '/');
        $deadline = time() - $days * 86400;
        $removed = 0;

        foreach (array('in', 'out') as $bucket) {
            $base = $root . '/' . $bucket;
            if (!is_dir($base)) {
                continue;
            }
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($iterator as $entry) {
                /** @var \SplFileInfo $entry */
                if ($entry->isFile()) {
                    if ($entry->getMTime() < $deadline && @unlink($entry->getPathname())) {
                        $removed++;
                    }
                } elseif ($entry->isDir()) {
                    @rmdir($entry->getPathname());   // сработает, только если каталог опустел
                }
            }
        }

        return $removed;
    }

    /** Запись в лог. Ошибки провайдера должны быть видны без включения debug. */
    public static function log($event, array $context = array())
    {
        if (!Config::get('log_enabled')) {
            return;
        }
        $file = Config::get('log_file');
        try {
            ImageFile::ensureDir(dirname($file));
        } catch (\Exception $e) {
            return;
        }
        self::protectStateDir();

        $line = json_encode(
            array_merge(array('ts' => date('c'), 'event' => $event), $context),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        @file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
    }
}
