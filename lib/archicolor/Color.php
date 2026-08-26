<?php
/**
 * ArchiColor AI — цветовая математика на стороне сервера.
 *
 * Точный порт assets/js/podbor.color.js: те же матрицы sRGB↔XYZ, тот же
 * осветитель D65 и та же формула CIEDE2000. Это важно: страница «Подбор цвета»
 * считает ΔE в браузере, страница /AI — на сервере, и клиент не должен видеть
 * расхождения между ними.
 */

namespace ArchiColor;

class Color
{
    /** D65, наблюдатель 2° — как в podbor.color.js */
    const WHITE_X = 95.047;
    const WHITE_Y = 100.0;
    const WHITE_Z = 108.883;

    const EPS   = 0.008856451679035631;   // 216/24389
    const KAPPA = 903.2962962962963;      // 24389/27

    public static function clamp($v, $lo, $hi)
    {
        return $v < $lo ? $lo : ($v > $hi ? $hi : $v);
    }

    public static function clamp255($v)
    {
        $v = (int) round($v);
        return $v < 0 ? 0 : ($v > 255 ? 255 : $v);
    }

    public static function srgbToLinear($c)
    {
        $c = $c / 255;
        return $c <= 0.04045 ? $c / 12.92 : pow(($c + 0.055) / 1.055, 2.4);
    }

    public static function linearToSrgb($c)
    {
        $v = $c <= 0.0031308 ? 12.92 * $c : 1.055 * pow($c, 1 / 2.4) - 0.055;
        return self::clamp255($v * 255);
    }

    /** @return array{0:float,1:float,2:float} XYZ */
    public static function rgbToXyz($r, $g, $b)
    {
        $R = self::srgbToLinear($r);
        $G = self::srgbToLinear($g);
        $B = self::srgbToLinear($b);
        return array(
            ($R * 0.4124564 + $G * 0.3575761 + $B * 0.1804375) * 100,
            ($R * 0.2126729 + $G * 0.7151522 + $B * 0.0721750) * 100,
            ($R * 0.0193339 + $G * 0.1191920 + $B * 0.9503041) * 100,
        );
    }

    /** @return array{0:int,1:int,2:int} RGB 0..255 */
    public static function xyzToRgb($x, $y, $z)
    {
        $X = $x / 100; $Y = $y / 100; $Z = $z / 100;
        return array(
            self::linearToSrgb($X *  3.2404542 + $Y * -1.5371385 + $Z * -0.4985314),
            self::linearToSrgb($X * -0.9692660 + $Y *  1.8760108 + $Z *  0.0415560),
            self::linearToSrgb($X *  0.0556434 + $Y * -0.2040259 + $Z *  1.0572252),
        );
    }

    private static function fLab($t)
    {
        return $t > self::EPS ? pow($t, 1 / 3) : (self::KAPPA * $t + 16) / 116;
    }

    private static function fLabInv($t)
    {
        $t3 = $t * $t * $t;
        return $t3 > self::EPS ? $t3 : (116 * $t - 16) / self::KAPPA;
    }

    /** @return array{0:float,1:float,2:float} Lab */
    public static function xyzToLab($x, $y, $z)
    {
        $fx = self::fLab($x / self::WHITE_X);
        $fy = self::fLab($y / self::WHITE_Y);
        $fz = self::fLab($z / self::WHITE_Z);
        return array(116 * $fy - 16, 500 * ($fx - $fy), 200 * ($fy - $fz));
    }

    /** @return array{0:float,1:float,2:float} XYZ */
    public static function labToXyz($l, $a, $b)
    {
        $fy = ($l + 16) / 116;
        $fx = $fy + $a / 500;
        $fz = $fy - $b / 200;
        return array(
            self::WHITE_X * self::fLabInv($fx),
            self::WHITE_Y * self::fLabInv($fy),
            self::WHITE_Z * self::fLabInv($fz),
        );
    }

