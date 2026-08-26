<?php
/**
 * ArchiColor AI — разбор изображения на доминирующие цвета.
 *
 * Порт extractDominantColors() из assets/js/podbor.color.js: k-means++ в
 * пространстве CIE Lab с детерминированной инициализацией. Одно и то же
 * изображение всегда даёт одну и ту же палитру — это важно, иначе клиент,
 * перезагрузив страницу, увидит другие оттенки и другой заказ.
 *
 * Считаем на сервере, а не в браузере: результат Decor8 лежит на их CDN,
 * и canvas в браузере «пачкается» кросс-доменной картинкой.
 */

namespace ArchiColor;

require_once __DIR__ . '/Color.php';
require_once __DIR__ . '/Palette.php';
require_once __DIR__ . '/Config.php';

class ImageAnalyzer
{
    /**
     * @param string $path путь к файлу изображения
     * @param array  $opts ['slots' => int, 'matches' => int, 'maxSamples' => int, 'collections' => [...]]
     * @return array ['colors' => [...], 'sampled' => int, 'width' => int, 'height' => int]
     * @throws AppException
     */
    public static function analyzeFile($path, array $opts = array())
    {
        $slots      = isset($opts['slots']) ? (int) $opts['slots'] : (int) Config::get('palette_slots', 5);
        $matches    = isset($opts['matches']) ? (int) $opts['matches'] : (int) Config::get('matches_per_slot', 3);
        $maxSamples = isset($opts['maxSamples']) ? (int) $opts['maxSamples'] : (int) Config::get('analyze_max_samples', 26000);

        $image = ImageFile::load($path);
        $width  = imagesx($image);
        $height = imagesy($image);

        $samples = self::collectSamples($image, $maxSamples);
        imagedestroy($image);

        if (!$samples) {
            throw new AppException('empty_image', 'Не удалось прочитать цвета изображения.');
        }

        // Кластеров просим с запасом и потом схлопываем похожие: k-means любит
        // разрезать один и тот же оттенок стены на два соседних кластера,
        // а клиенту незачем видеть два одинаковых квадратика в палитре.
        $overshoot = min(8, $slots + 2);
        $clusters = self::kmeans($samples, $overshoot, (int) Config::get('analyze_iterations', 24));
        $clusters = self::mergeSimilar($clusters, (float) Config::get('merge_delta_e', 3.0));
        $clusters = self::dropMarginal($clusters, (float) Config::get('min_color_share', 0.015));
        $clusters = array_slice($clusters, 0, $slots);

        $colors = array();
        $used   = array();
        foreach ($clusters as $index => $cluster) {
            $lab = $cluster['center'];
            $hex = Color::labToHex($lab[0], $lab[1], $lab[2]);
            $rgb = Color::hexToRgb($hex);
            $lch = Color::labToLch($lab[0], $lab[1], $lab[2]);

            $near = Palette::nearest($lab, $matches, array(
                'collections' => isset($opts['collections']) ? $opts['collections'] : null,
            ));

            $matchRows = array();
            foreach ($near as $m) {
                $quality = Color::deltaEQuality($m['deltaE']);
                $matchRows[] = array(
                    'code'       => $m['color']['code'],
                    'name'       => $m['color']['name'],
                    'hex'        => $m['color']['hex'],
                    'collection' => $m['color']['collection'],
                    'family'     => $m['color']['family'],
                    'lab'        => $m['color']['lab'],
                    'lrv'        => Color::lrv($m['color']['hex']),
                    'deltaE'     => round($m['deltaE'], 2),
                    'quality'    => $quality['label'],
                    'qualityCls' => $quality['cls'],
                    'textOn'     => Color::readableTextColor($m['color']['hex']),
                );
                $used[] = $m['color']['code'];
            }

            $colors[] = array(
                'index'   => $index,
                'hex'     => $hex,
                'rgb'     => $rgb,
                'lab'     => array(round($lab[0], 2), round($lab[1], 2), round($lab[2], 2)),
                'lch'     => array(round($lch[0], 2), round($lch[1], 2), round($lch[2], 2)),
                'lrv'     => Color::lrv($hex),
                'share'   => round($cluster['share'], 4),
                'sharePct'=> round($cluster['share'] * 100, 1),
                'pixels'  => $cluster['count'],
                'textOn'  => Color::readableTextColor($hex),
                'role'    => self::roleFor($index, $lab[0], $cluster['share']),
                'matches' => $matchRows,
            );
        }

        return array(
            'colors'  => $colors,
            'sampled' => count($samples),
            'width'   => $width,
            'height'  => $height,
        );
    }

