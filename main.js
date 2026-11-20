/* Анна Клос — main.js v2
   Vanilla JS, без зависимостей. Один общий rAF-цикл для всех scroll-зависимых эффектов.
   Контракт имён — см. SPEC.md («КОНТРАКТ» и «Поведение (JS)»). */
(() => {
  'use strict';

  const win = window;
  const doc = document;
  const root = doc.documentElement;

  /* ---------- helpers ---------- */
  const $ = (s, c) => (c || doc).querySelector(s);
  const $$ = (s, c) => Array.prototype.slice.call((c || doc).querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const noopMq = { matches: false };
  const mq = (q) => (win.matchMedia ? win.matchMedia(q) : noopMq);
  const onMq = (m, fn) => {
    if (m.addEventListener) m.addEventListener('change', fn);
    else if (m.addListener) m.addListener(fn);
  };
  const now = () => (win.performance && performance.now ? performance.now() : Date.now());
  const raf = win.requestAnimationFrame
    ? win.requestAnimationFrame.bind(win)
    : (fn) => setTimeout(() => fn(now()), 16);

  const mqReduce = mq('(prefers-reduced-motion: reduce)');
  const mqDesk = mq('(min-width: 960px)');
  const mqFine = mq('(pointer: fine)');
  const hasIO = 'IntersectionObserver' in win;
  let reduced = mqReduce.matches;

  /* Позиция в документе по цепочке offsetTop — не искажается transform/translate. */
  function docTop(el) {
    let y = 0;
    let n = el;
    while (n) {
      y += n.offsetTop;
      const p = n.offsetParent;
      if (p) y += p.clientTop;
      n = p;
    }
    return y;
  }
  const isRendered = (el) => el.getClientRects().length > 0;

  function init() {
    const body = doc.body;
    if (!body) return;

    /* ============ общий цикл ============ */
    let ticking = false;
    let dirty = true; // нужен пересчёт размеров
    const requestTick = () => {
      if (ticking) return;
      ticking = true;
      raf(frame);
    };
    const invalidate = () => {
      dirty = true;
      requestTick();
    };

    /* ============ Loader ============ */
    let loaded = false;
    let loadedAt = 0;
    // --boot из CSS (сколько держится заставка после is-loaded), в мс
    const bootMs = (parseFloat(getComputedStyle(root).getPropertyValue('--boot')) || 1.5) * 1000;
    const markLoaded = () => {
      if (loaded) return;
      loaded = true;
      loadedAt = now();
      body.classList.add('is-loaded');
      invalidate();
    };
    if (reduced) markLoaded();
    else if (doc.readyState === 'complete') raf(markLoaded);
    else {
      win.addEventListener('load', markLoaded, { once: true });
      setTimeout(markLoaded, 1800);
    }

    /* ============ разбиение текста на слова ============ */
    // Разделитель — пробельные символы, КРОМЕ неразрывных (U+00A0, U+202F, U+2007).
    // Эмодзи (в т.ч. с VS16 / ZWJ) не являются пробелами и остаются внутри слова целиком.
    const WS_SPLIT = /([^\S   ]+)/;
    const WS_ONLY = /^[^\S   ]+$/;
    const HEADING = /^H[1-6]$/;
    const splitDone = new WeakSet();

    function srOnly(text) {
      const s = doc.createElement('span');
      s.className = 'sr-only';
      s.textContent = text;
      s.style.cssText =
        'position:absolute!important;width:1px!important;height:1px!important;padding:0!important;' +
        'margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;' +
        'clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important;';
      return s;
    }

    function splitWords(el, makeWord) {
      if (splitDone.has(el)) return [];
      splitDone.add(el);
      const label = el.textContent.replace(/[^\S ]+/g, ' ').trim();
      if (!label) return [];
      const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const words = [];
      nodes.forEach((node) => {
        const parts = node.nodeValue.split(WS_SPLIT);
        const frag = doc.createDocumentFragment();
        parts.forEach((part) => {
          if (!part) return;
          if (WS_ONLY.test(part)) frag.appendChild(doc.createTextNode(part));
          else {
            const w = makeWord(part, words.length);
            words.push(w);
            frag.appendChild(w);
          }
        });
        node.parentNode.replaceChild(frag, node);
      });
      // Доступность: слова скрыты от AT, исходный текст — на контейнере.
      el.setAttribute('aria-label', label);
      // aria-label на <p>/<span> (generic) читалками часто игнорируется —
      // для не-заголовков дублируем текст визуально скрытым узлом.
      if (!HEADING.test(el.tagName) && !el.hasAttribute('role')) {
        el.removeAttribute('aria-label');
        el.insertBefore(srOnly(label), el.firstChild);
      }
      return words;
    }

    // [data-split] → span.word > span.word__inner, --i = индекс слова
    $$('[data-split]').forEach((el) => {
      splitWords(el, (text, i) => {
        const w = doc.createElement('span');
        w.className = 'word';
        w.setAttribute('aria-hidden', 'true');
        w.style.setProperty('--i', i);
        const inner = doc.createElement('span');
        inner.className = 'word__inner';
        inner.textContent = text;
        w.appendChild(inner);
        return w;
      });
    });

    // [data-fill] → span.fill-word
    const fills = $$('[data-fill]')
      .map((el) => ({
        el,
        words: splitWords(el, (text, i) => {
          const w = doc.createElement('span');
          w.className = 'fill-word';
          w.setAttribute('aria-hidden', 'true');
          w.style.setProperty('--i', i);
          w.textContent = text;
          return w;
        }),
        top: 0,
        h: 0,
        on: false,
        lit: 0,
      }))
      .filter((f) => f.words.length);

    const lightAllFills = () =>
      fills.forEach((f) => {
        f.words.forEach((w) => w.classList.add('is-lit'));
        f.lit = f.words.length;
      });

    /* ============ [data-reveal] / [data-split] → .is-in ============ */
    $$('[data-reveal]').forEach((el) => {
      const p = el.parentElement;
      if (!p || el.style.getPropertyValue('--i')) return;
      let i = 0;
      const kids = p.children;
      for (let k = 0; k < kids.length && kids[k] !== el; k++) {
        if (kids[k].hasAttribute('data-reveal')) i++;
      }
      el.style.setProperty('--i', i);
    });

    const inEls = $$('[data-reveal],[data-split]');
    const showAll = () => inEls.forEach((e) => e.classList.add('is-in'));
    let revealIO = null;
    if (reduced || !hasIO) showAll();
    else {
      revealIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            // вошёл во вьюпорт ИЛИ уже проскроллен выше (например, при загрузке с якоря)
            if (en.isIntersecting || en.boundingClientRect.bottom <= 0) {
              // Заголовок hero, до которого долистали уже после заставки (мобильный: фото над текстом),
              // появляется сразу — без задержки «на заставку».
              if (loaded && now() - loadedAt > bootMs && en.target.classList.contains('hero__title')) {
                en.target.classList.add('is-late');
              }
              en.target.classList.add('is-in');
              revealIO.unobserve(en.target);
            }
          });
        },
        { rootMargin: '0px 0px -10% 0px' }
      );
      inEls.forEach((e) => revealIO.observe(e));
    }

    /* ============ [data-count] ============ */
    const counts = $$('[data-count]')
      .map((el) => {
        const raw = String(el.getAttribute('data-count')).trim();
        const to = parseFloat(raw);
        const dec = (raw.split('.')[1] || '').length;
        return { el, to, dec, start: 0, running: false, done: false };
      })
      .filter((c) => isFinite(c.to));
    const fmt = (v, dec) =>
      v.toLocaleString('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const COUNT_MS = 1400;
    let countIO = null;
    const finishCounts = () =>
      counts.forEach((c) => {
        if (c.done) return;
        c.done = true;
        c.running = false;
        c.el.textContent = fmt(c.to, c.dec);
      });

    if (!reduced && hasIO && counts.length) {
      counts.forEach((c) => {
        c.el.textContent = fmt(0, c.dec);
      });
      countIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (!(en.isIntersecting || en.boundingClientRect.bottom <= 0)) return;
            countIO.unobserve(en.target);
            const c = counts.find((x) => x.el === en.target);
            if (!c || c.done) return;
            if (reduced) {
              c.done = true;
              c.el.textContent = fmt(c.to, c.dec);
              return;
            }
            c.start = now();
            c.running = true;
            requestTick();
          });
        },
        { rootMargin: '0px 0px -10% 0px' }
      );
      counts.forEach((c) => countIO.observe(c.el));
    }
    // без IO / reduced-motion — в HTML уже финальный текст, ничего не трогаем

    /* ============ элементы ============ */
    const progress = doc.getElementById('progress');
    const nav = $('.nav');
    const navChapter = $('.nav__chapter');
    const rail = $('.rail');
    const railLinks = $$('.rail__link[data-chapter-link]');
    const menuLinks = $$('.nav__menu a[href^="#"]');

    const chapters = $$('section[data-chapter]').map((el, i) => ({
      el,
      name: el.getAttribute('data-chapter') || '',
      num: String(i + 1).padStart(2, '0'),
      theme: el.classList.contains('ch--light') ? 'light' : 'dark', // ch--dark и #contact → dark
      link: railLinks.filter((a) => el.id && a.getAttribute('data-chapter-link') === el.id)[0] || null,
      top: 0,
    }));

    const cards = $$('.stack__card').map((el) => ({ el, nat: 0, T: 0, limit: 0, s: -1 }));
    const dots = $$('.stack__dots a');
    const dotFor = cards.map(
      (c, i) => dots.filter((a) => c.el.id && a.getAttribute('href') === '#' + c.el.id)[0] || dots[i] || null
    );

    const parallax = $$('[data-parallax]')
      .map((el) => ({ el, k: parseFloat(el.getAttribute('data-parallax')) || 0, c: 0, on: false, v: null }))
      .filter((p) => p.k);

    const mags = $$('[data-magnetic]').map((el) => ({ el, x: 0, y: 0, tx: 0, ty: 0, r: null, stale: true }));

    const burger = $('.nav__burger');
    const menu =
      doc.getElementById('nav-menu') ||
      (burger && burger.getAttribute('aria-controls')
        ? doc.getElementById(burger.getAttribute('aria-controls'))
        : null);

    /* ============ кэш размеров ============ */
    let vh = win.innerHeight;
    let maxScroll = 1;
    let navH = 0;
    let stackOn = false;
    let parallaxOn = false;
    let burgerVisible = false;

    function measure() {
      // --- ЧТЕНИЯ ---
      vh = win.innerHeight || root.clientHeight;
      const desk = mqDesk.matches;
      navH = nav ? nav.offsetHeight : 0;

      // Stack: естественные позиции карточек (без sticky-смещения)
      let wantStack = false;
      if (cards.length) {
        const cs0 = getComputedStyle(cards[0].el);
        wantStack = cards.length > 1 && desk && !reduced && cs0.position === 'sticky';
        cards.forEach((c) => {
          const cs = getComputedStyle(c.el);
          c.T = parseFloat(cs.top) || 0;
          c.mb = parseFloat(cs.marginBottom) || 0;
        });
        // временно static → offsetTop без липкого сдвига (один форс-лейаут, только на resize)
        cards.forEach((c) => {
          c.prevPos = c.el.style.position;
          c.el.style.position = 'static';
        });
        const parent = cards[0].el.parentElement;
        let parentBottom = Infinity;
        if (parent) {
          const pcs = getComputedStyle(parent);
          parentBottom =
            docTop(parent) + parent.clientTop + parent.clientHeight - (parseFloat(pcs.paddingBottom) || 0);
        }
        cards.forEach((c) => {
          c.nat = docTop(c.el);
          c.h = c.el.offsetHeight;
          c.limit = parentBottom - c.h - c.mb;
        });
        cards.forEach((c) => {
          c.el.style.position = c.prevPos || '';
        });
      }

      chapters.forEach((ch) => {
        ch.top = docTop(ch.el);
      });

      fills.forEach((f) => {
        f.on = isRendered(f.el);
        f.top = docTop(f.el);
        f.h = f.el.offsetHeight;
      });

      const wantParallax = desk && !reduced;
      parallax.forEach((p) => {
        p.on = wantParallax && isRendered(p.el);
        p.c = docTop(p.el) + p.el.offsetHeight / 2;
      });

      maxScroll = Math.max(0, root.scrollHeight - vh);
      burgerVisible = !!burger && isRendered(burger);

      // --- ЗАПИСИ (после всех чтений) ---
      if (stackOn && !wantStack) {
        cards.forEach((c) => {
          c.el.style.removeProperty('--s');
          c.s = -1;
        });
      }
      stackOn = wantStack;

      if (parallaxOn && !wantParallax) {
        parallax.forEach((p) => {
          p.el.style.translate = '';
          p.v = null;
        });
      }
      parallaxOn = wantParallax;

      if (menuOpen && !burgerVisible) setMenu(false);
      else syncMenuInert();

      mags.forEach((m) => {
        m.stale = true;
      });
    }

    /* ============ кадр ============ */
    let lastP = -1;
    let lastY = win.pageYOffset || root.scrollTop || 0;
    let dir = 0;
    let anchorY = lastY;
    let navScrolled = null;
    let navHidden = false;
    let activeChapter = -1;
    let activeCard = -1;

    function frame() {
      ticking = false;
      if (dirty) {
        dirty = false;
        measure();
      }
      let more = false;
      const y = win.pageYOffset || root.scrollTop || 0;
      const t = now();

      /* --- progress + rail --- */
      const p = maxScroll > 0 ? clamp(y / maxScroll) : 0;
      if (Math.abs(p - lastP) > 0.0002) {
        lastP = p;
        const ps = p.toFixed(4);
        if (progress) progress.style.transform = 'scaleX(' + ps + ')';
        if (rail) rail.style.setProperty('--rail-p', ps);
      }

      /* --- nav --- */
      if (nav) {
        const scrolled = y > 40;
        if (scrolled !== navScrolled) {
          navScrolled = scrolled;
          nav.classList.toggle('is-scrolled', scrolled);
        }
        if (y > lastY) {
          if (dir !== 1) {
            dir = 1;
            anchorY = lastY;
          }
          if (y > 400 && y - anchorY > 8) navHidden = true;
        } else if (y < lastY) {
          if (dir !== -1) {
            dir = -1;
            anchorY = lastY;
          }
          if (anchorY - y > 4) navHidden = false;
        }
        if (menuOpen || y <= 400) navHidden = false;
        if (nav.classList.contains('is-hidden') !== navHidden) nav.classList.toggle('is-hidden', navHidden);
      }
      lastY = y;

      /* --- chapters --- */
      if (chapters.length) {
        const line = y + vh * 0.4;
        let ai = 0;
        for (let i = 0; i < chapters.length; i++) if (chapters[i].top <= line) ai = i;
        if (ai !== activeChapter) {
          const prev = chapters[activeChapter];
          if (prev && prev.link) {
            prev.link.classList.remove('is-active');
            prev.link.removeAttribute('aria-current');
          }
          activeChapter = ai;
          const ch = chapters[ai];
          if (ch.link) {
            ch.link.classList.add('is-active');
            ch.link.setAttribute('aria-current', 'true');
          }
          if (navChapter) navChapter.textContent = ch.num + ' — ' + ch.name;
          for (let k = 0; k < menuLinks.length; k++) {
            const a = menuLinks[k];
            const cur = !a.classList.contains('btn') && a.getAttribute('href') === '#' + ch.el.id;
            a.classList.toggle('is-current', cur);
            if (cur) a.setAttribute('aria-current', 'true');
            else a.removeAttribute('aria-current');
          }
          if (body.getAttribute('data-theme') !== ch.theme) body.setAttribute('data-theme', ch.theme);
        }
      }

      /* --- [data-fill] --- */
      if (!reduced) {
        for (let i = 0; i < fills.length; i++) {
          const f = fills[i];
          if (!f.on) continue;
          const top = f.top - y;
          const fp = clamp((vh * 0.85 - top) / (vh * 0.4 + f.h));
          const n = f.words.length;
          const lit = Math.min(n, Math.ceil(fp * n - 1e-6)); // индексы < p·N
          if (lit !== f.lit) {
            const a = Math.min(lit, f.lit);
            const b = Math.max(lit, f.lit);
            const on = lit > f.lit;
            for (let k = a; k < b; k++) f.words[k].classList.toggle('is-lit', on);
            f.lit = lit;
          }
        }
      }

      /* --- [data-parallax] --- */
      if (parallaxOn) {
        const mid = y + vh / 2;
        for (let i = 0; i < parallax.length; i++) {
          const px = parallax[i];
          if (!px.on) continue;
          const d = px.c - mid;
          if (Math.abs(d) > vh * 1.5 && px.v !== null) continue; // далеко за экраном
          const v = Math.round(-d * px.k * 10) / 10;
          if (v !== px.v) {
            px.v = v;
            px.el.style.translate = '0 ' + v + 'px';
          }
        }
      }

      /* --- stack --- */
      if (cards.length) {
        const n = cards.length;
        const cur = new Array(n);
        for (let i = 0; i < n; i++) {
          const c = cards[i];
          const natural = c.nat - y;
          cur[i] = stackOn ? Math.min(Math.max(natural, c.T), c.limit - y) : natural;
        }
        if (stackOn) {
          for (let i = 0; i < n - 1; i++) {
            const denom = vh - cur[i];
            const s = denom > 1 ? clamp(1 - (cur[i + 1] - cur[i]) / denom) : 1;
            const sr = Math.round(s * 1000) / 1000;
            if (sr !== cards[i].s) {
              cards[i].s = sr;
              cards[i].el.style.setProperty('--s', sr);
            }
          }
        }
        let ac = 0;
        for (let i = 0; i < n; i++) if (cur[i] <= vh * 0.5) ac = i;
        if (ac !== activeCard) {
          const pd = dotFor[activeCard];
          if (pd) {
            pd.classList.remove('is-active');
            pd.removeAttribute('aria-current');
          }
          activeCard = ac;
          const nd = dotFor[ac];
          if (nd) {
            nd.classList.add('is-active');
            nd.setAttribute('aria-current', 'step');
          }
        }
      }

      /* --- count-up --- */
      for (let i = 0; i < counts.length; i++) {
        const c = counts[i];
        if (!c.running) continue;
        const k = clamp((t - c.start) / COUNT_MS);
        if (k >= 1) {
          c.running = false;
          c.done = true;
          c.el.textContent = fmt(c.to, c.dec);
        } else {
          const v = c.to * easeOutExpo(k);
          const f = Math.pow(10, c.dec);
          c.el.textContent = fmt(Math.round(v * f) / f, c.dec);
          more = true;
        }
      }

      /* --- magnetic --- */
      for (let i = 0; i < mags.length; i++) {
        const m = mags[i];
        if (m.x === m.tx && m.y === m.ty) continue;
        m.x += (m.tx - m.x) * 0.2;
        m.y += (m.ty - m.y) * 0.2;
        if (Math.abs(m.tx - m.x) < 0.05 && Math.abs(m.ty - m.y) < 0.05) {
          m.x = m.tx;
          m.y = m.ty;
        } else more = true;
        m.el.style.translate = m.x || m.y ? m.x.toFixed(2) + 'px ' + m.y.toFixed(2) + 'px' : '';
      }

      if (more) requestTick();
    }

    /* ============ magnetic ============ */
    const MAG = 6;
    const magOn = () => mqFine.matches && !reduced;
    mags.forEach((m) => {
      const el = m.el;
      el.addEventListener(
        'pointerenter',
        () => {
          m.stale = true;
        },
        { passive: true }
      );
      el.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerType === 'touch' || !magOn()) return;
          if (m.stale || !m.r) {
            const r = el.getBoundingClientRect();
            // убираем текущее собственное смещение из кэша
            m.r = { cx: r.left - m.x + r.width / 2, cy: r.top - m.y + r.height / 2, hw: r.width / 2 || 1, hh: r.height / 2 || 1 };
            m.stale = false;
          }
          m.tx = clamp((e.clientX - m.r.cx) / m.r.hw, -1, 1) * MAG;
          m.ty = clamp((e.clientY - m.r.cy) / m.r.hh, -1, 1) * MAG;
          requestTick();
        },
        { passive: true }
      );
      el.addEventListener(
        'pointerleave',
        () => {
          m.tx = 0;
          m.ty = 0;
          m.r = null;
          requestTick();
        },
        { passive: true }
      );
    });
    const resetMags = () =>
      mags.forEach((m) => {
        m.x = m.y = m.tx = m.ty = 0;
        m.r = null;
        m.el.style.translate = '';
      });

    /* ============ меню ============ */
    let menuOpen = false;

    function syncMenuInert() {
      if (!menu) return;
      const hide = !menuOpen && burgerVisible;
      if (hide) {
        menu.setAttribute('inert', '');
        menu.setAttribute('aria-hidden', 'true');
      } else {
        menu.removeAttribute('inert');
        menu.removeAttribute('aria-hidden');
      }
    }

    function setMenu(open, focusBurger) {
      open = !!open;
      if (open === menuOpen) {
        syncMenuInert();
        return;
      }
      menuOpen = open;
      body.classList.toggle('menu-open', open);
      if (burger) burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      syncMenuInert();
      if (open && menu) {
        const first = menu.querySelector('a[href], button:not([disabled])');
        if (first) raf(() => first.focus({ preventScroll: true }));
      } else if (!open && focusBurger && burger) {
        burger.focus({ preventScroll: true });
      }
      requestTick(); // снять .is-hidden с шапки
    }

    if (burger) {
      if (!burger.hasAttribute('aria-expanded')) burger.setAttribute('aria-expanded', 'false');
      burger.addEventListener('click', (e) => {
        e.preventDefault();
        setMenu(!menuOpen);
      });
    }
    if (menu) {
      menu.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('a')) setMenu(false);
      });
    }
    doc.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && menuOpen) setMenu(false, true);
    });

    /* ============ якоря ============ */
    function scrollTarget(el) {
      if (dirty) {
        dirty = false;
        measure();
      }
      const card = cards.filter((c) => c.el === el)[0];
      let top;
      if (card) top = card.nat - (stackOn ? card.T : navH);
      else top = docTop(el) - navH;
      return clamp(Math.round(top), 0, Math.max(0, root.scrollHeight - (win.innerHeight || vh)));
    }

    function scrollToEl(el, smooth) {
      const top = scrollTarget(el);
      try {
        win.scrollTo({ top, left: 0, behavior: smooth && !reduced ? 'smooth' : 'auto' });
      } catch (_) {
        win.scrollTo(0, top);
      }
      // перенос фокуса для клавиатуры/читалок без повторной прокрутки
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
        el.setAttribute('tabindex', '-1');
        el.style.outline = 'none';
      }
      try {
        el.focus({ preventScroll: true });
      } catch (_) {}
    }

    const getTarget = (hash) => {
      if (!hash || hash.length < 2) return null;
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch (_) {}
      return doc.getElementById(id);
    };

    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (href === '#') {
        e.preventDefault(); // заглушки (контакты) — без прыжка
        return;
      }
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = getTarget(href);
      if (!target) return;
      e.preventDefault();
      if (menuOpen) setMenu(false);
      scrollToEl(target, true);
      if (win.history && history.pushState && location.hash !== href) {
        try {
          history.pushState(null, '', href);
        } catch (_) {}
      }
    });

    // загрузка с #hash — поправить позицию с учётом шапки
    win.addEventListener(
      'load',
      () => {
        const target = getTarget(location.hash);
        if (target) raf(() => scrollToEl(target, false));
      },
      { once: true }
    );

    /* ============ reduced motion (в т.ч. смена на лету) ============ */
    function applyReduced() {
      markLoaded();
      showAll();
      if (revealIO) revealIO.disconnect();
      lightAllFills();
      finishCounts();
      if (countIO) countIO.disconnect();
      resetMags();
    }
    if (reduced) applyReduced();
    onMq(mqReduce, () => {
      reduced = mqReduce.matches;
      if (reduced) applyReduced();
      invalidate();
    });

    /* ============ слушатели ============ */
    win.addEventListener(
      'scroll',
      () => {
        for (let i = 0; i < mags.length; i++) mags[i].stale = true;
        requestTick();
      },
      { passive: true }
    );
    win.addEventListener('resize', invalidate, { passive: true });
    win.addEventListener('orientationchange', invalidate, { passive: true });
    win.addEventListener('load', invalidate);
    win.addEventListener('pageshow', invalidate);
    onMq(mqDesk, invalidate);
    onMq(mqFine, () => {
      if (!mqFine.matches) resetMags();
    });
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(invalidate, () => {});
    if ('ResizeObserver' in win) {
      // высота контента меняется (картинки, шрифты, раскрытия) → пересчёт кэша
      let lastH = -1;
      new ResizeObserver((entries) => {
        const h = entries[0] && entries[0].contentRect ? entries[0].contentRect.height : -2;
        if (h !== lastH) {
          lastH = h;
          invalidate();
        }
      }).observe(body);
    }

    syncMenuInert();
    invalidate();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
