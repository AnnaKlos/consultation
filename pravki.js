/*!
 * pravki.js — «режим правок» для сайта.
 * Подключение: <script src="pravki.js" defer></script> перед </body>.
 * Включение: открыть сайт с #pravki в конце адреса.
 * Обычные посетители ничего не видят, на сервере ничего не хранится.
 */
(function () {
  'use strict';

  var CDN = {
    fabric: 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
    zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    // форк html2canvas, понимающий современные CSS-цвета (color(), oklch и т.п.)
    h2c: 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.4/dist/html2canvas-pro.min.js',
  };

  function wanted() {
    if (/(^|[#&])pravki\b/i.test(location.hash)) return true;
    try { return sessionStorage.getItem('pravki-on') === '1'; } catch (e) { return false; }
  }
  var started = false;
  function boot() {
    if (started || !wanted()) return;
    started = true;
    try { sessionStorage.setItem('pravki-on', '1'); } catch (e) {}
    var go = function () { setTimeout(start, 250); };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }

  /* ===================== утилиты ===================== */
  var doc = document;
  var SITE = (location.origin === 'null' ? 'file://' : location.origin) +
    location.pathname.replace(/index\.html?$/i, '');
  var FORMAT = /^(EM|STRONG|B|I|U|S|SMALL|MARK|SUP|SUB|BR|ABBR|CODE|TIME|Q)$/;
  var SKIP_UP = /^(BODY|HTML|MAIN)$/;
  var isTouch = matchMedia('(pointer: coarse)').matches;

  function $(sel, root) { return (root || doc).querySelector(sel); }
  function uid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function norm(s) {
    return String(s || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ')
      .split('\n').map(function (l) { return l.trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function isSrOnly(n) {
    if (n.nodeType !== 1) return false;
    var st = n.getAttribute('style') || '';
    return /\b(sr-only|visually-hidden|screen-reader)/i.test(n.className || '') || /clip/.test(st) && /1px/.test(st);
  }
  // Текст элемента так, как он записан в HTML (без служебных копий для читалок)
  function cleanText(el) {
    var c = el.cloneNode(true);
    var all = c.querySelectorAll('*');
    for (var i = all.length - 1; i >= 0; i--) {
      var n = all[i];
      if (isSrOnly(n) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.tagName)) n.remove();
      else if (n.tagName === 'BR') n.replaceWith('\n');
    }
    return norm(c.textContent);
  }
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== doc.body && el !== doc.documentElement) {
      if (el.id && doc.querySelectorAll('#' + CSS.escape(el.id)).length === 1) {
        parts.unshift('#' + CSS.escape(el.id));
        break;
      }
      var tag = el.tagName.toLowerCase();
      var p = el.parentElement;
      if (p) {
        var sib = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (sib.length > 1) tag += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      }
      parts.unshift(tag);
      el = p;
    }
    return parts.join(' > ');
  }
  function byPath(path) { try { return path ? doc.querySelector(path) : null; } catch (e) { return null; } }
  function blockName(el) {
    if (!el) return '';
    if (el.tagName === 'PRAVKI-BLOCK') {
      var it = findItem(el.getAttribute('data-id'));
      return 'новый раздел' + (it && it.title ? ' «' + cut(it.title, 30) + '»' : '');
    }
    var n = el.getAttribute('data-chapter') || el.getAttribute('aria-label');
    if (!n) { var h = el.querySelector('h1,h2,h3'); if (h) n = cleanText(h); }
    if (!n && el.id) n = el.id;
    if (!n) n = ({ HEADER: 'Шапка', FOOTER: 'Подвал', NAV: 'Меню' })[el.tagName] || el.tagName.toLowerCase();
    return cut(n, 40);
  }
  function sectionOf(el) {
    var s = el.closest('section,header,footer,nav,article,pravki-block');
    return s ? blockName(s) + (s.id ? ' (#' + s.id + ')' : '') : '—';
  }
  function kindLabel(el) {
    var t = el.tagName;
    if (/^H[1-6]$/.test(t)) return 'Заголовок';
    if (t === 'P') return 'Абзац';
    if (t === 'A' || t === 'BUTTON') return 'Кнопка / ссылка';
    if (t === 'LI') return 'Пункт списка';
    if (t === 'IMG' || t === 'PICTURE' || t === 'FIGURE') return 'Фото';
    if (t === 'SECTION') return 'Раздел';
    if (t === 'HEADER' || t === 'NAV') return 'Шапка';
    if (t === 'FOOTER') return 'Подвал';
    if (t === 'SPAN') return 'Текст';
    return 'Блок';
  }
  function imgOf(el) {
    if (el.tagName === 'IMG') return el;
    var imgs = el.querySelectorAll('img');
    if (imgs.length === 1 && !cleanText(el)) return imgs[0];
    return null;
  }
  function isTextLeaf(el) {
    if (/^(SECTION|MAIN|HEADER|FOOTER|NAV|ARTICLE|UL|OL|FORM|TABLE|PRAVKI-BLOCK)$/.test(el.tagName)) return false;
    if (!cleanText(el) || cleanText(el).length > 3000) return false;
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (/^(IMG|SVG|VIDEO|PICTURE|IFRAME|INPUT|TEXTAREA|SELECT)$/i.test(n.tagName)) return false;
      if (isSrOnly(n) || n.closest('[aria-hidden="true"]')) continue;
      var d = getComputedStyle(n).display;
      if (d !== 'inline' && d !== 'inline-block' && d !== 'contents' && d !== 'none' && n.tagName !== 'BR') return false;
    }
    return true;
  }
  function kindOf(el) {
    if (imgOf(el)) return 'image';
    return isTextLeaf(el) ? 'text' : 'block';
  }
  function fileExt(f) {
    var m = /\.([a-z0-9]{2,5})$/i.exec(f.name || '');
    if (m) return m[1].toLowerCase();
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' })[f.blob.type] || 'bin';
  }
  var loaded = {};
  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise(function (res, rej) {
      var s = doc.createElement('script');
      s.src = url; s.onload = res;
      s.onerror = function () { delete loaded[url]; rej(new Error('Не удалось загрузить ' + url)); };
      doc.head.appendChild(s);
    });
    return loaded[url];
  }
  // чтение файла с ограничением по времени (на случай, если браузер «повис» на файле)
  function readBuf(blob, ms) {
    return Promise.race([
      blob.arrayBuffer(),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms || 8000); }),
    ]);
  }
  function blobFromDataURL(u) { return fetch(u).then(function (r) { return r.blob(); }); }
  function readAsDataURL(blob) {
    return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); });
  }
  function pickFiles(multiple, accept) {
    return new Promise(function (res) {
      var inp = doc.createElement('input');
      inp.type = 'file'; inp.accept = accept || 'image/*'; inp.multiple = !!multiple;
      inp.style.cssText = 'position:fixed;left:-9999px';
      inp.setAttribute('data-pv-own', '');
      inp.onchange = function () {
        var list = Array.prototype.slice.call(inp.files || []);
        // сразу копируем в память: на телефонах доступ к выбранному файлу может пропасть
        Promise.all(list.map(function (f) {
          return readBuf(f, 8000).then(function (buf) {
            var b = new Blob([buf], { type: f.type });
            b.name = f.name;
            return b;
          }).catch(function () { return f; }); // не вышло скопировать — оставляем оригинал
        })).then(function (arr) {
          inp.remove();
          res(arr);
        });
      };
      doc.body.appendChild(inp);
      inp.click();
    });
  }
  // уменьшить картинку для эскиза (чтобы файл правок не раздувался)
  function downscale(blob, max) {
    return readAsDataURL(blob).then(function (url) {
      return new Promise(function (res) {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, max / Math.max(im.width, im.height));
          var c = doc.createElement('canvas');
          c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.85));
        };
        im.onerror = function () { res(url); };
        im.src = url;
      });
    });
  }

  /* ===================== хранилище черновика ===================== */
  var idbOk = true;
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('pravki', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('drafts'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction('drafts').objectStore('drafts').get(key);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function idbSet(key, val) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(val, key);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  var state = { v: 1, site: SITE, items: [] };
  var files = new Map(); // id -> {blob, name}
  var saveTimer = 0;
  function save(now) {
    clearTimeout(saveTimer);
    var run = function () {
      if (!idbOk) return;
      var arr = [];
      files.forEach(function (f, id) { if (usedFile(id)) arr.push({ id: id, blob: f.blob, name: f.name }); });
      idbSet(SITE, { state: state, files: arr }).catch(function () {
        idbOk = false;
        toast('⚠️ Черновик не сохраняется на этом устройстве. Скачайте файл до закрытия страницы.', 6000);
      });
    };
    if (now) run(); else saveTimer = setTimeout(run, 300);
    renderCount();
  }
  function usedFile(id) {
    return state.items.some(function (it) {
      return it.file === id || (it.files || []).indexOf(id) >= 0 || (it.sketch && it.sketch.png === id);
    });
  }
  function addFile(blob, name) { var id = uid(); files.set(id, { blob: blob, name: name || '' }); return id; }
  function fileURL(id) {
    var f = files.get(id);
    if (!f) return '';
    if (!f.url) f.url = URL.createObjectURL(f.blob);
    return f.url;
  }
  function findItem(id) { return state.items.filter(function (i) { return i.id === id; })[0]; }
  function target(el) {
    var t = { path: cssPath(el), where: sectionOf(el), kind: kindLabel(el) };
    var im = imgOf(el);
    if (im) t.src = im.getAttribute('src') || im.currentSrc;
    else t.text = cut(cleanText(el), 400);
    return t;
  }

  /* ===================== применение правок к странице ===================== */
  var orig = new Map(); // el -> {html, ...}
  function remember(el) {
    if (orig.has(el)) return;
    var o = { html: el.innerHTML };
    if (el.tagName === 'IMG') {
      o.src = el.getAttribute('src'); o.srcset = el.getAttribute('srcset');
      var pic = el.parentElement && el.parentElement.tagName === 'PICTURE' ? el.parentElement : null;
      o.sources = pic ? Array.prototype.map.call(pic.querySelectorAll('source'), function (s) { return [s, s.getAttribute('srcset')]; }) : [];
    }
    orig.set(el, o);
  }
  function restore(el) {
    var o = orig.get(el);
    if (!o) return;
    if (el.tagName === 'IMG') {
      if (o.src != null) el.setAttribute('src', o.src);
      if (o.srcset != null) el.setAttribute('srcset', o.srcset);
      o.sources.forEach(function (p) { if (p[1] != null) p[0].setAttribute('srcset', p[1]); });
    } else el.innerHTML = o.html;
    orig.delete(el);
  }
  // убрать разбиение текста на слова (эффекты анимации), сохранив <em> и т.п.
  function flatten(el) {
    Array.prototype.slice.call(el.querySelectorAll('*')).forEach(function (n) {
      if (!n.isConnected) return;
      if (isSrOnly(n)) n.remove();
      else if (n.getAttribute('aria-hidden') === 'true' && n.textContent.trim()) n.replaceWith(doc.createTextNode(n.textContent));
    });
    el.normalize();
  }
  function setPhoto(img, url) {
    remember(img);
    img.removeAttribute('srcset');
    var pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
    if (pic) Array.prototype.forEach.call(pic.querySelectorAll('source'), function (s) { s.removeAttribute('srcset'); });
    img.src = url;
  }
  function applyItem(it) {
    it.lost = false;
    if (it.type === 'section') return insertBlock(it);
    if (it.type === 'general') return;
    var el = byPath(it.t.path);
    if (!el) { it.lost = true; return; }
    if (it.type === 'text') {
      var cur = cleanText(el);
      if (cur !== it.was && cur !== it.now) { it.lost = true; return; }
      remember(el); flatten(el); el.innerText = it.now;
    } else if (it.type === 'remove') {
      el.setAttribute('data-pv-hide', '');
    } else if (it.type === 'photo') {
      var im = imgOf(el);
      if (im && files.get(it.file)) setPhoto(im, fileURL(it.file)); else it.lost = true;
    }
  }
  function unapplyItem(it) {
    if (it.type === 'section') { var b = $('pravki-block[data-id="' + it.id + '"]'); if (b) b.remove(); return; }
    if (!it.t) return;
    var el = byPath(it.t.path);
    if (!el) return;
    if (it.type === 'text') restore(el);
    else if (it.type === 'remove') el.removeAttribute('data-pv-hide');
    else if (it.type === 'photo') { var im = imgOf(el); if (im) restore(im); }
  }
  function insertBlock(it) {
    var b = $('pravki-block[data-id="' + it.id + '"]');
    if (!b) {
      b = doc.createElement('pravki-block');
      b.setAttribute('data-id', it.id);
      var ref = it.pos.refNew ? $('pravki-block[data-id="' + it.pos.refNew + '"]') : byPath(it.pos.ref);
      if (ref) {
        if (it.pos.where === 'after') ref.after(b); else ref.before(b);
      } else {
        it.lost = !!(it.pos.ref || it.pos.refNew);
        (doc.querySelector('main') || doc.body).appendChild(b);
      }
    }
    var img = it.sketch && files.get(it.sketch.png) ? '<img src="' + fileURL(it.sketch.png) + '" alt="Эскиз">' : '';
    b.innerHTML =
      '<div class="pvb-in"><div class="pvb-tag">＋ Новый раздел (эскиз)</div>' +
      (it.title ? '<div class="pvb-title">' + esc(it.title) + '</div>' : '') +
      (it.body ? '<div class="pvb-body">' + esc(it.body) + '</div>' : '') + img +
      (it.comment ? '<div class="pvb-note">' + esc(it.comment) + '</div>' : '') + '</div>';
  }

  /* ===================== стили в самой странице ===================== */
  var PAGE_CSS =
    'html.pv-on [data-reveal],html.pv-on [data-aos],html.pv-on .reveal,html.pv-on .h-in,' +
    'html.pv-on [data-split] .word__inner{opacity:1!important;transform:none!important;animation:none!important;transition:none!important}' +
    'html.pv-on [data-pv-hide]{display:none!important}' +
    'html.pv-on body{padding-bottom:var(--pv-pad,0px)!important}' +
    'html.pv-on [data-pv-edit]{outline:2px dashed #2563eb!important;outline-offset:4px!important;cursor:text!important;-webkit-user-select:text!important;user-select:text!important}' +
    'pravki-block{display:block;padding:32px 16px;background:#f6f7fb;color:#1f2937;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
    'pravki-block .pvb-in{max-width:960px;margin:0 auto;border:2px dashed #94a3b8;border-radius:14px;padding:20px;background:#fff}' +
    'pravki-block .pvb-tag{font-size:13px;color:#64748b;margin-bottom:8px}' +
    'pravki-block .pvb-title{font-size:24px;font-weight:700;margin-bottom:8px}' +
    'pravki-block .pvb-body{white-space:pre-wrap;margin-bottom:12px}' +
    'pravki-block img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid #e2e8f0}' +
    'pravki-block .pvb-note{margin-top:10px;font-size:14px;color:#475569;white-space:pre-wrap}';

  /* ===================== интерфейс (Shadow DOM) ===================== */
  var UI_CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.panel{position:fixed;left:0;right:0;bottom:var(--kb,0px);background:#fff;border-top:1px solid #e2e8f0;box-shadow:0 -6px 24px rgba(15,23,42,.12);padding:8px 10px calc(8px + env(safe-area-inset-bottom));color:#0f172a;z-index:5}',
    '.hint{font-size:13px;color:#475569;text-align:center;margin:0 0 6px}',
    '.row{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}',
    'button{font:inherit;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:10px;padding:9px 12px;font-size:15px;line-height:1.2;min-height:44px;-webkit-tap-highlight-color:transparent}',
    'button:hover{background:#f1f5f9}',
    'button.pri{background:#2563eb;border-color:#2563eb;color:#fff}',
    'button.pri:hover{background:#1d4ed8}',
    'button.danger{color:#b91c1c}',
    'button.on{background:#dbeafe;border-color:#2563eb}',
    'button:disabled{opacity:.45;cursor:default}',
    '.panel button{flex:1 1 auto;max-width:180px;padding:9px 8px}',
    '@media (max-width:520px){.panel button{font-size:14px;padding:8px 4px}.panel .row{flex-wrap:nowrap}}',
    '.sel,.hov{position:fixed;pointer-events:none;border-radius:6px;z-index:1}',
    '.sel{outline:3px solid #2563eb;outline-offset:2px;box-shadow:0 0 0 9999px rgba(15,23,42,.18)}',
    '.hov{outline:2px dashed #60a5fa;outline-offset:2px}',
    '.sheet-wrap{position:fixed;inset:0;z-index:10;display:flex;align-items:flex-end;justify-content:center;pointer-events:none}',
    '.sheet-wrap.dim{background:rgba(15,23,42,.45);pointer-events:auto;align-items:center}',
    '.sheet{pointer-events:auto;background:#fff;color:#0f172a;width:100%;max-width:560px;border-radius:16px 16px 0 0;box-shadow:0 -10px 40px rgba(15,23,42,.25);padding:14px 14px calc(14px + env(safe-area-inset-bottom));margin-bottom:var(--kb,0px);max-height:88vh;overflow:auto}',
    '.dim .sheet{border-radius:16px;margin:12px}',
    '@media (max-width:600px){.dim{align-items:flex-end!important}.dim .sheet{margin:0;border-radius:16px 16px 0 0}}',
    '.sheet h3{margin:0 0 4px;font-size:18px}',
    '.sub{font-size:14px;color:#475569;margin:0 0 12px;white-space:pre-wrap;word-break:break-word}',
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
    '.grid button{text-align:left}',
    '.grid .wide{grid-column:1/-1}',
    '.foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}',
    '.sheet > .foot{position:sticky;bottom:calc(-14px - env(safe-area-inset-bottom));background:#fff;padding:8px 0 4px;margin-bottom:-4px}',
    'textarea,input[type=text]{width:100%;font:inherit;font-size:16px;border:1px solid #cbd5e1;border-radius:10px;padding:10px;color:#0f172a;background:#fff}',
    'textarea{min-height:110px;resize:vertical}',
    'label{display:block;font-size:13px;color:#475569;margin:10px 0 4px}',
    '.thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}',
    '.thumb{position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0}',
    '.thumb img{width:100%;height:100%;object-fit:cover}',
    '.thumb b{position:absolute;top:2px;right:2px;background:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:13px;cursor:pointer}',
    '.list{display:flex;flex-direction:column;gap:8px}',
    '.it{border:1px solid #e2e8f0;border-radius:12px;padding:10px}',
    '.it .h{font-weight:600;font-size:15px}',
    '.it .d{font-size:14px;color:#475569;margin:4px 0 8px;white-space:pre-wrap;word-break:break-word}',
    '.it .lost{color:#b45309;font-size:13px;margin-bottom:6px}',
    '.it .b{display:flex;gap:6px;flex-wrap:wrap}',
    '.it .b button{min-height:36px;padding:6px 10px;font-size:14px}',
    '.steps{margin:0 0 4px;padding-left:20px;font-size:15px;line-height:1.5}',
    '.steps li{margin-bottom:6px}',
    '.toast{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 16px;border-radius:10px;font-size:14px;z-index:30;max-width:92vw;box-shadow:0 8px 24px rgba(0,0,0,.25)}',
    '.edit-bar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--kb,0px) + 12px);display:flex;gap:8px;background:#fff;padding:8px;border-radius:14px;box-shadow:0 8px 30px rgba(15,23,42,.3);z-index:12}',
    '.layer{position:absolute;left:0;top:0;width:100%;height:0;z-index:2}',
    '.gap{position:absolute;left:50%;transform:translate(-50%,-50%);background:#2563eb;color:#fff;border:3px solid #fff;box-shadow:0 4px 18px rgba(37,99,235,.5);border-radius:999px;padding:10px 18px;font-weight:600;white-space:nowrap}',
    '.gap:hover{background:#1d4ed8}',
    '.topbar{position:fixed;top:0;left:0;right:0;background:#1e3a8a;color:#fff;padding:10px 12px;display:flex;gap:10px;align-items:center;justify-content:center;font-size:15px;z-index:6;flex-wrap:wrap}',
    '.topbar button{min-height:36px;padding:6px 12px}',
    /* эскиз */
    '.sk{position:fixed;inset:0;background:#e2e8f0;z-index:20;display:flex;flex-direction:column;color:#0f172a}',
    '.sk-head{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border-bottom:1px solid #cbd5e1}',
    '.sk-head h3{margin:0;font-size:16px;flex:1}',
    '.sk-tools{display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#fff;border-bottom:1px solid #cbd5e1;align-items:center}',
    '.sk-tools button{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:64px;padding:6px 8px;font-size:12px}',
    '.sk-tools button span{font-size:20px;line-height:1}',
    '.sk-colors{display:flex;gap:8px;align-items:center;margin-left:6px}',
    '.sk-colors small{font-size:12px;color:#475569}',
    '@media (max-width:600px){.sk-tools{gap:4px;padding:6px}.sk-tools button{flex:1 0 calc(25% - 4px);min-width:0;min-height:46px;padding:4px 2px;font-size:11px}.sk-tools button span{font-size:17px}.sk-colors{flex:1 0 100%;justify-content:center;margin:2px 0 0}.sk-head h3{font-size:15px}}',
    '.sw{width:30px;height:30px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #94a3b8;flex:0 0 auto;cursor:pointer}',
    '.sw.on{box-shadow:0 0 0 3px #0f172a}',
    '.sk-body{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}',
    '.sk-stage{display:flex;justify-content:center;padding:10px}',
    '.sk-stage .canvas-container{box-shadow:0 4px 20px rgba(15,23,42,.2);background:#fff;touch-action:none}',
    '.sk-fields{max-width:760px;margin:0 auto;padding:0 12px 16px}',
    '.sk-foot{display:flex;gap:8px;justify-content:flex-end;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #cbd5e1}',
    '.loading{padding:40px;text-align:center;color:#475569}',
  ].join('\n');

  var host, root, panel, selBox, hovBox, layer, countBtn;
  var selection = null;
  var editing = null;
  var insertMode = false;

  function h(html) {
    var t = doc.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function toast(msg, ms) {
    var t = h('<div class="toast"></div>');
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }

  // универсальное окно; buttons: [{text, cls, onClick -> false чтобы не закрывать}]
  var openSheets = [];
  function sheet(opts) {
    var wrap = h('<div class="sheet-wrap' + (opts.dim === false ? '' : ' dim') + '"><div class="sheet"></div></div>');
    var s = wrap.firstChild;
    if (opts.title) s.appendChild(h('<h3></h3>')).textContent = opts.title;
    if (opts.sub) s.appendChild(h('<p class="sub"></p>')).textContent = opts.sub;
    if (opts.body) s.appendChild(opts.body);
    var close = function () {
      wrap.remove();
      openSheets = openSheets.filter(function (x) { return x !== close; });
      if (opts.onClose) opts.onClose();
    };
    if (opts.buttons) {
      var f = h('<div class="' + (opts.grid ? 'grid' : 'foot') + '"></div>');
      opts.buttons.forEach(function (b) {
        if (!b) return;
        var btn = h('<button></button>');
        btn.textContent = b.text;
        if (b.cls) btn.className = b.cls;
        btn.onclick = function () {
          var r = b.onClick ? b.onClick(btn) : undefined;
          if (r !== false) close();
        };
        f.appendChild(btn);
      });
      s.appendChild(f);
    }
    wrap.addEventListener('click', function (e) { if (e.target === wrap && opts.dim !== false) close(); });
    root.appendChild(wrap);
    openSheets.push(close);
    return { close: close, el: s };
  }
  function closeSheets() { openSheets.slice().forEach(function (c) { c(); }); }
  function confirmBox(title, sub, okText, onOk, danger) {
    sheet({ title: title, sub: sub, buttons: [
      { text: 'Отмена' },
      { text: okText, cls: danger ? 'pri danger' : 'pri', onClick: onOk },
    ] });
  }

  function buildUI() {
    var st = doc.createElement('style');
    st.textContent = PAGE_CSS;
    doc.head.appendChild(st);
    doc.documentElement.classList.add('pv-on');
    // показать всё, что появляется при прокрутке
    doc.querySelectorAll('[data-reveal],[data-split],[data-aos]').forEach(function (e) { e.classList.add('is-in', 'aos-animate'); });
    doc.querySelectorAll('.fill-word').forEach(function (e) { e.classList.add('is-lit'); });

    host = doc.createElement('div');
    host.id = 'pravki-root';
    host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483000';
    doc.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.appendChild(h('<style>' + UI_CSS + '</style>'));
    layer = root.appendChild(h('<div class="layer"></div>'));
    selBox = root.appendChild(h('<div class="sel" hidden></div>'));
    hovBox = root.appendChild(h('<div class="hov" hidden></div>'));

    panel = h(
      '<div class="panel"><p class="hint">✋ Нажмите на любой текст, фото или блок, чтобы изменить</p><div class="row">' +
      '<button data-a="section">＋ Раздел</button>' +
      '<button data-a="general">💬 Пожелание</button>' +
      '<button data-a="list">📋 Правки</button>' +
      '<button data-a="done" class="pri">⬇ Готово</button>' +
      '<button data-a="more" aria-label="Ещё">⋯</button>' +
      '</div></div>'
    );
    root.appendChild(panel);
    countBtn = panel.querySelector('[data-a="list"]');
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      finishEdit();
      clearSelection();
      var a = b.getAttribute('data-a');
      if (a === 'section') startInsert();
      else if (a === 'general') commentDialog(null);
      else if (a === 'list') showList();
      else if (a === 'done') showDone();
      else if (a === 'more') showMore();
    });

    var pad = function () { doc.documentElement.style.setProperty('--pv-pad', panel.offsetHeight + 'px'); };
    pad();
    window.addEventListener('resize', pad);
    if (window.visualViewport) {
      var kb = function () {
        var vv = window.visualViewport;
        var off = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.host.style.setProperty('--kb', off + 'px');
      };
      visualViewport.addEventListener('resize', kb);
      visualViewport.addEventListener('scroll', kb);
    }

    window.addEventListener('click', onPageClick, true);
    window.addEventListener('submit', function (e) { e.preventDefault(); }, true);
    if (!isTouch) doc.addEventListener('mousemove', onHover, { passive: true });
    window.addEventListener('scroll', positionBoxes, { passive: true });
    window.addEventListener('resize', positionBoxes);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (editing) finishEdit(true); else if (insertMode) stopInsert(); else { closeSheets(); clearSelection(); } }
    });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) save(true); });
  }
  function renderCount() {
    if (countBtn) countBtn.textContent = '📋 Правки' + (state.items.length ? ' · ' + state.items.length : '');
  }

  /* ===================== выбор элемента ===================== */
  function isOurs(e) { return e.composedPath && e.composedPath().indexOf(host) >= 0; }
  function isDecor(n) {
    return n.getAttribute('aria-hidden') === 'true' && !n.textContent.trim() && !n.querySelector('img,svg');
  }
  function refine(el) {
    // выйти из разбитого на слова текста
    var ah;
    while ((ah = el.closest('[aria-hidden="true"]')) && ah.textContent.trim() && ah.parentElement) el = ah.parentElement;
    while (FORMAT.test(el.tagName) && el.parentElement) el = el.parentElement;
    if (el.tagName === 'SOURCE' || el.tagName === 'PICTURE') el = (el.closest('picture') || el).querySelector('img') || el;
    var ab = el.closest('a,button');
    if (ab && !imgOf(ab)) el = ab;
    var pb = el.closest('pravki-block');
    if (pb) el = pb;
    if (SKIP_UP.test(el.tagName)) return null;
    return el;
  }
  function pickAt(x, y) {
    var list = doc.elementsFromPoint(x, y);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === host || n === doc.documentElement || n === doc.body) continue;
      if (isDecor(n)) continue;
      return refine(n);
    }
    return null;
  }
  function onHover(e) {
    if (selection || editing || insertMode || openSheets.length) { hovBox.hidden = true; return; }
    if (isOurs(e)) { hovBox.hidden = true; return; }
    var el = pickAt(e.clientX, e.clientY);
    hovBox._el = el;
    placeBox(hovBox, el);
  }
  function placeBox(box, el) {
    if (!el || !el.isConnected) { box.hidden = true; return; }
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) { box.hidden = true; return; }
    box.hidden = false;
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
  }
  function positionBoxes() {
    if (selection) placeBox(selBox, selection);
    if (hovBox._el && !hovBox.hidden) placeBox(hovBox, hovBox._el);
    if (insertMode) drawGaps();
  }
  function clearSelection() { selection = null; selBox.hidden = true; }

  function onPageClick(e) {
    if (isOurs(e)) return;
    // служебные клики редактора (выбор файла, скачивание) пропускаем
    if (e.target && e.target.hasAttribute && e.target.hasAttribute('data-pv-own')) return;
    if (editing && editing.el.contains(e.target)) { e.preventDefault(); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    if (editing) { finishEdit(); return; }
    if (insertMode) return;
    if (openSheets.length) { closeSheets(); clearSelection(); return; }
    var el = pickAt(e.clientX, e.clientY);
    if (el) selectEl(el);
  }

  function selectEl(el) {
    closeSheets();
    selection = el;
    hovBox.hidden = true;
    placeBox(selBox, el);
    if (el.tagName === 'PRAVKI-BLOCK') {
      var it = findItem(el.getAttribute('data-id'));
      sheet({ dim: false, title: 'Новый раздел (ваш эскиз)', grid: true, onClose: clearSelection, buttons: [
        { text: '🎨 Изменить раздел', onClick: function () { sectionEditor(it); } },
        { text: '🗑 Удалить раздел', cls: 'danger', onClick: function () { removeItem(it); } },
        { text: '✕ Закрыть', cls: 'wide' },
      ] });
      return;
    }
    var k = kindOf(el);
    var text = k === 'image' ? '' : cut(cleanText(el), 120);
    var count = state.items.filter(function (i) { return i.t && i.t.path === cssPath(el); }).length;
    var parent = el.parentElement;
    var canUp = parent && !SKIP_UP.test(parent.tagName);
    var btns = [];
    if (k === 'text') btns.push({ text: '✏️ Изменить текст', cls: 'pri', onClick: function () { startEdit(el); } });
    if (k === 'image') btns.push({ text: '🖼 Заменить фото', cls: 'pri', onClick: function () { replacePhoto(el); } });
    btns.push({ text: '💬 Комментарий', onClick: function () { commentDialog(el); } });
    if (k !== 'text' || el.getBoundingClientRect().height > 160) btns.push({ text: '🎨 Нарисовать поверх', onClick: function () { drawOver(el); } });
    btns.push({ text: '🗑 Убрать', cls: 'danger', onClick: function () { removeEl(el); } });
    if (canUp) btns.push({ text: '⬆ Выбрать крупнее', onClick: function () { selectEl(parent); return false; } });
    btns.push({ text: '✕ Закрыть' });
    if (btns.length % 2) btns[btns.length - 1].cls = 'wide';
    sheet({
      dim: false, grid: true, onClose: function () { if (selection === el) clearSelection(); },
      title: kindLabel(el) + ' · ' + sectionOf(el).replace(/ \(#.*\)$/, ''),
      sub: (text ? '«' + text + '»' : '') + (count ? (text ? '\n' : '') + 'Здесь уже есть правок: ' + count : ''),
      buttons: btns,
    });
  }

  /* ===================== действия ===================== */
  function startEdit(el) {
    clearSelection();
    var existing = state.items.filter(function (i) { return i.type === 'text' && i.t.path === cssPath(el); })[0];
    var was = existing ? existing.was : cleanText(el);
    remember(el);
    flatten(el);
    el.setAttribute('data-pv-edit', '');
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    var onPaste = function (ev) {
      ev.preventDefault();
      var t = (ev.clipboardData || window.clipboardData).getData('text');
      doc.execCommand('insertText', false, t);
    };
    el.addEventListener('paste', onPaste);
    el.focus();
    try {
      var r = doc.createRange(); r.selectNodeContents(el); r.collapse(false);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r);
    } catch (e) {}
    var bar = h('<div class="edit-bar"><button class="pri" data-a="ok">✓ Готово</button><button data-a="cancel">Отменить</button></div>');
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bar.querySelector('[data-a="ok"]').onclick = function () { finishEdit(); };
    bar.querySelector('[data-a="cancel"]').onclick = function () { finishEdit(true); };
    root.appendChild(bar);
    editing = { el: el, was: was, item: existing, bar: bar, onPaste: onPaste };
  }
  function finishEdit(cancel) {
    if (!editing) return;
    var E = editing; editing = null;
    var el = E.el;
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-pv-edit');
    el.removeEventListener('paste', E.onPaste);
    E.bar.remove();
    var now = norm(el.innerText);
    if (cancel) {
      if (E.item) { el.innerText = E.item.now; } else restore(el);
      return;
    }
    if (now === E.was || !now && !E.was) {
      if (E.item) removeItem(E.item, true);
      restore(el);
      toast('Текст без изменений');
      return;
    }
    if (!now) { // текст стёрт целиком = убрать элемент
      restore(el);
      removeEl(el);
      return;
    }
    if (E.item) { E.item.now = now; }
    else state.items.push({ id: uid(), type: 'text', t: target(el), was: E.was, now: now });
    // показать без лишних пробелов
    el.innerText = now;
    save();
    toast('✓ Текст изменён');
  }
  function removeEl(el) {
    clearSelection();
    var it = { id: uid(), type: 'remove', t: target(el) };
    state.items.push(it);
    applyItem(it);
    save();
    toast('Блок убран. Вернуть можно в «📋 Правки»', 3500);
  }
  function replacePhoto(el, item) {
    clearSelection();
    pickFiles(false).then(function (fs) {
      if (!fs.length) return;
      var f = fs[0];
      if (f.size > 25 * 1024 * 1024) { toast('Фото слишком большое (больше 25 МБ)'); return; }
      var im = imgOf(el);
      if (!im) return;
      if (item) { item.file = addFile(f, f.name); }
      else {
        item = { id: uid(), type: 'photo', t: target(el), file: addFile(f, f.name) };
        state.items.push(item);
      }
      setPhoto(im, fileURL(item.file));
      save();
      toast('✓ Фото заменено');
    });
  }

  function commentDialog(el, item) {
    if (el) clearSelection();
    var isGeneral = item ? item.type === 'general' : !el;
    var att = item ? (item.files || []).slice() : [];
    var body = h(
      '<div><textarea placeholder="' + (isGeneral ? 'Например: хочу, чтобы сайт был светлее; добавить отзывы…' : 'Что здесь изменить?') + '"></textarea>' +
      '<div class="foot" style="justify-content:flex-start;margin-top:8px"><button data-a="att">📎 Приложить картинку</button></div>' +
      '<div class="thumbs"></div></div>'
    );
    var ta = body.querySelector('textarea');
    ta.value = item ? item.comment || '' : '';
    var thumbs = body.querySelector('.thumbs');
    var drawThumbs = function () {
      thumbs.innerHTML = '';
      att.forEach(function (id) {
        var t = h('<div class="thumb"><img alt=""><b title="Убрать">✕</b></div>');
        t.querySelector('img').src = fileURL(id);
        t.querySelector('b').onclick = function () { att = att.filter(function (x) { return x !== id; }); drawThumbs(); };
        thumbs.appendChild(t);
      });
    };
    drawThumbs();
    body.querySelector('[data-a="att"]').onclick = function () {
      pickFiles(true).then(function (fs) {
        fs.forEach(function (f) { if (f.size <= 25 * 1024 * 1024) att.push(addFile(f, f.name)); });
        drawThumbs();
      });
    };
    var where = el ? kindLabel(el) + ' · ' + sectionOf(el).replace(/ \(#.*\)$/, '') : '';
    sheet({
      title: isGeneral ? '💬 Общее пожелание' : '💬 Комментарий',
      sub: where || (item && item.t ? item.t.kind + ' · ' + item.t.where : 'Любая мысль о сайте — можно приложить картинки-примеры'),
      body: body,
      buttons: [
        { text: 'Отмена' },
        { text: '✓ Сохранить', cls: 'pri', onClick: function () {
          var c = norm(ta.value);
          if (!c && !att.length) { toast('Напишите комментарий или приложите картинку'); return false; }
          if (item) { item.comment = c; item.files = att; }
          else state.items.push(el ? { id: uid(), type: 'comment', t: target(el), comment: c, files: att }
            : { id: uid(), type: 'general', comment: c, files: att });
          save();
          toast('✓ Сохранено');
        } },
      ],
    });
    setTimeout(function () { ta.focus(); }, 50);
  }

  /* ===================== новый раздел: выбор места ===================== */
  function topBlocks() {
    var main = doc.querySelector('main') || doc.body;
    return Array.prototype.filter.call(main.children, function (c) {
      if (c === host || /^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(c.tagName)) return false;
      if (c.hasAttribute('data-pv-hide')) return false;
      var r = c.getBoundingClientRect();
      return r.height > 40 && getComputedStyle(c).position !== 'fixed';
    });
  }
  var topbar = null;
  function startInsert() {
    insertMode = true;
    topbar = h('<div class="topbar"><span>Выберите, куда вставить новый раздел</span><button>Отмена</button></div>');
    topbar.querySelector('button').onclick = stopInsert;
    root.appendChild(topbar);
    drawGaps();
  }
  function stopInsert() {
    insertMode = false;
    layer.innerHTML = '';
    if (topbar) { topbar.remove(); topbar = null; }
  }
  function drawGaps() {
    layer.innerHTML = '';
    var bl = topBlocks();
    if (!bl.length) return;
    var sy = window.scrollY;
    var hostTop = host.getBoundingClientRect().top + sy;
    for (var i = 0; i <= bl.length; i++) {
      var prev = bl[i - 1], next = bl[i];
      var y = next ? next.getBoundingClientRect().top + sy : prev.getBoundingClientRect().bottom + sy;
      if (i === 0) y += 34; else if (!next) y -= 34;
      var label = prev && next ? 'между «' + blockName(prev) + '» и «' + blockName(next) + '»'
        : next ? 'в самом начале, перед «' + blockName(next) + '»' : 'в конце, после «' + blockName(prev) + '»';
      var b = h('<button class="gap">＋ Вставить раздел сюда</button>');
      b.style.top = (y - hostTop) + 'px';
      b.title = label;
      (function (prev, next, label) {
        b.onclick = function () {
          var ref = prev || next;
          var pos = { where: prev ? 'after' : 'before', label: label };
          if (ref.tagName === 'PRAVKI-BLOCK') pos.refNew = ref.getAttribute('data-id');
          else pos.ref = cssPath(ref);
          stopInsert();
          sectionEditor(null, pos);
        };
      })(prev, next, label);
      layer.appendChild(b);
    }
  }

  /* ===================== редактор эскизов ===================== */
  var COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a'];
  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function sectionEditor(item, pos) {
    sketchEditor({
      title: item ? 'Изменить новый раздел' : 'Новый раздел',
      sub: (item ? item.pos.label : pos.label),
      sketch: item && item.sketch,
      fields: [
        { key: 'title', label: 'Заголовок раздела', value: item ? item.title : '' },
        { key: 'body', label: 'Текст раздела', value: item ? item.body : '', area: true },
        { key: 'comment', label: 'Пояснение (что здесь должно быть, как выглядеть)', value: item ? item.comment : '', area: true },
      ],
      onSave: function (res) {
        if (!res.empty && !res.title && !res.body && !res.comment) return 'Нарисуйте эскиз или напишите текст';
        if (!item) { item = { id: uid(), type: 'section', pos: pos }; state.items.push(item); }
        item.title = res.title; item.body = res.body; item.comment = res.comment;
        item.sketch = res.empty ? null : res.sketch;
        applyItem(item);
        save();
        var b = $('pravki-block[data-id="' + item.id + '"]');
        if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('✓ Раздел добавлен');
      },
    });
  }

  function drawOver(el, item) {
    clearSelection();
    if (item) {
      return sketchEditor({
        title: 'Рисунок поверх блока', sub: item.t.kind + ' · ' + item.t.where, sketch: item.sketch,
        fields: [{ key: 'comment', label: 'Пояснение', value: item.comment, area: true }],
        onSave: function (res) { item.sketch = res.sketch; item.comment = res.comment; save(); toast('✓ Сохранено'); },
      });
    }
    toast('Делаю снимок блока…', 1800);
    var r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > innerHeight) el.scrollIntoView({ block: 'nearest' });
    loadScript(CDN.h2c).then(function () {
      var r = el.getBoundingClientRect();
      var vx = Math.max(0, r.left), vy = Math.max(0, r.top);
      var vw = Math.min(innerWidth, r.right) - vx;
      var vh = Math.min(innerHeight - panel.offsetHeight, r.bottom) - vy;
      var H2C = window.html2canvas;
      var shoot = typeof H2C === 'function' ? H2C : (H2C.default || H2C.html2canvas);
      return shoot(doc.body, {
        x: vx + window.scrollX, y: vy + window.scrollY, width: vw, height: vh,
        scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, logging: false,
        ignoreElements: function (n) { return n === host; },
      }).then(function (cv) {
        return { url: cv.toDataURL('image/jpeg', 0.88), w: Math.round(vw), h: Math.round(vh) };
      });
    }).then(function (shot) {
      sketchEditor({
        title: 'Рисунок поверх блока', sub: 'Обведите, зачеркните, поставьте стрелки, подпишите',
        background: shot,
        fields: [{ key: 'comment', label: 'Пояснение', value: '', area: true }],
        onSave: function (res) {
          if (res.empty && !res.comment) return 'Нарисуйте что-нибудь или напишите пояснение';
          state.items.push({ id: uid(), type: 'draw', t: target(el), sketch: res.sketch, comment: res.comment });
          save();
          toast('✓ Рисунок сохранён');
        },
      });
    }).catch(function (err) {
      console.warn('[pravki]', err);
      toast('Не удалось сделать снимок. Оставьте комментарий вместо рисунка.', 4000);
    });
  }

  function sketchEditor(o) {
    var box = h(
      '<div class="sk"><div class="sk-head"><h3></h3><button data-a="x" aria-label="Закрыть">✕</button></div>' +
      '<div class="sk-tools">' +
      '<button data-t="rect"><span>▭</span>Блок</button>' +
      '<button data-t="circle"><span>◯</span>Круг</button>' +
      '<button data-t="arrow"><span>➝</span>Стрелка</button>' +
      '<button data-t="pen"><span>✎</span>Карандаш</button>' +
      '<button data-t="text"><span>T</span>Текст</button>' +
      '<button data-t="photo"><span>🖼</span>Фото</button>' +
      '<button data-t="undo"><span>↶</span>Назад</button>' +
      '<button data-t="del"><span>🗑</span>Удалить</button>' +
      '<div class="sk-colors"><small>Цвет:</small>' +
      COLORS.map(function (c, i) { return '<b class="sw' + (i ? '' : ' on') + '" data-c="' + c + '" style="background:' + c + '"></b>'; }).join('') +
      '</div>' +
      '</div><div class="sk-body"><div class="sk-stage"><div class="loading">Загружаю холст…</div></div><div class="sk-fields"></div></div>' +
      '<div class="sk-foot"><button data-a="x">Отмена</button><button data-a="ok" class="pri">✓ Сохранить</button></div></div>'
    );
    box.querySelector('h3').textContent = o.title + (o.sub ? ' — ' + o.sub : '');
    var fieldsEl = box.querySelector('.sk-fields');
    var inputs = {};
    o.fields.forEach(function (f) {
      fieldsEl.appendChild(h('<label></label>')).textContent = f.label;
      var inp = h(f.area ? '<textarea rows="3" style="min-height:70px"></textarea>' : '<input type="text">');
      inp.value = f.value || '';
      inputs[f.key] = fieldsEl.appendChild(inp);
    });
    root.appendChild(box);
    panel.hidden = true;
    var stage = box.querySelector('.sk-stage');
    var c = null, color = COLORS[0], hist = [], restoring = false, mode = null, scale = 1, W, H;

    var close = function () { box.remove(); panel.hidden = false; window.removeEventListener('resize', fit); if (c) c.dispose(); };
    box.querySelectorAll('[data-a="x"]').forEach(function (b) { b.onclick = close; });

    function fit() {
      if (!c) return;
      var aw = Math.max(200, stage.clientWidth - 20);
      var ah = Math.max(220, window.innerHeight * (o.fields.length > 1 ? 0.58 : 0.66));
      scale = Math.min(aw / W, ah / H);
      c.setDimensions({ width: Math.round(W * scale), height: Math.round(H * scale) });
      c.setZoom(scale);
      c.requestRenderAll();
    }
    function snap() {
      if (restoring || !c) return;
      hist.push(JSON.stringify(c.toJSON()));
      if (hist.length > 50) hist.shift();
    }
    function center() { return { x: W / 2, y: H / 2 }; }
    function base() { return Math.max(W, H) / 1000; } // масштаб размеров фигур
    function add(obj) { c.add(obj); c.setActiveObject(obj); c.requestRenderAll(); }
    function arrowPath(x1, y1, x2, y2) {
      var a = Math.atan2(y2 - y1, x2 - x1), L = 26 * base();
      var hx1 = x2 - L * Math.cos(a - 0.45), hy1 = y2 - L * Math.sin(a - 0.45);
      var hx2 = x2 - L * Math.cos(a + 0.45), hy2 = y2 - L * Math.sin(a + 0.45);
      return new fabric.Path('M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 + ' M ' + hx1 + ' ' + hy1 + ' L ' + x2 + ' ' + y2 + ' L ' + hx2 + ' ' + hy2,
        { stroke: color, strokeWidth: 6 * base(), fill: '', strokeLineCap: 'round', strokeLineJoin: 'round', strokeUniform: true });
    }
    function setMode(m) {
      mode = m;
      c.isDrawingMode = m === 'pen';
      c.selection = !m;
      box.querySelector('[data-t="pen"]').classList.toggle('on', m === 'pen');
      box.querySelector('[data-t="arrow"]').classList.toggle('on', m === 'arrow');
      c.defaultCursor = m === 'arrow' ? 'crosshair' : 'default';
    }
    function textDialog(initial, cb) {
      var body = h('<div><textarea placeholder="Например: «Отзывы клиентов»"></textarea></div>');
      var ta = body.querySelector('textarea'); ta.value = initial || '';
      var sh = sheet({ title: 'Текст на эскизе', body: body, buttons: [
        { text: 'Отмена' },
        { text: '✓ Готово', cls: 'pri', onClick: function () { var v = ta.value.trim(); if (v) cb(v); } },
      ] });
      sh.el.parentElement.style.zIndex = 25;
      setTimeout(function () { ta.focus(); ta.select(); }, 50);
    }

    loadScript(CDN.fabric).then(function () {
      stage.innerHTML = '<canvas></canvas>';
      var sk = o.sketch;
      if (sk) { W = sk.w; H = sk.h; }
      else if (o.background) { W = o.background.w; H = o.background.h; }
      else {
        var aw = Math.max(200, stage.clientWidth - 20), ah = window.innerHeight * 0.58;
        W = 1000; H = Math.round(Math.min(1800, Math.max(560, 1000 * ah / aw)));
      }
      c = new fabric.Canvas(stage.querySelector('canvas'), {
        backgroundColor: '#ffffff', preserveObjectStacking: true, allowTouchScrolling: false,
        enableRetinaScaling: true, fireRightClick: false,
      });
      fabric.Object.prototype.set({
        transparentCorners: false, cornerColor: '#ffffff', cornerStrokeColor: '#2563eb',
        borderColor: '#2563eb', cornerStyle: 'circle', cornerSize: isTouch ? 20 : 12, touchCornerSize: 34, padding: 4,
      });
      c.freeDrawingBrush = new fabric.PencilBrush(c);
      c.freeDrawingBrush.width = 6 * base();
      c.freeDrawingBrush.color = color;
      fit();
      window.addEventListener('resize', fit);

      var ready = function () { c.renderAll(); hist = []; snap(); };
      if (sk && sk.json) {
        restoring = true;
        c.loadFromJSON(sk.json, function () { restoring = false; ready(); });
      } else if (o.background) {
        fabric.Image.fromURL(o.background.url, function (img) {
          img.set({ scaleX: W / img.width, scaleY: H / img.height });
          c.setBackgroundImage(img, ready);
        });
      } else ready();

      c.on('object:added', snap);
      c.on('object:modified', snap);
      c.on('object:removed', snap);
      c.on('path:created', function () { setMode(null); });

      // стрелка: провести пальцем от начала к концу
      var a0 = null, ghost = null;
      c.on('mouse:down', function (ev) {
        if (mode !== 'arrow') return;
        var p = c.getPointer(ev.e); a0 = p;
      });
      c.on('mouse:move', function (ev) {
        if (mode !== 'arrow' || !a0) return;
        var p = c.getPointer(ev.e);
        restoring = true;
        if (ghost) c.remove(ghost);
        ghost = arrowPath(a0.x, a0.y, p.x, p.y);
        ghost.selectable = false;
        c.add(ghost);
        restoring = false;
      });
      c.on('mouse:up', function (ev) {
        if (mode !== 'arrow' || !a0) return;
        var p = c.getPointer(ev.e);
        restoring = true; if (ghost) c.remove(ghost); ghost = null; restoring = false;
        var d = Math.hypot(p.x - a0.x, p.y - a0.y);
        if (d < 15 * base()) { var m = center(); add(arrowPath(m.x - 140 * base(), m.y, m.x + 140 * base(), m.y)); }
        else add(arrowPath(a0.x, a0.y, p.x, p.y));
        a0 = null;
        setMode(null);
      });
      c.on('mouse:dblclick', function (ev) {
        var t = ev.target;
        if (t && t.type === 'textbox') textDialog(t.text, function (v) { t.set('text', v); c.requestRenderAll(); snap(); });
      });
      c.on('selection:created', syncTextBtn);
      c.on('selection:updated', syncTextBtn);
      c.on('selection:cleared', syncTextBtn);
    }).catch(function () {
      stage.innerHTML = '<div class="loading">Не удалось загрузить холст (нет интернета?). Можно написать всё словами ниже.</div>';
    });

    function syncTextBtn() {
      var t = c.getActiveObject();
      box.querySelector('[data-t="text"]').lastChild.textContent = t && t.type === 'textbox' ? 'Изменить' : 'Текст';
    }

    box.querySelector('.sk-tools').addEventListener('click', function (e) {
      var sw = e.target.closest('.sw');
      if (sw && c) {
        color = sw.getAttribute('data-c');
        box.querySelectorAll('.sw').forEach(function (s) { s.classList.toggle('on', s === sw); });
        c.freeDrawingBrush.color = color;
        c.getActiveObjects().forEach(function (ob) {
          if (ob.type === 'textbox') ob.set('fill', color);
          else if (ob.type === 'path') ob.set('stroke', color);
          else ob.set({ stroke: color, fill: hexA(color, 0.08) });
        });
        c.requestRenderAll(); snap();
        return;
      }
      var b = e.target.closest('button');
      if (!b || !c) return;
      var t = b.getAttribute('data-t'), m = center(), k = base();
      if (t !== 'pen' && t !== 'arrow') setMode(null);
      if (t === 'rect') add(new fabric.Rect({ left: m.x - 170 * k, top: m.y - 100 * k, width: 340 * k, height: 200 * k, rx: 12 * k, ry: 12 * k, fill: hexA(color, 0.08), stroke: color, strokeWidth: 5 * k, strokeUniform: true }));
      else if (t === 'circle') add(new fabric.Ellipse({ left: m.x - 110 * k, top: m.y - 110 * k, rx: 110 * k, ry: 110 * k, fill: hexA(color, 0.08), stroke: color, strokeWidth: 5 * k, strokeUniform: true }));
      else if (t === 'arrow') { if (mode === 'arrow') setMode(null); else { setMode('arrow'); toast('Проведите пальцем или мышкой от начала к концу стрелки'); } }
      else if (t === 'pen') setMode(mode === 'pen' ? null : 'pen');
      else if (t === 'text') {
        var ao = c.getActiveObject();
        if (ao && ao.type === 'textbox') textDialog(ao.text, function (v) { ao.set('text', v); c.requestRenderAll(); snap(); });
        else textDialog('', function (v) {
          add(new fabric.Textbox(v, { left: m.x - 300 * k, top: m.y - 30 * k, width: 600 * k, fontSize: 44 * k, fill: color, textAlign: 'center', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', editable: false }));
        });
      }
      else if (t === 'photo') {
        pickFiles(false).then(function (fs) {
          if (!fs.length) return;
          downscale(fs[0], 1400).then(function (url) {
            fabric.Image.fromURL(url, function (img) {
              var s = Math.min((W * 0.5) / img.width, (H * 0.5) / img.height);
              img.set({ scaleX: s, scaleY: s, left: m.x - img.width * s / 2, top: m.y - img.height * s / 2 });
              add(img);
            });
          });
        });
      }
      else if (t === 'undo') {
        if (hist.length < 2) { toast('Отменять нечего'); return; }
        hist.pop();
        restoring = true;
        c.loadFromJSON(JSON.parse(hist[hist.length - 1]), function () { restoring = false; c.renderAll(); });
      }
      else if (t === 'del') {
        var objs = c.getActiveObjects();
        if (!objs.length) { toast('Сначала нажмите на фигуру, которую нужно удалить'); return; }
        objs.forEach(function (ob) { c.remove(ob); });
        c.discardActiveObject(); c.requestRenderAll();
      }
    });

    box.querySelector('[data-a="ok"]').onclick = function () {
      var res = {};
      Object.keys(inputs).forEach(function (k) { res[k] = norm(inputs[k].value); });
      var finish = function () {
        var err = o.onSave(res);
        if (err) { toast(err); return; }
        close();
      };
      if (!c) { res.empty = true; return finish(); }
      setMode(null);
      c.discardActiveObject(); c.renderAll();
      res.empty = c.getObjects().length === 0 && !o.background && !(o.sketch && o.sketch.json && o.sketch.json.backgroundImage);
      if (res.empty) return finish();
      var mult = (1 / scale) * Math.min(2, window.devicePixelRatio || 1);
      var url = c.toDataURL({ format: 'png', multiplier: mult });
      blobFromDataURL(url).then(function (blob) {
        res.sketch = { w: W, h: H, json: c.toJSON(), png: addFile(blob, 'sketch.png') };
        finish();
      });
    };
  }

  /* ===================== список правок ===================== */
  var TYPE = {
    text: ['✏️', 'Изменить текст'], comment: ['💬', 'Комментарий'], remove: ['🗑', 'Убрать'],
    photo: ['🖼', 'Заменить фото'], draw: ['🎨', 'Рисунок поверх блока'], section: ['＋', 'Новый раздел'],
    general: ['💬', 'Общее пожелание'],
  };
  function itemSummary(it) {
    if (it.type === 'text') return 'Было: «' + cut(it.was, 90) + '»\nСтало: «' + cut(it.now, 90) + '»';
    if (it.type === 'section') return it.pos.label + (it.title ? '\nЗаголовок: ' + it.title : '') + (it.comment ? '\n' + cut(it.comment, 100) : '');
    var s = it.t ? (it.t.text ? '«' + cut(it.t.text, 70) + '»' : it.t.src ? 'фото ' + it.t.src.split('/').pop() : '') : '';
    if (it.comment) s += (s ? '\n' : '') + cut(it.comment, 120);
    if (it.files && it.files.length) s += '\n📎 картинок: ' + it.files.length;
    return s;
  }
  function showList() {
    var body = h('<div class="list"></div>');
    if (!state.items.length) body.appendChild(h('<p class="sub">Пока нет ни одной правки. Нажмите на любое место сайта, чтобы начать.</p>'));
    var sh;
    state.items.forEach(function (it, i) {
      var tp = TYPE[it.type];
      var where = it.t ? ' · ' + it.t.where.replace(/ \(#.*\)$/, '') : '';
      var row = h('<div class="it"><div class="h"></div><div class="d"></div><div class="b"></div></div>');
      row.querySelector('.h').textContent = (i + 1) + '. ' + tp[0] + ' ' + tp[1] + where;
      row.querySelector('.d').textContent = itemSummary(it);
      if (it.lost) row.insertBefore(h('<div class="lost">⚠️ Место на сайте изменилось — правка сохранена, но показать её не получится</div>'), row.querySelector('.d'));
      var bb = row.querySelector('.b');
      var btn = function (text, fn, cls) { var b = h('<button></button>'); b.textContent = text; if (cls) b.className = cls; b.onclick = fn; bb.appendChild(b); };
      var el = it.type === 'section' ? $('pravki-block[data-id="' + it.id + '"]') : it.t ? byPath(it.t.path) : null;
      if (el && it.type !== 'remove' && !it.lost) btn('👁 Показать', function () { sh.close(); showEl(el); });
      if (it.type !== 'remove' && !(it.type === 'text' && it.lost)) btn('✏️ Изменить', function () { sh.close(); editItem(it, el); });
      btn(it.type === 'remove' ? '↩ Вернуть блок' : '✕ Удалить правку', function () {
        removeItem(it); sh.close(); showList();
      }, 'danger');
      body.appendChild(row);
    });
    sh = sheet({ title: '📋 Мои правки' + (state.items.length ? ' (' + state.items.length + ')' : ''), body: body, buttons: [
      state.items.length ? { text: 'Очистить всё', cls: 'danger', onClick: function () {
        confirmBox('Удалить все правки?', 'Это действие нельзя отменить.', 'Удалить всё', function () {
          state.items.slice().forEach(function (it) { unapplyItem(it); });
          state.items = []; save(true); toast('Все правки удалены');
        }, true);
      } } : null,
      { text: 'Закрыть', cls: 'pri' },
    ] });
  }
  function showEl(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () {
      selection = el; placeBox(selBox, el);
      setTimeout(function () { if (selection === el) clearSelection(); }, 1600);
    }, 450);
  }
  function editItem(it, el) {
    if (it.type === 'text') { if (el) { el.scrollIntoView({ block: 'center' }); startEdit(el); } }
    else if (it.type === 'comment' || it.type === 'general') commentDialog(null, it);
    else if (it.type === 'photo') { if (el) replacePhoto(el, it); }
    else if (it.type === 'draw') drawOver(el, it);
    else if (it.type === 'section') sectionEditor(it);
  }
  function removeItem(it, silent) {
    unapplyItem(it);
    state.items = state.items.filter(function (x) { return x !== it; });
    // если на удалённый раздел ссылались другие новые разделы — перепривязать
    state.items.forEach(function (x) {
      if (x.type === 'section' && x.pos.refNew === it.id) { x.pos = it.pos; }
    });
    save();
    if (!silent) toast(it.type === 'remove' ? '↩ Блок возвращён' : 'Правка удалена');
  }

  /* ===================== меню «⋯», помощь ===================== */
  function showMore() {
    sheet({ title: 'Ещё', grid: true, buttons: [
      { text: '📂 Открыть файл правок', cls: 'wide', onClick: importFile },
      { text: '❓ Как пользоваться', cls: 'wide', onClick: showHelp },
      { text: 'Закрыть', cls: 'wide' },
    ] });
  }
  function showHelp() {
    var body = h(
      '<ol class="steps">' +
      '<li><b>Нажмите на любой текст, фото или блок</b> — появится меню: изменить текст, комментарий, заменить фото, нарисовать поверх, убрать.</li>' +
      '<li><b>＋ Раздел</b> — добавить новый раздел: выберите место, нарисуйте, как он должен выглядеть, и впишите текст.</li>' +
      '<li><b>💬 Пожелание</b> — любая общая мысль, можно приложить картинки-примеры.</li>' +
      '<li>Всё сохраняется само. Когда закончите — <b>⬇ Готово</b>: скачается файл. Отправьте его тому, кто ведёт ваш сайт, любым удобным способом.</li>' +
      '<li>Чтобы дописать позже на другом устройстве — <b>⋯ → 📂 Открыть файл правок</b>.</li>' +
      '</ol>'
    );
    sheet({ title: 'Режим правок', sub: 'Покажите прямо на сайте, что нужно изменить.', body: body, buttons: [
      { text: 'Понятно, начать', cls: 'pri' },
    ] });
  }

  /* ===================== экспорт / импорт ===================== */
  function slug() {
    var s = (location.hostname.split('.')[0] + '-' + location.pathname.replace(/index\.html?$/i, '').replace(/[^a-z0-9]+/gi, '-'))
      .replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return s || 'site';
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function buildTxt(names) {
    var d = new Date();
    var L = [];
    L.push('ПРАВКИ К САЙТУ');
    L.push('Сайт: ' + SITE);
    L.push('Файл создан: ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
    L.push('Устройство: ' + (isTouch ? 'телефон/планшет' : 'компьютер') + ', экран ' + innerWidth + '×' + innerHeight);
    L.push('Всего правок: ' + state.items.length);
    L.push('«Было» — текст на сайте сейчас (дословно), «Стало» — как должно быть.');
    L.push('');
    state.items.forEach(function (it, i) {
      L.push('==================================================');
      L.push('#' + (i + 1) + '  ' + TYPE[it.type][1].toUpperCase() + (it.lost ? '   (⚠ место на сайте изменилось)' : ''));
      if (it.t) {
        L.push('Где: ' + it.t.where + ' → ' + it.t.kind);
        L.push('Элемент: ' + it.t.path);
      }
      if (it.type === 'text') { L.push('Было: «' + it.was + '»'); L.push('Стало: «' + it.now + '»'); }
      else if (it.t && it.t.text) L.push('Текст элемента: «' + it.t.text + '»');
      else if (it.t && it.t.src) L.push('Фото на сайте: ' + it.t.src);
      if (it.type === 'section') {
        L.push('Куда: ' + it.pos.label + (it.pos.ref ? ' [' + (it.pos.where === 'after' ? 'после ' : 'перед ') + it.pos.ref + ']' : ''));
        if (it.title) L.push('Заголовок: ' + it.title);
        if (it.body) L.push('Текст раздела:\n' + it.body);
      }
      if (it.type === 'photo') L.push('Новое фото: ' + names[it.file]);
      if (it.sketch) L.push('Эскиз: ' + names[it.sketch.png]);
      if (it.comment) L.push((it.type === 'section' || it.type === 'draw' ? 'Пояснение: ' : 'Комментарий: ') + it.comment);
      if (it.files && it.files.length) L.push('Вложения: ' + it.files.map(function (f) { return names[f]; }).join(', '));
      L.push('');
    });
    return L.join('\r\n');
  }
  function showDone() {
    if (!state.items.length) {
      sheet({ title: 'Пока нет правок', sub: 'Нажмите на любое место сайта, чтобы изменить его, или добавьте общее пожелание.', buttons: [{ text: 'Понятно', cls: 'pri' }] });
      return;
    }
    sheet({
      title: '⬇ Сохранить правки в файл',
      sub: 'Правок: ' + state.items.length + '.\nСкачайте файл и отправьте его тому, кто ведёт ваш сайт, любым удобным способом (мессенджер, почта).\n\nЧтобы потом что-то дописать — откройте этот файл здесь же: ⋯ → 📂 Открыть файл правок.',
      buttons: [{ text: 'Отмена' }, { text: '⬇ Скачать файл', cls: 'pri', onClick: function (btn) {
        btn.disabled = true; btn.textContent = 'Готовлю файл…';
        exportZip().then(function () { closeSheets(); toast('✓ Файл скачан', 3500); })
          .catch(function (e) { console.warn('[pravki]', e); btn.disabled = false; btn.textContent = '⬇ Скачать файл'; toast('Не получилось. Проверьте интернет и попробуйте ещё раз.', 4000); });
        return false;
      } }],
    });
  }
  function exportZip() {
    return loadScript(CDN.zip).then(function () {
      var zip = new window.JSZip();
      var names = {}, meta = {}, jobs = [];
      state.items.forEach(function (it, i) {
        var n = i + 1;
        var reg = function (id, dir, suffix) {
          var f = files.get(id); if (!f) return;
          var p = dir + '/' + n + suffix + '.' + fileExt(f);
          // заранее читаем файл: один нечитаемый файл не должен ломать весь архив
          jobs.push(readBuf(f.blob, 8000).then(function (buf) {
            names[id] = p; meta[id] = { path: p, name: f.name, type: f.blob.type };
            zip.file(p, buf);
          }).catch(function () {
            names[id] = '(файл «' + (f.name || 'без имени') + '» не удалось прочитать — пришлите его отдельно)';
          }));
        };
        if (it.file) reg(it.file, 'photos', '');
        if (it.sketch) reg(it.sketch.png, 'sketches', '');
        (it.files || []).forEach(function (id, k) { reg(id, 'attachments', '-' + (k + 1)); });
      });
      return Promise.all(jobs).then(function () {
        zip.file('pravki.txt', '﻿' + buildTxt(names));
        zip.file('data.json', JSON.stringify({ format: 'pravki', v: 1, site: SITE, exported: new Date().toISOString(), items: state.items, files: meta }));
        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      });
    }).then(function (blob) {
      var d = new Date();
      var a = doc.createElement('a');
      a.setAttribute('data-pv-own', '');
      a.href = URL.createObjectURL(blob);
      a.download = 'pravki-' + slug() + '-' + pad2(d.getDate()) + '-' + pad2(d.getMonth() + 1) + '.zip';
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 30000);
    });
  }
  function importFile() {
    pickFiles(false, '.zip,application/zip').then(function (fs) {
      if (!fs.length) return;
      toast('Открываю файл…');
      loadScript(CDN.zip).then(function () { return window.JSZip.loadAsync(fs[0]); }).then(function (zip) {
        var dj = zip.file('data.json');
        if (!dj) throw new Error('nodata');
        return dj.async('string').then(function (txt) {
          var data = JSON.parse(txt);
          if (data.format !== 'pravki') throw new Error('format');
          var ids = Object.keys(data.files || {});
          return Promise.all(ids.map(function (id) {
            var m = data.files[id], zf = zip.file(m.path);
            return zf ? zf.async('blob').then(function (b) { return { id: id, blob: new Blob([b], { type: m.type || '' }), name: m.name || '' }; }) : null;
          })).then(function (arr) { return { data: data, files: arr.filter(Boolean) }; });
        });
      }).then(function (res) {
        var go = function () {
          var st = { v: 1, site: SITE, items: res.data.items || [] };
          idbSet(SITE, { state: st, files: res.files }).then(function () {
            try { sessionStorage.setItem('pravki-on', '1'); } catch (e) {}
            location.reload();
          }).catch(function () {
            // без хранилища — применить прямо сейчас
            state.items.slice().forEach(unapplyItem);
            files = new Map(); res.files.forEach(function (f) { files.set(f.id, { blob: f.blob, name: f.name }); });
            state = st; state.items.forEach(applyItem); renderCount();
            toast('✓ Правки из файла открыты');
          });
        };
        var other = res.data.site && res.data.site !== SITE;
        var msg = (other ? 'Файл сделан для другого адреса:\n' + res.data.site + '\n\n' : '') +
          (state.items.length ? 'Текущие правки на этом устройстве (' + state.items.length + ') будут заменены правками из файла (' + (res.data.items || []).length + ').' : 'В файле правок: ' + (res.data.items || []).length + '.');
        confirmBox('Открыть файл правок?', msg, 'Открыть', go);
      }).catch(function (e) {
        console.warn('[pravki]', e);
        toast('Это не файл правок или он повреждён', 4000);
      });
    });
  }

  /* ===================== запуск ===================== */
  function start() {
    buildUI();
    var p;
    try { p = idbGet(SITE); } catch (e) { p = Promise.reject(e); }
    p.then(function (rec) {
      if (rec && rec.state) {
        state = rec.state; state.site = SITE;
        (rec.files || []).forEach(function (f) { files.set(f.id, { blob: f.blob, name: f.name }); });
      }
    }).catch(function () {
      idbOk = false;
      toast('⚠️ Черновик не сохраняется на этом устройстве. Скачайте файл до закрытия страницы.', 6000);
    }).then(function () {
      state.items.forEach(function (it) { try { applyItem(it); } catch (e) { it.lost = true; } });
      renderCount();
      var seen = false;
      try { seen = localStorage.getItem('pravki-help') === '1'; localStorage.setItem('pravki-help', '1'); } catch (e) {}
      if (!seen) showHelp();
      else if (state.items.length) toast('Режим правок · сохранено правок: ' + state.items.length);
    });
  }

  window.addEventListener('hashchange', boot);
  boot();
})();
