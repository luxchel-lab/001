<?php
/**
 * Сборка автономного превью страницы ArchiColor AI.
 *
 * Рендерит ../index.php с заглушками Bitrix (header/footer, $APPLICATION, $USER,
 * Asset, Option) и сохраняет статический preview/index.html, который открывается
 * без Bitrix, PHP-сервера и сети. Запросы к /ajax/* перехватывает mock-api.js.
 *
 *   php archicolor-ai/preview/build.php
 */

namespace Bitrix\Main\Page {
    class Asset {
        private static $inst;
        public $css = [];
        public $js = [];
        public static function getInstance() { return self::$inst ?: (self::$inst = new self()); }
        public function addCss($p) { $this->css[] = $p; }
        public function addJs($p) { $this->js[] = $p; }
    }
}

namespace Bitrix\Main\Config {
    class Option { public static function get($m, $n, $d = null) { return $d; } }
}

namespace {
    class PreviewApp {
        public $props = [];
        public $title = '';
        public function SetPageProperty($k, $v) { $this->props[$k] = $v; }
        public function SetTitle($t) { $this->title = $t; }
    }
    class PreviewUser {
        public function IsAuthorized() { return true; }
        public function GetID() { return 1; }
    }

    $root = dirname(__DIR__);
    $out  = __DIR__;
    $repo = dirname($root);

    // Фейковый DOCUMENT_ROOT: только bitrix/header.php и footer.php, оба пустые.
    $docRoot = sys_get_temp_dir() . '/archicolor-preview-root';
    @mkdir($docRoot . '/bitrix', 0777, true);
    file_put_contents($docRoot . '/bitrix/header.php', '<?php');
    file_put_contents($docRoot . '/bitrix/footer.php', '<?php');
    $_SERVER['DOCUMENT_ROOT'] = $docRoot;

    $APPLICATION = new PreviewApp();
    $USER = new PreviewUser();

    ob_start();
    include $root . '/index.php';
    $body = ob_get_clean();

    // Копируем ассеты рядом с превью, чтобы страница открывалась и через file://.
    $copy = function ($from, $to) {
        @mkdir(dirname($to), 0777, true);
        copy($from, $to);
    };
    $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/assets', FilesystemIterator::SKIP_DOTS));
    foreach ($rii as $f) {
        $copy($f->getPathname(), $out . '/assets' . substr($f->getPathname(), strlen($root . '/assets')));
    }
    // Базовая дизайн-система «Подбор цвета» лежит в корне репозитория.
    if (is_file($repo . '/assets/css/podbor.css')) {
        $copy($repo . '/assets/css/podbor.css', $out . '/assets/css/podbor.css');
    }
    if (is_file($repo . '/assets/js/podbor.palette.js')) {
        $copy($repo . '/assets/js/podbor.palette.js', $out . '/assets/js/podbor.palette.js');
    }

    $asset = \Bitrix\Main\Page\Asset::getInstance();
    $rel = function ($p) { return ltrim($p, '/'); };
    $links = '';
    foreach ($asset->css as $p) {
        if (is_file($out . '/' . $rel($p))) {
            $links .= '<link rel="stylesheet" href="' . $rel($p) . "\">\n";
        } elseif ($p === '/assets/css/ai.css') {
            // ai.css нет в архиве — подставляем восстановленные стили превью.
            $links .= "<link rel=\"stylesheet\" href=\"ai-fallback.css\">\n";
        } else {
            $links .= "<!-- нет в архиве: $p -->\n";
        }
    }
    $scripts = "<script src=\"vendor/jquery.min.js\"></script>\n"
             . "<script src=\"assets/js/podbor.palette.js\"></script>\n"
             . "<script src=\"mock-api.js\"></script>\n";
    foreach ($asset->js as $p) {
        if ($p === '/assets/js/magnific.js') {
            $scripts .= "<script src=\"vendor/jquery.magnific-popup.min.js\"></script>\n";
        } elseif (is_file($out . '/' . $rel($p))) {
            $scripts .= '<script src="' . $rel($p) . "\"></script>\n";
        }
    }

    // Абсолютные пути /assets/... и /ajax/... в разметке делаем относительными.
    $body = preg_replace('#(["\'(])/assets/#', '$1assets/', $body);

    $title = htmlspecialchars($APPLICATION->props['title'] ?? $APPLICATION->title);
    $desc  = htmlspecialchars($APPLICATION->props['description'] ?? '');

    $html = <<<HTML
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$title</title>
<meta name="description" content="$desc">
<link rel="stylesheet" href="vendor/magnific-popup.css">
$links<style>
  .preview-banner{position:relative;background:#1f2a24;color:#f3efe6;font:13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center}
  .preview-banner b{color:#e8c77a}
</style>
</head>
<body>
<div class="preview-banner"><b>Автономное превью</b> · без Bitrix: генерация ИИ, каталог, цены и корзина работают на демо-данных</div>
$body
$scripts</body>
</html>
HTML;

    file_put_contents($out . '/index.html', $html);
    echo "OK: {$out}/index.html\n";
}
