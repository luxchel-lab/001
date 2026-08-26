/**
 * Замер плотности каталога: насколько близко палитра накрывает цветовое
 * пространство. Это главный показатель качества подбора — именно он
 * определяет, какие ΔE увидит клиент.
 *
 * Запуск: node tools/measure-density.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

global.window = {};
const C = require(path.join(__dirname, '..', 'assets', 'js', 'podbor.color.js'));
eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'podbor.palette.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'podbor.standards.js'), 'utf8'));

const palette = global.window.ARCHIPAINT_PALETTE;
const standards = global.window.ARCHIPAINT_STANDARDS;

// генератор с фиксированным зерном: замер должен воспроизводиться
let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

function measure(label, samples, makeLab) {
  let sum = 0, worst = 0, over5 = 0;
  for (let i = 0; i < samples; i++) {
    const lab = makeLab();
    const de = C.findNearest(lab, palette, { limit: 1 })[0].deltaE;
    sum += de;
    if (de > worst) worst = de;
    if (de > 5) over5++;
  }
  console.log(
    '  ' + label.padEnd(38),
    'средний ΔE00', (sum / samples).toFixed(2).padStart(6),
    '| худший', worst.toFixed(2).padStart(6),
    '| доля >5:', (over5 / samples * 100).toFixed(0).padStart(3) + '%'
  );
}

console.log('Каталог ArchiPaint:', palette.length, 'оттенков\n');

measure('Произвольные цвета sRGB', 4000, () => {
  return C.hexToLab(C.rgbToHex(Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256)));
});

measure('Интерьерный диапазон (хрома < 38)', 3000, () => {
  return C.fitToGamut(15 + rnd() * 80, rnd() * 38, rnd() * 360);
});

measure('Спокойные тона (хрома < 20)', 3000, () => {
  return C.fitToGamut(15 + rnd() * 80, rnd() * 20, rnd() * 360);
});

let sum = 0, worst = 0, worstCode = '';
standards.forEach((s) => {
  const de = C.findNearest({ l: s.lab[0], a: s.lab[1], b: s.lab[2] }, palette, { limit: 1 })[0].deltaE;
  sum += de;
  if (de > worst) { worst = de; worstCode = s.code + ' ' + s.name; }
});
console.log(
  '  ' + ('RAL Classic (' + standards.length + ' оттенков)').padEnd(38),
  'средний ΔE00', (sum / standards.length).toFixed(2).padStart(6),
  '| худший', worst.toFixed(2).padStart(6), '—', worstCode
);

console.log('\nВывод: чем плотнее каталог, тем меньше ΔE увидит клиент.');
console.log('Подмена справочного набора на реальную выгрузку — самый заметный способ улучшить подбор.');