    public static function rgbToLab($r, $g, $b)
    {
        $xyz = self::rgbToXyz($r, $g, $b);
        return self::xyzToLab($xyz[0], $xyz[1], $xyz[2]);
    }

    public static function labToRgb($l, $a, $b)
    {
        $xyz = self::labToXyz($l, $a, $b);
        return self::xyzToRgb($xyz[0], $xyz[1], $xyz[2]);
    }

    /** @return array{0:float,1:float,2:float} LCh */
    public static function labToLch($l, $a, $b)
    {
        $c = sqrt($a * $a + $b * $b);
        $h = rad2deg(atan2($b, $a));
        if ($h < 0) {
            $h += 360;
        }
        return array($l, $c, $c < 0.02 ? 0.0 : $h);
    }

    public static function rgbToHex($r, $g, $b)
    {
        return sprintf('#%02X%02X%02X', self::clamp255($r), self::clamp255($g), self::clamp255($b));
    }

    public static function labToHex($l, $a, $b)
    {
        $rgb = self::labToRgb($l, $a, $b);
        return self::rgbToHex($rgb[0], $rgb[1], $rgb[2]);
    }

    /** @return array{0:int,1:int,2:int}|null */
    public static function hexToRgb($hex)
    {
        if (!is_string($hex)) {
            return null;
        }
        $h = ltrim(trim($hex), '#');
        if (strlen($h) === 3) {
            $h = $h[0] . $h[0] . $h[1] . $h[1] . $h[2] . $h[2];
        }
        if (!preg_match('/^[0-9a-fA-F]{6}$/', $h)) {
            return null;
        }
        return array(
            (int) hexdec(substr($h, 0, 2)),
            (int) hexdec(substr($h, 2, 2)),
            (int) hexdec(substr($h, 4, 2)),
        );
    }

    /** @return array{0:float,1:float,2:float}|null */
    public static function hexToLab($hex)
    {
        $rgb = self::hexToRgb($hex);
        if ($rgb === null) {
            return null;
        }
        return self::rgbToLab($rgb[0], $rgb[1], $rgb[2]);
    }

