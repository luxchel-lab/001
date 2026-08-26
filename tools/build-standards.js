/**
 * Сборка справочника внешних стандартов (RAL Classic).
 *
 * Источник: tools/ral-source.txt — строки вида «код|HEX|русское название».
 * Скрипт пересчитывает Lab (D65, 2°) из HEX и пишет assets/js/podbor.standards.js.
 *
 * Запуск: node tools/build-standards.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require(path.join(__dirname, '..', 'assets', 'js', 'podbor.color.js'));

const src = fs.readFileSync(path.join(__dirname, 'ral-source.txt'), 'utf8');
const rows = src.split('\n').map((l) => l.trim()).filter(Boolean);

const items = rows.map((line) => {
  const [code, hex, name] = line.split('|');
  const full = '#' + hex.trim().toUpperCase();
  if (!C.isHex(full)) throw new Error('Некорректный HEX в строке: ' + line);
  const lab = C.hexToLab(full);
  return {
    standard: 'RAL Classic',
    code: 'RAL ' + code.trim(),
    num: code.trim(),
    name: name.trim(),
    hex: full,
    lab: [C.round(lab.l, 3), C.round(lab.a, 3), C.round(lab.b, 3)],
  };
});

const codes = new Set(items.map((i) => i.code));
if (codes.size !== items.length) throw new Error('Дубликаты кодов RAL');

const header = `/*!
 * ArchiPaint — справочник внешних цветовых стандартов.
 * Сгенерировано tools/build-standards.js — не редактируйте вручную.
 *
 * RAL Classic, ${items.length} оттенков.
 *
 * ВАЖНО: HEX здесь — общепринятые экранные приближения RAL Classic.
 * Они НЕ заменяют физический веер: реальный оттенок зависит от партии,
 * подложки и освещения, а экран показывает цвет с искажениями.
 * Справочник нужен для одного — быстро найти ближайший цвет
 * колеровочной палитры ArchiPaint по знакомому клиенту коду.
 *
 * Чтобы добавить NCS, Pantone, Tikkurila и другие коллекции,
 * подключите колеровочный API через ArchiPaintData.configure({ apiBase }).
 */
`;

const out = path.join(__dirname, '..', 'assets', 'js', 'podbor.standards.js');
fs.writeFileSync(out, header + 'window.ARCHIPAINT_STANDARDS = ' + JSON.stringify(items) + ';\n', 'utf8');
console.log('Записано:', out, '| оттенков:', items.length);
