<?php
/**
 * ArchiColor AI — каталог колеровки ArchiPaint на стороне сервера.
 *
 * Источник тот же, что и у страницы «Подбор цвета»: assets/js/podbor.palette.js
 * (window.ARCHIPAINT_PALETTE). Файл сгенерирован tools/build-palette.js, поэтому
 * дублировать каталог в PHP не нужно — мы читаем его и кладём разобранный
 * результат в кэш, который сам протухает при изменении исходника.
 *
 * Если появится выгрузка спектрофотометра, положите её в
 * data/archipaint-palette.json — он будет прочитан первым.
 */

namespace ArchiColor;

require_once __DIR__ . '/Color.php';
require_once __DIR__ . '/Config.php';

class Palette
{
    /** @var array|null */
    private static $items = null;

    /**
     * @return array список записей:
     *   ['code','name','hex','family','familyId','collection','lab'=>[l,a,b]]
     */
    public static function all()
    {
        if (self::$items !== null) {
            return self::$items;
        }

        $root = dirname(dirname(__DIR__));
        $json = $root . '/data/archipaint-palette.json';
        $js   = $root . '/assets/js/podbor.palette.js';

        $source = is_readable($json) ? $json : $js;
        if (!is_readable($source)) {
            self::$items = array();
            return self::$items;
        }

        $cached = self::readCache($source);
        if ($cached !== null) {
            self::$items = $cached;
            return self::$items;
        }

        $raw = file_get_contents($source);
        $items = self::parse($raw);
        self::writeCache($source, $items);

        self::$items = $items;
        return self::$items;
    }

    /** Разбор как JSON-файла, так и window.ARCHIPAINT_PALETTE = [...]; */
    private static function parse($raw)
    {
        $raw = (string) $raw;
        $decoded = json_decode($raw, true);

        if (!is_array($decoded)) {
            $start = strpos($raw, '[');
            $end   = strrpos($raw, ']');
            if ($start === false || $end === false || $end <= $start) {
                return array();
            }
            $decoded = json_decode(substr($raw, $start, $end - $start + 1), true);
        }

        if (isset($decoded['items']) && is_array($decoded['items'])) {
            $decoded = $decoded['items'];
        }
        if (!is_array($decoded)) {
            return array();
        }

        $out = array();
        foreach ($decoded as $row) {
            $item = self::normalizeRow($row);
            if ($item !== null) {
                $out[] = $item;
            }
        }
        return $out;
    }

    private static function normalizeRow($row)
    {
        if (!is_array($row)) {
            return null;
        }

        $hex = isset($row['hex']) ? $row['hex'] : (isset($row['h']) ? $row['h'] : null);
        $rgb = Color::hexToRgb($hex);
        if ($rgb === null) {
            return null;
        }
        $hex = Color::rgbToHex($rgb[0], $rgb[1], $rgb[2]);

        $lab = null;
        if (isset($row['lab'])) {
            $l = $row['lab'];
            if (is_array($l) && isset($l[0], $l[1], $l[2])) {
                $lab = array((float) $l[0], (float) $l[1], (float) $l[2]);
            } elseif (is_array($l) && isset($l['l'], $l['a'], $l['b'])) {
                $lab = array((float) $l['l'], (float) $l['a'], (float) $l['b']);
            }
        } elseif (isset($row['lab_l'], $row['lab_a'], $row['lab_b'])) {
            $lab = array((float) $row['lab_l'], (float) $row['lab_a'], (float) $row['lab_b']);
        }
        if ($lab === null) {
            $lab = Color::rgbToLab($rgb[0], $rgb[1], $rgb[2]);
        }

        return array(
            'code'       => (string) self::pick($row, array('code', 'color_code', 'c'), ''),
            'name'       => (string) self::pick($row, array('name', 'color_name', 'n'), ''),
            'hex'        => $hex,
            'rgb'        => $rgb,
            'family'     => (string) self::pick($row, array('family'), ''),
            'familyId'   => (string) self::pick($row, array('familyId', 'family_id'), ''),
            'collection' => (string) self::pick($row, array('collection'), ''),
            'lab'        => array(round($lab[0], 3), round($lab[1], 3), round($lab[2], 3)),
        );
    }

    private static function pick($row, array $keys, $default)
    {
        foreach ($keys as $key) {
            if (isset($row[$key]) && $row[$key] !== '') {
                return $row[$key];
            }
        }
        return $default;
    }

    /**
     * Ближайшие оттенки каталога по ΔE2000.
     *
     * @param array $lab  [L, a, b]
     * @param int   $limit
     * @param array $opts ['exclude' => ['AP-0101', ...], 'collections' => [...], 'maxDeltaE' => float]
     * @return array список ['color' => запись, 'deltaE' => float]
     */
    public static function nearest(array $lab, $limit = 3, array $opts = array())
    {
        $catalog     = self::all();
        $exclude     = isset($opts['exclude']) && is_array($opts['exclude']) ? array_flip($opts['exclude']) : array();
        $collections = isset($opts['collections']) && $opts['collections'] ? array_flip((array) $opts['collections']) : null;
        $maxDeltaE   = isset($opts['maxDeltaE']) ? (float) $opts['maxDeltaE'] : INF;

        $out = array();
        foreach ($catalog as $item) {
            if (isset($exclude[$item['code']])) {
                continue;
            }
            if ($collections !== null && !isset($collections[$item['collection']])) {
                continue;
            }
            $de = Color::deltaE2000($lab, $item['lab']);
            if ($de > $maxDeltaE) {
                continue;
            }
            $out[] = array('color' => $item, 'deltaE' => $de);
        }

        usort($out, function ($a, $b) {
            if ($a['deltaE'] == $b['deltaE']) {
                return 0;
            }
            return $a['deltaE'] < $b['deltaE'] ? -1 : 1;
        });

        return array_slice($out, 0, max(1, (int) $limit));
    }

    public static function byCode($code)
    {
        foreach (self::all() as $item) {
            if (strcasecmp($item['code'], (string) $code) === 0) {
                return $item;
            }
        }
        return null;
    }

    public static function collections()
    {
        $out = array();
        foreach (self::all() as $item) {
            if ($item['collection'] !== '' && !in_array($item['collection'], $out, true)) {
                $out[] = $item['collection'];
            }
        }
        return $out;
    }

    /* ------------------------------------------------------------------ */

    private static function cachePath($source)
    {
        $dir = Config::get('state_dir');
        return $dir . '/palette-' . substr(sha1($source), 0, 12) . '.cache.php';
    }

    private static function readCache($source)
    {
        $path = self::cachePath($source);
        if (!is_readable($path)) {
            return null;
        }
        $data = include $path;
        if (!is_array($data) || !isset($data['mtime'], $data['items'])) {
            return null;
        }
        if ((int) $data['mtime'] !== (int) filemtime($source)) {
            return null;
        }
        return $data['items'];
    }

    private static function writeCache($source, array $items)
    {
        $path = self::cachePath($source);
        $dir  = dirname($path);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            return;
        }
        $payload = array('mtime' => (int) filemtime($source), 'items' => $items);
        $tmp = $path . '.' . getmypid() . '.tmp';
        if (@file_put_contents($tmp, "<?php\nreturn " . var_export($payload, true) . ";\n") !== false) {
            @rename($tmp, $path);
        }
    }

    /** Только для тестов. */
    public static function setItems(array $items)
    {
        self::$items = $items;
    }
}