    /**
     * CIEDE2000. Порт deltaE2000() из podbor.color.js.
     *
     * @param array $lab1 [L, a, b]
     * @param array $lab2 [L, a, b]
     */
    public static function deltaE2000($lab1, $lab2, $kL = 1.0, $kC = 1.0, $kH = 1.0)
    {
        $L1 = $lab1[0]; $a1 = $lab1[1]; $b1 = $lab1[2];
        $L2 = $lab2[0]; $a2 = $lab2[1]; $b2 = $lab2[2];

        $C1 = sqrt($a1 * $a1 + $b1 * $b1);
        $C2 = sqrt($a2 * $a2 + $b2 * $b2);
        $Cbar = ($C1 + $C2) / 2;
        $Cbar7 = pow($Cbar, 7);
        $G = 0.5 * (1 - sqrt($Cbar7 / ($Cbar7 + 6103515625.0))); // 25^7

        $a1p = (1 + $G) * $a1;
        $a2p = (1 + $G) * $a2;
        $C1p = sqrt($a1p * $a1p + $b1 * $b1);
        $C2p = sqrt($a2p * $a2p + $b2 * $b2);

        $h1p = ($a1p == 0.0 && $b1 == 0.0) ? 0.0 : self::posDeg(rad2deg(atan2($b1, $a1p)));
        $h2p = ($a2p == 0.0 && $b2 == 0.0) ? 0.0 : self::posDeg(rad2deg(atan2($b2, $a2p)));

        $dLp = $L2 - $L1;
        $dCp = $C2p - $C1p;

        if ($C1p * $C2p == 0.0) {
            $dhp = 0.0;
        } elseif (abs($h2p - $h1p) <= 180) {
            $dhp = $h2p - $h1p;
        } elseif ($h2p - $h1p > 180) {
            $dhp = $h2p - $h1p - 360;
        } else {
            $dhp = $h2p - $h1p + 360;
        }
        $dHp = 2 * sqrt($C1p * $C2p) * sin(deg2rad($dhp) / 2);

        $Lbarp = ($L1 + $L2) / 2;
        $Cbarp = ($C1p + $C2p) / 2;

        if ($C1p * $C2p == 0.0) {
            $hbarp = $h1p + $h2p;
        } elseif (abs($h1p - $h2p) <= 180) {
            $hbarp = ($h1p + $h2p) / 2;
        } elseif ($h1p + $h2p < 360) {
            $hbarp = ($h1p + $h2p + 360) / 2;
        } else {
            $hbarp = ($h1p + $h2p - 360) / 2;
        }

        $T = 1
            - 0.17 * cos(deg2rad($hbarp - 30))
            + 0.24 * cos(deg2rad(2 * $hbarp))
            + 0.32 * cos(deg2rad(3 * $hbarp + 6))
            - 0.20 * cos(deg2rad(4 * $hbarp - 63));

        $dTheta = 30 * exp(-pow(($hbarp - 275) / 25, 2));
        $Cbarp7 = pow($Cbarp, 7);
        $Rc = 2 * sqrt($Cbarp7 / ($Cbarp7 + 6103515625.0));
        $Lm50 = pow($Lbarp - 50, 2);
        $Sl = 1 + (0.015 * $Lm50) / sqrt(20 + $Lm50);
        $Sc = 1 + 0.045 * $Cbarp;
        $Sh = 1 + 0.015 * $Cbarp * $T;
        $Rt = -sin(deg2rad(2 * $dTheta)) * $Rc;

        $tL = $dLp / ($kL * $Sl);
        $tC = $dCp / ($kC * $Sc);
        $tH = $dHp / ($kH * $Sh);

        return sqrt($tL * $tL + $tC * $tC + $tH * $tH + $Rt * $tC * $tH);
    }

    private static function posDeg($d)
    {
        return $d < 0 ? $d + 360 : $d;
    }

    /** Словесная оценка совпадения — те же пороги, что и в podbor.color.js. */
    public static function deltaEQuality($de)
    {
        if ($de <= 0.5)  return array('level' => 'perfect',    'label' => 'Неотличимо',            'cls' => 'good');
        if ($de <= 1.0)  return array('level' => 'excellent',  'label' => 'Неразличимо глазом',    'cls' => 'good');
        if ($de <= 1.5)  return array('level' => 'good',       'label' => 'Точное совпадение',     'cls' => 'good');
        if ($de <= 2.5)  return array('level' => 'fair',       'label' => 'Лёгкое отличие',        'cls' => 'mid');
        if ($de <= 3.5)  return array('level' => 'noticeable', 'label' => 'Заметно при сравнении', 'cls' => 'mid');
        if ($de <= 5.0)  return array('level' => 'poor',       'label' => 'Заметная разница',      'cls' => 'poor');
        return array('level' => 'different', 'label' => 'Другой оттенок', 'cls' => 'poor');
    }

    /** LRV — коэффициент отражения света, равен Y из XYZ. */
    public static function lrv($hex)
    {
        $lab = self::hexToLab($hex);
        if ($lab === null) {
            return null;
        }
        $xyz = self::labToXyz($lab[0], $lab[1], $lab[2]);
        return round(self::clamp($xyz[1], 0, 100), 1);
    }

    /** Цвет текста, читаемый на данном фоне. */
    public static function readableTextColor($hex)
    {
        $rgb = self::hexToRgb($hex);
        if ($rgb === null) {
            return '#20241F';
        }
        $lum = 0.2126 * self::srgbToLinear($rgb[0])
             + 0.7152 * self::srgbToLinear($rgb[1])
             + 0.0722 * self::srgbToLinear($rgb[2]);
        return $lum > 0.42 ? '#20241F' : '#FFFFFF';
    }
}