    /**
     * Пиксели → выборка точек в Lab.
     * Отбрасываем почти чёрные и выбитые в белое — они смещают кластеры.
     */
    private static function collectSamples($image, $maxSamples)
    {
        $w = imagesx($image);
        $h = imagesy($image);
        $total = $w * $h;
        $step = max(1, (int) floor($total / max(1, $maxSamples)));

        $samples = array();
        $cache = array();

        for ($i = 0; $i < $total; $i += $step) {
            $x = $i % $w;
            $y = (int) ($i / $w);
            $rgba = imagecolorat($image, $x, $y);

            $alpha = ($rgba >> 24) & 0x7F;      // 0 — непрозрачный, 127 — прозрачный
            if ($alpha > 64) {
                continue;
            }
            $r = ($rgba >> 16) & 0xFF;
            $g = ($rgba >> 8) & 0xFF;
            $b = $rgba & 0xFF;

            $mx = max($r, $g, $b);
            $mn = min($r, $g, $b);
            if ($mx < 12 || $mn > 249) {
                continue;
            }

            $key = ($r << 16) | ($g << 8) | $b;
            if (!isset($cache[$key])) {
                $cache[$key] = Color::rgbToLab($r, $g, $b);
            }
            $samples[] = $cache[$key];
        }

        return $samples;
    }

    /** k-means++ с детерминированным выбором стартовых центров. */
    private static function kmeans(array $samples, $k, $iterations)
    {
        $n = count($samples);
        $k = max(1, min((int) $k, $n));

        $centers = self::initCenters($samples, $k);
        $assign  = array_fill(0, $n, 0);

        for ($it = 0; $it < $iterations; $it++) {
            $moved = false;
            for ($s = 0; $s < $n; $s++) {
                $best = 0;
                $bestD = INF;
                foreach ($centers as $c => $center) {
                    $d = self::sqDist($samples[$s], $center);
                    if ($d < $bestD) {
                        $bestD = $d;
                        $best = $c;
                    }
                }
                if ($assign[$s] !== $best) {
                    $assign[$s] = $best;
                    $moved = true;
                }
            }

            $sums = array_fill(0, count($centers), array(0.0, 0.0, 0.0, 0));
            for ($s = 0; $s < $n; $s++) {
                $c = $assign[$s];
                $sums[$c][0] += $samples[$s][0];
                $sums[$c][1] += $samples[$s][1];
                $sums[$c][2] += $samples[$s][2];
                $sums[$c][3]++;
            }
            foreach ($sums as $c => $sum) {
                if ($sum[3] > 0) {
                    $centers[$c] = array($sum[0] / $sum[3], $sum[1] / $sum[3], $sum[2] / $sum[3]);
                }
            }

            if (!$moved && $it > 2) {
                break;
            }
        }

        $counts = array_fill(0, count($centers), 0);
        foreach ($assign as $c) {
            $counts[$c]++;
        }

        $out = array();
        foreach ($centers as $c => $center) {
            if ($counts[$c] <= 0) {
                continue;
            }
            $out[] = array(
                'center' => $center,
                'count'  => $counts[$c],
                'share'  => $counts[$c] / $n,
            );
        }

        usort($out, function ($a, $b) {
            if ($a['share'] == $b['share']) {
                return 0;
            }
            return $a['share'] > $b['share'] ? -1 : 1;
        });

        return array_values($out);
    }

