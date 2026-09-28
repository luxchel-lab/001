/*!
 * ArchiColor AI — mock backend для автономного превью.
 *
 * Перехватывает $.ajax и fetch к /ajax/*.php и отвечает демо-данными в тех же
 * форматах, что и production-обработчики Bitrix. Каталог — справочная палитра
 * ArchiPaint (window.ARCHIPAINT_PALETTE), близость — CIEDE2000.
 * «Генерация ИИ» — локальная цветокоррекция загруженного фото по выбранному стилю,
 * а не вызов Decor8.
 */
(function ($) {
    "use strict";

    // Сессия Bitrix не нужна, но ai.js передаёт sessid, если BX есть.
    window.BX = window.BX || { bitrix_sessid: function () { return "preview"; }, onCustomEvent: function () {} };

    var RAD = Math.PI / 180;
    var PALETTE = (window.ARCHIPAINT_PALETTE || []).map(function (c, i) {
        return { id: i + 1, code: c.code, n: c.name, h: c.hex.toUpperCase(), lab: c.lab || hexToLab(c.hex) };
    });

    function hexToLab(hex) {
        hex = hex.replace("#", "");
        var rgb = [0, 2, 4].map(function (i) { return parseInt(hex.slice(i, i + 2), 16); });
        function lin(v) { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; }
        var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
        var X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
        var Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
        var Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
        function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
        X = f(X); Y = f(Y); Z = f(Z);
        return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    }

    function de2000(l1, l2) {
        var L1 = l1[0], a1 = l1[1], b1 = l1[2], L2 = l2[0], a2 = l2[1], b2 = l2[2];
        var C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
        var p25 = Math.pow(25, 7), Cb7 = Math.pow(Cb, 7);
        var G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + p25)));
        var a1p = a1 * (1 + G), a2p = a2 * (1 + G);
        var C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
        var h1 = Math.atan2(b1, a1p) / RAD; if (h1 < 0) h1 += 360;
        var h2 = Math.atan2(b2, a2p) / RAD; if (h2 < 0) h2 += 360;
        var dL = L2 - L1, dC = C2p - C1p, dh = 0;
        if (C1p * C2p !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
        var dH = 2 * Math.sqrt(C1p * C2p) * Math.sin(dh * RAD / 2);
        var Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2, hb = h1 + h2;
        if (C1p * C2p !== 0) {
            if (Math.abs(h1 - h2) <= 180) hb = (h1 + h2) / 2;
            else if (h1 + h2 < 360) hb = (h1 + h2 + 360) / 2;
            else hb = (h1 + h2 - 360) / 2;
        }
        var T = 1 - 0.17 * Math.cos((hb - 30) * RAD) + 0.24 * Math.cos(2 * hb * RAD) + 0.32 * Math.cos((3 * hb + 6) * RAD) - 0.20 * Math.cos((4 * hb - 63) * RAD);
        var dT = 30 * Math.exp(-Math.pow((hb - 275) / 25, 2));
        var Cbp7 = Math.pow(Cbp, 7), RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + p25));
        var SL = 1 + 0.015 * Math.pow(Lb - 50, 2) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
        var SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T, RT = -Math.sin(2 * dT * RAD) * RC;
        return Math.sqrt(Math.pow(dL / SL, 2) + Math.pow(dC / SC, 2) + Math.pow(dH / SH, 2) + RT * (dC / SC) * (dH / SH));
    }

    function nearest(lab, limit) {
        return PALETTE.map(function (c) {
            return { id: c.id, code: c.code, n: c.n, h: c.h, de: de2000(lab, c.lab) };
        }).sort(function (a, b) { return a.de - b.de; }).slice(0, limit || 3);
    }

    function swatchSvg(label, hex) {
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
            '<rect x="22" y="18" width="52" height="64" rx="8" fill="' + hex + '" stroke="#2b2b2b" stroke-opacity=".25"/>' +
            '<rect x="30" y="10" width="36" height="10" rx="3" fill="#8a8a8a"/>' +
            '<text x="48" y="56" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#fff" stroke="#000" stroke-opacity=".3" stroke-width=".4">' + label + '</text></svg>';
        return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    }

    // Цветокоррекция по стилю: [насыщенность, тёплый/холодный сдвиг, контраст, яркость]
    var STYLE_GRADE = {
        modern:       [0.85, -6, 1.10, 4],
        scandinavian: [0.60, -4, 0.95, 18],
        minimalist:   [0.45, 0, 0.92, 14],
        neoclassic:   [0.90, 14, 1.05, 6],
        loft:         [0.70, 10, 1.22, -12],
        artdeco:      [1.25, 18, 1.15, -4]
    };

    function fakeGeneration(file, style) {
        return new Promise(function (resolve, reject) {
            if (!file) { reject(new Error("no file")); return; }
            var img = new Image();
            img.onload = function () {
                var max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
                var cv = document.createElement("canvas");
                cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
                var ctx = cv.getContext("2d");
                ctx.drawImage(img, 0, 0, cv.width, cv.height);
                var g = STYLE_GRADE[style] || STYLE_GRADE.modern;
                var d = ctx.getImageData(0, 0, cv.width, cv.height), p = d.data;
                for (var i = 0; i < p.length; i += 4) {
                    var r = p[i], gr = p[i + 1], b = p[i + 2];
                    var l = 0.299 * r + 0.587 * gr + 0.114 * b;
                    r = l + (r - l) * g[0]; gr = l + (gr - l) * g[0]; b = l + (b - l) * g[0];
                    r += g[1]; b -= g[1];
                    r = (r - 128) * g[2] + 128 + g[3]; gr = (gr - 128) * g[2] + 128 + g[3]; b = (b - 128) * g[2] + 128 + g[3];
                    p[i] = r; p[i + 1] = gr; p[i + 2] = b;
                }
                ctx.putImageData(d, 0, 0);
                URL.revokeObjectURL(img.src);
                resolve(cv.toDataURL("image/jpeg", 0.9));
            };
            img.onerror = function () { reject(new Error("bad image")); };
            img.src = URL.createObjectURL(file);
        });
    }

    var usedQuota = parseInt(window.GLOBAL_USER_USED_QUOTA, 10) || 0;
    var STYLE_LABELS = { modern: "Современный", scandinavian: "Скандинавский", minimalist: "Минимализм", neoclassic: "Неоклассицизм", loft: "Лофт", artdeco: "Ар-деко" };
    var ROOM_LABELS = { living_room: "Гостиная", bedroom: "Спальня", kitchen: "Кухня", bathroom: "Ванная", kids_room: "Детская", home_office: "Кабинет", dining_room: "Столовая", hallway: "Прихожая" };

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; });
    }

    function readParam(data, key) {
        if (!data) return undefined;
        if (typeof FormData !== "undefined" && data instanceof FormData) return data.get(key);
        if (typeof data === "string") return new URLSearchParams(data).get(key);
        return data[key];
    }

    var ROUTES = {
        "catalog_search.php": function (data) {
            var q = String(readParam(data, "q") || "").trim().toLowerCase().replace(/^#/, "");
            var limit = 120;
            var found = !q ? PALETTE : PALETTE.filter(function (c) {
                return (c.n + " " + c.code + " " + c.h).toLowerCase().indexOf(q) !== -1;
            });
            return { items: found.slice(0, limit), total: found.length, limit: limit };
        },
        "color_service.php": function (data) {
            var colors = JSON.parse(readParam(data, "colors") || "{}"), out = {};
            Object.keys(colors).forEach(function (k) {
                var t = colors[k];
                out[k] = nearest([+t.l, +t.a, +t.b], 3);
            });
            return out;
        },
        // Реальный endpoint подбора: ai-stage3-core.js переводит на него запросы color_service.php.
        "color_search_core.php": function (data) {
            var body = {};
            try { body = typeof data === "string" ? JSON.parse(data) : (data || {}); } catch (e) { body = {}; }
            var limit = Math.max(1, Math.min(12, parseInt(body.limit, 10) || 3));
            return {
                items: (body.targets || []).map(function (t) {
                    return nearest([+t.l, +t.a, +t.b], limit).map(function (m) {
                        return { id: m.id, code: m.code, name: m.n, hex: m.h, url: "#", deltaE: +m.de.toFixed(4) };
                    });
                }),
                catalogCount: PALETTE.length, formula: "CIEDE2000", source: "preview:ARCHIPAINT_PALETTE"
            };
        },
        "get_product_options_v3.php": function (data) {
            var c = PALETTE[(parseInt(readParam(data, "color_id"), 10) || 1) - 1] || PALETTE[0];
            var hex = c ? c.h : "#D8D2C4";
            return { color: { id: c && c.id, name: c && c.n }, options: [
                { bitrix_id: 37672, main_product_id: 37672, title: "Пробник цвета", desc: "Мини-банка краски для выкрасов и теста цвета", price: 390, img: swatchSvg("0,1 л", hex), url: "#" },
                { bitrix_id: 82767, main_product_id: 82767, title: "Образец на бумаге", desc: "Выкрас краски формата А4", price: 150, img: swatchSvg("A4", hex), url: "#" },
                { bitrix_id: 90001, main_product_id: 90000, title: "ArchiPaint Interior Matt (0,9 л)", desc: "Краска с колеровкой в выбранный цвет", price: 1290, img: swatchSvg("0,9 л", hex), url: "#" },
                { bitrix_id: 90002, main_product_id: 90000, title: "ArchiPaint Interior Matt (2,7 л)", desc: "Краска с колеровкой в выбранный цвет", price: 3450, img: swatchSvg("2,7 л", hex), url: "#" },
                { bitrix_id: 90003, main_product_id: 90000, title: "ArchiPaint Interior Matt (9 л)", desc: "Краска с колеровкой в выбранный цвет", price: 10490, img: swatchSvg("9 л", hex), url: "#" }
            ] };
        },
        "ai_generation.php": function (data) {
            var style = readParam(data, "style"), room = readParam(data, "room_type"), notes = readParam(data, "notes");
            return new Promise(function (resolve) { setTimeout(resolve, 2500); })
                .then(function () { return fakeGeneration(readParam(data, "image"), style); })
                .then(function (url) {
                    usedQuota = Math.min(usedQuota + 1, 2); // превью никогда не упирается в лимит
                    var echo = "Перерисовка помещения: <u>" + (ROOM_LABELS[room] || "Помещение") + "</u> в стиле <u>" + (STYLE_LABELS[style] || "Выбранный стиль") + "</u>.";
                    if (notes) echo += " Дополнительно: <i>«" + escapeHtml(notes) + "»</i>";
                    return { success: true, image_url: url, prompt_echo: echo + " <small>(демо: цветокоррекция вместо Decor8)</small>", used_quota: usedQuota };
                }, function () {
                    return { success: false, error: "Не удалось прочитать изображение" };
                });
        },
        "add_to_basket_v3.php": function (data) {
            var c = PALETTE[(parseInt(readParam(data, "color_id"), 10) || 1) - 1];
            return { status: "success", basket_item_id: Date.now() % 100000, quantity: 1, color_article: c ? c.code : "" };
        }
    };

    function route(url) {
        var m = /\/ajax\/([\w.-]+\.php)/.exec(url || "");
        return m && ROUTES[m[1]] ? ROUTES[m[1]] : null;
    }

    var realAjax = $.ajax;
    $.ajax = function (url, opts) {
        if (typeof url === "object") { opts = url; url = opts.url; }
        opts = opts || {};
        var handler = route(url);
        if (!handler) return realAjax.apply($, arguments);
        var dfd = $.Deferred();
        setTimeout(function () {
            Promise.resolve().then(function () { return handler(opts.data); }).then(function (res) {
                if (opts.success) opts.success(res, "success", dfd);
                dfd.resolve(res, "success", dfd);
            }, function (err) {
                var xhr = { status: 500, responseText: String(err) };
                if (opts.error) opts.error(xhr, "error", err);
                dfd.reject(xhr, "error", err);
            }).then(function () { if (opts.complete) opts.complete(dfd, "success"); });
        }, 250);
        return dfd.promise();
    };

    var realFetch = window.fetch;
    window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : input && input.url;
        var handler = route(url);
        if (!handler) return realFetch.apply(window, arguments);
        return Promise.resolve(handler(init && init.body)).then(function (res) {
            return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json" } });
        });
    };
})(window.jQuery);
