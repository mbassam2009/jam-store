(function () {
  'use strict';
  var J = window.JAM;
  var app = document.getElementById('app');
  var nf = new Intl.NumberFormat('ar-SA');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var heroTimer = null;

  function sar(n) { return nf.format(n) + ' ر.س'; }
  function priceHtml() { return '<span class="price">' + sar(J.PRICE) + '<s>' + nf.format(J.COMPARE_AT) + '</s></span>'; }
  function setName(p) { return 'طقم ' + J.SETS[p.set].ar; }
  function alt(p) { return setName(p) + ' ' + p.color + ' في ' + J.CITIES[p.city].ar; }
  function href(p) { return '#/p/' + p.set + '/' + p.key; }
  function setTone(hex) { document.documentElement.style.setProperty('--tone', hex); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var WHATSAPP = 'https://wa.me/966558166661';

  /* ---------- shop API (orders, stock, payment check) ---------- */
  var configured = !!(J.API && J.PAY_KEY);
  var paymentsOn = false; // turns true once the shop API says it can verify payments
  // Test keys: checkout is only for someone who opened the site with ?test=1 in this tab.
  var testKey = J.PAY_KEY.indexOf('pk_test_') === 0;
  var tester = false;
  try {
    if (new URLSearchParams(location.search).get('test') === '1') sessionStorage.setItem('jam-test', '1');
    tester = sessionStorage.getItem('jam-test') === '1';
  } catch (e) { tester = /[?&]test=1/.test(location.search); }
  var mayPay = !testKey || tester;
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
    var test = testKey;
    bar.hidden = !test;
    if (test) bar.textContent = 'وضع تجريبي. الدفع ببطاقات اختبار فقط، وما ينخصم أي مبلغ.';
  }

  /* ---------- cart (kept in this browser only) ---------- */
  var cart = [];
  try { cart = JSON.parse(localStorage.getItem('jam-cart') || '[]').filter(function (s) { var p = J.bySku(s); return p && p.stock > 0; }); } catch (e) { cart = []; }
  function saveCart() { try { localStorage.setItem('jam-cart', JSON.stringify(cart)); } catch (e) { /* storage unavailable: cart lives for this visit */ } }
  function totals() {
    var sub = cart.length * J.PRICE;
    var ship = sub === 0 || sub >= J.SHIPPING.freeFrom ? 0 : J.SHIPPING.fee;
    return { sub: sub, ship: ship, total: sub + ship, left: Math.max(0, J.SHIPPING.freeFrom - sub) };
  }
  function updateCount() {
    var el = document.getElementById('cartCount');
    el.textContent = nf.format(cart.length);
    el.dataset.full = cart.length > 0;
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
        '<div class="price">' + sar(J.PRICE) + '</div></div>';
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
    if (location.hash === '#/checkout') route();
  }

  /* ---------- home ---------- */
  function cardHtml(p) {
    var c = J.CITIES[p.city];
    return '<a class="card' + (p.stock ? '' : ' card--out') + '" href="' + href(p) + '" style="--c:' + p.hex + '">' +
      '<div class="card__img"><img src="' + J.img(p.model) + '" alt="' + alt(p) + '" loading="lazy" width="675" height="900">' +
      '<span class="card__city">' + c.code + '</span>' + (p.stock ? '' : '<span class="stamp">نفد</span>') + '</div>' +
      '<div class="card__meta"><span class="card__dot"></span>' +
      '<span class="card__color">' + p.color + ' <span class="card__where">' + c.ar + '</span></span>' +
      (p.stock ? priceHtml() : '<span class="price">نفد</span>') + '</div></a>';
  }
  function homeHtml() {
    var first = J.bySku(J.HERO[0]);
    var gates = J.HERO.map(function (sku, i) {
      var p = J.bySku(sku), c = J.CITIES[p.city];
      return '<button class="gate" type="button" data-hero="' + i + '" aria-pressed="' + (i === 0) + '">' +
        '<span class="gate__code">' + c.code + '</span><span class="gate__city">' + c.ar + '</span></button>';
    }).join('');
    var rows = J.SET_ORDER.map(function (k) {
      var s = J.SETS[k];
      var dots = J.inSet(k).map(function (p) { return '<span class="dot' + (p.stock ? '' : ' dot--out') + '" style="background:' + p.hex + '"></span>'; }).join('');
      return '<a class="flight" href="#/set/' + k + '"><span class="flight__name">' + s.ar + '<small>' + s.en + '</small></span>' +
        '<span class="flight__top">' + s.top + ' مع بنطلون واسع</span><span class="flight__dots" aria-hidden="true">' + dots + '</span>' +
        '<span class="flight__price">' + nf.format(J.PRICE) + '</span></a>';
    }).join('');
    var sets = J.SET_ORDER.map(function (k) {
      var s = J.SETS[k];
      return '<section class="set" id="set-' + k + '"><div class="set__head"><h2 class="set__name">طقم ' + s.ar + '</h2>' +
        '<p class="set__top">' + s.top + ' مع بنطلون واسع</p></div><div class="rail">' + J.inSet(k).map(cardHtml).join('') + '</div></section>';
    }).join('');
    return '<section class="hero"><div class="hero__in">' +
      '<div class="hero__text"><h1 class="hero__title"><span>طقم واحد.</span><span>ست مدن.</span></h1>' +
      '<p class="hero__lede">بلوزة وبنطلون واسع بلون واحد. كل لون صوّرناه في مدينة، اختاري لونك.</p>' +
      '<div class="hero__cta"><a class="btn" href="#/set/amalfi">تسوّقي الأطقم</a></div></div>' +
      '<div class="window-wrap"><div class="window"><img class="is-on" id="heroA" src="' + J.img(first.model) + '" alt="' + alt(first) + '" width="675" height="900"><img id="heroB" alt="" width="675" height="900"></div>' +
      '<a class="tag" id="heroTag" href="' + href(first) + '"><strong>' + setName(first) + '</strong><span>' + first.color + '، ' + sar(J.PRICE) + '</span></a></div>' +
      '<div class="gates" role="group" aria-label="المدن">' + gates + '</div></div></section>' +
      '<section class="board"><div class="board__in"><h2 class="board__title">أربع قصّات، وكل طقم بسعر واحد.</h2><div class="board__rows">' + rows + '</div></div></section>' +
      sets +
      '<section class="facts"><dl class="facts__in">' +
      '<div><dt>طقم كامل</dt><dd>السعر يشمل البلوزة والبنطلون</dd></div>' +
      '<div><dt>فري سايز</dt><dd>قصّة واسعة ومريحة</dd></div>' +
      '<div><dt>توصيل أرامكس</dt><dd>' + sar(J.SHIPPING.fee) + '، ومجاني من ' + sar(J.SHIPPING.freeFrom) + '</dd></div>' +
      '<div><dt>واتساب</dt><dd>اسألينا عن أي طقم قبل الطلب</dd></div></dl></section>';
  }
  var heroTurn = 0;
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
      var tag = document.getElementById('heroTag');
      tag.href = href(p);
      tag.innerHTML = '<strong>' + setName(p) + '</strong><span>' + p.color + '، ' + sar(J.PRICE) + '</span>';
    };
    pre.src = url;
    Array.prototype.forEach.call(document.querySelectorAll('.gate'), function (g, n) { g.setAttribute('aria-pressed', n === i); });
    app.dataset.hero = i;
    if (userPicked) stopHero();
  }
  function stopHero() { clearInterval(heroTimer); heroTimer = null; }
  function startHero() {
    stopHero();
    if (reduceMotion) return;
    heroTimer = setInterval(function () {
      if (document.hidden) return;
      showHero(((+app.dataset.hero || 0) + 1) % J.HERO.length, false);
    }, 3800);
  }

  /* ---------- product page ---------- */
  function productHtml(p) {
    var s = J.SETS[p.set], c = J.CITIES[p.city];
    var inCart = cart.indexOf(p.sku) !== -1;
    var dest = J.inSet(p.set).map(function (q) {
      var qc = J.CITIES[q.city];
      return '<a class="dest__item' + (q.stock ? '' : ' dest__item--out') + '" href="' + href(q) + '"' + (q.sku === p.sku ? ' aria-current="true"' : '') + '>' +
        '<span class="dot" style="background:' + q.hex + '"></span>' +
        '<span><span class="dest__color">' + q.color + '</span><span class="dest__city">' + (q.stock ? qc.ar : 'نفد') + '</span></span>' +
        '<span class="dest__code">' + qc.code + '</span></a>';
    }).join('');
    var thumbs = '<button class="thumb" type="button" aria-pressed="true" data-img="' + J.img(p.model) + '"><img src="' + J.img(p.model) + '" alt="صورة العارضة"></button>' +
      (p.flat ? '<button class="thumb" type="button" aria-pressed="false" data-img="' + J.img(p.flat) + '"><img src="' + J.img(p.flat) + '" alt="صورة القطعتين" loading="lazy"></button>' : '');
    var buy = p.stock
      ? '<button class="btn btn--wide" type="button" data-add="' + p.sku + '">' + (inCart ? 'في السلة، عرض السلة' : 'أضيفي للسلة') + '</button>' +
        '<p class="buy__note">توصيل ' + J.SHIPPING.carrier + ' ' + sar(J.SHIPPING.fee) + '، ومجاني للطلبات من ' + sar(J.SHIPPING.freeFrom) + '.</p>'
      : '<button class="btn btn--wide" type="button" disabled>نفد هذا اللون</button><p class="buy__note">اختاري لون ثاني من نفس الطقم.</p>';
    return '<section class="pdp"><div class="pdp__in">' +
      '<div class="gallery"><div class="gallery__main"><img id="mainImg" src="' + J.img(p.model) + '" alt="' + alt(p) + '" width="675" height="900"><span class="card__city">' + c.code + '</span></div>' +
      '<div class="gallery__thumbs">' + thumbs + '</div></div>' +
      '<div class="pdp__info"><p class="crumb"><a href="#/">الرئيسية</a> / <a href="#/set/' + p.set + '">طقم ' + s.ar + '</a></p>' +
      '<h1 class="pdp__title">طقم ' + s.ar + '</h1>' +
      '<p class="pdp__sub">' + p.color + '، مصوّر في ' + c.ar + '</p>' +
      '<p class="pdp__price">' + priceHtml() + '<span class="save">وفّري ' + sar(J.COMPARE_AT - J.PRICE) + '</span></p>' +
      '<div class="dest"><p class="dest__label">اختاري اللون</p><div class="dest__list">' + dest + '</div></div>' +
      '<div class="buy">' + buy + '</div>' +
      '<dl class="spec"><div><dt>القطع</dt><dd>' + s.top + '، مع بنطلون واسع</dd></div>' +
      '<div><dt>المقاس</dt><dd>فري سايز</dd></div>' +
      '<div><dt>اللون</dt><dd>' + p.color + '</dd></div>' +
      '<div><dt>السعر</dt><dd>يشمل القطعتين: ' + s.pieces + '</dd></div></dl>' +
      '</div></div></section>';
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
        publishable_api_key: J.PAY_KEY,
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
    stopHero();
    app.innerHTML = html;
    current = 'result';
    document.title = title + ' | JAM';
    window.scrollTo(0, 0);
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
      var turnedOn = !paymentsOn && !!r.data.payments && mayPay;
      paymentsOn = !!r.data.payments && mayPay;
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
  var current = '';
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    var view = parts[0] || 'home';
    var wasProduct = current === 'p';
    stopHero();
    Array.prototype.forEach.call(document.querySelectorAll('.top__nav a'), function (a) {
      a.setAttribute('aria-current', (view === 'set' || view === 'p') && a.getAttribute('href') === '#/set/' + parts[1]);
    });

    if (view === 'p') {
      var p = J.bySku(parts[1] + '-' + parts[2]);
      if (!p) { location.hash = '#/'; return; }
      setTone(p.hex);
      app.innerHTML = productHtml(p);
      document.title = 'طقم ' + J.SETS[p.set].ar + ' ' + p.color + ' | JAM';
      if (!wasProduct) window.scrollTo(0, 0);
    } else if (view === 'returns') {
      app.innerHTML = returnsHtml();
      document.title = 'الاسترجاع والاستبدال | JAM';
      window.scrollTo(0, 0);
    } else if (view === 'checkout') {
      app.innerHTML = checkoutHtml();
      document.title = 'إتمام الطلب | JAM';
      window.scrollTo(0, 0);
      if (document.getElementById('payForm')) mountPayment();
    } else {
      if (current !== 'home') {
        app.innerHTML = homeHtml();
        app.dataset.hero = 0;
        setTone(J.bySku(J.HERO[0]).hex);
        document.title = 'JAM | أطقم نسائية متناسقة';
      }
      startHero();
      if (view === 'set' && J.SETS[parts[1]]) {
        var el = document.getElementById('set-' + parts[1]);
        requestAnimationFrame(function () { el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });
      } else if (current !== 'home') {
        window.scrollTo(0, 0);
      }
      view = 'home';
    }
    current = view;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-hero],[data-add],[data-rm],[data-close],[data-edit],[data-reload],.thumb');
    if (!t) return;
    if (t.hasAttribute('data-reload')) { location.reload(); return; }
    // Back to the delivery form. Sending it again opens a fresh order and drops this hold.
    if (t.hasAttribute('data-edit')) { order = null; store('jam-order', null); route(); return; }
    if (t.dataset.hero !== undefined) { showHero(+t.dataset.hero, true); return; }
    if (t.dataset.add) { addToCart(t.dataset.add); t.textContent = 'في السلة، عرض السلة'; return; }
    if (t.dataset.rm) { removeFromCart(t.dataset.rm); return; }
    if (t.hasAttribute('data-close')) { closeCart(); return; }
    if (t.classList.contains('thumb')) {
      document.getElementById('mainImg').src = t.dataset.img;
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
  window.addEventListener('hashchange', function () {
    if (!document.getElementById('cart').hidden) closeCart();
    route();
  });

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