    /**
     * Убирает цвета, занимающие доли процента кадра: красить ими нечего,
     * а в палитре они выглядят мусором. Три цвета оставляем всегда.
     */
    private static function dropMarginal(array $clusters, $minShare)
    {
        if ($minShare <= 0 || count($clusters) <= 3) {
            return $clusters;
        }
        $kept = array();
        foreach ($clusters as $cluster) {
            if ($cluster['share'] >= $minShare || count($kept) < 3) {
                $kept[] = $cluster;
            }
        }
        return $kept;
    }

    /**
     * Схлопывает кластеры, различие которых глаз не поймает.
     * Центр объединённого кластера — среднее по числу пикселей.
     */
    private static function mergeSimilar(array $clusters, $threshold)
    {
        if ($threshold <= 0) {
            return $clusters;
        }

        $kept = array();
        foreach ($clusters as $cluster) {
            $mergedInto = null;
            foreach ($kept as $i => $existing) {
                if (Color::deltaE2000($existing['center'], $cluster['center']) < $threshold) {
                    $mergedInto = $i;
                    break;
                }
            }

            if ($mergedInto === null) {
                $kept[] = $cluster;
                continue;
            }

            $a = $kept[$mergedInto];
            $total = $a['count'] + $cluster['count'];
            if ($total <= 0) {
                continue;
            }
            $kept[$mergedInto] = array(
                'center' => array(
                    ($a['center'][0] * $a['count'] + $cluster['center'][0] * $cluster['count']) / $total,
                    ($a['center'][1] * $a['count'] + $cluster['center'][1] * $cluster['count']) / $total,
                    ($a['center'][2] * $a['count'] + $cluster['center'][2] * $cluster['count']) / $total,
                ),
                'count' => $total,
                'share' => $a['share'] + $cluster['share'],
            );
        }

        usort($kept, function ($a, $b) {
            if ($a['share'] == $b['share']) {
                return 0;
            }
            return $a['share'] > $b['share'] ? -1 : 1;
        });

        return array_values($kept);
    }

    private static function initCenters(array $pts, $k)
    {
        $n = count($pts);
        $centers = array($pts[(int) floor($n / 2)]);
        $dist = array_fill(0, $n, INF);

        while (count($centers) < $k) {
            $last = $centers[count($centers) - 1];
            $sum = 0.0;
            for ($i = 0; $i < $n; $i++) {
                $d = self::sqDist($pts[$i], $last);
                if ($d < $dist[$i]) {
                    $dist[$i] = $d;
                }
                $sum += $dist[$i];
            }
            if ($sum <= 0) {
                break;
            }
            // детерминированный выбор: сервис должен давать один и тот же результат
            $target = $sum * fmod(count($centers) * 0.6180339887, 1.0);
            $acc = 0.0;
            $pick = $n - 1;
            for ($i = 0; $i < $n; $i++) {
                $acc += $dist[$i];
                if ($acc >= $target) {
                    $pick = $i;
                    break;
                }
            }
            $centers[] = $pts[$pick];
        }

        return $centers;
    }

    private static function sqDist(array $p, array $q)
    {
        $d0 = $p[0] - $q[0];
        $d1 = $p[1] - $q[1];
        $d2 = $p[2] - $q[2];
        return $d0 * $d0 + $d1 * $d1 + $d2 * $d2;
    }

    /** Подсказка «куда красить» — по светлоте и доле в кадре. */
    private static function roleFor($index, $l, $share)
    {
        if ($index === 0 && $share >= 0.28) {
            return $l >= 62 ? 'Основной тон стен' : 'Основной тон интерьера';
        }
        if ($l >= 80) {
            return 'Потолок и столярка';
        }
        if ($l >= 55) {
            return 'Стены или дополнительный тон';
        }
        if ($l >= 30) {
            return 'Дополнительный тон';
        }
        return 'Акцент';
    }
}
