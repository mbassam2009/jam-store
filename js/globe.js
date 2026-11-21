/* JAM globe. A dotted Earth drawn on a canvas that the shopper can spin by dragging.
   City labels are real buttons laid over the canvas; this file only moves them.

   JAMGlobe({
     canvas,                 the <canvas>, sized by CSS
     grab,                   element the shopper drags to spin the globe (defaults to the canvas)
     pins,                   element holding one [data-city] button per city
     cities,                 { key: { lat, lon } }
     active,                 key of the city to start on
     tone,                   hex color of the look on show
     geometry(w, h),         returns { cx, cy, r } in CSS pixels
     anchor(),               returns { x, y } in CSS pixels where the line from the active city ends, or null
     onPick(key),            the shopper spun the globe onto another city
     onGrab(),               the shopper took hold of the globe
     still                   true when motion should be kept to a minimum
   })
   returns { flyTo(key, instant), setTone(hex), destroy() } */
window.JAMGlobe = function (o) {
  'use strict';
  var RAD = Math.PI / 180;
  var canvas = o.canvas, ctx = canvas.getContext('2d');
  var hold = o.grab || canvas; // the element the shopper drags
  var still = !!o.still;
  // The active city sits up and to the side of the middle, clear of the photo that overlaps the globe.
  var OFF_LON = 15, OFF_LAT = 9;

  /* ---------- land dots ---------- */
  function decodeLand(L) {
    if (!L) return new Float32Array(0);
    var raw = atob(L.bits), pts = [], i = 0;
    for (var lat = L.top; lat >= L.bottom; lat -= L.step) {
      var n = Math.max(1, Math.round((360 / L.step) * Math.cos(lat * RAD)));
      for (var k = 0; k < n; k++, i++) {
        if (!(raw.charCodeAt(i >> 3) & (1 << (i & 7)))) continue;
        var lon = -180 + (k + 0.5) * 360 / n;
        var c = Math.cos(lat * RAD);
        pts.push(c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD));
      }
    }
    return new Float32Array(pts);
  }
  var land = decodeLand(window.JAM_LAND);

  function vec(lat, lon) {
    var c = Math.cos(lat * RAD);
    return [c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD)];
  }
  var keys = Object.keys(o.cities);
  var cityVec = {};
  keys.forEach(function (k) { cityVec[k] = vec(o.cities[k].lat, o.cities[k].lon); });
  var pinEls = {};
  Array.prototype.forEach.call(o.pins.querySelectorAll('[data-city]'), function (el) { pinEls[el.dataset.city] = el; });

  /* ---------- state ---------- */
  var W = 0, H = 0, dpr = 1, geo = { cx: 0, cy: 0, r: 1 };
  var active = o.active || keys[0];
  var lon0 = o.cities[active].lon + OFF_LON, lat0 = o.cities[active].lat - OFF_LAT;
  var vLon = 0, vLat = 0;
  var fly = null;        // { fromLon, fromLat, toLon, toLat, t0, dur }
  var hop = null;        // { a: vec, b: vec, t0, dur } the light that travels between two cities
  var drag = null;
  var settleCheck = false;
  var tone = [255, 255, 255], glow = [255, 255, 255];
  var raf = 0, inView = true, shown = !document.hidden, dead = false, born = performance.now();
  var sLon = 0, cLon = 1, sLat = 0, cLat = 1;

  function setTone(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return;
    var n = parseInt(m[1], 16);
    tone = [n >> 16 & 255, n >> 8 & 255, n & 255];
    glow = tone.map(function (v) { return Math.round(v * 0.55 + 255 * 0.45); });
    kick();
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    geo = o.geometry(W, H);
    kick();
  }

  // Sphere point to screen. Returns z (toward the viewer when positive).
  var px = 0, py = 0;
  function project(x, y, z) {
    var x1 = x * cLon - z * sLon, z1 = x * sLon + z * cLon;
    var y2 = y * cLat - z1 * sLat, z2 = y * sLat + z1 * cLat;
    px = geo.cx + geo.r * x1; py = geo.cy - geo.r * y2;
    return z2;
  }
  function wrap(d) { return ((d + 540) % 360) - 180; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function slerp(a, b, t) {
    var dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    var th = Math.acos(dot);
    if (th < 1e-4) return a;
    var s = Math.sin(th), p = Math.sin((1 - t) * th) / s, q = Math.sin(t * th) / s;
    return [a[0] * p + b[0] * q, a[1] * p + b[1] * q, a[2] * p + b[2] * q];
  }

  /* ---------- drawing ---------- */
  function draw(now) {
    var R = geo.r, cx = geo.cx, cy = geo.cy;
    sLon = Math.sin(lon0 * RAD); cLon = Math.cos(lon0 * RAD);
    sLat = Math.sin(lat0 * RAD); cLat = Math.cos(lat0 * RAD);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // light behind the planet, in the color of the look
    var g = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.42);
    g.addColorStop(0, rgba(glow, 0.34)); g.addColorStop(0.45, rgba(tone, 0.12)); g.addColorStop(1, rgba(tone, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // the planet body
    var b = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    b.addColorStop(0, 'rgba(30,44,92,0.92)'); b.addColorStop(0.7, 'rgba(11,17,40,0.94)'); b.addColorStop(1, 'rgba(7,11,26,0.96)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fillStyle = b; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = rgba(glow, 0.55); ctx.stroke();

    // land, sorted into four brightness steps by how much it faces the viewer
    var s = Math.max(0.9, R * 0.0072), paths = [[], [], [], []], i, z, bkt;
    for (i = 0; i < land.length; i += 3) {
      z = project(land[i], land[i + 1], land[i + 2]);
      if (z <= 0.02) continue;
      bkt = z > 0.75 ? 3 : z > 0.5 ? 2 : z > 0.25 ? 1 : 0;
      paths[bkt].push(px, py);
    }
    var alphas = [0.22, 0.45, 0.7, 0.95];
    for (bkt = 0; bkt < 4; bkt++) {
      var p = paths[bkt], rr = s * (0.7 + bkt * 0.1);
      ctx.fillStyle = 'rgba(206,218,255,' + alphas[bkt] + ')';
      ctx.beginPath();
      for (i = 0; i < p.length; i += 2) { ctx.moveTo(p[i] + rr, p[i + 1]); ctx.arc(p[i], p[i + 1], rr, 0, 6.2832); }
      ctx.fill();
    }

    // the hop between the last city and this one
    if (hop) {
      var u = still ? 1 : Math.min(1, (now - hop.t0) / hop.dur), eu = ease(u), N = 56, started = false;
      var fade = u < 1 ? 1 : Math.max(0.3, 1 - (now - hop.t0 - hop.dur) / 1600);
      ctx.beginPath();
      for (i = 0; i <= N; i++) {
        var t = i / N; if (t > eu) break;
        var v = slerp(hop.a, hop.b, t), lift = 1 + 0.2 * Math.sin(Math.PI * t);
        z = project(v[0] * lift, v[1] * lift, v[2] * lift);
        var out = (px - cx) * (px - cx) + (py - cy) * (py - cy) > R * R;
        if (z > 0 || out) { if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; } }
        else started = false;
      }
      ctx.strokeStyle = rgba(glow, 0.9 * fade); ctx.lineWidth = 1.6;
      ctx.shadowColor = rgba(glow, 0.9); ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      if (u < 1) {
        var h = slerp(hop.a, hop.b, eu), hl = 1 + 0.2 * Math.sin(Math.PI * eu);
        z = project(h[0] * hl, h[1] * hl, h[2] * hl);
        if (z > 0) { ctx.beginPath(); ctx.arc(px, py, 3.2, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.shadowColor = rgba(glow, 1); ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0; }
      }
    }

    // cities
    var ax = null, ay = null, labelled = [];
    // the active city first, so its label always wins the space
    var order = [active].concat(keys.filter(function (k) { return k !== active; }));
    order.forEach(function (k) {
      var v = cityVec[k], zz = project(v[0], v[1], v[2]), el = pinEls[k], on = k === active;
      if (el) {
        el.style.transform = 'translate3d(' + px.toFixed(1) + 'px,' + py.toFixed(1) + 'px,0)';
        var back = zz < 0.06;
        if (el._back !== back) { el._back = back; el.classList.toggle('is-back', back); }
        if (el._on !== on) { el._on = on; el.classList.toggle('is-on', on); }
        // keep the label on the side with more room
        var flip = px > cx;
        if (el._flip !== flip) { el._flip = flip; el.classList.toggle('is-flip', flip); }
        // a label that would sit on top of another one stays folded until its city is picked
        var quiet = false;
        if (!back) {
          for (var q = 0; q < labelled.length; q += 2) {
            if (Math.abs(labelled[q] - px) < 62 && Math.abs(labelled[q + 1] - py) < 26) { quiet = true; break; }
          }
          if (!quiet) labelled.push(px, py);
        }
        if (el._quiet !== quiet) { el._quiet = quiet; el.classList.toggle('is-quiet', quiet); }
      }
      if (zz < 0.06) return;
      if (on) {
        ax = px; ay = py;
        if (!still) {
          var ph = ((now - born) % 2200) / 2200;
          ctx.beginPath(); ctx.arc(px, py, 5 + ph * 20, 0, 6.2832);
          ctx.strokeStyle = rgba(glow, (1 - ph) * 0.8); ctx.lineWidth = 1.4; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(px, py, 9, 0, 6.2832); ctx.fillStyle = rgba(glow, 0.28); ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 4.2, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(px, py, 3, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + zz * 0.5) + ')'; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, 6.5, 0, 6.2832); ctx.strokeStyle = 'rgba(255,255,255,' + (0.15 + zz * 0.25) + ')'; ctx.lineWidth = 1; ctx.stroke();
      }
    });

    // line from the active city to its photo
    var an = ax !== null && o.anchor ? o.anchor() : null;
    if (an) {
      ctx.beginPath(); ctx.moveTo(ax, ay);
      var midx = an.x, midy = ay; // out sideways first, then down to the photo
      if (Math.abs(an.y - ay) < 12) ctx.lineTo(an.x, an.y); else { ctx.lineTo(midx, midy); ctx.lineTo(an.x, an.y); }
      ctx.setLineDash([2, 5]); ctx.strokeStyle = rgba(glow, 0.75); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* ---------- motion ---------- */
  function step(now) {
    raf = 0;
    if (dead) return;
    if (fly) {
      var t = Math.min(1, (now - fly.t0) / fly.dur), e = ease(t);
      lon0 = fly.fromLon + fly.dLon * e; lat0 = fly.fromLat + (fly.toLat - fly.fromLat) * e;
      if (t >= 1) fly = null;
    } else if (!drag && (Math.abs(vLon) > 0.01 || Math.abs(vLat) > 0.01)) {
      lon0 += vLon; lat0 = Math.max(-65, Math.min(65, lat0 + vLat));
      vLon *= 0.94; vLat *= 0.9;
    } else if (settleCheck && !drag) {
      settleCheck = false; vLon = vLat = 0;
      pickNearest();
    }
    draw(now);
    if (inView && shown && !still) raf = requestAnimationFrame(step);
  }
  function kick() { if (!raf && !dead) raf = requestAnimationFrame(step); }

  function pickNearest() {
    // the point of the globe sitting where the active city is shown
    var f = vec(lat0 + OFF_LAT, lon0 - OFF_LON), best = null, bestDot = Math.cos(48 * RAD);
    keys.forEach(function (k) {
      var v = cityVec[k], d = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
      if (d > bestDot) { bestDot = d; best = k; }
    });
    if (best && best !== active && o.onPick) o.onPick(best);
  }

  function flyTo(key, instant) {
    if (!o.cities[key]) return;
    var from = active, c = o.cities[key];
    var toLon = c.lon + OFF_LON, toLat = c.lat - OFF_LAT;
    active = key; vLon = vLat = 0; settleCheck = false;
    if (instant || still) { lon0 = toLon; lat0 = toLat; fly = null; }
    else {
      var d = wrap(toLon - lon0);
      fly = { fromLon: lon0, fromLat: lat0, dLon: d, toLat: toLat, t0: performance.now(), dur: 900 + Math.min(900, Math.abs(d) * 9) };
    }
    if (from !== key) hop = { a: cityVec[from], b: cityVec[key], t0: performance.now() + (instant ? -5000 : 120), dur: fly ? fly.dur : 1 };
    kick();
  }

  /* ---------- dragging ---------- */
  function down(e) {
    if (e.button) return;
    drag = { x: e.clientX, y: e.clientY, moved: false };
    try { hold.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    fly = null; vLon = vLat = 0;
    hold.classList.add('is-grabbed');
    kick();
  }
  function move(e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!drag.moved) { drag.moved = true; if (o.onGrab) o.onGrab(); }
    var now = performance.now(), dt = Math.max(8, now - (drag.t || now - 16));
    drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    var k = 57.3 / geo.r, dLon = -dx * k, dLat = dy * k;
    lon0 += dLon; lat0 = Math.max(-65, Math.min(65, lat0 + dLat));
    // speed to carry on with after letting go, in degrees per frame
    vLon = Math.max(-2.4, Math.min(2.4, vLon * 0.4 + dLon / dt * 16.7 * 0.6));
    vLat = Math.max(-1.2, Math.min(1.2, vLat * 0.4 + dLat / dt * 16.7 * 0.6));
    kick();
  }
  function up() {
    if (!drag) return;
    var moved = drag.moved;
    if (performance.now() - (drag.t || 0) > 90) vLon = vLat = 0; // held still before letting go
    drag = null; hold.classList.remove('is-grabbed');
    if (moved) settleCheck = true;
    if (still) { vLon = vLat = 0; if (moved) { settleCheck = false; pickNearest(); } }
    kick();
  }
  hold.addEventListener('pointerdown', down);
  hold.addEventListener('pointermove', move);
  hold.addEventListener('pointerup', up);
  hold.addEventListener('pointercancel', up);

  var ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(canvas); else window.addEventListener('resize', resize);
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (en) {
    inView = en[0].isIntersecting; if (inView) kick();
  }) : null;
  if (io) io.observe(canvas);
  function vis() { shown = !document.hidden; if (shown) kick(); }
  document.addEventListener('visibilitychange', vis);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);

  setTone(o.tone);
  resize();

  return {
    flyTo: flyTo,
    setTone: setTone,
    redraw: kick,
    destroy: function () {
      dead = true; cancelAnimationFrame(raf);
      if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      if (io) io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    }
  };
};
