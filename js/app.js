(function () {
  'use strict';
  var J = window.JAM;
  var app = document.getElementById('app');
  var nf = new Intl.NumberFormat('ar-SA');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var heroTimer = null;

  function sar(n) { return nf.format(n) + ' ر.س'; }
  function priceHtml(p) { return '<span class="price">' + sar(J.price(p)) + '<s>' + nf.format(J.compareAt(p)) + '</s></span>'; }
  // The chip beside the price: the set's own offer, or what the shopper saves.
  function saveHtml(p) { return '<span class="save">' + (J.SETS[p.set].offer || 'وفّري ' + sar(J.compareAt(p) - J.price(p))) + '</span>'; }
  function setName(p) { return 'طقم ' + J.SETS[p.set].ar; }
  function alt(p) { return setName(p) + ' ' + p.color + ' في ' + J.CITIES[p.city].ar; }
  function href(p) { return '#/p/' + p.set + '/' + p.key; }
  var globe = null; // the spinning globe on the home page, while that page is open
  function setTone(hex) { document.documentElement.style.setProperty('--tone', hex); if (globe) globe.setTone(hex); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var WHATSAPP = 'https://wa.me/966504227762';

  /* ---------- shop API (orders, stock, payment check) ---------- */
  var configured = !!J.API;
  var paymentsOn = false; // turns true once the shop API says it can verify payments
  // Test keys: checkout is only for someone who opened the site with ?test=1 in this tab.
  // The shop API says which Moyasar key to use and whether it is live. In test mode checkout is only for ?test=1 visitors.
  var payKey = '';
  var testMode = true;
  var tester = false;
  try {
    if (new URLSearchParams(location.search).get('test') === '1') sessionStorage.setItem('jam-test', '1');
    tester = sessionStorage.getItem('jam-test') === '1';
  } catch (e) { tester = /[?&]test=1/.test(location.search); }
  function mayPay() { return !testMode || tester; }
  function api(path, body) {
    var opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    return fetch(J.API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }
  function store(key, value) {
    try {
      if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable: state lives for this page only */ }
  }
  function stored(key) { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  // The order being paid for, and the delivery details the shopper typed.
  var order = stored('jam-order');
  var customer = stored('jam-customer') || {};
  function orderOpen() {
    return !!order && new Date(order.expires_at).getTime() - Date.now() > 60000 &&
      order.skus.slice().sort().join() === cart.slice().sort().join();
  }
  function setPreviewBar() {
    var bar = document.getElementById('previewBar');
    if (!paymentsOn) { bar.hidden = false; bar.textContent = 'نسخة معاينة. الدفع غير مفعّل بعد.'; return; }
    var test = testMode;
    bar.hidden = !test;
    if (test) bar.textContent = 'وضع تجريبي. الدفع ببطاقات اختبار فقط، وما ينخصم أي مبلغ.';
  }

  /* ---------- cart (kept in this browser only) ---------- */
  var cart = [];
  try { cart = JSON.parse(localStorage.getItem('jam-cart') || '[]').filter(function (s) { var p = J.bySku(s); return p && p.stock > 0; }); } catch (e) { cart = []; }
  function saveCart() { try { localStorage.setItem('jam-cart', JSON.stringify(cart)); } catch (e) { /* storage unavailable: cart lives for this visit */ } }
  function totals() {
    var sub = cart.reduce(function (sum, sku) { return sum + J.price(J.bySku(sku)); }, 0);
    var ship = sub === 0 || sub >= J.SHIPPING.freeFrom ? 0 : J.SHIPPING.fee;
    return { sub: sub, ship: ship, total: sub + ship, left: Math.max(0, J.SHIPPING.freeFrom - sub) };
  }
  function updateCount() {
    var el = document.getElementById('cartCount');
    var was = el.textContent;
    el.textContent = nf.format(cart.length);
    el.dataset.full = cart.length > 0;
    // a small jump when the number changes
    if (was !== el.textContent && el.animate && !reduceMotion) {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('is-on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }

  function sumsHtml() {
    var t = totals();
    return '<div class="sums">' +
      '<div><span>المجموع</span><span>' + sar(t.sub) + '</span></div>' +
      '<div><span>الشحن (' + J.SHIPPING.carrier + ')</span><span>' + (t.ship ? sar(t.ship) : 'مجاني') + '</span></div>' +
      '<div class="sums__total"><span>الإجمالي</span><span>' + sar(t.total) + '</span></div></div>';
  }
  function linesHtml(removable) {
    return cart.map(function (sku) {
      var p = J.bySku(sku);
      return '<div class="line"><img src="' + J.img(p.model) + '" alt="' + alt(p) + '" loading="lazy">' +
        '<div><div class="line__name">' + setName(p) + '</div><div class="line__color">' + p.color + '، فري سايز</div>' +
        (removable ? '<button class="line__rm" type="button" data-rm="' + sku + '">حذف من السلة</button>' : '') + '</div>' +
        '<div class="price">' + sar(J.price(p)) + '</div></div>';
    }).join('');
  }
  function renderCart() {
    var body = document.getElementById('cartBody');
    if (!cart.length) {
      body.innerHTML = '<div class="empty"><p>السلة فاضية. اختاري طقمك ولونك.</p><a class="btn" href="#/" data-close>تسوّقي الأطقم</a></div>';
      return;
    }
    var t = totals();
    var pct = Math.min(100, Math.round(t.sub / J.SHIPPING.freeFrom * 100));
    var meter = t.left > 0
      ? '<div class="meter"><p>باقي ' + sar(t.left) + ' على الشحن المجاني</p><div class="meter__bar"><i style="width:' + pct + '%"></i></div></div>'
      : '<div class="meter meter--done"><p>شحنك مجاني</p></div>';
    body.innerHTML = linesHtml(true) + meter + sumsHtml() +
      '<a class="btn btn--wide" href="#/checkout" data-close>إتمام الطلب</a>';
  }

  var lastFocus = null;
  function openCart() {
    lastFocus = document.activeElement;
    renderCart();
    document.getElementById('cart').hidden = false;
    document.getElementById('scrim').hidden = false;
    document.body.style.overflow = 'hidden';
    document.getElementById('cartClose').focus();
  }
  function closeCart() {
    document.getElementById('cart').hidden = true;
    document.getElementById('scrim').hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function addToCart(sku) {
    if (cart.indexOf(sku) === -1) { cart.push(sku); saveCart(); updateCount(); toast('انضاف للسلة'); }
    openCart();
  }
  function removeFromCart(sku) {
    cart = cart.filter(function (s) { return s !== sku; });
    saveCart(); updateCount(); renderCart();
    if (path === '#/checkout') route();
  }

  /* ---------- home ---------- */
  var ICON_NEXT = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PREV = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function coords(c) {
    return Math.abs(c.lat).toFixed(2) + '°' + (c.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(c.lon).toFixed(2) + '°' + (c.lon >= 0 ? 'E' : 'W');
  }
  function lookHtml(p) {
    var c = J.CITIES[p.city];
    return '<a class="look' + (p.stock ? '' : ' look--out') + '" href="' + href(p) + '" data-sku="' + p.sku + '" style="--c:' + p.hex + '" draggable="false">' +
      '<span class="look__img"><img src="' + J.img(p.model) + '" alt="' + alt(p) + '" loading="lazy" width="675" height="900" draggable="false">' +
      '<span class="code">' + c.code + '</span>' + (p.stock ? '' : '<span class="stamp">نفد</span>') + '</span></a>';
  }
  function focusHtml(p) {
    var c = J.CITIES[p.city], inCart = cart.indexOf(p.sku) !== -1;
    return '<div class="focus__info"><p class="focus__color">' + p.color + '</p>' +
      '<p class="focus__city">' + c.ar + '<span class="code-inline">' + c.code + '</span></p></div>' +
      '<div class="focus__buy">' + (p.stock ? priceHtml(p) + (J.SETS[p.set].offer ? saveHtml(p) : '') : '<span class="price price--out">نفد هذا اللون</span>') +
      (p.stock ? '<button class="btn" type="button" data-add="' + p.sku + '">' + (inCart ? 'في السلة، عرض السلة' : 'أضيفي للسلة') + '</button>' : '') +
      '<a class="btn btn--ghost" href="' + href(p) + '">تفاصيل الطقم</a></div>';
  }
  function homeHtml() {
    var first = J.bySku(J.HERO[0]), fc = J.CITIES[first.city];
    var gates = J.HERO.map(function (sku, i) {
      var p = J.bySku(sku), c = J.CITIES[p.city];
      return '<button class="gate" type="button" data-hero="' + i + '" aria-pressed="' + (i === 0) + '">' +
        '<span class="gate__code">' + c.code + '</span><span class="gate__city">' + c.ar + '</span></button>';
    }).join('');
    var pins = J.HERO.map(function (sku, i) {
      var p = J.bySku(sku), c = J.CITIES[p.city];
      return '<button class="pin" type="button" tabindex="-1" data-city="' + p.city + '" data-hero="' + i + '"><span>' + c.code + '</span></button>';
    }).join('');
    var rows = J.SET_ORDER.map(function (k) {
      var s = J.SETS[k], list = J.inSet(k);
      var dots = list.map(function (p) { return '<span class="dot' + (p.stock ? '' : ' dot--out') + '" style="background:' + p.hex + '"></span>'; }).join('');
      return '<a class="row" href="#/set/' + k + '" data-preview="' + J.img(list[0].model) + '" style="--c:' + list[0].hex + '">' +
        '<span class="row__name">' + s.ar + '<small>' + s.en + '</small></span>' +
        '<span class="row__top">' + s.line + '</span><span class="row__dots" aria-hidden="true">' + dots + '</span>' +
        '<span class="row__price">' + nf.format(J.price(list[0])) + '<small>ر.س</small></span></a>';
    }).join('');
    var sets = J.SET_ORDER.map(function (k) {
      var s = J.SETS[k], list = J.inSet(k);
      var sw = list.map(function (p, i) {
        return '<button class="swatch' + (p.stock ? '' : ' swatch--out') + '" type="button" data-flow-go="' + k + ':' + i + '" aria-pressed="false" aria-label="' + p.color + (p.stock ? '' : '، نفد') + '" style="--c:' + p.hex + '"></button>';
      }).join('');
      return '<section class="set" id="set-' + k + '" data-set="' + k + '">' +
        '<div class="set__head"><div><h2 class="set__name">طقم ' + s.ar + '</h2><p class="set__top">' + s.line + '</p></div>' +
        '<div class="set__nav"><button class="arrow" type="button" data-flow-step="' + k + ':-1" aria-label="اللون السابق">' + ICON_PREV + '</button>' +
        '<button class="arrow" type="button" data-flow-step="' + k + ':1" aria-label="اللون التالي">' + ICON_NEXT + '</button></div></div>' +
        '<div class="flow" data-flow="' + k + '">' + list.map(lookHtml).join('') + '</div>' +
        '<div class="set__foot"><div class="swatches" role="group" aria-label="ألوان طقم ' + s.ar + '">' + sw + '</div>' +
        '<div class="focus" id="focus-' + k + '"></div></div></section>';
    }).join('');
    return '<section class="hero"><div class="hero__in">' +
      '<div class="hero__text"><h1 class="hero__title"><span class="ln"><span>طقم واحد.</span></span> <span class="ln"><span>ست مدن.</span></span></h1>' +
      '<p class="hero__lede">أطقم من قطعتين، ولكل لون مدينة. لفّي الكرة واختاري مدينتك.</p>' +
      '<div class="hero__cta"><a class="btn" href="#/set/' + J.SET_ORDER[0] + '">تسوّقي الأطقم</a><span class="hero__price">الأطقم من ' + sar(J.fromPrice()) + '</span></div>' +
      '<div class="gates" role="group" aria-label="المدن">' + gates + '</div></div>' +
      '<div class="stage" id="stage"><div class="orbit" id="orbit"><canvas class="globe" id="globe" aria-hidden="true"></canvas></div>' +
      '<div class="grab" id="grab" aria-hidden="true"></div>' +
      '<div class="pins" id="pins" aria-hidden="true">' + pins + '</div>' +
      '<p class="readout" id="readout" dir="ltr" aria-hidden="true">' + fc.code + ' ' + coords(fc) + '</p>' +
      '<a class="portal" id="heroTag" href="' + href(first) + '"><span class="portal__img" id="portalImg">' +
      '<img class="is-on" id="heroA" src="' + J.img(first.model) + '" alt="' + alt(first) + '" width="675" height="900"><img id="heroB" alt="" width="675" height="900"></span>' +
      '<span class="portal__meta" id="heroMeta"><strong>' + setName(first) + '</strong><span>' + first.color + '، ' + sar(J.price(first)) + '</span></span></a>' +
      '<p class="stage__hint" id="stageHint">اسحبي الكرة</p></div>' +
      '</div></section>' +
      '<section class="index"><div class="index__in"><h2 class="index__title">عبايات المخمل أول، وبعدها أربع قصّات.</h2><div class="index__rows" id="indexRows">' + rows + '</div></div>' +
      '<div class="floater" id="floater" aria-hidden="true"><img alt=""></div></section>' +
      sets +
      '<section class="facts"><dl class="facts__in">' +
      '<div><dt>طقم كامل</dt><dd>السعر يشمل القطعتين</dd></div>' +
      '<div><dt>فري سايز</dt><dd>قصّة واسعة ومريحة</dd></div>' +
      '<div><dt>توصيل أرامكس</dt><dd>' + sar(J.SHIPPING.fee) + '، ومجاني من ' + sar(J.SHIPPING.freeFrom) + '</dd></div>' +
      '<div><dt>واتساب</dt><dd>اسألينا عن أي طقم قبل الطلب</dd></div></dl></section>';
  }

  /* hero: one look per city, shown in the window beside the globe */
  var heroTurn = 0, heroAt = 0, readoutTimer = null;
  function setReadout(c) {
    var el = document.getElementById('readout');
    if (!el) return;
    var final = c.code + ' ' + coords(c);
    clearInterval(readoutTimer);
    if (reduceMotion) { el.textContent = final; return; }
    // numbers roll for a moment before they land on the new city
    var n = 0;
    readoutTimer = setInterval(function () {
      n++;
      if (n >= 9 || !el.isConnected) { clearInterval(readoutTimer); el.textContent = final; return; }
      el.textContent = final.replace(/\d/g, function (d, i) { return i < n * 2 ? d : String(Math.floor(Math.random() * 10)); });
    }, 45);
  }
  function showHero(i, userPicked) {
    var p = J.bySku(J.HERO[i]);
    var a = document.getElementById('heroA'), b = document.getElementById('heroB');
    if (!a) return;
    var url = J.img(p.model), turn = ++heroTurn;
    // Swap photo, tint and label together, and only once the photo has arrived.
    var pre = new Image();
    pre.onload = pre.onerror = function () {
      if (turn !== heroTurn || !a.isConnected) return;
      var next = a.classList.contains('is-on') ? b : a, prev = next === a ? b : a;
      next.src = url; next.alt = alt(p);
      next.classList.add('is-on'); prev.classList.remove('is-on');
      setTone(p.hex);
      document.getElementById('heroTag').href = href(p);
      document.getElementById('heroMeta').innerHTML = '<strong>' + setName(p) + '</strong><span>' + p.color + '، ' + sar(J.price(p)) + '</span>';
    };
    pre.src = url;
    Array.prototype.forEach.call(document.querySelectorAll('.gate'), function (g, n) { g.setAttribute('aria-pressed', n === i); });
    heroAt = i;
    if (globe) globe.flyTo(p.city);
    setReadout(J.CITIES[p.city]);
    if (userPicked) stopHero();
  }
  function stopHero() { clearInterval(heroTimer); heroTimer = null; }
  function startHero() {
    stopHero();
    if (reduceMotion) return;
    heroTimer = setInterval(function () {
      if (document.hidden || window.scrollY > window.innerHeight * 0.7) return;
      showHero((heroAt + 1) % J.HERO.length, false);
    }, 5200);
  }
  function initGlobe() {
    var canvas = document.getElementById('globe');
    if (!canvas || !window.JAMGlobe) return;
    var portal = document.getElementById('heroTag'), orbit = document.getElementById('orbit'), first = J.bySku(J.HERO[0]);
    globe = window.JAMGlobe({
      canvas: canvas, grab: document.getElementById('grab'), pins: document.getElementById('pins'), cities: J.CITIES,
      active: first.city, tone: first.hex, still: reduceMotion,
      // The canvas is 136% of the stage (see .orbit). The planet sits at 42% of the stage and is 80% of it wide.
      geometry: function (w, h) { var m = Math.min(w, h); return { cx: w * 0.4412, cy: h * 0.4412, r: m * 0.2941 }; },
      anchor: function () { return { x: portal.offsetLeft + portal.offsetWidth / 2 - orbit.offsetLeft, y: portal.offsetTop + 4 - orbit.offsetTop }; },
      onPick: function (city) {
        for (var i = 0; i < J.HERO.length; i++) if (J.bySku(J.HERO[i]).city === city) { showHero(i, true); break; }
      },
      onGrab: function () {
        stopHero();
        var hint = document.getElementById('stageHint'); if (hint) hint.classList.add('is-gone');
      }
    });
    // the photo leans a little toward the pointer
    var stage = document.getElementById('stage'), pic = document.getElementById('portalImg');
    if (finePointer && !reduceMotion) {
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        pic.style.transform = 'perspective(900px) rotateY(' + (x * 10).toFixed(2) + 'deg) rotateX(' + (-y * 8).toFixed(2) + 'deg)';
      });
      stage.addEventListener('pointerleave', function () { pic.style.transform = ''; });
    }
  }
  function killHome() {
    stopHero(); clearInterval(readoutTimer);
    if (globe) { globe.destroy(); globe = null; }
    flows = {};
  }

  /* the four sets: each one is a ring of looks that turns as it scrolls */
  var flows = {};
  function flowTarget(f, i) { var c = f.cards[i]; return c.offsetLeft + c.offsetWidth / 2 - f.el.clientWidth / 2; }
  function centerFlow(f, i, instant) {
    i = Math.max(0, Math.min(f.cards.length - 1, i));
    f.el.scrollTo({ left: flowTarget(f, i), behavior: instant || reduceMotion ? 'auto' : 'smooth' });
  }
  function layoutFlow(f) {
    var mid = f.el.scrollLeft + f.el.clientWidth / 2, best = 0, bestD = 1e9;
    f.cards.forEach(function (c, i) {
      var d = (c.offsetLeft + c.offsetWidth / 2 - mid) / c.offsetWidth, ad = Math.abs(d);
      if (ad < bestD) { bestD = ad; best = i; }
      c.style.setProperty('--d', Math.max(-2.6, Math.min(2.6, d)).toFixed(3));
      c.style.setProperty('--ad', Math.min(2.6, ad).toFixed(3));
    });
    if (best !== f.focus) setFlowFocus(f, best);
  }
  function setFlowFocus(f, i) {
    f.focus = i;
    var p = f.items[i];
    f.cards.forEach(function (c, n) { c.classList.toggle('is-focus', n === i); });
    Array.prototype.forEach.call(f.section.querySelectorAll('.swatch'), function (s, n) { s.setAttribute('aria-pressed', n === i); });
    f.section.style.setProperty('--c', p.hex);
    f.panel.innerHTML = focusHtml(p);
    var arrows = f.section.querySelectorAll('.arrow');
    arrows[0].disabled = i === 0; arrows[1].disabled = i === f.cards.length - 1;
  }
  function initFlows() {
    flows = {};
    Array.prototype.forEach.call(document.querySelectorAll('.flow'), function (el) {
      var set = el.dataset.flow;
      var f = { el: el, set: set, cards: Array.prototype.slice.call(el.children), items: J.inSet(set), focus: -1, raf: 0,
        section: document.getElementById('set-' + set), panel: document.getElementById('focus-' + set) };
      flows[set] = f;
      el.addEventListener('scroll', function () {
        if (!f.raf) f.raf = requestAnimationFrame(function () { f.raf = 0; layoutFlow(f); });
      }, { passive: true });
      // mouse: grab the ring and pull it
      var st = null;
      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button) return;
        st = { x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId };
      });
      el.addEventListener('pointermove', function (e) {
        if (!st) return;
        var dx = e.clientX - st.x;
        if (!st.moved && Math.abs(dx) < 6) return;
        if (!st.moved) { st.moved = true; el.classList.add('is-dragging'); try { el.setPointerCapture(st.id); } catch (err) { /* no capture */ } }
        el.scrollLeft = st.left - dx;
      });
      function end() {
        if (!st) return;
        var moved = st.moved; st = null;
        if (!moved) return;
        centerFlow(f, f.focus);
        el.classList.remove('is-dragging');
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('dragstart', function (e) { e.preventDefault(); });
      centerFlow(f, Math.min(2, Math.floor((f.cards.length - 1) / 2)), true);
      layoutFlow(f);
    });
  }
  window.addEventListener('resize', function () {
    Object.keys(flows).forEach(function (k) { var f = flows[k]; if (f.el.isConnected) { centerFlow(f, f.focus, true); layoutFlow(f); } });
  });

  /* the list of sets: a photo follows the pointer along the rows */
  function initFloater() {
    var box = document.getElementById('floater'), rows = document.getElementById('indexRows');
    if (!box || !rows || !finePointer) return;
    var img = box.firstChild;
    rows.addEventListener('pointermove', function (e) {
      var row = e.target.closest('.row');
      if (!row) { box.classList.remove('is-on'); return; }
      if (img.getAttribute('src') !== row.dataset.preview) img.src = row.dataset.preview;
      box.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
      box.classList.add('is-on');
    });
    rows.addEventListener('pointerleave', function () { box.classList.remove('is-on'); });
  }
  function initHome() {
    initGlobe();
    initFlows();
    initFloater();
  }

  /* ---------- product page ---------- */
  function productHtml(p) {
    var s = J.SETS[p.set], c = J.CITIES[p.city];
    var inCart = cart.indexOf(p.sku) !== -1;
    var dest = J.inSet(p.set).map(function (q) {
      var qc = J.CITIES[q.city];
      return '<a class="dest__item' + (q.stock ? '' : ' dest__item--out') + '" href="' + href(q) + '"' + (q.sku === p.sku ? ' aria-current="true"' : '') + ' style="--c:' + q.hex + '">' +
        '<span class="dot" style="background:' + q.hex + '"></span>' +
        '<span><span class="dest__color">' + q.color + '</span><span class="dest__city">' + (q.stock ? qc.ar : 'نفد') + '</span></span>' +
        '<span class="dest__code">' + qc.code + '</span></a>';
    }).join('');
    var labels = s.shots || [];
    var thumbs = '<button class="thumb" type="button" aria-pressed="true" data-img="' + J.img(p.model) + '"><img src="' + J.img(p.model) + '" alt="' + (labels[0] || 'صورة العارضة') + '"></button>' +
      (p.flat ? '<button class="thumb thumb--flat" type="button" aria-pressed="false" data-flat="1" data-img="' + J.img(p.flat) + '"><img src="' + J.img(p.flat) + '" alt="صورة القطعتين" loading="lazy"></button>' : '') +
      p.more.map(function (id, i) {
        return '<button class="thumb" type="button" aria-pressed="false" data-img="' + J.img(id) + '"><img src="' + J.img(id) + '" alt="' + (labels[i + 1] || 'صورة إضافية') + '" loading="lazy"></button>';
      }).join('');
    var buy = p.stock
      ? '<button class="btn btn--wide" type="button" data-add="' + p.sku + '">' + (inCart ? 'في السلة، عرض السلة' : 'أضيفي للسلة') + '</button>' +
        '<p class="buy__note">توصيل ' + J.SHIPPING.carrier + ' ' + sar(J.SHIPPING.fee) + '، ومجاني للطلبات من ' + sar(J.SHIPPING.freeFrom) + '.</p>'
      : '<button class="btn btn--wide" type="button" disabled>نفد هذا اللون</button><p class="buy__note">اختاري لون ثاني من نفس الطقم.</p>';
    var more = J.SET_ORDER.filter(function (k) { return k !== p.set; }).map(function (k) {
      var q = J.inSet(k)[0];
      return '<a class="mini" href="' + href(q) + '" style="--c:' + q.hex + '"><span class="mini__img"><img src="' + J.img(q.model) + '" alt="' + alt(q) + '" loading="lazy" width="675" height="900"></span>' +
        '<span class="mini__name">طقم ' + J.SETS[k].ar + '</span><span class="mini__top">' + J.SETS[k].top + '</span></a>';
    }).join('');
    return '<section class="pdp"><div class="pdp__in">' +
      '<div class="gallery"><div class="gallery__main" id="zoom"><img id="mainImg" src="' + J.img(p.model) + '" alt="' + alt(p) + '" width="675" height="900">' +
      '<span class="code code--big">' + c.code + '</span><span class="gallery__coords" dir="ltr">' + coords(c) + '</span></div>' +
      '<div class="gallery__thumbs">' + thumbs + '</div></div>' +
      '<div class="pdp__info"><p class="crumb"><a href="#/">الرئيسية</a> / <a href="#/set/' + p.set + '">طقم ' + s.ar + '</a></p>' +
      '<h1 class="pdp__title">طقم ' + s.ar + '</h1>' +
      '<p class="pdp__sub">' + p.color + '، ' + c.ar + '</p>' +
      '<p class="pdp__price">' + priceHtml(p) + saveHtml(p) + '</p>' +
      '<div class="dest"><p class="dest__label">اختاري اللون</p><div class="dest__list">' + dest + '</div></div>' +
      '<div class="buy">' + buy + '</div>' +
      '<dl class="spec"><div><dt>القطع</dt><dd>' + s.line + '</dd></div>' +
      '<div><dt>المقاس</dt><dd>فري سايز</dd></div>' +
      '<div><dt>اللون</dt><dd>' + p.color + '</dd></div>' +
      '<div><dt>السعر</dt><dd>يشمل القطعتين: ' + s.pieces + '</dd></div>' +
      '<div><dt>الاسترجاع</dt><dd><a href="#/returns">استرجاع أو استبدال خلال ٣٠ يوم</a></dd></div></dl>' +
      '</div></div>' +
      '<div class="more"><h2 class="more__title">قصّات ثانية</h2><div class="more__list">' + more + '</div></div></section>';
  }
  /* product photo: move the pointer over it to look closer */
  function initZoom() {
    var box = document.getElementById('zoom'), img = document.getElementById('mainImg');
    if (!box || !finePointer) return;
    box.addEventListener('pointermove', function (e) {
      if (box.classList.contains('is-flat')) return;
      var r = box.getBoundingClientRect();
      img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '% ' + ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
      box.classList.add('is-zoom');
    });
    box.addEventListener('pointerleave', function () { box.classList.remove('is-zoom'); });
  }

  /* ---------- checkout ---------- */
  function checkoutHtml() {
    if (!cart.length) {
      return '<section class="co"><h1>إتمام الطلب</h1><div class="empty"><div id="emptyNotice" class="notice" role="status" hidden></div><p>السلة فاضية. اختاري طقمك أول.</p><a class="btn" href="#/">تسوّقي الأطقم</a></div></section>';
    }
    if (paymentsOn && orderOpen()) return payHtml();
    var t = totals();
    return '<section class="co"><h1>إتمام الطلب</h1>' +
      '<form class="form" id="coForm" novalidate>' +
      '<h2>بيانات التوصيل</h2>' +
      field('name', 'الاسم الكامل', 'autocomplete="name" required') +
      field('phone', 'رقم الجوال', 'type="tel" inputmode="numeric" autocomplete="tel" placeholder="05XXXXXXXX" dir="ltr" required') +
      '<div class="form__row">' + field('city', 'المدينة', 'autocomplete="address-level2" required') + field('district', 'الحي', 'required') + '</div>' +
      field('address', 'العنوان (الشارع ورقم المبنى)', 'autocomplete="street-address" required') +
      '<h2>الشحن</h2>' +
      '<div class="ship"><strong>' + J.SHIPPING.carrier + '</strong><span>مجاني للطلبات من ' + sar(J.SHIPPING.freeFrom) + '</span><b>' + (t.ship ? sar(t.ship) : 'مجاني') + '</b></div>' +
      '<button class="btn btn--wide" type="submit">ادفعي ' + sar(t.total) + '</button>' +
      '<div id="coNotice" hidden class="notice" role="status"></div>' +
      '</form>' +
      '<aside class="summary" aria-label="ملخص الطلب"><h2>طلبك</h2>' + linesHtml(false) + sumsHtml() + '</aside></section>';
  }
  function field(id, label, attrs) {
    return '<div class="field" data-field="' + id + '"><label for="f-' + id + '">' + label + '</label><input id="f-' + id + '" name="' + id + '" value="' + esc(customer[id]) + '" ' + attrs + '><p class="field__err" id="e-' + id + '"></p></div>';
  }
  function payHtml() {
    return '<section class="co"><h1>الدفع</h1>' +
      '<div class="pay">' +
      '<h2>طلب رقم ' + order.number + '</h2>' +
      '<p class="pay__to">التوصيل إلى: ' + esc(customer.name) + '، ' + esc(customer.city) + '، ' + esc(customer.district) + '، ' + esc(customer.address) + '. ' +
      '<button class="link" type="button" data-edit>تعديل البيانات</button></p>' +
      '<p class="pay__hold">حجزنا لك القطع ٢٠ دقيقة لين تكملين الدفع.</p>' +
      '<div id="payForm"><div class="mysr-form"></div></div>' +
      '<div id="payNotice" class="notice" role="status" hidden></div>' +
      '</div>' +
      '<aside class="summary" aria-label="ملخص الطلب"><h2>طلبك</h2>' + linesHtml(false) + sumsHtml() + '</aside></section>';
  }
  var moyasarAssets = null;
  function loadMoyasar() {
    if (moyasarAssets) return moyasarAssets;
    moyasarAssets = new Promise(function (resolve, reject) {
      var css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.css';
      document.head.appendChild(css);
      var js = document.createElement('script');
      js.src = 'https://cdn.moyasar.com/mpf/1.15.0/moyasar.js';
      js.onload = resolve;
      js.onerror = function () { moyasarAssets = null; reject(new Error('moyasar')); };
      document.head.appendChild(js);
    });
    return moyasarAssets;
  }
  function mountPayment() {
    var forOrder = order.id;
    loadMoyasar().then(function () {
      if (!order || order.id !== forOrder || !document.getElementById('payForm')) return;
      window.Moyasar.init({
        // Moyasar renames the element it mounts on, so it gets its own inner div and a class selector.
        element: '.mysr-form',
        amount: order.total,
        currency: 'SAR',
        description: 'طلب JAM رقم ' + order.number,
        publishable_api_key: payKey,
        callback_url: location.origin + location.pathname,
        methods: ['creditcard'],
        supported_networks: ['mada', 'visa', 'mastercard'],
        language: 'ar',
        fixed_width: false,
        metadata: { order_id: order.id, order_number: String(order.number) },
        // Tell the shop which payment belongs to this order before the bank page opens.
        on_completed: function (payment) {
          return api('/orders/' + forOrder + '/payment', { payment_id: payment.id }).catch(function () {});
        }
      });
    }).catch(function () {
      var n = document.getElementById('payNotice');
      if (n) { n.hidden = false; n.textContent = 'ما قدرنا نفتح نموذج الدفع. تأكدي من الاتصال وحدّثي الصفحة.'; }
    });
  }
  function resultHtml(title, lines, actions) {
    return '<section class="co co--result"><h1>' + title + '</h1><div class="result">' +
      lines.map(function (l) { return '<p>' + l + '</p>'; }).join('') +
      '<div class="result__actions">' + actions + '</div></div></section>';
  }
  function itemsLine(items) {
    return (items || []).map(function (i) { return esc(i.name) + '، ' + esc(i.color); }).join(' / ');
  }
  function showResult(html, title) {
    killHome();
    app.innerHTML = html;
    current = 'result';
    document.title = title + ' | JAM';
    toTop();
  }
  var shopLink = '<a class="btn" href="#/">رجوع للمتجر</a>';
  var helpLink = '<a class="btn btn--ghost" href="' + WHATSAPP + '" target="_blank" rel="noopener">كلمينا واتساب</a>';
  function confirmPayment(paymentId, tries) {
    showResult(resultHtml('نتأكد من الدفع', ['لحظة، لا تقفلين الصفحة.'], ''), 'نتأكد من الدفع');
    api('/confirm', { payment_id: paymentId }).then(function (r) {
      var d = r.data || {}, num = d.number ? String(d.number) : '';
      if (d.status === 'paid') {
        cart = []; saveCart(); updateCount();
        order = null; store('jam-order', null);
        (d.items || []).forEach(function (i) { var p = J.bySku(i.sku); if (p) p.stock = 0; });
        showResult(resultHtml('تم الطلب', [
          'رقم طلبك <strong>' + num + '</strong>. احتفظي فيه.',
          itemsLine(d.items),
          'المدفوع: ' + sar(d.total / 100) + '.',
          'نجهّز طلبك ونشحنه مع ' + J.SHIPPING.carrier + '. أي سؤال، كلمينا واتساب ومعك رقم الطلب.'
        ], shopLink + helpLink), 'تم الطلب');
      } else if (d.status === 'oversold') {
        showResult(resultHtml('القطعة انباعت قبل وصول دفعتك', [
          'دفعتك وصلت بعد ما انتهى وقت الحجز، والقطعة أخذتها عميلة ثانية.',
          'بنرجّع لك المبلغ كامل (' + sar(d.total / 100) + '). رقم طلبك <strong>' + num + '</strong>.'
        ], helpLink + shopLink), 'القطعة انباعت');
      } else if (d.status === 'waiting' && tries < 5) {
        setTimeout(function () { confirmPayment(paymentId, tries + 1); }, 3000);
      } else if (d.status === 'failed' || d.status === 'waiting') {
        showResult(resultHtml('ما تمت عملية الدفع', [
          d.message ? 'رد البنك: ' + esc(d.message) + '.' : 'البنك ما قبل العملية.',
          'ما انخصم منك شي. ' + (d.order_open ? 'القطع لسا محجوزة لك، جربي ببطاقة ثانية.' : 'انتهى وقت الحجز، ارجعي للسلة واطلبي من جديد.')
        ], (d.order_open ? '<a class="btn" href="#/checkout">جربي مرة ثانية</a>' : shopLink) + helpLink), 'ما تمت عملية الدفع');
      } else {
        showResult(resultHtml('ما قدرنا نتأكد من الدفع', [
          'لا تدفعين مرة ثانية. كلمينا واتساب' + (num ? ' ومعك رقم الطلب <strong>' + num + '</strong>' : '') + ' ونتأكد لك.'
        ], helpLink + shopLink), 'ما قدرنا نتأكد من الدفع');
      }
    }).catch(function () {
      showResult(resultHtml('ما قدرنا نتأكد من الدفع', [
        'الاتصال انقطع. لا تدفعين مرة ثانية.',
        'حدّثي الصفحة، وإذا تكرر كلمينا واتساب.'
      ], '<button class="btn" type="button" data-reload>تحديث الصفحة</button>' + helpLink), 'ما قدرنا نتأكد من الدفع');
    });
  }
  function submitOrder(form) {
    var btn = form.querySelector('button[type="submit"]'), label = btn.textContent;
    var notice = document.getElementById('coNotice');
    function say(msg) { notice.hidden = false; notice.textContent = msg; btn.disabled = false; btn.textContent = label; }
    ['name', 'phone', 'city', 'district', 'address'].forEach(function (k) { customer[k] = form.elements[k].value.trim(); });
    customer.phone = customer.phone.replace(/\s/g, '');
    store('jam-customer', customer);
    btn.disabled = true; btn.textContent = 'لحظة…'; notice.hidden = true;
    api('/orders', { items: cart, customer: customer }).then(function (r) {
      var d = r.data || {};
      if (r.ok && d.id) {
        order = { id: d.id, number: d.number, total: d.total, expires_at: d.expires_at, skus: cart.slice() };
        store('jam-order', order);
        route();
      } else if (d.error === 'sold_out') {
        var names = (d.skus || []).map(function (sku) {
          var p = J.bySku(sku); if (!p) return '';
          p.stock = 0; return setName(p) + ' ' + p.color;
        }).filter(Boolean);
        cart = cart.filter(function (sku) { return (d.skus || []).indexOf(sku) === -1; });
        saveCart(); updateCount(); route();
        var n = document.getElementById('coNotice') || document.getElementById('emptyNotice');
        if (n) { n.hidden = false; n.textContent = 'انباع قبل شوي: ' + names.join('، ') + '. شلناه من سلتك.'; }
      } else if (d.error === 'too_many') {
        say('عندك أكثر من طلب مفتوح. كمّلي دفع واحد منها أو جربي بعد ٢٠ دقيقة.');
      } else {
        say('ما قدرنا نفتح الطلب. راجعي البيانات وجربي مرة ثانية.');
      }
    }).catch(function () { say('الاتصال انقطع. جربي مرة ثانية.'); });
  }
  function loadStock() {
    if (!configured) return;
    api('/stock').then(function (r) {
      if (!r.ok || !r.data.stock) return;
      payKey = r.data.pay_key || '';
      testMode = r.data.mode !== 'live';
      var on = !!r.data.payments && !!payKey && mayPay();
      var turnedOn = !paymentsOn && on;
      paymentsOn = on;
      setPreviewBar();
      // Reloaded in the middle of paying: bring the payment step back.
      if (turnedOn && current === 'checkout' && orderOpen() && !document.getElementById('payForm')) route();
      var changed = false;
      J.PRODUCTS.forEach(function (p) {
        if (!(p.sku in r.data.stock)) return;
        var v = r.data.stock[p.sku] ? 1 : 0;
        // A piece held by this shopper's own open order still counts as theirs.
        if (!v && order && order.skus.indexOf(p.sku) !== -1 && new Date(order.expires_at) > new Date()) v = 1;
        if (p.stock !== v) { p.stock = v; changed = true; }
      });
      var kept = cart.filter(function (sku) { var p = J.bySku(sku); return p && p.stock > 0; });
      if (kept.length !== cart.length) { cart = kept; saveCart(); updateCount(); changed = true; }
      if (changed && current !== 'result' && !document.getElementById('payForm')) { current = ''; route(); }
    }).catch(function () { /* keep the stock that shipped with the page */ });
  }
  function validate(form) {
    var ok = true, first = null;
    var rules = {
      name: function (v) { return v.trim().length >= 3 ? '' : 'اكتبي اسمك الكامل.'; },
      phone: function (v) { return /^05\d{8}$/.test(v.replace(/\s/g, '')) ? '' : 'رقم الجوال يبدأ بـ 05 ويتكوّن من 10 أرقام.'; },
      city: function (v) { return v.trim() ? '' : 'اكتبي المدينة.'; },
      district: function (v) { return v.trim() ? '' : 'اكتبي الحي.'; },
      address: function (v) { return v.trim().length >= 5 ? '' : 'اكتبي الشارع ورقم المبنى.'; }
    };
    Object.keys(rules).forEach(function (k) {
      var input = form.elements[k], msg = rules[k](input.value);
      document.getElementById('e-' + k).textContent = msg;
      input.closest('.field').classList.toggle('field--bad', !!msg);
      input.setAttribute('aria-invalid', !!msg);
      if (msg) { ok = false; first = first || input; }
    });
    if (first) first.focus();
    return ok;
  }

  /* ---------- returns policy ---------- */
  function returnsHtml() {
    return '<section class="co co--result"><h1>الاسترجاع والاستبدال</h1><div class="result">' +
      '<p>تقدرين ترجّعين طلبك أو تبدّلينه خلال ٣٠ يوم من استلامه.</p>' +
      '<p>للترجيع أو التبديل كلمينا واتساب ومعك رقم الطلب، ونرتّب معك الباقي.</p>' +
      '<p>في الاسترجاع، المبلغ يرجع على نفس البطاقة اللي دفعتي فيها. مدة وصوله تعتمد على بنكك.</p>' +
      '<div class="result__actions">' + helpLink + shopLink + '</div></div></section>';
  }

  /* ---------- router ---------- */
  var current = '', introDone = false;
  // A new page starts at its top at once, without the smooth scroll the rest of the site uses.
  function toTop() { try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { window.scrollTo(0, 0); } }
  // The page on show, written like the address hash ("#/p/amalfi/pink"). On the live site it mirrors the address bar.
  // Inside someone else's frame (a preview) the address is left alone and the pages change in place.
  var path = location.hash || '#/';
  var framed = false;
  try { framed = window.top !== window.self; } catch (e) { framed = true; }
  function go(to) {
    path = to || '#/';
    if (!document.getElementById('cart').hidden) closeCart();
    if (!framed) { try { if (location.hash !== path) location.hash = path; } catch (e) { /* the page still changes below */ } }
    navigate();
  }
  function route() {
    var h = path.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var view = parts[0] || 'home';
    var wasProduct = current === 'p';
    stopHero();
    Array.prototype.forEach.call(document.querySelectorAll('.top__nav a'), function (a) {
      a.setAttribute('aria-current', (view === 'set' || view === 'p') && a.getAttribute('href') === '#/set/' + parts[1]);
    });
    document.body.dataset.view = view === 'set' ? 'home' : view;

    if (view === 'p') {
      var p = J.bySku(parts[1] + '-' + parts[2]);
      if (!p) { go('#/'); return; }
      killHome();
      setTone(p.hex);
      app.innerHTML = productHtml(p);
      initZoom();
      document.title = 'طقم ' + J.SETS[p.set].ar + ' ' + p.color + ' | JAM';
      if (!wasProduct) toTop();
    } else if (view === 'returns') {
      killHome();
      app.innerHTML = returnsHtml();
      document.title = 'الاسترجاع والاستبدال | JAM';
      toTop();
    } else if (view === 'checkout') {
      killHome();
      app.innerHTML = checkoutHtml();
      document.title = 'إتمام الطلب | JAM';
      toTop();
      if (document.getElementById('payForm')) mountPayment();
    } else {
      if (current !== 'home') {
        killHome();
        app.classList.toggle('intro', !introDone); introDone = true;
        app.innerHTML = homeHtml();
        heroAt = 0;
        setTone(J.bySku(J.HERO[0]).hex);
        initHome();
        document.title = 'JAM | أطقم نسائية متناسقة';
      }
      startHero();
      if (view === 'set' && J.SETS[parts[1]]) {
        var el = document.getElementById('set-' + parts[1]);
        requestAnimationFrame(function () { el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });
      } else if (current !== 'home') {
        toTop();
      } else if (view === 'home' && window.scrollY > 40) {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      view = 'home';
    }
    current = view;
  }
  // Moving between pages: the photo the shopper tapped grows into the product photo where the browser can do it.
  function navigate() {
    var next = (path.replace(/^#\/?/, '').split('/')[0]) || 'home';
    var staysHome = current === 'home' && (next === 'home' || next === 'set');
    if (!document.startViewTransition || reduceMotion || staysHome) { route(); return; }
    try {
      var vt = document.startViewTransition(route);
      vt.ready.catch(function () { /* the page still changed, only the animation was skipped */ });
      vt.finished.catch(function () {});
    } catch (e) { route(); }
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    // mark the tapped photo so it can grow into the product photo
    var link = e.target.closest('a[href^="#/p/"]');
    if (link && !document.getElementById('mainImg')) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-vt]'), function (n) { n.style.viewTransitionName = ''; n.removeAttribute('data-vt'); });
      var im = link.querySelector('img.is-on') || link.querySelector('img');
      if (im) { im.style.viewTransitionName = 'look'; im.setAttribute('data-vt', ''); }
    }
    // links inside the shop change the page here, so they also work where the address bar is out of reach
    var nav = e.target.closest('a[href^="#/"]');
    if (nav && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.button) {
      e.preventDefault();
      go(nav.getAttribute('href'));
      return;
    }
    var t = e.target.closest('[data-hero],[data-add],[data-rm],[data-close],[data-edit],[data-reload],[data-flow-go],[data-flow-step],.thumb');
    if (!t) return;
    if (t.hasAttribute('data-reload')) { location.reload(); return; }
    // Back to the delivery form. Sending it again opens a fresh order and drops this hold.
    if (t.hasAttribute('data-edit')) { order = null; store('jam-order', null); route(); return; }
    if (t.dataset.hero !== undefined) { showHero(+t.dataset.hero, true); return; }
    if (t.dataset.flowGo) { var g = t.dataset.flowGo.split(':'); if (flows[g[0]]) centerFlow(flows[g[0]], +g[1]); return; }
    if (t.dataset.flowStep) { var s = t.dataset.flowStep.split(':'); if (flows[s[0]]) centerFlow(flows[s[0]], flows[s[0]].focus + (+s[1])); return; }
    if (t.dataset.add) { addToCart(t.dataset.add); t.textContent = 'في السلة، عرض السلة'; return; }
    if (t.dataset.rm) { removeFromCart(t.dataset.rm); return; }
    if (t.hasAttribute('data-close')) { closeCart(); return; }
    if (t.classList.contains('thumb')) {
      var main = document.getElementById('mainImg');
      main.src = t.dataset.img;
      main.parentNode.classList.toggle('is-flat', !!t.dataset.flat);
      main.parentNode.classList.remove('is-zoom');
      Array.prototype.forEach.call(document.querySelectorAll('.thumb'), function (b) { b.setAttribute('aria-pressed', b === t); });
    }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id !== 'coForm') return;
    e.preventDefault();
    if (!validate(e.target)) return;
    if (paymentsOn) { submitOrder(e.target); return; }
    var n = document.getElementById('coNotice');
    n.hidden = false;
    n.textContent = 'بياناتك صحيحة. الدفع الإلكتروني يتفعّل عند إطلاق الموقع، وهذي نسخة معاينة ما تسجّل أي طلب.';
    n.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  });
  document.getElementById('cartBtn').addEventListener('click', openCart);
  document.getElementById('cartClose').addEventListener('click', closeCart);
  document.getElementById('scrim').addEventListener('click', closeCart);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.getElementById('cart').hidden) closeCart(); });
  // back and forward buttons, or an address typed by hand
  window.addEventListener('hashchange', function () {
    if (framed || (location.hash || '#/') === path) return;
    path = location.hash || '#/';
    if (!document.getElementById('cart').hidden) closeCart();
    navigate();
  });
  // the header gets a solid back once the page moves under it
  var topBar = document.getElementById('top');
  function onScroll() { topBar.classList.toggle('is-stuck', window.scrollY > 12); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  updateCount();
  // Coming back from the bank page: Moyasar adds ?id=<payment> to the address.
  var returned = new URLSearchParams(location.search).get('id');
  if (returned && configured) {
    paymentsOn = true; setPreviewBar();
    history.replaceState(null, '', location.pathname);
    confirmPayment(returned, 0);
  } else {
    route();
  }
  loadStock();
})();
