/* The sphere — a glass sphere whose luminous rim is the assistant's whole face.

   It never invents activity. Every frame it reads:
     · a state name set by app.js from the real pipeline
       (idle | listening | hearing | thinking | speaking | error | offline)
     · a level 0..1 pulled from a callback: the live microphone analyser while
       listening, the playback analyser while speaking, 0 otherwise.

   Cost: one small 2D canvas for the ring, a third-resolution copy blurred by
   the compositor for the glow. 30 fps when idle, 60 when something is
   happening, nothing at all while the tab is hidden. */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var POINTS = 96;

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    var n = m ? parseInt(m[1], 16) : 0xa78bfa;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')';
  }

  var TARGETS = {
    //            listen think speak error offline
    idle:      [0, 0, 0, 0, 0],
    listening: [1, 0, 0, 0, 0],
    hearing:   [1, 0, 0, 0, 0],
    thinking:  [0, 1, 0, 0, 0],
    speaking:  [0, 0, 1, 0, 0],
    error:     [0, 0, 0, 1, 0],
    offline:   [0, 0, 0, 0, 1]
  };
  var ERR = [255, 92, 110], OFF = [96, 102, 116], WHITE = [255, 255, 255];

  function Orb(canvas, glowCanvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.gv = glowCanvas; this.gctx = glowCanvas.getContext('2d');
    this.state = 'idle';
    this.m = [0, 0, 0, 0, 0];           // eased state mix
    this.level = 0;                     // eased input level
    this.kickV = 0;                     // one-shot pulse (speech boundary events)
    this.levelSource = null;
    this.look = { c1: '#9cc2ff', c2: '#eef2f8', c3: '#d8b878', glow: 1 };
    this.t = 0; this.last = 0; this.size = 0;
    this.reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._frame = this._frame.bind(this);
    var self = this;
    // The ring leans a few pixels toward the pointer: eased, never snapped.
    this.aim = [0, 0]; this.lean = [0, 0];
    global.addEventListener('pointermove', function (e) {
      self.aim[0] = (e.clientX / global.innerWidth) * 2 - 1;
      self.aim[1] = (e.clientY / global.innerHeight) * 2 - 1;
    }, { passive: true });
    document.addEventListener('pointerleave', function () { self.aim[0] = self.aim[1] = 0; });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { self.last = 0; requestAnimationFrame(self._frame); }
    });
    if (global.ResizeObserver) new ResizeObserver(function () { self._resize(); }).observe(canvas);
    requestAnimationFrame(this._frame);
  }

  Orb.prototype.setState = function (name) { if (TARGETS[name]) this.state = name; };
  Orb.prototype.setLook = function (look) { for (var k in look) this.look[k] = look[k]; };
  Orb.prototype.kick = function (v) { this.kickV = Math.max(this.kickV, v == null ? 0.6 : v); };

  Orb.prototype._resize = function () {
    var css = this.cv.clientWidth;
    if (!css) return false;
    // full device resolution (4K / 200–300 % displays included), capped so a
    // huge window cannot ask for a canvas the GPU struggles to fill each frame
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    var px = Math.min(Math.round(css * dpr), 2800);
    if (px !== this.cv.width) {
      this.cv.width = this.cv.height = px;
      this.gv.width = this.gv.height = Math.max(64, Math.round(px / 3));
    }
    this.size = px;
    return true;
  };

  Orb.prototype._path = function (ctx, cx, cy, R, amp, scale) {
    var t = this.t, m = this.m, pts = [];
    for (var i = 0; i < POINTS; i++) {
      var a = (i / POINTS) * TAU;
      var d = Math.sin(a * 2 + t * 0.31) * 0.55
            + Math.sin(a * 3 - t * 0.23 + 1.3) * 0.35
            + Math.sin(a * 5 + t * 0.47 + 4.1) * 0.12;
      // thinking: a wave that travels round the ring
      d += m[1] * Math.sin(a * 6 - t * 2.4) * 0.16;
      // listening / speaking: finer ripples whose height is the real level
      d += (m[0] + m[2]) * this.level * (Math.sin(a * 9 + t * 5.2) * 0.5 + Math.sin(a * 4 - t * 3.4) * 0.6);
      var r = R * scale * (1 + amp * d);
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.beginPath();
    var n = pts.length;
    ctx.moveTo((pts[n - 2] + pts[0]) / 2, (pts[n - 1] + pts[1]) / 2);
    for (var j = 0; j < n; j += 2) {
      var nx = pts[(j + 2) % n], ny = pts[(j + 3) % n];
      ctx.quadraticCurveTo(pts[j], pts[j + 1], (pts[j] + nx) / 2, (pts[j + 1] + ny) / 2);
    }
    ctx.closePath();
  };

  Orb.prototype._gradient = function (ctx, cx, cy, R, c1, c2, c3, alpha) {
    if (ctx.createConicGradient) {
      var g = ctx.createConicGradient(-Math.PI / 2, cx, cy);   // 0 = top, clockwise
      g.addColorStop(0, rgba(mix(c1, WHITE, 0.3), alpha));
      g.addColorStop(0.22, rgba(c2, alpha * 0.92));
      g.addColorStop(0.5, rgba(c3, alpha * 0.74));     // the foot of the ring sits dimmer
      g.addColorStop(0.8, rgba(c1, alpha * 0.95));
      g.addColorStop(1, rgba(mix(c1, WHITE, 0.3), alpha));
      return g;
    }
    var l = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    l.addColorStop(0, rgba(c1, alpha)); l.addColorStop(0.5, rgba(c2, alpha)); l.addColorStop(1, rgba(c3, alpha));
    return l;
  };

  Orb.prototype._frame = function (now) {
    if (document.hidden) return;                    // resumed by visibilitychange
    requestAnimationFrame(this._frame);
    var active = (this.state !== 'idle' && this.state !== 'offline') || Math.abs(this.aim[0] - this.lean[0]) + Math.abs(this.aim[1] - this.lean[1]) > 0.01;
    var minGap = active ? 15 : 32;                  // ~60 fps busy, ~30 fps idle
    if (this.last && now - this.last < minGap) return;
    var dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    if (!this._resize()) return;

    // ease state mix and level
    var target = TARGETS[this.state], k = 1 - Math.pow(0.002, dt);
    for (var i = 0; i < 5; i++) this.m[i] += (target[i] - this.m[i]) * k;
    var raw = this.levelSource ? Math.max(0, Math.min(1, this.levelSource() || 0)) : 0;
    this.kickV *= Math.pow(0.02, dt);
    raw = Math.max(raw, this.kickV);
    this.level += (raw - this.level) * (raw > this.level ? 1 - Math.pow(0.0001, dt) : 1 - Math.pow(0.02, dt));
    var m = this.m, lv = this.level;
    // at rest the surface barely drifts; it quickens only with real activity
    var speed = (this.reduced ? 0.25 : 1) * (0.32 + m[0] * 0.45 + m[1] * 0.9 + m[2] * 0.6 - m[4] * 0.25);
    this.t += dt * speed;

    // colour: user palette, pulled toward red on error and grey when offline
    var tint = function (hex) { return mix(mix(hexToRgb(hex), ERR, m[3] * 0.85), OFF, m[4] * 0.9); };
    var c1 = tint(this.look.c1), c2 = tint(this.look.c2), c3 = tint(this.look.c3);

    var lk = this.reduced ? 0 : 1 - Math.pow(0.05, dt);
    this.lean[0] += (this.aim[0] - this.lean[0]) * lk;
    this.lean[1] += (this.aim[1] - this.lean[1]) * lk;
    var S = this.size, R = S * 0.385;
    var cx = S / 2 + this.lean[0] * S * 0.006, cy = S / 2 + this.lean[1] * S * 0.006;
    var breathe = Math.sin(this.t * 0.7) * 0.5 + 0.5;
    var amp = 0.013 + m[0] * 0.006 + m[1] * 0.008 + (m[0] + m[2]) * lv * 0.03;
    var scale = 1 + breathe * 0.006 + (m[0] * 0.02 + (m[0] + m[2]) * lv * 0.055) - m[4] * 0.03;
    var bright = (0.82 + breathe * 0.08 + m[1] * 0.08 + (m[0] + m[2]) * (0.06 + lv * 0.35)) * (1 - m[4] * 0.55);
    bright = Math.min(1.25, bright);

    var ctx = this.ctx;
    ctx.clearRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    // volume: the ring is the rim of a glass sphere. Key light from the upper
    // left, a cool fall-off toward the rim, warm light bounced up from below.
    var lx = cx - R * (0.34 - this.lean[0] * 0.08), ly = cy - R * (0.46 - this.lean[1] * 0.06);
    var body = ctx.createRadialGradient(lx, ly, R * 0.02, cx, cy, R * scale);
    body.addColorStop(0, rgba(WHITE, 0.11 * bright));
    body.addColorStop(0.32, rgba(mix(c1, WHITE, 0.4), 0.05 * bright));
    body.addColorStop(0.7, rgba(c1, 0.012 * bright));
    body.addColorStop(0.93, rgba(c1, 0.05 * bright));
    body.addColorStop(1, rgba(mix(c1, WHITE, 0.3), 0.11 * bright));
    this._path(ctx, cx, cy, R, amp, scale);
    ctx.fillStyle = body;
    ctx.fill();
    var bounce = ctx.createRadialGradient(cx, cy + R * 0.95, R * 0.05, cx, cy + R * 0.7, R * 0.75);
    bounce.addColorStop(0, rgba(c3, 0.11 * bright));
    bounce.addColorStop(1, rgba(c3, 0));
    ctx.fillStyle = bounce;
    ctx.fill();

    // body of the ring
    // Drawn at device resolution with no CSS blur, so the softness is built in:
    // nested strokes, widest and faintest first, give a smooth fall-off around
    // a sharp bright core (no visible edges, no "second ring").
    this._path(ctx, cx, cy, R, amp, scale);
    var LAYERS = [[0.060, 0.10], [0.040, 0.16], [0.026, 0.24], [0.016, 0.34], [0.009, 0.55]];
    for (var L = 0; L < LAYERS.length; L++) {
      ctx.lineWidth = R * (LAYERS[L][0] + lv * 0.02 * (1 - L / LAYERS.length));
      ctx.strokeStyle = this._gradient(ctx, cx, cy, R, c1, c2, c3, Math.min(1, LAYERS[L][1] * bright));
      ctx.stroke();
    }
    ctx.lineWidth = R * 0.0045;
    ctx.strokeStyle = this._gradient(ctx, cx, cy, R, mix(c1, WHITE, 0.45), mix(c2, WHITE, 0.3), mix(c3, WHITE, 0.3), Math.min(1, 0.85 * bright));
    ctx.stroke();

    // white-hot crest across the top, as in the reference
    var hx = this.lean[0] * R * 0.5;      // the crest slides toward the pointer, like light on glass
    var hi = ctx.createLinearGradient(cx + hx, cy - R * 1.06, cx - hx * 0.6, cy - R * 0.5);
    hi.addColorStop(0, rgba(WHITE, Math.min(1, 0.95 * bright) * (1 - m[4] * 0.7)));
    hi.addColorStop(0.45, rgba(WHITE, Math.min(1, 0.5 * bright) * (1 - m[4] * 0.7)));
    hi.addColorStop(1, rgba(WHITE, 0));
    ctx.lineWidth = R * 0.012;
    ctx.strokeStyle = hi;
    ctx.stroke();

    // thinking: one soft band of light travelling round the rim (only while the
    // request is really in flight; m[1] eases to zero the moment it ends)
    if (m[1] > 0.02 && ctx.createConicGradient) {
      var sweep = ctx.createConicGradient(this.t * 1.5, cx, cy);
      sweep.addColorStop(0, rgba(WHITE, 0.85 * m[1]));
      sweep.addColorStop(0.09, rgba(mix(c1, WHITE, 0.5), 0.25 * m[1]));
      sweep.addColorStop(0.2, rgba(WHITE, 0));
      sweep.addColorStop(1, rgba(WHITE, 0));
      this._path(ctx, cx, cy, R, amp, scale);
      ctx.lineWidth = R * 0.03;
      ctx.strokeStyle = sweep;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // glow layer: a third-resolution copy plus an inward bloom, blurred in CSS
    var g = this.gctx, G = this.gv.width, f = G / S;
    g.clearRect(0, 0, G, G);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.75;
    g.drawImage(this.cv, 0, 0, G, G);
    g.globalAlpha = 1;
    g.save(); g.scale(f, f);
    // bloom that falls INTO the ring: wide and faint, then narrower and stronger
    this._path(g, cx, cy, R, amp, scale * 0.9);
    g.lineWidth = R * (0.2 + lv * 0.06);
    g.strokeStyle = this._gradient(g, cx, cy, R, c1, c2, c3, Math.min(1, 0.3 * bright));
    g.stroke();
    this._path(g, cx, cy, R, amp, scale * 0.955);
    g.lineWidth = R * (0.1 + lv * 0.04);
    g.strokeStyle = this._gradient(g, cx, cy, R, c1, c2, c3, Math.min(1, 0.6 * bright));
    g.stroke();
    g.restore();
    this.gv.style.opacity = Math.min(1, (0.5 + m[1] * 0.1 + (m[0] + m[2]) * (0.08 + lv * 0.32)) * this.look.glow).toFixed(3);
  };

  global.Orb = Orb;
})(window);
