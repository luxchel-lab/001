/*!
 * ArchiPaint · podbor.js
 * Интерфейс сервиса подбора краски.
 *
 * Точка входа — глобальная функция podbor(). Она идемпотентна: повторный
 * вызов не создаёт дублирующих обработчиков. Любой блок разметки
 * необязателен — если секции нет на странице, соответствующий модуль
 * молча пропускается. Это позволяет разложить инструмент по разным
 * страницам Bitrix без правки скрипта.
 *
 * Зависит от: podbor.color.js, podbor.palette.js, podbor.data.js
 * Опционально: podbor.standards.js
 */
(function (global) {
  'use strict';

  var C = global.ArchiPaintColor;
  var D = global.ArchiPaintData;
  if (!C || !D) {
    if (global.console) console.error('podbor.js: не подключены podbor.color.js / podbor.data.js');
    return;
  }

  var initialized = false;

  /* ============================================================
   *  Состояние
   * ============================================================ */

  var S = {
    image: null,          // { img, canvas, ctx, width, height, name }
    slots: [],            // 4 доминирующих + 1 снятый пипеткой
    pickedSlot: null,
    activeHex: null,      // цвет, вокруг которого строятся гармонии и палитры
    activeSource: null,   // откуда он взялся: 'photo' | 'catalog' | 'coords' | 'standard'
    activeLabel: null,

    formula: 'de2000',
    collections: [],      // пустой массив = искать по всем коллекциям
    light: 'd65',
    cvd: 'normal',

    scheme: 'analogous',
    mood: 'soft_light',
    baseRole: 'auto',

    compare: [],
    picking: false,
    lastPalettes: null,
    cardColor: null
  };

  var SLOT_COUNT = 4;

  /* ============================================================
   *  Мелкие утилиты
   * ============================================================ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }

  /** Создание элемента: el('div', {class:'x', onclick:fn}, [child|string]) */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
      else node.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(children) ? children : children == null ? [] : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function svgIcon(paths, opts) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', (opts && opts.viewBox) || '0 0 24 24');
    svg.setAttribute('fill', (opts && opts.fill) || 'none');
    svg.setAttribute('stroke', (opts && opts.stroke) || 'currentColor');
    svg.setAttribute('stroke-width', (opts && opts.width) || '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (Array.isArray(paths) ? paths : [paths]).forEach(function (d) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function fmt(n, digits) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(digits == null ? 2 : digits).replace('.', ',');
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  /* ============================================================
   *  Уведомления
   * ============================================================ */

  var toastTimer = null;

  function toast(message) {
    var node = byId('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('is-visible'); }, 2600);
  }

  function copyText(text, successMessage) {
    var done = function () { toast(successMessage || ('Скопировано: ' + text)); };
    if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();

    function fallback() {
      try {
        var ta = el('textarea', { style: { position: 'fixed', opacity: '0', pointerEvents: 'none' } });
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch (e) {
        toast('Не удалось скопировать');
      }
    }
  }

  /* ============================================================
   *  Модальные окна
   * ============================================================ */

  var modalStack = [];

  function openModal(backdrop) {
    if (!backdrop) return;
    backdrop.classList.add('is-open');
    modalStack.push({ node: backdrop, restoreFocus: document.activeElement });
    document.body.style.overflow = 'hidden';
    var focusable = backdrop.querySelector('input, button, [tabindex]');
    if (focusable) setTimeout(function () { focusable.focus(); }, 40);
  }

  function closeModal(backdrop) {
    var entry = null;
    for (var i = modalStack.length - 1; i >= 0; i--) {
      if (!backdrop || modalStack[i].node === backdrop) { entry = modalStack.splice(i, 1)[0]; break; }
    }
    if (!entry) return;
    entry.node.classList.remove('is-open');
    if (!modalStack.length) document.body.style.overflow = '';
    if (entry.restoreFocus && entry.restoreFocus.focus) entry.restoreFocus.focus();
  }

  function closeTopModal() {
    if (modalStack.length) closeModal(modalStack[modalStack.length - 1].node);
  }

  function wireModal(backdropId, closeSelectors) {
    var back = byId(backdropId);
    if (!back) return null;
    // клик по подложке закрывает окно, клик внутри — нет
    back.addEventListener('mousedown', function (e) { if (e.target === back) closeModal(back); });
    (closeSelectors || []).forEach(function (sel) {
      var btn = typeof sel === 'string' ? byId(sel) : sel;
      if (btn) btn.addEventListener('click', function () { closeModal(back); });
    });
    return back;
  }

  /* ============================================================
   *  Загрузка изображения
   * ============================================================ */

  var MAX_ANALYSIS_SIDE = 620;   // больше не нужно: k-means и так сходится
  var MAX_FILE_BYTES = 20 * 1024 * 1024;

  function initUpload() {
    var drop = byId('drop');
    var input = byId('fileInput');
    if (!drop || !input) return;

    var dropSection = byId('dropSection');
    var previewSection = byId('previewSection');
    var holder = byId('pvHolder');
    var note = byId('fileNameNote');

    byId('btnPick') && byId('btnPick').addEventListener('click', function (e) {
      e.stopPropagation();
      input.click();
    });
    byId('btnDemo') && byId('btnDemo').addEventListener('click', function (e) {
      e.stopPropagation();
      loadDemoScene();
    });
    byId('btnReplace') && byId('btnReplace').addEventListener('click', function () { input.click(); });
    byId('btnReset') && byId('btnReset').addEventListener('click', resetImage);
    byId('btnPicker') && byId('btnPicker').addEventListener('click', togglePicker);

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-dragover'); });
    });
    drop.addEventListener('drop', function (e) {
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
      input.value = '';
    });

    // вставка из буфера — самый быстрый путь для скриншота из мессенджера
    document.addEventListener('paste', function (e) {
      if (modalStack.length) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image') === 0) {
          var file = items[i].getAsFile();
          if (file) { handleFile(file); e.preventDefault(); }
          return;
        }
      }
    });

    function handleFile(file) {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        toast('Нужен файл изображения: JPG, PNG или WEBP');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast('Файл больше 20 МБ — уменьшите изображение');
        return;
      }
      var url = URL.createObjectURL(file);
      loadImage(url, file.name, function () { URL.revokeObjectURL(url); });
    }

    function loadImage(src, name, done) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) {
          toast('Не удалось прочитать изображение');
          if (done) done();
          return;
        }
        setImage(img, name);
        if (done) done();
      };
      img.onerror = function () {
        toast('Не удалось загрузить изображение');
        if (done) done();
      };
      img.src = src;
    }

    function setImage(img, name) {
      // уменьшенная копия: анализировать 12 Мп бессмысленно и медленно
      var scale = Math.min(1, MAX_ANALYSIS_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));

      var canvas = el('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);

      S.image = { img: img, canvas: canvas, ctx: ctx, width: w, height: h, name: name || '' };
      S.pickedSlot = null;
      S.picking = false;

      clear(holder);
      var view = el('img', { src: img.src, alt: 'Загруженное изображение' });
      holder.appendChild(view);

      if (dropSection) dropSection.hidden = true;
      if (previewSection) previewSection.hidden = false;
      if (note) note.textContent = name ? 'Файл: ' + name + ' · ' + img.naturalWidth + '×' + img.naturalHeight + ' px' : '';

      var wrap = byId('previewWrap');
      if (wrap) wrap.classList.remove('is-picking');
      var dot = byId('pickDot');
      if (dot) dot.hidden = true;
      hideLoupe();

      analyzeImage();
    }

    function resetImage() {
      S.image = null;
      S.slots = [];
      S.pickedSlot = null;
      S.picking = false;
      S.activeHex = null;
      S.activeSource = null;
      clear(holder);
      if (dropSection) dropSection.hidden = false;
      if (previewSection) previewSection.hidden = true;
      if (note) note.textContent = '';
      renderResults();
      renderHarmony();
      renderInteriorSection();
      updateUrlState();
    }

    /**
     * Демо-сцена рисуется на canvas, а не грузится с сервера:
     * инструмент должен работать даже без картинок в проекте.
     */
    function loadDemoScene() {
      var w = 900, h = 620;
      var cv = el('canvas');
      cv.width = w; cv.height = h;
      var g = cv.getContext('2d');

      var sky = g.createLinearGradient(0, 0, 0, h * 0.55);
      sky.addColorStop(0, '#C9D6DE');
      sky.addColorStop(1, '#EBE4D6');
      g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.62);

      g.fillStyle = '#8FAE86'; g.fillRect(0, h * 0.62, w, h * 0.38);
      g.fillStyle = '#5C6B4F';
      g.beginPath(); g.moveTo(0, h * 0.72); g.lineTo(w * 0.35, h * 0.64);
      g.lineTo(w * 0.7, h * 0.75); g.lineTo(w, h * 0.66); g.lineTo(w, h); g.lineTo(0, h);
      g.closePath(); g.fill();

      g.fillStyle = '#B8A282'; g.fillRect(w * 0.12, h * 0.30, w * 0.34, h * 0.42);
      g.fillStyle = '#8C4A3E';
      g.beginPath(); g.moveTo(w * 0.09, h * 0.31); g.lineTo(w * 0.29, h * 0.16);
      g.lineTo(w * 0.49, h * 0.31); g.closePath(); g.fill();

      g.fillStyle = '#3E4A3D'; g.fillRect(w * 0.20, h * 0.46, w * 0.07, h * 0.26);
      g.fillStyle = '#D8CBB0'; g.fillRect(w * 0.33, h * 0.38, w * 0.09, h * 0.11);

      g.fillStyle = '#8A7530'; g.beginPath();
      g.arc(w * 0.72, h * 0.46, h * 0.11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4A5568'; g.fillRect(w * 0.60, h * 0.72, w * 0.30, h * 0.10);

      loadImage(cv.toDataURL('image/png'), 'Пример сцены');
    }

    function togglePicker() {
      if (!S.image) { toast('Сначала загрузите изображение'); return; }
      S.picking = !S.picking;
      var wrap = byId('previewWrap');
      if (wrap) wrap.classList.toggle('is-picking', S.picking);
      var btn = byId('btnPicker');
      if (btn) btn.classList.toggle('btn-accent', S.picking);
      toast(S.picking ? 'Наведите на изображение и кликните, чтобы снять цвет' : 'Пипетка выключена');
      if (!S.picking) hideLoupe();
    }

    initPicker();
  }

  /* ------------------------------------------------------------
   *  Пипетка и лупа
   * ---------------------------------------------------------- */

  function hideLoupe() {
    var loupe = byId('loupe');
    if (loupe) loupe.hidden = true;
  }

  function initPicker() {
    var wrap = byId('previewWrap');
    if (!wrap) return;
    var loupe = byId('loupe');
    var loupeSw = byId('loupeSw');
    var loupeHex = byId('loupeHex');
    var dot = byId('pickDot');

    wrap.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    wrap.addEventListener('mouseleave', hideLoupe);
    wrap.addEventListener('click', function (e) { onPick(e.clientX, e.clientY); });

    wrap.addEventListener('touchmove', function (e) {
      if (!S.picking || !e.touches.length) return;
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    wrap.addEventListener('touchend', function (e) {
      if (!S.picking || !e.changedTouches.length) return;
      onPick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    });

    function toImageCoords(clientX, clientY) {
      if (!S.image) return null;
      var view = wrap.querySelector('img, canvas');
      if (!view) return null;
      var rect = view.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
      var rx = (clientX - rect.left) / rect.width;
      var ry = (clientY - rect.top) / rect.height;
      return {
        x: Math.min(S.image.width - 1, Math.max(0, Math.round(rx * S.image.width))),
        y: Math.min(S.image.height - 1, Math.max(0, Math.round(ry * S.image.height))),
        localX: clientX - rect.left + (rect.left - wrap.getBoundingClientRect().left),
        localY: clientY - rect.top + (rect.top - wrap.getBoundingClientRect().top)
      };
    }

    function sampleAt(pt) {
      var data = S.image.ctx.getImageData(
        Math.max(0, pt.x - 3), Math.max(0, pt.y - 3),
        Math.min(7, S.image.width - Math.max(0, pt.x - 3)),
        Math.min(7, S.image.height - Math.max(0, pt.y - 3))
      );
      return C.averageAt(data, Math.min(3, pt.x), Math.min(3, pt.y), 2);
    }

    function onMove(cx, cy) {
      if (!S.picking || !S.image || !loupe) return;
      var pt = toImageCoords(cx, cy);
      if (!pt) { hideLoupe(); return; }
      var s = sampleAt(pt);
      if (!s) return;
      loupe.hidden = false;
      // держим подсказку внутри превью, иначе у краёв её срезает overflow
      var half = (loupe.offsetWidth || 96) / 2 + 4;
      var maxX = wrap.clientWidth - half;
      loupe.style.left = Math.min(Math.max(pt.localX, half), Math.max(half, maxX)) + 'px';
      loupe.style.top = Math.max(pt.localY, (loupe.offsetHeight || 38) + 18) + 'px';
      if (loupeSw) loupeSw.style.background = s.hex;
      if (loupeHex) loupeHex.textContent = s.hex;
    }

    function onPick(cx, cy) {
      if (!S.picking || !S.image) return;
      var pt = toImageCoords(cx, cy);
      if (!pt) return;
      var s = sampleAt(pt);
      if (!s) return;

      S.pickedSlot = { hex: s.hex, lab: s.lab, lch: s.lch, share: null, picked: true };
      if (dot) {
        dot.hidden = false;
        dot.style.left = pt.localX + 'px';
        dot.style.top = pt.localY + 'px';
        dot.style.background = s.hex;
      }
      hideLoupe();
      setActiveColor(s.hex, 'photo', 'снято пипеткой');
      renderResults();
      toast('Снят цвет ' + s.hex);
    }
  }

  /* ------------------------------------------------------------
   *  Анализ изображения
   * ---------------------------------------------------------- */

  function analyzeImage() {
    if (!S.image) return;
    var results = byId('results');
    if (results) {
      clear(results);
      results.appendChild(el('div', { class: 'res-empty' }, [
        el('div', { class: 'spinner', style: { borderColor: 'rgba(32,36,31,.2)', borderTopColor: '#3E4A3D' } }),
        el('p', { style: { margin: '0', fontWeight: '700' }, text: 'Разбираем изображение…' }),
        el('small', { text: 'Кластеризация цветов в пространстве CIE Lab' })
      ]));
    }

    // отдаём кадр браузеру, чтобы спиннер успел отрисоваться
    setTimeout(function () {
      var data = S.image.ctx.getImageData(0, 0, S.image.width, S.image.height);
      var dominant = C.extractDominantColors(data, SLOT_COUNT, { maxSamples: 26000 });
      S.slots = dominant.map(function (d) {
        return { hex: d.hex, lab: d.lab, lch: d.lch, share: d.share, picked: false };
      });
      if (!S.slots.length) {
        toast('Не удалось выделить цвета — попробуйте другое фото');
        return;
      }
      setActiveColor(S.slots[0].hex, 'photo', 'основной цвет фото');
      renderResults();
      renderHarmony();
      renderInteriorSection();
      updateUrlState();
    }, 30);
  }

  /* ============================================================
   *  Активный цвет
   * ============================================================ */

  function setActiveColor(hex, source, label) {
    var norm = C.normalizeHex(hex);
    if (!norm) return;
    S.activeHex = norm;
    S.activeSource = source || null;
    S.activeLabel = label || null;
    D.store.pushRecent({ hex: norm, source: source || '', label: label || '' });
  }

  function matchOpts(extra) {
    return Object.assign({
      formula: S.formula,
      collections: S.collections.length ? S.collections : null
    }, extra || {});
  }

  function deltaBadge(de) {
    var q = C.deltaEQuality(de);
    return el('span', {
      class: 'de ' + q.cls,
      title: q.label,
      text: 'ΔE ' + fmt(de, 2)
    });
  }

  /* ============================================================
   *  Палитра и ближайшие цвета (шаг 2)
   * ============================================================ */

  function renderResults() {
    var box = byId('results');
    if (!box) return;
    clear(box);

    var slots = S.slots.slice(0, SLOT_COUNT);
    if (!slots.length && !S.pickedSlot) {
      box.appendChild(el('div', { class: 'res-empty' }, [
        svgIcon('M12 3a9 9 0 1 0 0 18c1.6 0 2.4-1 2.4-2.2 0-.7-.3-1.2-.7-1.7-.4-.5-.7-1-.7-1.7 0-1.2 1-2.2 2.4-2.2H17a4 4 0 0 0 4-4c0-3.5-4-6.2-9-6.2z', { width: 1.5 }),
        el('p', { style: { margin: '0', fontWeight: '700' }, text: 'Здесь появится палитра' }),
        el('small', { html: '4 доминирующих цвета + пятый слот для пипетки.<br>Для каждого — HEX и 3 ближайших цвета из каталога с ΔE.' })
      ]));
      return;
    }

    box.appendChild(buildToolbar());

    var list = el('div', { class: 'swatch-list' });
    slots.forEach(function (slot, i) { list.appendChild(buildSwatchRow(slot, i)); });
    list.appendChild(buildSwatchRow(S.pickedSlot, SLOT_COUNT));
    box.appendChild(list);

    var actions = el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { exportPaletteJson(); }
      }, 'Скачать палитру (JSON)'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { exportPalettePng(); }
      }, 'Сохранить картинкой'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(shareUrl(), 'Ссылка на подбор скопирована'); }
      }, 'Скопировать ссылку')
    ]);
    box.appendChild(actions);
  }

  /** Панель настроек расчёта: формула ΔE, коллекции, освещение, зрение. */
  function buildToolbar() {
    var bar = el('div', { class: 'toolbar' });

    var formulaSel = el('select', {
      'aria-label': 'Формула цветового различия',
      onchange: function () {
        S.formula = this.value;
        renderResults();
        renderInteriorSection();
        toast('Формула: ' + C.DELTA_E_FORMULAS[S.formula].label);
      }
    });
    Object.keys(C.DELTA_E_FORMULAS).forEach(function (id) {
      var f = C.DELTA_E_FORMULAS[id];
      formulaSel.appendChild(el('option', { value: id, selected: id === S.formula, title: f.note }, f.label));
    });
    bar.appendChild(el('label', {}, ['Формула ΔE', formulaSel]));

    var collSel = el('select', {
      'aria-label': 'Коллекция',
      onchange: function () {
        S.collections = this.value ? [this.value] : [];
        renderResults();
        renderInteriorSection();
      }
    });
    collSel.appendChild(el('option', { value: '', selected: !S.collections.length }, 'Все коллекции'));
    D.COLLECTIONS.forEach(function (c) {
      collSel.appendChild(el('option', { value: c.id, selected: S.collections[0] === c.id }, c.name + ' (' + c.count + ')'));
    });
    bar.appendChild(el('label', {}, ['Каталог', collSel]));

    var lightSel = el('select', {
      'aria-label': 'Освещение',
      onchange: function () { S.light = this.value; renderResults(); }
    });
    C.LIGHT_ORDER.forEach(function (id) {
      var l = C.LIGHT_SOURCES[id];
      lightSel.appendChild(el('option', { value: id, selected: id === S.light, title: l.note }, l.label));
    });
    bar.appendChild(el('label', {}, ['Свет', lightSel]));

    var cvdSel = el('select', {
      'aria-label': 'Моделирование цветовосприятия',
      onchange: function () { S.cvd = this.value; renderResults(); }
    });
    Object.keys(C.CVD_LABELS).forEach(function (id) {
      cvdSel.appendChild(el('option', { value: id, selected: id === S.cvd }, C.CVD_LABELS[id]));
    });
    bar.appendChild(el('label', {}, ['Зрение', cvdSel]));

    return bar;
  }

  /** Как показать цвет с учётом выбранного света и модели зрения. */
  function displayHex(hex) {
    return C.simulateCVD(C.underLight(hex, S.light), S.cvd);
  }

  function buildSwatchRow(slot, index) {
    var isPicked = index === SLOT_COUNT;

    if (!slot) {
      return el('div', { class: 'sw-row is-empty-slot' }, [
        el('div', {
          class: 'sw-main',
          style: { background: 'repeating-linear-gradient(45deg,#F4F4EF,#F4F4EF 8px,#EBEBE4 8px,#EBEBE4 16px)' }
        }, el('span', { class: 'sw-hex', style: { color: '#7C8479' }, text: 'слот 5' })),
        el('div', { class: 'sw-body' }, [
          el('div', { class: 'sw-title' }, el('strong', { text: 'Свободный слот' })),
          el('div', { class: 'sw-meta', text: 'снимите цвет пипеткой' }),
          el('p', { class: 'fine', style: { margin: '0' }, text: 'Нажмите «Пипетка» и кликните по нужной точке фотографии — цвет встанет сюда.' })
        ])
      ]);
    }

    var shown = displayHex(slot.hex);
    var textColor = C.readableTextColor(shown);
    var matches = D.nearest(slot.lab, matchOpts({ limit: 3 }));

    var main = el('div', {
      class: 'sw-main',
      style: { background: shown, color: textColor }
    }, [
      slot.picked
        ? el('span', { class: 'sw-share', text: 'пипетка' })
        : el('span', { class: 'sw-share', text: slot.share != null ? Math.round(slot.share * 100) + '%' : '—' }),
      el('button', {
        class: 'sw-hex',
        style: { background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, textAlign: 'left' },
        title: 'Скопировать HEX',
        onclick: function () { copyText(slot.hex); }
      }, slot.hex)
    ]);

    var lch = slot.lch || C.labToLch(slot.lab.l, slot.lab.a, slot.lab.b);
    var temp = C.temperature(slot.hex);

    var body = el('div', { class: 'sw-body' }, [
      el('div', { class: 'sw-title' }, [
        el('strong', { text: isPicked ? 'Цвет с пипетки' : 'Цвет ' + (index + 1) }),
        el('span', { class: 'chip chip-muted', text: temp.label }),
        S.activeHex === slot.hex ? el('span', { class: 'chip', text: 'активный' }) : null
      ]),
      el('div', {
        class: 'sw-meta',
        text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) + '° · LRV ' + fmt(C.lrv(slot.hex), 0)
      })
    ]);

    var matchList = el('div', { class: 'match-list' });
    if (!matches.length) {
      matchList.appendChild(el('p', { class: 'fine', style: { margin: 0 }, text: 'В выбранной коллекции нет близких оттенков — снимите фильтр каталога.' }));
    }
    matches.forEach(function (m) {
      matchList.appendChild(el('button', {
        class: 'match-item',
        type: 'button',
        onclick: function () { openColorCard(m.color, { sourceHex: slot.hex, deltaE: m.deltaE, sourceLabel: isPicked ? 'пипетка' : 'ваше фото' }); }
      }, [
        el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
        el('span', { class: 'match-name' }, [
          el('b', { text: m.color.name }),
          el('span', { text: m.color.code + ' · ' + m.color.hex })
        ]),
        deltaBadge(m.deltaE)
      ]));
    });
    body.appendChild(matchList);

    body.appendChild(el('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: function () {
          setActiveColor(slot.hex, 'photo', isPicked ? 'снято пипеткой' : 'цвет фото');
          renderResults(); renderHarmony(); renderInteriorSection(); updateUrlState();
          toast('Гармонии и палитры построены от ' + slot.hex);
        }
      }, 'Взять за основу'),
      el('button', {
        class: 'btn btn-quiet btn-sm',
        onclick: function () { addToCompare(slot.hex, isPicked ? 'Пипетка' : 'Цвет ' + (index + 1)); }
      }, 'В сравнение')
    ]));

    return el('div', { class: 'sw-row' }, [main, body]);
  }

  /* ============================================================
   *  Карточка цвета
   * ============================================================ */

  function openColorCard(color, ctx) {
    ctx = ctx || {};
    S.cardColor = color;
    var back = byId('cardBack');
    if (!back) return;

    var banner = byId('mBanner');
    var shown = displayHex(color.hex);
    if (banner) {
      banner.style.background = shown;
      banner.style.color = C.readableTextColor(shown);
    }
    var nameEl = byId('mName');
    if (nameEl) nameEl.textContent = color.name || color.code;
    var hexEl = byId('mHex');
    if (hexEl) hexEl.textContent = color.hex;

    var box = byId('matchBox');
    if (box) {
      box.hidden = !ctx.sourceHex;
      if (ctx.sourceHex) {
        var srcSw = byId('mSrcSw'), dstSw = byId('mDstSw'), badge = byId('mDeBadge'), srcLabel = byId('mSrcLabel');
        if (srcSw) srcSw.style.background = displayHex(ctx.sourceHex);
        if (dstSw) dstSw.style.background = shown;
        if (srcLabel) srcLabel.textContent = ctx.sourceLabel || 'ваш цвет';
        if (badge) {
          var q = C.deltaEQuality(ctx.deltaE);
          badge.textContent = 'ΔE ' + fmt(ctx.deltaE, 2);
          badge.className = 'de ' + q.cls;
          badge.title = q.label;
        }
      }
    }

    var note = byId('mNote');
    if (note) {
      var parts = [];
      if (ctx.deltaE != null) {
        parts.push(C.deltaEQuality(ctx.deltaE).label + ' по формуле ' + C.DELTA_E_FORMULAS[S.formula].label + '.');
      }
      parts.push(C.lrvAdvice(color.lrv != null ? color.lrv : C.lrv(color.hex)));
      note.textContent = parts.join(' ');
    }

    renderCardProps(color);
    renderCardLights(color);
    renderCardOptions(color);
    renderCardSimilar(color);

    openModal(back);
  }

  function renderCardProps(color) {
    var host = byId('mProps');
    if (!host) return;
    clear(host);

    var lab = color.lab || C.hexToLab(color.hex);
    var lch = color.lch || C.labToLch(lab.l, lab.a, lab.b);
    var rgb = C.hexToRgb(color.hex);
    var lrvValue = color.lrv != null ? color.lrv : C.lrv(color.hex);
    var temp = color.temperature || C.temperature(color.hex);

    [
      ['Код', color.code, color.collection || ''],
      ['HEX', color.hex, 'sRGB'],
      ['RGB', rgb.r + ', ' + rgb.g + ', ' + rgb.b, ''],
      ['Lab (D65)', fmt(lab.l, 1) + ', ' + fmt(lab.a, 1) + ', ' + fmt(lab.b, 1), 'наблюдатель 2°'],
      ['LCh', fmt(lch.l, 1) + ', ' + fmt(lch.c, 1) + ', ' + fmt(lch.h, 0) + '°', ''],
      ['LRV', fmt(lrvValue, 1), 'отражение света'],
      ['Температура', temp.label, ''],
      ['Текст на фоне', C.readableTextColor(color.hex) === '#FFFFFF' ? 'белый' : 'тёмный',
        'контраст ' + fmt(C.contrastRatio(color.hex, C.readableTextColor(color.hex)), 1) + ':1']
    ].forEach(function (row) {
      host.appendChild(el('dl', { class: 'prop' }, [
        el('dt', { text: row[0] }),
        el('dd', {}, [document.createTextNode(row[1]), row[2] ? el('small', { text: row[2] }) : null])
      ]));
    });
  }

  function renderCardLights(color) {
    var host = byId('mLights');
    if (!host) return;
    clear(host);
    C.LIGHT_ORDER.forEach(function (id) {
      var src = C.LIGHT_SOURCES[id];
      host.appendChild(el('div', { class: 'light-cell', title: src.note }, [
        el('i', { style: { background: C.simulateCVD(C.underLight(color.hex, id), S.cvd) } }),
        el('span', { text: src.label.split(' · ')[0] }),
        el('span', { class: 'mono', text: src.label.split(' · ')[1] || '' })
      ]));
    });
  }

  function renderCardOptions(color) {
    var host = byId('mOpts');
    if (!host) return;
    clear(host);

    D.ORDER_OPTIONS.forEach(function (opt) {
      host.appendChild(el('div', { class: 'opt' }, [
        el('div', { class: 'opt-info' }, [
          el('b', {}, [
            document.createTextNode(opt.title + ' · ' + opt.volume),
            opt.badge ? el('span', { class: 'chip', style: { marginLeft: '8px' }, text: opt.badge }) : null
          ]),
          el('span', { text: opt.note + ' Готовность: ' + opt.lead + '.' })
        ]),
        el('div', { class: 'opt-buy' }, [
          el('span', { class: 'opt-price', text: opt.price.toLocaleString('ru-RU') + ' ₽' }),
          el('button', {
            class: 'btn btn-accent btn-sm',
            onclick: function () { requestOrder(color, opt); }
          }, 'В корзину')
        ])
      ]));
    });

    var fav = D.store.isFavorite(color.code);
    host.appendChild(el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function (e) {
          var added = D.store.toggleFavorite(color.code);
          e.currentTarget.textContent = added ? 'В избранном ✓' : 'В избранное';
          toast(added ? 'Цвет добавлен в избранное' : 'Убран из избранного');
          renderFavorites();
        }
      }, fav ? 'В избранном ✓' : 'В избранное'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { addToCompare(color.hex, color.code + ' · ' + color.name); }
      }, 'В сравнение'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          setActiveColor(color.hex, 'catalog', color.code + ' · ' + color.name);
          closeModal(byId('cardBack'));
          renderHarmony(); renderInteriorSection(); updateUrlState();
          toast('Палитры строятся от ' + color.code);
        }
      }, 'Построить палитру от этого цвета'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(color.code + ' · ' + color.name + ' · ' + color.hex, 'Данные цвета скопированы'); }
      }, 'Скопировать')
    ]));
  }

  function renderCardSimilar(color) {
    var host = byId('mSimilar');
    if (!host) return;
    clear(host);
    var similar = D.nearest(color.lab || C.hexToLab(color.hex), matchOpts({ limit: 6, exclude: [color.code] }));
    similar.forEach(function (m) {
      host.appendChild(el('button', {
        class: 'match-item',
        type: 'button',
        onclick: function () { openColorCard(m.color, { sourceHex: color.hex, deltaE: m.deltaE, sourceLabel: color.code }); }
      }, [
        el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
        el('span', { class: 'match-name' }, [
          el('b', { text: m.color.name }),
          el('span', { text: m.color.code + ' · ' + (m.color.collection || '') })
        ]),
        deltaBadge(m.deltaE)
      ]));
    });
  }

  /**
   * Заказ. Если на странице живёт корзина Bitrix — отдаём ей управление
   * через событие; иначе показываем понятную заглушку.
   */
  function requestOrder(color, option) {
    var detail = {
      colorCode: color.code,
      colorName: color.name,
      hex: color.hex,
      collection: color.collection || null,
      optionId: option.id,
      volume: option.volume,
      price: option.price
    };
    D.logEvent('order_intent', detail);

    var event;
    try {
      event = new CustomEvent('archipaint:order', { detail: detail, cancelable: true, bubbles: true });
    } catch (e) {
      event = document.createEvent('CustomEvent');
      event.initCustomEvent('archipaint:order', true, true, detail);
    }
    var notHandled = document.dispatchEvent(event);

    if (notHandled) {
      toast(option.title + ' · ' + option.volume + ' — ' + color.code + ' добавлен в заявку');
    }
  }

  /* ============================================================
   *  Поиск по координатам (HEX / RGB / Lab / LCh)
   * ============================================================ */

  function initCoordSearch() {
    var back = wireModal('coordBack', ['coordX']);
    if (!back) return;

    var input = byId('coordInput');
    var preview = byId('coordPreview');
    var detected = byId('coordDetected');
    var results = byId('coordResults');
    var modes = byId('coordModes');
    var mode = 'auto';

    byId('coordBtn') && byId('coordBtn').addEventListener('click', function () {
      openModal(back);
      run();
    });

    if (modes) {
      modes.addEventListener('click', function (e) {
        var btn = e.target.closest('.mode-tab');
        if (!btn) return;
        mode = btn.dataset.mode || 'auto';
        $$('.mode-tab', modes).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        run();
      });
    }

    if (input) {
      input.addEventListener('input', debounce(run, 160));
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); run(); }
      });
    }

    function run() {
      if (!input) return;
      var raw = input.value.trim();
      clear(results);

      if (!raw) {
        if (preview) preview.style.background = '#E6E6E0';
        if (detected) { detected.textContent = ''; detected.className = 'coord-detected'; }
        return;
      }

      var parsed = C.parseColorInput(raw, mode);
      if (!parsed) {
        if (preview) preview.style.background = '#E6E6E0';
        if (detected) {
          detected.className = 'coord-detected is-error';
          detected.textContent = 'Не удалось разобрать значение. Проверьте формат или выберите его вручную.';
        }
        return;
      }

      if (preview) preview.style.background = parsed.hex;

      if (detected) {
        detected.className = 'coord-detected';
        clear(detected);
        var names = { hex: 'HEX', rgb: 'RGB', lab: 'CIE Lab', lch: 'CIE LCh', hsl: 'HSL' };
        detected.appendChild(document.createTextNode('Распознано как '));
        detected.appendChild(el('b', { text: names[parsed.format] || parsed.format }));
        detected.appendChild(document.createTextNode(
          ' → ' + parsed.hex + ' · Lab ' + fmt(parsed.lab.l, 1) + ', ' + fmt(parsed.lab.a, 1) + ', ' + fmt(parsed.lab.b, 1)
        ));
        if (parsed.inGamut === false) {
          detected.appendChild(el('span', {
            class: 'chip chip-muted',
            style: { marginLeft: '8px' },
            title: 'Такой цвет невозможно точно показать на экране sRGB — показан ближайший отображаемый.',
            text: 'вне охвата sRGB'
          }));
        }
      }

      var matches = D.nearest(parsed.lab, matchOpts({ limit: 5 }));
      if (!matches.length) {
        results.appendChild(el('p', { class: 'fine', text: 'В выбранной коллекции ничего не найдено.' }));
        return;
      }
      matches.forEach(function (m) {
        results.appendChild(el('button', {
          class: 'match-item',
          type: 'button',
          onclick: function () {
            closeModal(back);
            openColorCard(m.color, { sourceHex: parsed.hex, deltaE: m.deltaE, sourceLabel: 'запрос' });
          }
        }, [
          el('span', { class: 'match-sw-mini', style: { background: displayHex(m.color.hex) } }),
          el('span', { class: 'match-name' }, [
            el('b', { text: m.color.name }),
            el('span', { text: m.color.code + ' · ' + m.color.hex + ' · ' + (m.color.collection || '') })
          ]),
          deltaBadge(m.deltaE)
        ]));
      });

      results.appendChild(el('div', { class: 'btn-row' }, el('button', {
        class: 'btn btn-accent btn-sm',
        onclick: function () {
          setActiveColor(parsed.hex, 'coords', 'введено вручную');
          closeModal(back);
          renderHarmony(); renderInteriorSection(); updateUrlState();
          scrollToSection(byId('harmony'));
          toast('Строим палитры от ' + parsed.hex);
        }
      }, 'Построить палитры от этого цвета')));
    }
  }

  /* ============================================================
   *  Каталог целиком
   * ============================================================ */

  function initCatalogModal() {
    var back = wireModal('catBack', ['catX']);
    if (!back) return;

    var grid = byId('catGrid');
    var search = byId('catSearch');
    var count = byId('catCount');
    var filters = byId('catFilters');
    var activeCollection = null;

    byId('navCatalog') && byId('navCatalog').addEventListener('click', function (e) {
      e.preventDefault();
      open();
    });
    $$('[data-open-catalog]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        activeCollection = btn.dataset.openCatalog || null;
        open();
      });
    });

    function open() {
      openModal(back);
      renderFilters();
      render();
    }

    function renderFilters() {
      if (!filters) return;
      clear(filters);
      filters.appendChild(el('button', {
        class: 'filter-chip' + (activeCollection ? '' : ' is-active'),
        onclick: function () { activeCollection = null; renderFilters(); render(); }
      }, 'Все · ' + D.getCatalog().length));
      D.COLLECTIONS.forEach(function (c) {
        filters.appendChild(el('button', {
          class: 'filter-chip' + (activeCollection === c.id ? ' is-active' : ''),
          onclick: function () { activeCollection = c.id; renderFilters(); render(); }
        }, c.name.replace('ArchiPaint ', '') + ' · ' + c.count));
      });
    }

    function render() {
      if (!grid) return;
      var q = search ? search.value.trim() : '';
      var items = q
        ? D.searchCatalog(q, { limit: 400, collections: activeCollection ? [activeCollection] : null })
        : D.getCatalog().filter(function (c) { return !activeCollection || c.collection === activeCollection; });

      clear(grid);
      if (count) {
        count.textContent = items.length + ' ' + plural(items.length, 'оттенок', 'оттенка', 'оттенков');
      }
      if (!items.length) {
        grid.appendChild(el('p', { class: 'fine', text: 'Ничего не найдено. Попробуйте другой запрос — код, название или HEX.' }));
        return;
      }
      var frag = document.createDocumentFragment();
      items.forEach(function (c) {
        frag.appendChild(el('button', {
          class: 'cat-cell',
          type: 'button',
          title: c.code + ' · ' + c.name + ' · ' + c.hex,
          onclick: function () {
            closeModal(back);
            openColorCard(c, S.activeHex ? {
              sourceHex: S.activeHex,
              deltaE: C.deltaE(C.hexToLab(S.activeHex), c.lab, S.formula),
              sourceLabel: S.activeLabel || 'ваш цвет'
            } : {});
          }
        }, [
          el('i', { style: { background: displayHex(c.hex) } }),
          el('div', { class: 'cat-meta' }, [
            el('b', { text: c.code }),
            el('span', { text: c.name })
          ])
        ]));
      });
      grid.appendChild(frag);
    }

    if (search) search.addEventListener('input', debounce(render, 140));
  }

  /* ============================================================
   *  Поиск по коду чужого стандарта (RAL и т. п.)
   * ============================================================ */

  function initStandardSearch() {
    var section = byId('standardSection');
    if (!section) return;

    var input = byId('stdInput');
    var swatch = byId('stdSwatch');
    var list = byId('stdSuggest');
    var result = byId('stdResult');
    if (!input || !list || !result) return;

    var suggestions = [];
    var activeIndex = -1;

    input.addEventListener('input', debounce(suggest, 130));
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!suggestions.length) return;
        activeIndex = (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (suggestions.length) choose(suggestions[Math.max(0, activeIndex)]);
      } else if (e.key === 'Escape') {
        hide();
      }
    });
    input.addEventListener('blur', function () { setTimeout(hide, 180); });
    input.addEventListener('focus', suggest);

    function hide() { list.hidden = true; activeIndex = -1; }

    function highlight() {
      $$('.ac-item', list).forEach(function (b, i) { b.classList.toggle('is-active', i === activeIndex); });
    }

    function suggest() {
      var q = input.value.trim();
      if (q.length < 1) { clear(list); suggestions = []; activeIndex = -1; hide(); return; }

      // адаптер сам сходит в API, если он настроен, и вернётся
      // к локальному индексу при любой ошибке или пустом ответе
      D.searchCatalogAsync(q, { limit: 8, collections: S.collections.length ? S.collections : null })
        .then(function (own) {
          if (input.value.trim() !== q) return;   // пользователь уже печатает дальше
          paint(q, own);
        });
    }

    function paint(q, own) {
      clear(list);
      suggestions = [];
      activeIndex = -1;

      var stds = D.getStandards().length ? D.searchStandards(q, { limit: 8 }) : [];

      if (stds.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Чужие стандарты' }));
        stds.forEach(function (s) { addItem(s, true); });
      }
      if (own.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Палитра ArchiPaint' }));
        own.forEach(function (c) { addItem(c, false); });
      }

      if (!suggestions.length) {
        list.appendChild(el('div', { class: 'ac-group', text: 'Ничего не найдено' }));
      }
      list.hidden = false;
    }

    function addItem(item, isStandard) {
      suggestions.push({ item: item, isStandard: isStandard });
      list.appendChild(el('button', {
        class: 'ac-item',
        type: 'button',
        onmousedown: function (e) { e.preventDefault(); },
        onclick: function () { choose({ item: item, isStandard: isStandard }); }
      }, [
        el('span', { class: 'ac-sw', style: { background: item.hex } }),
        el('span', {}, [
          el('b', { text: item.code + (item.name ? ' · ' + item.name : '') }),
          el('span', { text: item.hex + ' · ' + (isStandard ? item.standard : item.collection) })
        ]),
        el('span', { class: 'chip chip-muted', text: isStandard ? 'стандарт' : 'в наличии' })
      ]));
    }

    function choose(entry) {
      hide();
      input.value = entry.item.code + (entry.item.name ? ' · ' + entry.item.name : '');
      if (swatch) swatch.style.background = entry.item.hex;
      if (entry.isStandard) showStandard(entry.item);
      else showOwn(entry.item);
    }

    function showStandard(std) {
      var matched = D.matchStandard(std, matchOpts({ limit: 6 }));
      clear(result);
      result.classList.add('is-visible');

      result.appendChild(el('div', { class: 'std-source' }, [
        el('div', { class: 'std-source-sw', style: { background: displayHex(std.hex) } }),
        el('div', {}, [
          el('h3', { text: std.code + ' · ' + std.name }),
          el('div', { class: 'mono', text: std.hex + ' · Lab ' + fmt(std.lab.l, 1) + ', ' + fmt(std.lab.a, 1) + ', ' + fmt(std.lab.b, 1) + ' · LRV ' + fmt(std.lrv, 1) }),
          el('p', { class: 'fine', style: { margin: '6px 0 0' }, text: 'Стандарт ' + std.standard + '. Ниже — чем его закрыть из колеровочной палитры ArchiPaint.' })
        ])
      ]));

      var best = matched.matches[0];
      if (best) {
        result.appendChild(el('p', { class: 'section-intro', style: { margin: '0 0 14px' } }, [
          document.createTextNode('Лучшее совпадение — '),
          el('b', { text: best.color.code + ' «' + best.color.name + '»' }),
          document.createTextNode(', ΔE ' + fmt(best.deltaE, 2) + ' по ' + C.DELTA_E_FORMULAS[S.formula].label + ' — ' + best.quality.label.toLowerCase() + '.')
        ]));
      }

      var grid = el('div', { class: 'cards-grid' });
      matched.matches.forEach(function (m) {
        grid.appendChild(colorCardTile(m.color, m.deltaE));
      });
      result.appendChild(grid);

      result.appendChild(el('div', { class: 'btn-row' }, el('button', {
        class: 'btn btn-accent btn-sm',
        onclick: function () {
          setActiveColor(std.hex, 'standard', std.code);
          renderHarmony(); renderInteriorSection(); updateUrlState();
          scrollToSection(byId('interior'));
          toast('Строим интерьерные палитры от ' + std.code);
        }
      }, 'Построить интерьерные палитры от ' + std.code)));

      D.logEvent('standard_lookup', { code: std.code, hex: std.hex, bestMatch: best ? best.color.code : null });
    }

    function showOwn(color) {
      clear(result);
      result.classList.add('is-visible');
      result.appendChild(el('div', { class: 'std-source' }, [
        el('div', { class: 'std-source-sw', style: { background: displayHex(color.hex) } }),
        el('div', {}, [
          el('h3', { text: color.code + ' · ' + color.name }),
          el('div', { class: 'mono', text: color.hex + ' · ' + color.collection + ' · LRV ' + fmt(color.lrv, 1) }),
          el('p', { class: 'fine', style: { margin: '6px 0 0' }, text: C.lrvAdvice(color.lrv) })
        ])
      ]));

      var grid = el('div', { class: 'cards-grid' });
      D.nearest(color.lab, matchOpts({ limit: 6, exclude: [color.code] })).forEach(function (m) {
        grid.appendChild(colorCardTile(m.color, m.deltaE));
      });
      result.appendChild(el('h4', { text: 'Близкие оттенки' }));
      result.appendChild(grid);

      result.appendChild(el('div', { class: 'btn-row' }, [
        el('button', {
          class: 'btn btn-accent btn-sm',
          onclick: function () { openColorCard(color, {}); }
        }, 'Открыть карточку и заказать'),
        el('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: function () {
            setActiveColor(color.hex, 'catalog', color.code);
            renderHarmony(); renderInteriorSection(); updateUrlState();
            scrollToSection(byId('interior'));
          }
        }, 'Построить палитры')
      ]));
    }
  }

  /** Плитка каталога с ΔE — используется в нескольких секциях. */
  function colorCardTile(color, deltaE) {
    var lch = color.lch || C.labToLch(color.lab.l, color.lab.a, color.lab.b);
    return el('button', {
      class: 'color-card',
      type: 'button',
      'aria-label': color.code + ' ' + color.name,
      onclick: function () {
        openColorCard(color, deltaE != null ? { sourceHex: S.activeHex, deltaE: deltaE, sourceLabel: 'запрос' } : {});
      }
    }, [
      el('div', { class: 'cc-sw', style: { background: displayHex(color.hex) } },
        el('span', { class: 'cc-lab mono', text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) })),
      el('div', { class: 'cc-meta' }, [
        el('span', { class: 'cc-code', text: color.code }),
        el('span', { class: 'cc-name', text: color.name }),
        el('span', { class: 'cc-foot' }, [
          el('span', { class: 'chip chip-muted', text: (color.collection || '').replace('ArchiPaint ', '') }),
          deltaE != null ? deltaBadge(deltaE) : null
        ])
      ])
    ]);
  }

  /* ============================================================
   *  Коллекции
   * ============================================================ */

  function renderCollections() {
    var host = byId('collectionsGrid');
    if (!host) return;
    clear(host);
    D.COLLECTIONS.forEach(function (c) {
      host.appendChild(el('button', {
        class: 'collection-card',
        type: 'button',
        dataset: { openCatalog: c.id },
        onclick: function () {
          var back = byId('catBack');
          var search = byId('catSearch');
          if (search) search.value = '';
          if (back) {
            openModal(back);
            // фильтр выставляется через тот же обработчик, что и кнопки в модалке
            var chip = $$('#catFilters .filter-chip').filter(function (b) {
              return b.textContent.indexOf(c.name.replace('ArchiPaint ', '')) === 0;
            })[0];
            if (chip) chip.click();
          }
        }
      }, [
        el('div', { class: 'collection-strip' }, c.preview.map(function (hex) {
          return el('i', { style: { background: displayHex(hex) } });
        })),
        el('div', { class: 'collection-body' }, [
          el('h3', { text: c.name }),
          el('p', { text: c.tagline }),
          el('p', { class: 'fine', style: { margin: '0 0 9px' }, text: c.desc }),
          el('span', { class: 'chip', text: c.count + ' ' + plural(c.count, 'оттенок', 'оттенка', 'оттенков') })
        ])
      ]));
    });
  }

  /* ============================================================
   *  Гармонические сочетания и цветовой круг
   * ============================================================ */

  function renderHarmony() {
    var empty = byId('harmonyEmpty');
    var body = byId('harmonyBody');
    if (!body) return;

    if (!S.activeHex) {
      if (empty) empty.hidden = false;
      body.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    body.hidden = false;

    renderSchemeTabs();
    renderBaseRow();
    drawWheel();
    renderSchemeColors();
  }

  function renderSchemeTabs() {
    var host = byId('schemeTabs');
    if (!host) return;
    clear(host);
    C.HARMONY_SCHEMES.forEach(function (s) {
      host.appendChild(el('button', {
        class: 'scheme-tab' + (s.id === S.scheme ? ' is-active' : ''),
        type: 'button',
        onclick: function () {
          S.scheme = s.id;
          renderHarmony();
          updateUrlState();
        }
      }, s.label));
    });
  }

  function renderBaseRow() {
    var host = byId('baseRow');
    if (!host) return;
    clear(host);

    var lab = C.hexToLab(S.activeHex);
    var lch = C.labToLch(lab.l, lab.a, lab.b);
    var match = D.nearestOne(lab, matchOpts());

    host.appendChild(el('div', { class: 'base-sw', style: { background: displayHex(S.activeHex) } }));
    host.appendChild(el('div', { style: { minWidth: '0' } }, [
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' } }, [
        el('strong', { text: S.activeHex }),
        el('span', { class: 'chip chip-muted', text: S.activeLabel || 'базовый цвет' }),
        el('span', { class: 'chip chip-muted', text: C.temperature(S.activeHex).label })
      ]),
      el('div', { class: 'mono fine', text: 'L ' + fmt(lch.l, 1) + ' · C ' + fmt(lch.c, 1) + ' · h ' + fmt(lch.h, 0) + '° · LRV ' + fmt(C.lrv(S.activeHex), 1) })
    ]));

    if (match) {
      host.appendChild(el('button', {
        class: 'btn btn-ghost btn-sm',
        style: { marginLeft: 'auto' },
        onclick: function () {
          openColorCard(match.color, { sourceHex: S.activeHex, deltaE: match.deltaE, sourceLabel: S.activeLabel || 'ваш цвет' });
        }
      }, ['Ближайший: ' + match.color.code, deltaBadge(match.deltaE)]));
    }
  }

  function renderSchemeColors() {
    var host = byId('hsGrid');
    var descEl = byId('schemeDesc');
    if (!host) return;

    var harmony = C.buildHarmony(S.activeHex, S.scheme);
    if (!harmony) return;
    if (descEl) descEl.textContent = harmony.desc;

    clear(host);
    harmony.colors.forEach(function (c, i) {
      var match = D.nearestOne(c.lab, matchOpts());
      var shown = displayHex(c.hex);
      host.appendChild(el('button', {
        class: 'hs-item',
        type: 'button',
        onclick: function () {
          if (match) openColorCard(match.color, { sourceHex: c.hex, deltaE: match.deltaE, sourceLabel: i === 0 ? 'базовый' : 'цвет схемы' });
        }
      }, [
        el('div', { class: 'hs-sw', style: { background: shown } }),
        el('div', { class: 'hs-meta' }, [
          el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' } }, [
            el('span', { class: 'badge ' + (i === 0 ? 'badge-base' : 'badge-additional'), text: i === 0 ? 'база' : 'цвет ' + (i + 1) })
          ]),
          el('div', { class: 'mono', style: { fontSize: '12px', fontWeight: '650' }, text: c.hex }),
          match ? el('div', { class: 'fine', style: { marginTop: '3px' }, text: match.color.code + ' · ' + match.color.name }) : null,
          match ? el('div', { style: { marginTop: '6px' } }, deltaBadge(match.deltaE)) : null
        ])
      ]));
    });
  }

  /**
   * Цветовой круг: кольцо тонов LCh при фиксированной светлоте
   * и маркеры выбранной схемы. Рисуем на canvas — это дешевле,
   * чем сотня SVG-сегментов, и корректно масштабируется.
   */
  function drawWheel() {
    var canvas = byId('wheel');
    if (!canvas || !S.activeHex) return;

    var dpr = Math.min(2, global.devicePixelRatio || 1);
    var cssSize = canvas.clientWidth || 300;
    canvas.width = Math.round(cssSize * dpr);
    canvas.height = Math.round(cssSize * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssSize, cssSize);

    var cx = cssSize / 2, cy = cssSize / 2;
    var outer = cssSize * 0.46, inner = cssSize * 0.31;

    var baseLab = C.hexToLab(S.activeHex);
    var baseLch = C.labToLch(baseLab.l, baseLab.a, baseLab.b);
    var ringL = C.clamp(baseLch.l, 34, 78);
    var ringC = Math.max(24, Math.min(baseLch.c * 1.15, 62));

    // кольцо тонов
    var step = 1.5;
    for (var a = 0; a < 360; a += step) {
      var lab = C.fitToGamut(ringL, ringC, a);
      ctx.beginPath();
      ctx.fillStyle = C.simulateCVD(C.labToHex(lab.l, lab.a, lab.b), S.cvd);
      var a0 = (a - 90 - step * 0.05) * Math.PI / 180;
      var a1 = (a - 90 + step * 1.1) * Math.PI / 180;
      ctx.arc(cx, cy, outer, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fill();
    }

    // центр — базовый цвет
    ctx.beginPath();
    ctx.arc(cx, cy, inner - 9, 0, Math.PI * 2);
    ctx.fillStyle = displayHex(S.activeHex);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(32,36,31,.16)';
    ctx.stroke();

    // маркеры схемы
    var harmony = C.buildHarmony(S.activeHex, S.scheme);
    if (!harmony) return;

    harmony.colors.forEach(function (col, i) {
      var h = col.lch.c < 1.5 ? baseLch.h : col.lch.h;
      var rad = (h - 90) * Math.PI / 180;
      var r = (outer + inner) / 2;
      var x = cx + Math.cos(rad) * r;
      var y = cy + Math.sin(rad) * r;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(x, y, i === 0 ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = displayHex(col.hex);
      ctx.fill();
      ctx.lineWidth = i === 0 ? 3 : 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(32,36,31,.28)';
      ctx.stroke();
    });
  }

  /* ============================================================
   *  Интерьерные палитры
   * ============================================================ */

  function initInterior() {
    var section = byId('interior');
    if (!section) return;

    var roleSel = byId('interiorRole');
    if (roleSel) {
      roleSel.addEventListener('change', function () {
        S.baseRole = this.value;
        renderInteriorSection();
        updateUrlState();
      });
    }

    var buildBtn = byId('interiorBuild');
    if (buildBtn) {
      buildBtn.addEventListener('click', function () {
        if (!S.activeHex) {
          toast('Сначала выберите базовый цвет — из фото, по коду или по координатам');
          return;
        }
        renderInteriorSection(true);
      });
    }

    renderMoodGrid();
  }

  function renderMoodGrid() {
    var host = byId('moodGrid');
    if (!host) return;
    clear(host);

    D.MOOD_PRESETS.forEach(function (preset) {
      // полоска-превью строится от текущего базового цвета,
      // поэтому пресеты сразу видно «на своём» оттенке
      var previewBase = S.activeHex || '#A89480';
      var sample = D.buildInteriorPalettes(previewBase, preset.id, { schemes: ['analogous'] });
      var strip = sample && sample.results[0]
        ? sample.results[0].colors.slice(0, 5).map(function (c) { return c.hex; })
        : ['#EEE', '#DDD', '#CCC', '#BBB', '#AAA'];

      host.appendChild(el('button', {
        class: 'mood-card' + (preset.id === S.mood ? ' is-active' : ''),
        type: 'button',
        title: preset.desc,
        onclick: function () {
          S.mood = preset.id;
          renderMoodGrid();
          renderInteriorSection();
          updateUrlState();
        }
      }, [
        el('div', { class: 'mood-strip' }, strip.map(function (hex) {
          return el('i', { style: { background: displayHex(hex) } });
        })),
        el('span', { class: 'mood-name', text: preset.title })
      ]));
    });
  }

  function renderInteriorSection(scrollIntoView) {
    var section = byId('interior');
    if (!section) return;

    var empty = byId('interiorEmpty');
    var body = byId('interiorBody');
    var results = byId('interiorResults');
    if (!results) return;

    if (!S.activeHex) {
      if (empty) empty.hidden = false;
      if (body) body.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (body) body.hidden = false;

    var opts = matchOpts({ baseRoleOverride: S.baseRole });
    var hex = S.activeHex, mood = S.mood;

    // Локальный расчёт мгновенный — показываем его сразу, не заставляя ждать сеть.
    var data = D.buildInteriorPalettes(hex, mood, opts);
    if (!data) return;
    paint(data);
    if (scrollIntoView) scrollToSection(results);

    // Если подключён колеровочный API, его ответ приходит следом и уточняет
    // результат. Пока он в пути, страница уже полностью работоспособна.
    if (D.config.apiBase) {
      D.buildInteriorPalettesAsync(hex, mood, opts).then(function (remote) {
        // за время запроса пользователь мог сменить цвет или настроение
        if (!remote || S.activeHex !== hex || S.mood !== mood) return;
        if (remote === data) return;
        paint(remote);
      });
    }

    function paint(payload) {
      S.lastPalettes = payload;
      renderInteriorHeader(payload);
      clear(results);

      var grid = el('div', { class: 'schemes-grid' });
      payload.results.forEach(function (scheme, index) {
        grid.appendChild(buildSchemeCard(payload, scheme, index));
      });
      results.appendChild(grid);

      D.logEvent('interior_palettes_shown', {
        baseColor: payload.baseColor,
        presetId: payload.presetId,
        effectiveBaseRole: payload.effectiveBaseRole,
        schemes: payload.results.map(function (x) { return x.schemeId; })
      });
    }
  }

  function renderInteriorHeader(data) {
    var host = byId('interiorSelected');
    if (!host) return;
    clear(host);

    var preset = D.PRESETS_BY_ID[data.presetId];
    var roleInfo = D.roleMeta(data.effectiveBaseRole);

    host.appendChild(el('div', { class: 'selected-swatch', style: { background: displayHex(data.baseColor) } }));
    host.appendChild(el('div', { class: 'selected-info-main' }, [
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '3px' } }, [
        roleBadge(data.effectiveBaseRole),
        el('strong', { class: 'mono', text: data.baseColor }),
        S.activeLabel ? el('span', { class: 'chip chip-muted', text: S.activeLabel }) : null,
        data.effectiveBaseRole !== data.autoBaseRole
          ? el('span', { class: 'chip chip-muted', text: 'роль задана вручную' })
          : el('span', { class: 'chip chip-muted', text: 'роль подобрана автоматически' })
      ]),
      el('div', { class: 'fine', text: 'Настроение: ' + preset.title + '. ' + preset.desc }),
      el('div', { class: 'fine', style: { marginTop: '4px' }, text: roleInfo.hint })
    ]));

    host.appendChild(el('div', { class: 'btn-row', style: { marginTop: 0, marginLeft: 'auto' } }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { global.print(); }
      }, 'Распечатать'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { copyText(shareUrl(), 'Ссылка скопирована'); }
      }, 'Поделиться')
    ]));
  }

  function roleBadge(roleId) {
    var meta = D.roleMeta(roleId);
    return el('span', { class: 'badge badge-' + meta.tone, title: meta.hint, text: meta.label });
  }

  function buildSchemeCard(data, scheme, index) {
    var card = el('div', { class: 'scheme-card' });
    card.appendChild(el('h3', { text: scheme.label }));
    card.appendChild(el('p', { class: 'scheme-note', text: scheme.desc }));

    // Полоса 60/30/10 — правило распределения цвета в интерьере
    var wall = pickRole(scheme.colors, 'main');
    var extra = pickRole(scheme.colors, 'additional');
    var accent = pickRole(scheme.colors, 'accent');

    var bar = el('div', { class: 'scheme-bar' });
    [[wall, 60], [extra, 30], [accent, 10]].forEach(function (pair) {
      if (!pair[0]) return;
      var shown = displayHex(pair[0].hex);
      bar.appendChild(el('i', {
        style: { background: shown, flex: String(pair[1]), color: C.readableTextColor(shown) },
        title: D.roleMeta(pair[0].role).label + ' · ' + pair[0].hex
      }, pair[1] + '%'));
    });
    card.appendChild(bar);
    card.appendChild(el('div', { class: 'scheme-ratio' }, [
      el('span', { text: 'стены' }),
      el('span', { text: 'дополнительный' }),
      el('span', { text: 'акцент' })
    ]));

    var list = el('div', { class: 'scheme-colors' });
    var order = D.ROLE_ORDER;
    scheme.colors.slice().sort(function (a, b) {
      return order.indexOf(a.role) - order.indexOf(b.role);
    }).forEach(function (col) {
      list.appendChild(buildSchemeColorRow(col));
    });
    card.appendChild(list);

    var foot = el('div', { class: 'scheme-foot' });
    foot.appendChild(el('span', {
      class: 'chip chip-muted',
      title: 'Разброс светлоты между самым светлым и самым тёмным цветом палитры',
      text: scheme.contrast.levelLabel + ' · ΔL ' + fmt(scheme.contrast.spread, 0)
    }));
    foot.appendChild(buildRating(data, scheme, index));
    card.appendChild(foot);

    card.appendChild(el('div', { class: 'btn-row' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () { applyPaletteToVisualizer(scheme); }
      }, 'Примерить в комнате'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          D.store.savePalette({
            baseColor: data.baseColor,
            presetId: data.presetId,
            presetTitle: data.presetTitle,
            schemeId: scheme.schemeId,
            schemeLabel: scheme.label,
            colors: scheme.colors.map(function (c) {
              return { role: c.role, hex: c.hex, code: c.catalogColorCode, name: c.catalogColorName };
            })
          });
          renderSavedPalettes();
          toast('Палитра сохранена');
        }
      }, 'Сохранить'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: function () {
          var text = scheme.colors.map(function (c) {
            return D.roleMeta(c.role).label + ': ' + (c.catalogColorCode || '') + ' ' + (c.catalogColorName || '') + ' ' + c.hex;
          }).join('\n');
          copyText(text, 'Палитра скопирована');
        }
      }, 'Скопировать')
    ]));

    return card;
  }

  function pickRole(colors, role) {
    return colors.filter(function (c) { return c.role === role; })[0] || null;
  }

  function buildSchemeColorRow(col) {
    var shown = displayHex(col.hex);
    return el('button', {
      class: 'scheme-color-row',
      type: 'button',
      onclick: function () {
        var catalogColor = col.catalogColorCode ? D.getByCode(col.catalogColorCode) : null;
        if (catalogColor) {
          openColorCard(catalogColor, {
            sourceHex: col.hex,
            deltaE: col.deltaE,
            sourceLabel: D.roleMeta(col.role).label
          });
        } else {
          copyText(col.hex);
        }
      }
    }, [
      el('span', { class: 'scheme-color-sw', style: { background: shown } }),
      el('span', { class: 'scheme-color-info' }, [
        el('span', { style: { display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '2px' } }, [
          roleBadge(col.role),
          col.isBase ? el('span', { class: 'badge badge-base', text: 'ваш цвет' }) : null
        ]),
        el('span', {
          class: 'scheme-color-code',
          text: col.catalogColorCode
            ? col.catalogColorCode + ' · ' + col.catalogColorName
            : col.hex
        }),
        el('span', {
          class: 'scheme-color-lch',
          text: 'L ' + fmt(col.lch.l, 1) + ' · C ' + fmt(col.lch.c, 1) + ' · h ' + fmt(col.lch.h, 0) + '° · LRV ' + fmt(col.lrv, 0)
        })
      ]),
      col.deltaE != null && !col.isBase ? deltaBadge(col.deltaE) : el('span', { class: 'chip chip-muted', text: 'основа' })
    ]);
  }

  var STAR_PATH = 'M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.8 4.8 17.6l1-5.8L1.6 7.7l5.8-.8z';

  function buildRating(data, scheme, index) {
    var key = data.presetId + '::' + scheme.schemeId + '::' + data.baseColor;
    var saved = D.store.getRatings()[key] || 0;

    var wrap = el('div', { style: { display: 'flex', alignItems: 'center' } });
    wrap.appendChild(el('span', { class: 'rating-label', text: 'Оценка:' }));
    var stars = el('div', { class: 'rating-stars', role: 'group', 'aria-label': 'Оценить палитру' });

    for (var i = 1; i <= 5; i++) {
      (function (value) {
        var btn = el('button', {
          class: 'rating-star' + (value <= saved ? ' is-on' : ''),
          type: 'button',
          'aria-label': 'Оценка ' + value + ' из 5',
          onclick: function () {
            D.store.setRating(key, value);
            paint(value);
            D.logEvent('palette_rating', {
              presetId: data.presetId,
              schemeId: scheme.schemeId,
              schemeIndex: index,
              baseColor: data.baseColor,
              rating: value,
              colors: scheme.colors.map(function (c) {
                return { role: c.role, hex: c.hex, code: c.catalogColorCode };
              })
            });
            toast('Спасибо! Оценка учтена');
          },
          onmouseenter: function () { paint(value); }
        }, svgIcon(STAR_PATH, { viewBox: '0 0 20 20', fill: 'currentColor', stroke: 'none' }));
        stars.appendChild(btn);
      })(i);
    }

    stars.addEventListener('mouseleave', function () {
      paint(D.store.getRatings()[key] || 0);
    });

    function paint(value) {
      $$('.rating-star', stars).forEach(function (b, i) { b.classList.toggle('is-on', i + 1 <= value); });
    }

    wrap.appendChild(stars);
    return wrap;
  }

  /* ============================================================
   *  Сохранённые палитры и избранное
   * ============================================================ */

  function renderSavedPalettes() {
    var host = byId('savedPalettes');
    if (!host) return;
    clear(host);

    var saved = D.store.getSavedPalettes();
    if (!saved.length) {
      host.appendChild(el('p', { class: 'fine', text: 'Сохранённых палитр пока нет. Постройте палитру и нажмите «Сохранить» — она останется в этом браузере.' }));
      return;
    }

    saved.forEach(function (p) {
      host.appendChild(el('div', { class: 'scheme-card' }, [
        el('h3', { text: p.schemeLabel + ' · ' + p.presetTitle }),
        el('p', { class: 'scheme-note', text: 'Базовый цвет ' + p.baseColor }),
        el('div', { class: 'scheme-bar' }, p.colors.map(function (c) {
          return el('i', { style: { background: displayHex(c.hex), flex: '1' }, title: (c.code || '') + ' ' + c.hex });
        })),
        el('div', { class: 'btn-row' }, [
          el('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: function () {
              setActiveColor(p.baseColor, 'saved', 'сохранённая палитра');
              S.mood = p.presetId;
              renderMoodGrid(); renderHarmony(); renderInteriorSection(true);
            }
          }, 'Открыть'),
          el('button', {
            class: 'btn btn-quiet btn-sm',
            onclick: function () { D.store.removePalette(p.id); renderSavedPalettes(); toast('Палитра удалена'); }
          }, 'Удалить')
        ])
      ]));
    });
  }

  function renderFavorites() {
    var host = byId('favoritesGrid');
    if (!host) return;
    clear(host);

    var codes = D.store.getFavorites();
    var colors = codes.map(D.getByCode).filter(Boolean);

    if (!colors.length) {
      host.appendChild(el('p', { class: 'fine', text: 'Избранных цветов пока нет. Откройте карточку любого оттенка и нажмите «В избранное».' }));
      return;
    }
    colors.forEach(function (c) { host.appendChild(colorCardTile(c)); });
  }

  /* ============================================================
   *  Визуализатор комнаты
   * ============================================================ */

  var vizState = {
    wall: '#C8BBA6',
    accentWall: '#8C7B63',
    ceiling: '#F4F1EA',
    trim: '#EFEAE0',
    floor: '#9A7B55',
    view: 'living'
  };

  function initVisualizer() {
    var stage = byId('vizStage');
    if (!stage) return;

    var viewSeg = byId('vizViews');
    if (viewSeg) {
      viewSeg.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-view]');
        if (!btn) return;
        vizState.view = btn.dataset.view;
        $$('button', viewSeg).forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        drawRoom();
      });
    }
    drawRoom();
    renderVizAssign();
  }

  function applyPaletteToVisualizer(scheme) {
    var main = pickRole(scheme.colors, 'main');
    var additional = pickRole(scheme.colors, 'additional');
    var accent = pickRole(scheme.colors, 'accent');
    var ceiling = pickRole(scheme.colors, 'ceiling');
    var trim = pickRole(scheme.colors, 'trim');

    if (main) vizState.wall = main.hex;
    if (accent) vizState.accentWall = accent.hex;
    if (ceiling) vizState.ceiling = ceiling.hex;
    if (trim) vizState.trim = trim.hex;
    if (additional) vizState.floor = additional.hex;

    drawRoom();
    renderVizAssign();
    scrollToSection(byId('visualizer'));
    toast('Палитра примерена в комнате');
  }

  function renderVizAssign() {
    var host = byId('vizAssign');
    if (!host) return;
    clear(host);

    [
      ['wall', 'Основная стена'],
      ['accentWall', 'Акцентная стена'],
      ['ceiling', 'Потолок'],
      ['trim', 'Столярка и плинтус'],
      ['floor', 'Пол']
    ].forEach(function (pair) {
      var key = pair[0];
      var match = D.nearestOne(vizState[key], matchOpts());
      host.appendChild(el('div', { class: 'viz-assign-row' }, [
        el('span', { class: 'viz-sw', style: { background: displayHex(vizState[key]) } }),
        el('span', {}, [
          el('b', { text: pair[1] }),
          el('span', { text: match ? match.color.code + ' · ' + match.color.name : vizState[key] })
        ]),
        el('button', {
          class: 'btn btn-quiet btn-sm',
          title: 'Назначить текущий базовый цвет',
          onclick: function () {
            if (!S.activeHex) { toast('Сначала выберите базовый цвет'); return; }
            vizState[key] = S.activeHex;
            drawRoom();
            renderVizAssign();
          }
        }, 'Задать')
      ]));
    });
  }

  /**
   * Комната рисуется SVG-примитивами: никаких внешних картинок,
   * а значит инструмент работает в любом окружении и мгновенно
   * перекрашивается под выбранную палитру.
   */
  function drawRoom() {
    var stage = byId('vizStage');
    if (!stage) return;

    var wall = displayHex(vizState.wall);
    var accent = displayHex(vizState.accentWall);
    var ceiling = displayHex(vizState.ceiling);
    var trim = displayHex(vizState.trim);
    var floor = displayHex(vizState.floor);

    // затенение боковой стены — иначе комната читается плоской
    var wallShade = C.darken(vizState.wall, 7);
    var shaded = displayHex(wallShade);

    var furniture = C.readableTextColor(vizState.wall) === '#FFFFFF'
      ? C.lighten(vizState.wall, 26)
      : C.darken(vizState.wall, 22);
    var furn = displayHex(furniture);

    var svg = vizState.view === 'bedroom'
      ? bedroomSvg(wall, accent, ceiling, trim, floor, shaded, furn)
      : livingSvg(wall, accent, ceiling, trim, floor, shaded, furn);

    stage.innerHTML = svg;
  }

  function livingSvg(wall, accent, ceiling, trim, floor, shaded, furn) {
    return '' +
      '<svg viewBox="0 0 900 560" role="img" aria-label="Гостиная, окрашенная в выбранные цвета">' +
      '<rect width="900" height="560" fill="' + wall + '"/>' +
      '<polygon points="0,0 900,0 760,96 140,96" fill="' + ceiling + '"/>' +
      '<polygon points="0,560 900,560 760,430 140,430" fill="' + floor + '"/>' +
      '<polygon points="0,0 140,96 140,430 0,560" fill="' + shaded + '"/>' +
      '<rect x="140" y="96" width="620" height="334" fill="' + accent + '"/>' +
      '<rect x="140" y="418" width="620" height="14" fill="' + trim + '"/>' +
      '<polygon points="0,545 140,424 140,430 0,560" fill="' + trim + '"/>' +
      // окно
      '<rect x="196" y="150" width="176" height="196" rx="4" fill="#DCE6EC"/>' +
      '<rect x="196" y="150" width="176" height="196" rx="4" fill="none" stroke="' + trim + '" stroke-width="11"/>' +
      '<line x1="284" y1="150" x2="284" y2="346" stroke="' + trim + '" stroke-width="7"/>' +
      // диван
      '<rect x="430" y="300" width="270" height="86" rx="12" fill="' + furn + '"/>' +
      '<rect x="446" y="286" width="238" height="34" rx="9" fill="' + furn + '" opacity=".82"/>' +
      '<rect x="470" y="386" width="16" height="26" fill="' + trim + '"/>' +
      '<rect x="644" y="386" width="16" height="26" fill="' + trim + '"/>' +
      // картина и растение
      '<rect x="452" y="160" width="118" height="88" rx="3" fill="' + trim + '"/>' +
      '<rect x="462" y="170" width="98" height="68" fill="' + accent + '" opacity=".55"/>' +
      '<ellipse cx="742" cy="392" rx="30" ry="12" fill="' + floor + '" opacity=".5"/>' +
      '<rect x="726" y="352" width="32" height="42" rx="5" fill="' + trim + '"/>' +
      '<path d="M742 352c-22-8-30-34-22-54 20 4 32 26 22 54z" fill="#5C6B4F"/>' +
      '<path d="M742 352c20-12 24-38 14-56-19 8-26 30-14 56z" fill="#7B8F6C"/>' +
      '</svg>';
  }

  function bedroomSvg(wall, accent, ceiling, trim, floor, shaded, furn) {
    return '' +
      '<svg viewBox="0 0 900 560" role="img" aria-label="Спальня, окрашенная в выбранные цвета">' +
      '<rect width="900" height="560" fill="' + wall + '"/>' +
      '<polygon points="0,0 900,0 780,88 120,88" fill="' + ceiling + '"/>' +
      '<polygon points="0,560 900,560 780,440 120,440" fill="' + floor + '"/>' +
      '<polygon points="900,0 780,88 780,440 900,560" fill="' + shaded + '"/>' +
      '<rect x="120" y="88" width="660" height="352" fill="' + wall + '"/>' +
      '<rect x="300" y="130" width="300" height="180" rx="6" fill="' + accent + '"/>' +
      '<rect x="120" y="428" width="660" height="14" fill="' + trim + '"/>' +
      // кровать
      '<rect x="300" y="292" width="300" height="42" rx="8" fill="' + furn + '"/>' +
      '<rect x="278" y="330" width="344" height="88" rx="10" fill="' + trim + '"/>' +
      '<rect x="300" y="344" width="140" height="34" rx="8" fill="#FFFFFF" opacity=".85"/>' +
      '<rect x="460" y="344" width="140" height="34" rx="8" fill="#FFFFFF" opacity=".85"/>' +
      '<rect x="286" y="418" width="16" height="24" fill="' + furn + '"/>' +
      '<rect x="598" y="418" width="16" height="24" fill="' + furn + '"/>' +
      // тумбы и лампы
      '<rect x="204" y="352" width="62" height="66" rx="6" fill="' + furn + '"/>' +
      '<rect x="634" y="352" width="62" height="66" rx="6" fill="' + furn + '"/>' +
      '<path d="M219 352h32l-6-30h-20z" fill="' + ceiling + '"/>' +
      '<path d="M649 352h32l-6-30h-20z" fill="' + ceiling + '"/>' +
      '</svg>';
  }

  /* ============================================================
   *  Калькулятор расхода
   * ============================================================ */

  function initCalculator() {
    var form = byId('calcForm');
    if (!form) return;

    var surfaceSel = byId('calcSurface');
    if (surfaceSel && !surfaceSel.options.length) {
      D.SURFACES.forEach(function (s) {
        surfaceSel.appendChild(el('option', { value: s.id }, s.label));
      });
    }

    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    form.addEventListener('submit', function (e) { e.preventDefault(); recalc(); });
    recalc();

    function recalc() {
      var out = byId('calcOut');
      if (!out) return;

      var length = num('calcLength');
      var width = num('calcWidth');
      var height = num('calcHeight');
      var openings = num('calcOpenings');
      var coats = num('calcCoats') || 2;
      var includeCeiling = byId('calcCeiling') && byId('calcCeiling').checked;

      var surface = D.SURFACES.filter(function (s) {
        return s.id === (surfaceSel ? surfaceSel.value : 'plaster');
      })[0] || D.SURFACES[0];

      var wallArea = 2 * (length + width) * height;
      if (includeCeiling) wallArea += length * width;

      var result = C.paintCalculator({
        area: wallArea,
        openings: openings,
        coats: coats,
        consumption: surface.consumption,
        surfaceFactor: surface.factor
      });

      clear(out);
      if (!result) {
        out.appendChild(el('p', { class: 'fine', text: 'Введите размеры помещения — посчитаем объём краски.' }));
        return;
      }

      out.appendChild(el('div', { class: 'calc-big' }, [
        document.createTextNode(fmt(result.litresWithReserve, 1)),
        el('small', { text: ' л' })
      ]));
      out.appendChild(el('p', { class: 'fine', style: { margin: '4px 0 0' }, text: 'с запасом 10% на подрезку и подкрас' }));

      var rows = el('div', { class: 'calc-rows' });
      [
        ['Площадь под окраску', fmt(result.netArea, 1) + ' м²'],
        ['Слоёв', String(result.coats)],
        ['Расход поверхности', surface.consumption + ' м²/л'],
        ['Чистый расчёт', fmt(result.litres, 2) + ' л'],
        ['Банок по 9 л', String(result.cans.l9)],
        ['Банок по 2,7 л', String(result.cans.l2_7)]
      ].forEach(function (r) {
        rows.appendChild(el('div', { class: 'calc-row' }, [
          el('span', { text: r[0] }),
          el('b', { text: r[1] })
        ]));
      });
      out.appendChild(rows);

      if (S.activeHex) {
        var match = D.nearestOne(S.activeHex, matchOpts());
        if (match) {
          out.appendChild(el('p', { class: 'fine', style: { marginTop: '12px' } }, [
            document.createTextNode('Для цвета '),
            el('b', { text: match.color.code + ' · ' + match.color.name })
          ]));
        }
      }
    }

    function num(id) {
      var node = byId(id);
      if (!node) return 0;
      var v = parseFloat(String(node.value).replace(',', '.'));
      return isFinite(v) && v > 0 ? v : 0;
    }
  }

  /* ============================================================
   *  Сравнение цветов
   * ============================================================ */

  function addToCompare(hex, label) {
    var norm = C.normalizeHex(hex);
    if (!norm) return;
    if (S.compare.some(function (c) { return c.hex === norm; })) {
      toast('Этот цвет уже в сравнении');
      return;
    }
    if (S.compare.length >= 4) S.compare.shift();
    S.compare.push({ hex: norm, label: label || norm });
    renderCompareTray();
    toast('Добавлено в сравнение (' + S.compare.length + ' из 4)');
  }

  function renderCompareTray() {
    var tray = byId('compareTray');
    if (!tray) return;
    var items = byId('compareItems');
    var info = byId('compareInfo');

    tray.classList.toggle('is-visible', S.compare.length > 0);
    if (!S.compare.length) return;

    clear(items);
    S.compare.forEach(function (c, i) {
      items.appendChild(el('i', {
        style: { background: displayHex(c.hex) },
        title: c.label + ' — нажмите, чтобы убрать',
        onclick: function () { S.compare.splice(i, 1); renderCompareTray(); }
      }));
    });

    if (info) {
      if (S.compare.length < 2) {
        info.textContent = 'Добавьте ещё цвет для сравнения';
      } else {
        var a = C.hexToLab(S.compare[0].hex);
        var b = C.hexToLab(S.compare[S.compare.length - 1].hex);
        var de = C.deltaE(a, b, S.formula);
        info.textContent = 'ΔE между крайними: ' + fmt(de, 2) + ' — ' + C.deltaEQuality(de).label.toLowerCase();
      }
    }
  }

  /* ============================================================
   *  Экспорт
   * ============================================================ */

  function currentPaletteData() {
    var slots = S.slots.concat(S.pickedSlot ? [S.pickedSlot] : []);
    return {
      generatedAt: new Date().toISOString(),
      source: S.image ? (S.image.name || 'изображение') : (S.activeSource || 'ручной ввод'),
      deltaEFormula: C.DELTA_E_FORMULAS[S.formula].label,
      baseColor: S.activeHex,
      colors: slots.map(function (slot, i) {
        var matches = D.nearest(slot.lab, matchOpts({ limit: 3 }));
        return {
          index: i + 1,
          picked: !!slot.picked,
          hex: slot.hex,
          share: slot.share != null ? Math.round(slot.share * 1000) / 10 : null,
          lab: { L: C.round(slot.lab.l, 2), a: C.round(slot.lab.a, 2), b: C.round(slot.lab.b, 2) },
          lrv: C.lrv(slot.hex),
          matches: matches.map(function (m) {
            return { code: m.color.code, name: m.color.name, hex: m.color.hex, collection: m.color.collection, deltaE: C.round(m.deltaE, 2) };
          })
        };
      })
    };
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function exportPaletteJson() {
    var data = currentPaletteData();
    if (!data.colors.length) { toast('Сначала загрузите изображение'); return; }
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'archipaint-palette.json');
    toast('Файл палитры сохранён');
  }

  /** Карточка палитры картинкой — её удобно отправить клиенту в мессенджер. */
  function exportPalettePng() {
    var data = currentPaletteData();
    if (!data.colors.length) { toast('Сначала загрузите изображение'); return; }

    var W = 1200, rowH = 190, headH = 128, footH = 62;
    var H = headH + data.colors.length * rowH + footH;
    var cv = el('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    g.fillStyle = '#FAFAF7'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#20241F';
    g.font = '700 34px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Палитра ArchiPaint', 48, 62);
    g.fillStyle = '#7C8479';
    g.font = '400 18px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    g.fillText('Источник: ' + data.source + ' · ΔE по ' + data.deltaEFormula, 48, 94);

    data.colors.forEach(function (c, i) {
      var y = headH + i * rowH;
      g.fillStyle = c.hex;
      g.fillRect(48, y + 14, 220, rowH - 34);
      g.strokeStyle = 'rgba(32,36,31,.14)';
      g.strokeRect(48, y + 14, 220, rowH - 34);

      g.fillStyle = '#20241F';
      g.font = '700 24px ui-monospace, Consolas, monospace';
      g.fillText(c.hex, 300, y + 44);
      g.fillStyle = '#7C8479';
      g.font = '400 16px system-ui, sans-serif';
      g.fillText(
        (c.picked ? 'снято пипеткой' : (c.share != null ? c.share + '% кадра' : '')) +
        ' · LRV ' + c.lrv + ' · Lab ' + c.lab.L.toFixed(1) + ', ' + c.lab.a.toFixed(1) + ', ' + c.lab.b.toFixed(1),
        300, y + 70
      );

      c.matches.forEach(function (m, j) {
        var mx = 300 + j * 300;
        var my = y + 92;
        g.fillStyle = m.hex;
        g.fillRect(mx, my, 44, 44);
        g.strokeStyle = 'rgba(32,36,31,.14)';
        g.strokeRect(mx, my, 44, 44);
        g.fillStyle = '#20241F';
        g.font = '700 15px ui-monospace, Consolas, monospace';
        g.fillText(m.code, mx + 56, my + 18);
        g.fillStyle = '#4A5148';
        g.font = '400 14px system-ui, sans-serif';
        g.fillText(m.name.slice(0, 22), mx + 56, my + 36);
        g.fillStyle = '#7C8479';
        g.font = '400 13px ui-monospace, Consolas, monospace';
        g.fillText('ΔE ' + m.deltaE.toFixed(2), mx + 56, my + 54);
      });

      g.strokeStyle = '#E3E4DC';
      g.beginPath(); g.moveTo(48, y + rowH - 10); g.lineTo(W - 48, y + rowH - 10); g.stroke();
    });

    g.fillStyle = '#7C8479';
    g.font = '400 15px system-ui, sans-serif';
    g.fillText('Экранные цвета отличаются от реального выкраса. Закажите выкрас на бумаге для точного выбора.', 48, H - 26);

    cv.toBlob(function (blob) {
      if (!blob) { toast('Браузер не смог сохранить картинку'); return; }
      downloadBlob(blob, 'archipaint-palette.png');
      toast('Картинка палитры сохранена');
    }, 'image/png');
  }

  /* ============================================================
   *  Состояние в адресе страницы
   * ============================================================ */

  function shareUrl() {
    var params = [];
    if (S.activeHex) params.push('c=' + encodeURIComponent(S.activeHex.replace('#', '')));
    if (S.mood) params.push('m=' + S.mood);
    if (S.scheme) params.push('s=' + S.scheme);
    if (S.baseRole && S.baseRole !== 'auto') params.push('r=' + S.baseRole);
    if (S.formula !== 'de2000') params.push('f=' + S.formula);
    return location.origin + location.pathname + (params.length ? '#' + params.join('&') : '');
  }

  function updateUrlState() {
    if (!global.history || !history.replaceState) return;
    try { history.replaceState(null, '', shareUrl()); } catch (e) {}
  }

  function readUrlState() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    var params = {};
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) params[kv[0]] = decodeURIComponent(kv[1]);
    });

    if (params.f && C.DELTA_E_FORMULAS[params.f]) S.formula = params.f;
    if (params.m && D.PRESETS_BY_ID[params.m]) S.mood = params.m;
    if (params.s && C.HARMONY_SCHEMES.some(function (x) { return x.id === params.s; })) S.scheme = params.s;
    if (params.r && D.ROLES[params.r]) S.baseRole = params.r;

    if (params.c) {
      var hex = C.normalizeHex(params.c);
      if (hex) setActiveColor(hex, 'link', 'из ссылки');
    }

    var roleSel = byId('interiorRole');
    if (roleSel) roleSel.value = S.baseRole;
  }

  /* ============================================================
   *  Прокрутка и горячие клавиши
   * ============================================================ */

  function scrollToSection(node) {
    if (!node) return;
    var y = node.getBoundingClientRect().top + global.pageYOffset - 70;
    try {
      global.scrollTo({ top: y, behavior: 'smooth' });
    } catch (e) {
      global.scrollTo(0, y);
    }
  }

  function initShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeTopModal(); return; }
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'p' || e.key === 'з') {
        var btn = byId('btnPicker');
        if (btn) { btn.click(); e.preventDefault(); }
      } else if (e.key === 'k' || e.key === 'л') {
        var cat = byId('navCatalog');
        if (cat) { cat.click(); e.preventDefault(); }
      } else if (e.key === '/') {
        var std = byId('stdInput');
        if (std) { std.focus(); std.select(); e.preventDefault(); }
      }
    });
  }

  /* ============================================================
   *  Инициализация
   * ============================================================ */

  function podbor(options) {
    if (initialized) {
      // повторный вызов — просто перерисовываем то, что зависит от данных
      renderResults(); renderHarmony(); renderInteriorSection();
      return;
    }
    initialized = true;

    if (options) D.configure(options);

    readUrlState();

    initUpload();
    initCoordSearch();
    initCatalogModal();
    initStandardSearch();
    initInterior();
    initVisualizer();
    initCalculator();
    initShortcuts();

    wireModal('cardBack', ['cardX']);

    renderCollections();
    renderFavorites();
    renderSavedPalettes();
    renderCompareTray();
    renderResults();
    renderHarmony();
    renderInteriorSection();

    // перерисовываем круг при смене размеров окна
    global.addEventListener('resize', debounce(function () {
      if (S.activeHex) drawWheel();
    }, 180));

    // переход по ссылке вида ...#c=C15B33&m=luxury_dark на уже открытой
    // странице меняет только фрагмент — документ не перезагружается
    global.addEventListener('hashchange', function () {
      var before = S.activeHex + '|' + S.mood + '|' + S.scheme + '|' + S.baseRole;
      readUrlState();
      if (before === S.activeHex + '|' + S.mood + '|' + S.scheme + '|' + S.baseRole) return;
      renderMoodGrid();
      renderResults();
      renderHarmony();
      renderInteriorSection();
    });
  }

  global.podbor = podbor;
  global.ArchiPaintUI = {
    state: S,
    setActiveColor: function (hex, label) {
      setActiveColor(hex, 'api', label);
      renderHarmony(); renderInteriorSection(); updateUrlState();
    },
    openColorCard: openColorCard,
    refresh: function () { renderResults(); renderHarmony(); renderInteriorSection(); },
    toast: toast
  };
})(typeof window !== 'undefined' ? window : globalThis);
