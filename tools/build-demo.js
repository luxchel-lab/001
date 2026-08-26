/**
 * Собирает автономную demo/index.html из podbor.php.
 *
 * Берёт разметку между открывающим <div class="ap-tool"> и последним
 * require() футера, подставляет пути к ассетам и оборачивает в HTML5-каркас.
 * Так демо-страница не расходится с боевой вёрсткой Bitrix.
 *
 * Запуск: node tools/build-demo.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const php = fs.readFileSync(path.join(root, 'podbor.php'), 'utf8');

const start = php.indexOf('<div class="ap-tool">');
const end = php.lastIndexOf('<?php require');
if (start === -1 || end === -1) throw new Error('Не найдены границы разметки в podbor.php');

let body = php.slice(start, end).trim();

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchiPaint — подбор цвета краски</title>
<meta name="description" content="Демонстрация сервиса подбора краски ArchiPaint: подбор по фото, поиск по коду RAL и координатам, интерьерные палитры, примерка в комнате и расчёт расхода.">
<style>
  /* минимальная обвязка вместо шаблона Bitrix */
  body { margin: 0; background: #FAFAF7; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  .demo-note { background: #20241F; color: #EDEDE6; font-size: 13px; padding: 10px 20px; text-align: center; }
  .demo-note code { font-family: ui-monospace, Consolas, monospace; background: rgba(255,255,255,.12); padding: 2px 6px; border-radius: 4px; }
</style>
<link rel="stylesheet" href="../assets/css/podbor.css">
</head>
<body>
<div class="demo-note">
  Автономная демонстрация сервиса. Боевая версия живёт в <code>podbor.php</code>; эта страница собирается из неё скриптом <code>tools/build-demo.js</code>.
</div>

${body}

<script src="../assets/js/podbor.color.js"></script>
<script src="../assets/js/podbor.palette.js"></script>
<script src="../assets/js/podbor.standards.js"></script>
<script src="../assets/js/podbor.data.js"></script>
<script src="../assets/js/podbor.js"></script>
</body>
</html>
`;

const out = path.join(root, 'demo', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html, 'utf8');
console.log('Записано:', out, '|', Math.round(html.length / 1024), 'КБ');
