/* ================= Euchre: the screen =================
   One person plays with a computer partner against two computer players.
   The rules and the computer players live in engine.js; this file draws the
   table and runs the game. Plain JavaScript, no libraries. */
(function () {
  'use strict';

  var E = window.Euchre;
  var SYM = E.SUIT_SYMS.map(function (s) { return s + '︎'; });   // FE0E keeps phones from drawing emoji
  var STORE_KEY = 'euchre.settings.v1';
  var DEFAULT_NAMES = ['You', 'West', 'Partner', 'East'];
  var ROLES = [
    ['You', 'Bottom of the table'],
    ['Left opponent', 'Other team'],
    ['Your partner', 'Across from you'],
    ['Right opponent', 'Other team']
  ];
  var SEAT_ORDER = [0, 2, 1, 3];   // order shown on the settings screen: your team first
  var SPEEDS = {
    relaxed: { name: 'Relaxed', bid: 1400, play: 1150, trick: 1900, said: 900 },
    normal:  { name: 'Normal',  bid: 900,  play: 750,  trick: 1300, said: 650 },
    fast:    { name: 'Fast',    bid: 380,  play: 320,  trick: 700, said: 350 }
  };
  var TEAM_COLORS = ['#4db5ff', '#ff5c8a'];
  var RULES = [
    ['🏁', 'First to 10 points', 'The team that names trump scores 1 point for 3 or 4 tricks and 2 points for all 5.'],
    ['💥', 'Euchre', 'If the team that named trump takes fewer than 3 tricks, the other team scores 2 points.'],
    ['🦸', 'Going alone', 'Whoever names trump may play without their partner. All 5 tricks alone scores 4 points.'],
    ['📌', 'Stick the dealer', 'If everyone passes twice, the dealer has to name trump. Every hand gets played.']
  ];

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function isRed(suit) { return suit === 1 || suit === 3; }
  function symHTML(suit) { return '<span class="sym' + (isRed(suit) ? ' red' : '') + '">' + SYM[suit] + '</span>'; }

  /* ================= Settings ================= */
  var settings = { names: ['', '', '', ''], speed: 'normal', sound: true, won: 0, lost: 0 };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (Array.isArray(s.names)) for (var i = 0; i < 4; i++) settings.names[i] = typeof s.names[i] === 'string' ? s.names[i].slice(0, 12) : '';
      if (SPEEDS[s.speed]) settings.speed = s.speed;
      settings.sound = s.sound !== false;
      settings.won = Math.max(0, s.won | 0); settings.lost = Math.max(0, s.lost | 0);
    } catch (e) { /* storage unavailable: use defaults */ }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }
  function seatNames() {
    return settings.names.map(function (n, i) { return n.trim() || DEFAULT_NAMES[i]; });
  }

  /* ---------- cards ---------- */
  function cardName(c) { return E.RANK_NAMES[E.rankOf(c)] + ' of ' + E.SUIT_NAMES[E.suitOf(c)].toLowerCase(); }
  function cardInner(c, trump) {
    var s = E.suitOf(c), r = E.rankOf(c), tag = '';
    if (trump >= 0 && r === 2 && E.effSuit(c, trump) === trump) tag = '<span class="tag">' + (s === trump ? 'Right' : 'Left') + '</span>';
    return '<span class="ix">' + E.RANK_LABELS[r] + '<i>' + SYM[s] + '</i></span><span class="pip">' + SYM[s] + '</span>' + tag;
  }
  function cardClass(c, trump) {
    return 'card' + (isRed(E.suitOf(c)) ? ' red' : '') + (trump >= 0 && E.effSuit(c, trump) === trump ? ' trump' : '');
  }
  function cardHTML(c, trump, extra) { return '<span class="' + cardClass(c, trump) + (extra ? ' ' + extra : '') + '">' + cardInner(c, trump) + '</span>'; }
  // Your hand, left to right: trump first (strongest first), then the other suits with colours alternating.
  function sortHand(cards, trump) {
    function key(c) {
      var s = E.effSuit(c, trump);
      if (trump >= 0 && s === trump) return 1000 - E.trumpValue(c, trump);
      var slot = trump >= 0 ? ((s - trump + 4) & 3) : s;         // suits after trump, in table order
      if (trump >= 0) slot = [0, 1, 3, 2][slot];                 // trump, next colour, same colour, other colour
      return 2000 + slot * 10 - E.rankOf(c);
    }
    return cards.slice().sort(function (a, b) { return key(a) - key(b); });
  }

  /* ---------- settings screen ---------- */
  function renderSeats() {
    $('#seats').innerHTML = SEAT_ORDER.map(function (i) {
      return '<div class="seat t' + E.teamOf(i) + '" data-i="' + i + '">' +
        '<div class="role"><b>' + ROLES[i][0] + '</b><span>' + ROLES[i][1] + '</span></div>' +
        '<input type="text" maxlength="12" autocomplete="off" autocapitalize="words" spellcheck="false" aria-label="Name for ' + ROLES[i][0].toLowerCase() + '" placeholder="' + DEFAULT_NAMES[i] + '" value="' + esc(settings.names[i]) + '"></div>';
    }).join('');
  }
  function renderSpeed() {
    $('#speed').innerHTML = Object.keys(SPEEDS).map(function (k) {
      var on = settings.speed === k;
      return '<button type="button" class="seg' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-speed="' + k + '">' + SPEEDS[k].name + '</button>';
    }).join('');
  }
  function renderRecord() {
    var n = settings.won + settings.lost;
    $('#record').innerHTML = n ? 'Games won: <b>' + settings.won + '</b> of ' + n : '';
  }
  function renderSummary() {
    var n = seatNames();
    $('#summary').innerHTML = '<b>' + esc(n[0]) + ' &amp; ' + esc(n[2]) + '</b> against <b>' + esc(n[1]) + ' &amp; ' + esc(n[3]) + '</b> &middot; First to <b>10</b> &middot; ' + SPEEDS[settings.speed].name + ' speed';
  }
  function renderSetup() {
    renderSeats(); renderSpeed(); renderRecord(); renderSummary();
    $('#rules').innerHTML = RULES.map(function (r) {
      return '<div class="effect"><div class="effect-ico">' + r[0] + '</div><div><b>' + r[1] + '</b><span>' + r[2] + '</span></div></div>';
    }).join('');
    $('#logo').innerHTML = cardHTML(14, 0) + cardHTML(11, -1) + cardHTML(2, 0);   // jack of clubs, ace of hearts, jack of spades
  }
  function bindSetup() {
    $('#seats').addEventListener('input', function (e) {
      var row = e.target.closest('.seat'); if (!row || e.target.tagName !== 'INPUT') return;
      settings.names[+row.dataset.i] = e.target.value.slice(0, 12); saveSettings(); renderSummary();
    });
    $('#speed').addEventListener('click', function (e) {
      var b = e.target.closest('[data-speed]'); if (!b) return;
      settings.speed = b.dataset.speed; saveSettings(); Sound.play('tick'); renderSpeed(); renderSummary();
    });
    $('#start-btn').addEventListener('click', function () { Sound.play('start'); startGame(); });
  }
  function showScreen(id) {
    $('#setup').classList.toggle('active', id === 'setup');
    $('#game').classList.toggle('active', id === 'game');
  }

  /* ================= Sound (synthesized) ================= */
  var Sound = (function () {
    var ctx = null, master = null;
    function init() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        try {
          ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.9;
          // A limiter keeps the louder sounds from crackling when several overlap.
          var lim = ctx.createDynamicsCompressor();
          master.connect(lim); lim.connect(ctx.destination);
        } catch (e) { ctx = null; return; }
      }
      // Browsers keep audio asleep until the player clicks, taps or presses a key; wake it every time.
      if (ctx.state !== 'running') { try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }
    }
    ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { if (settings.sound) init(); }, true);
    });
    function tone(freq, dur, opt) {
      opt = opt || {};
      var t = ctx.currentTime + (opt.at || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = opt.type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + dur);
      var v = opt.vol == null ? 0.3 : opt.vol;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function noise(dur, opt) {
      opt = opt || {};
      var t = ctx.currentTime + (opt.at || 0);
      var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      var src = ctx.createBufferSource(); src.buffer = buf;
      var f = ctx.createBiquadFilter(); f.type = opt.filter || 'lowpass'; f.frequency.value = opt.freq || 800;
      var g = ctx.createGain(); g.gain.value = opt.vol == null ? 0.3 : opt.vol;
      src.connect(f); f.connect(g); g.connect(master); src.start(t);
    }
    var bank = {
      tick: function () { tone(660, 0.06, { type: 'triangle', vol: 0.12 }); },
      start: function () { tone(392, 0.12, { type: 'triangle', vol: 0.2 }); tone(523, 0.12, { type: 'triangle', vol: 0.2, at: 0.09 }); tone(784, 0.22, { type: 'triangle', vol: 0.22, at: 0.18 }); },
      deal: function () { for (var i = 0; i < 5; i++) noise(0.05, { freq: 2600, vol: 0.16, at: i * 0.07, filter: 'highpass' }); },
      card: function () { noise(0.06, { freq: 2200, vol: 0.22, filter: 'highpass' }); tone(170, 0.09, { to: 90, vol: 0.28 }); },
      pass: function () { tone(330, 0.08, { type: 'triangle', vol: 0.1 }); },
      nope: function () { tone(160, 0.12, { type: 'square', vol: 0.08 }); tone(120, 0.14, { type: 'square', vol: 0.08, at: 0.1 }); },
      trump: function () { [784, 1047, 1319].forEach(function (f, i) { tone(f, 0.2, { type: 'sine', vol: 0.18, at: i * 0.08 }); }); },
      trickUs: function () { tone(523, 0.1, { type: 'triangle', vol: 0.16 }); tone(784, 0.16, { type: 'triangle', vol: 0.16, at: 0.09 }); },
      trickThem: function () { tone(294, 0.16, { type: 'triangle', vol: 0.13 }); },
      handUs: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, { type: 'triangle', vol: 0.2, at: i * 0.1 }); }); },
      handThem: function () { [392, 330].forEach(function (f, i) { tone(f, 0.26, { type: 'triangle', vol: 0.16, at: i * 0.17 }); }); },
      win: function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone(f, 0.22, { type: 'triangle', vol: 0.22, at: i * 0.11 }); }); tone(262, 0.9, { type: 'sine', vol: 0.18, at: 0.44 }); },
      lose: function () { [392, 330, 262].forEach(function (f, i) { tone(f, 0.3, { type: 'triangle', vol: 0.18, at: i * 0.18 }); }); }
    };
    function play(name) {
      if (!settings.sound) return;
      init(); if (!ctx) return;
      try { bank[name](); } catch (e) { /* ignore audio errors */ }
    }
    return { init: init, play: play };
  })();

  /* ================= Confetti ================= */
  var Confetti = (function () {
    var cv, cx, parts = [], raf = 0;
    function size() { cv.width = window.innerWidth; cv.height = window.innerHeight; }
    function burst(color) {
      cv = cv || $('#confetti'); cx = cx || cv.getContext('2d'); size();
      var cols = [color, '#ffffff', '#ffcf5c', color, '#ffe9a8'];
      for (var i = 0; i < 170; i++) {
        var side = i % 2 ? 1 : -1;
        parts.push({
          x: cv.width / 2 + side * cv.width * 0.25 * Math.random(), y: cv.height * 0.35,
          vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 15 - 4,
          w: 6 + Math.random() * 8, h: 4 + Math.random() * 6, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.4,
          c: cols[i % cols.length], life: 150 + Math.random() * 70, round: Math.random() < 0.3
        });
      }
      if (!raf) raf = requestAnimationFrame(step);
    }
    function step() {
      cx.clearRect(0, 0, cv.width, cv.height);
      parts = parts.filter(function (p) { return p.life > 0 && p.y < cv.height + 30; });
      parts.forEach(function (p) {
        p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life--;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.globalAlpha = Math.min(1, p.life / 40); cx.fillStyle = p.c;
        if (p.round) { cx.beginPath(); cx.arc(0, 0, p.w / 2, 0, 6.3); cx.fill(); } else cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      });
      if (parts.length) raf = requestAnimationFrame(step); else { raf = 0; cx.clearRect(0, 0, cv.width, cv.height); }
    }
    function clear() { parts = []; }
    return { burst: burst, clear: clear };
  })();

  /* ================= Modal ================= */
  var modalCancel = null;
  function openModal(html, buttons, onCancel) {
    var m = $('#modal');
    m.innerHTML = html + '<div class="modal-actions">' + buttons.map(function (b, i) {
      return '<button type="button" class="btn ' + (b.cls || 'ghost') + '" data-b="' + i + '">' + b.label + '</button>';
    }).join('') + '</div>';
    m.onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return;
      var fn = buttons[+b.dataset.b].fn; closeModal(); if (fn) fn();
    };
    modalCancel = onCancel || null;
    $('#modal-layer').hidden = false;
    var first = m.querySelector('.btn.primary') || m.querySelector('.btn'); if (first) first.focus();
  }
  function closeModal() { $('#modal-layer').hidden = true; $('#modal').innerHTML = ''; modalCancel = null; }
  function modalOpen() { return !$('#modal-layer').hidden; }
  function confirmModal(ico, title, text, yes, fn) {
    openModal('<div class="modal-ico">' + ico + '</div><h3>' + title + '</h3><p>' + text + '</p>',
      [{ label: 'Keep playing', cls: 'ghost' }, { label: yes, cls: 'danger', fn: fn }], function () {});
  }

  /* ================= Game state ================= */
  var G = null;        // the game in progress
  var gen = 0;         // bumped whenever a game is abandoned, so stale timers do nothing
  var wait = null;     // what we are waiting for the person to do: { kind, resolve, legal, forced }
  var aloneOn = false; // the "Go alone" switch
  var Debug = { auto: false };
  var toastTimer = 0;
  var FLASH_MS = 1500; // how long a new "Pass" or "Pick it up" bubble flashes (matches the CSS)

  function speed() { return SPEEDS[settings.speed]; }
  function nm(p) { return esc(G.names[p]); }
  // "You win" but "West wins"
  function says(p, verbYou, verbOther) { return nm(p) + ' ' + (p === 0 && G.youAreYou ? verbYou : verbOther); }
  function teamName(t) { return t === 0 ? nm(0) + ' &amp; ' + nm(2) : nm(1) + ' &amp; ' + nm(3); }

  function startGame() {
    gen++; wait = null;
    var names = seatNames();
    G = {
      names: names, youAreYou: !settings.names[0].trim(),
      scores: [0, 0], dealer: Math.floor(Math.random() * 4), handNo: 0,
      H: null, phase: 'idle', active: -1, bubbles: [null, null, null, null],
      newCard: -1, dealt: false, counted: false
    };
    closeModal(); Confetti.clear(); hideToast();
    showScreen('game');
    runHand(gen);
  }
  function gameInProgress() { return G && G.phase !== 'over' && (G.handNo > 1 || (G.H && G.H.bids.length > 0)); }
  function toSettings() {
    gen++; wait = null; closeModal(); Confetti.clear(); hideToast();
    renderSetup(); showScreen('setup');
  }

  /* ================= Drawing ================= */
  function setStatus(html) { $('#status-main').innerHTML = '<span class="txt">' + html + '</span>'; }
  function setActive(p) {
    G.active = p;
    $('#game').style.setProperty('--turn', p < 0 ? '#ffcf5c' : TEAM_COLORS[E.teamOf(p)]);
    var plates = document.querySelectorAll('#table .plate');
    for (var i = 0; i < plates.length; i++) plates[i].classList.toggle('active', +plates[i].dataset.p === p);
  }

  function renderInfo() {
    $('#round-info').innerHTML = 'Hand <b>' + G.handNo + '</b><span class="long"> &middot; Dealer: <b>' + nm(G.dealer) + '</b></span>';
  }

  function renderScore(bumpTeam) {
    var H = G.H, h = '';
    function team(t) {
      var pips = '';
      for (var i = 0; i < 5; i++) pips += '<i' + (H && i < H.tricks[t] ? ' class="on"' : '') + '></i>';
      var maker = H && H.maker >= 0 && E.teamOf(H.maker) === t;
      return '<div class="pcard t' + t + (maker ? ' maker' : '') + (bumpTeam === t ? ' bump' : '') + '">' +
        '<div class="pcard-text"><div class="pcard-name">' + teamName(t) + '</div>' +
        '<div class="pcard-tag"><span class="pips" aria-label="' + (H ? H.tricks[t] : 0) + ' tricks">' + pips + '</span>' +
        (maker ? '<span class="called">Named trump' + (H.alone ? ', alone' : '') + '</span>' : '') + '</div></div>' +
        '<div class="pcard-score"><b>' + G.scores[t] + '</b><span>of 10</span></div></div>';
    }
    h += team(0);
    if (H && H.trump >= 0) {
      h += '<div class="trumpbox set"><div class="trump-sym' + (isRed(H.trump) ? ' red' : '') + '">' + SYM[H.trump] + '</div>' +
        '<div class="trump-text"><span>Trump</span><b>' + E.SUIT_NAMES[H.trump] + '</b></div></div>';
    } else {
      h += '<div class="trumpbox"><div class="trump-sym">?</div><div class="trump-text"><span>Trump</span><b>Not yet</b></div></div>';
    }
    h += team(1);
    $('#players').innerHTML = h;
  }

  function bubbleHTML(p) {
    var b = G.bubbles[p];
    if (!b) return '<div class="bubble">&nbsp;</div>';
    // The flash lasts FLASH_MS; if the seat is re-drawn part-way through, carry on from where it was.
    var age = Date.now() - b.t, flash = age < FLASH_MS;
    return '<div class="bubble show' + (b.call ? ' call' : '') + (flash ? ' pop' : '') + '"' +
      (flash ? ' style="animation-delay:-' + Math.max(0, age) + 'ms"' : '') + '>' + b.html + '</div>';
  }
  // Who plays the first card of the trick: the player on the dealer's left to start the hand,
  // then whoever won the last trick. Nobody once the hand is over.
  function leaderNow() {
    var H = G.H;
    if (!H || G.phase === 'handover' || G.phase === 'over' || H.trickNo >= 5) return -1;
    return G.phase === 'play' ? H.leader : E.nextSeat(H, G.dealer);
  }
  function plateHTML(p) {
    var H = G.H, out = H && H.sitting === p;
    var dealer = G.dealer === p, leads = leaderNow() === p;
    return '<div class="plate t' + E.teamOf(p) + (G.active === p ? ' active' : '') + (out ? ' out' : '') + (dealer ? ' dealer' : '') + (leads ? ' leads' : '') + '" data-p="' + p + '"><span class="pname">' + nm(p) + '</span>' +
      (H && H.maker === p && H.trump != null && H.trump >= 0 ? '<span class="chip-t' + (isRed(H.trump) ? ' red' : '') + '" title="Named ' + E.SUIT_NAMES[H.trump].toLowerCase() + ' as trump" aria-label="Named ' + E.SUIT_NAMES[H.trump].toLowerCase() + ' as trump">' + SYM[H.trump] + '</span>' : '') +
      (leads ? '<span class="chip-l">Leads</span>' : '') + (dealer ? '<span class="chip-d">Dealer</span>' : '') + '</div>';
  }
  function renderSeats2() {
    var H = G.H;
    for (var p = 1; p <= 3; p++) {
      var backs = '';
      if (H && H.sitting === p) backs = '<span class="note">Sitting out</span>';
      else if (H) for (var i = 0; i < H.hands[p].length; i++) backs += '<span class="card back"></span>';
      $('#seat-' + p).innerHTML = plateHTML(p) + '<div class="backs">' + backs + '</div>' + bubbleHTML(p);
    }
    var note = '';
    if (H && H.sitting === 0) note = '<span class="note">' + nm(2) + ' is going alone, so you sit this hand out.</span>';
    $('#you-line').innerHTML = plateHTML(0) + bubbleHTML(0) + note;
  }

  function renderHand() {
    var H = G.H, el = $('#hand');
    if (!H) { el.innerHTML = ''; return; }
    var cards = sortHand(H.hands[0], H.trump);
    var picking = wait && (wait.kind === 'play' || wait.kind === 'discard');
    el.className = 'hand' + (H.sitting === 0 ? ' out' : '') + (G.dealt ? ' dealt' : '');
    el.innerHTML = cards.map(function (c) {
      var can = picking && wait.legal.indexOf(c) >= 0;
      return '<button type="button" class="' + cardClass(c, H.trump) + (picking ? (can ? ' can' : ' no') : '') + (G.newCard === c ? ' new' : '') +
        '" data-c="' + c + '" aria-label="' + cardName(c) + '"' + (picking && !can ? ' aria-disabled="true"' : '') + '>' + cardInner(c, H.trump) + '</button>';
    }).join('');
    G.dealt = false; G.newCard = -1;
  }

  function renderUpcard() {
    var H = G.H, el = $('#upcard'), h = '';
    if (H && G.phase === 'bid') {
      var s = E.suitOf(H.upcard);
      if (H.round === 1) h = cardHTML(H.upcard, -1) + '<div class="cap">Turned up</div>';
      else h = '<span class="card back"></span><div class="cap">' + symHTML(s) + ' ' + E.SUIT_NAMES[s] + ' turned down</div>';
    }
    el.innerHTML = h;
  }

  function addTrickCard(p, c) {
    var d = document.createElement('div');
    d.className = cardClass(c, G.H.trump) + ' s' + p;
    d.innerHTML = cardInner(c, G.H.trump);
    $('#trick').appendChild(d);
  }
  function clearTrick() { var t = $('#trick'); t.innerHTML = ''; t.className = 'trick'; }
  function markWinner(p) {
    var t = $('#trick'), el = t.querySelector('.s' + p);
    if (el) el.classList.add('win');
    t.classList.add('settled');
  }
  async function sweepTrick(p) {
    $('#trick').classList.add('sweep-' + p);
    await sleep(430);
  }

  function renderActions() {
    var el = $('#actions'), H = G.H, h = '';
    function aloneSwitch() {
      return '<button class="switch" type="button" role="switch" data-act="alone" aria-checked="' + aloneOn + '" aria-label="Go alone">' +
        '<span class="switch-knob"></span><span class="switch-label">Go alone</span></button>';
    }
    if (wait && wait.kind === 'bid1') {
      var label = G.dealer === 0 ? 'Pick it up' : 'Order it up';
      h = aloneSwitch() + '<button class="btn ghost" type="button" data-act="pass">Pass</button>' +
        '<button class="btn primary" type="button" data-act="order">' + label + (aloneOn ? ', alone' : '') + '</button>';
    } else if (wait && wait.kind === 'bid2') {
      h = aloneSwitch() + (wait.forced ? '' : '<button class="btn ghost" type="button" data-act="pass">Pass</button>');
      for (var s = 0; s < 4; s++) {
        if (s === E.suitOf(H.upcard)) continue;
        h += '<button class="btn ghost suit" type="button" data-act="suit" data-suit="' + s + '" aria-label="' + E.SUIT_NAMES[s] + '">' + symHTML(s) + '<span class="nm">' + E.SUIT_NAMES[s] + '</span></button>';
      }
    } else if (G.phase === 'handover') {
      h = '<button class="btn primary" type="button" data-act="next">Next hand</button>';
    } else if (G.phase === 'over') {
      h = '<button class="btn primary" type="button" data-act="again">Play again</button>';
    }
    el.innerHTML = h;
  }

  function renderAll() { renderInfo(); renderScore(); renderSeats2(); renderHand(); renderUpcard(); renderActions(); }

  function say(p, html, call) { G.bubbles[p] = { html: html, call: !!call, t: Date.now() }; }

  function showToast(icoHTML, title, sub, ms, low) {
    var t = $('#toast');
    t.classList.toggle('low', !!low);       // low = over your empty hand, so the last trick stays in view
    t.innerHTML = icoHTML + '<div><b>' + title + '</b><span>' + sub + '</span></div>';
    t.classList.add('show');
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() { clearTimeout(toastTimer); var t = $('#toast'); if (t) t.classList.remove('show'); }

  /* ================= Waiting for the person ================= */
  function ask(kind, extra) {
    return new Promise(function (resolve) {
      wait = { kind: kind, resolve: function (v) { wait = null; resolve(v); } };
      for (var k in extra) wait[k] = extra[k];
      setActive(0); renderHand(); renderActions();
      var first = kind === 'play' || kind === 'discard' ? null : $('#actions .btn.primary');
      if (first && !modalOpen()) first.focus({ preventScroll: true });
      if (Debug.auto) setTimeout(autoAnswer, 30);
    });
  }
  // Test hook: lets the computer play your seat too.
  function autoAnswer() {
    if (!wait) return;
    var H = G.H, w = wait, a;
    if (w.kind === 'bid1') w.resolve(E.ai.bid1(H, 0, G.scores));
    else if (w.kind === 'bid2') { a = E.ai.bid2(H, 0, G.scores, w.forced); w.resolve(a); }
    else if (w.kind === 'discard') w.resolve(E.ai.discard(H, G.scores));
    else if (w.kind === 'play') w.resolve(E.ai.play(H, 0, G.scores));
  }

  function bindTable() {
    $('#hand').addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]'); if (!b || !wait) return;
      if (wait.kind !== 'play' && wait.kind !== 'discard') return;
      var c = +b.dataset.c;
      if (wait.legal.indexOf(c) < 0) {
        Sound.play('nope');
        if (wait.kind === 'play' && G.H.trick.length) {
          var lead = E.effSuit(G.H.trick[0].c, G.H.trump);
          setStatus('You have to follow suit: play a ' + E.SUIT_NAMES[lead].toLowerCase().replace(/s$/, '') + '.');
        }
        return;
      }
      wait.resolve(c);
    });
    $('#actions').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.dataset.act;
      if (act === 'alone') { aloneOn = !aloneOn; Sound.play('tick'); renderActions(); var sw = $('#actions .switch'); if (sw) sw.focus(); return; }
      if (act === 'next') { Sound.play('start'); nextHand(); return; }
      if (act === 'again') { Sound.play('start'); startGame(); return; }
      if (!wait) return;
      if (act === 'pass') wait.resolve(wait.kind === 'bid1' ? { order: false, alone: false } : { suit: -1, alone: false });
      else if (act === 'order' && wait.kind === 'bid1') wait.resolve({ order: true, alone: aloneOn });
      else if (act === 'suit' && wait.kind === 'bid2') wait.resolve({ suit: +b.dataset.suit, alone: aloneOn });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalOpen() && modalCancel) { var fn = modalCancel; closeModal(); fn(); }
    });
  }

  /* ================= One hand ================= */
  async function think(p, ms, my) {
    setActive(p);
    setStatus(says(p, 'are', 'is') + ' thinking<span class="dots"></span>');
    await sleep(ms);
    return my === gen;
  }

  function announceTrump() {
    var H = G.H, p = H.maker, how;
    if (H.round === 1) how = p === G.dealer ? says(p, 'pick', 'picks') + ' it up' : says(p, 'order', 'orders') + ' it up';
    else how = says(p, 'name', 'names') + ' trump';
    if (H.alone) how += ' and ' + (p === 0 && G.youAreYou ? 'go' : 'goes') + ' alone';
    showToast('<div class="toast-ico sym' + (isRed(H.trump) ? ' red' : '') + '">' + SYM[H.trump] + '</div>', E.SUIT_NAMES[H.trump] + ' are trump', how + '.', 2400);
    Sound.play('trump');
  }

  async function runHand(my) {
    var H = G.H = E.deal(G.dealer), sp = speed(), i, p, act, c;
    G.handNo++; G.phase = 'bid'; G.bubbles = [null, null, null, null]; G.dealt = true; G.counted = false;
    wait = null; aloneOn = false;
    hideToast(); clearTrick(); G.active = -1; renderAll(); setActive(-1);
    Sound.play('deal');
    setStatus(says(G.dealer, 'deal', 'deals') + '. The ' + cardName(H.upcard) + ' is turned up.');
    await sleep(Math.max(700, sp.bid)); if (my !== gen) return;

    // ----- round 1: order up the turned-up card? -----
    var called = false;
    for (i = 1; i <= 4 && !called; i++) {
      p = (G.dealer + i) & 3;
      if (p === 0) {
        setStatus(G.dealer === 0 ? 'Your call: pick up the ' + cardName(H.upcard) + '?' :
          'Your call: order ' + nm(G.dealer) + ' to pick up the ' + cardName(H.upcard) + '?');
        act = await ask('bid1');
      } else {
        if (!(await think(p, sp.bid, my))) return;
        act = E.ai.bid1(H, p, G.scores);
      }
      if (my !== gen) return;
      if (act.order) {
        E.orderUp(H, p, act.alone); called = true;
        say(p, (p === G.dealer ? 'I’ll pick it up' : 'Pick it up') + (act.alone ? ', alone!' : ''), true);
      } else {
        E.pass(H, p); say(p, 'Pass'); Sound.play('pass');
        setStatus(says(p, 'pass', 'passes') + '.');
      }
      renderSeats2(); renderActions();
      if (!called) { await sleep(sp.said); if (my !== gen) return; }
    }

    if (called) {
      G.phase = 'deal2'; announceTrump();
      if (G.dealer === 0 && H.needDiscard) G.newCard = H.upcard;
      renderAll();
      if (H.needDiscard) {
        if (G.dealer === 0) {
          setStatus('You picked up the ' + cardName(H.upcard) + '. Choose a card to throw away.');
          c = await ask('discard', { legal: H.hands[0].slice() });
        } else {
          setActive(G.dealer);
          setStatus(says(G.dealer, 'pick', 'picks') + ' up the ' + cardName(H.upcard) + '.');
          await sleep(sp.bid); if (my !== gen) return;
          c = E.ai.discard(H, G.scores);
        }
        if (my !== gen) return;
        E.discard(H, c); Sound.play('card'); renderAll();
      }
    } else {
      // ----- round 2: name a different suit -----
      E.turnDown(H); renderUpcard();
      setStatus('Everyone passed. The ' + cardName(H.upcard) + ' is turned down.');
      await sleep(sp.said + 300); if (my !== gen) return;
      for (i = 1; i <= 4 && !called; i++) {
        p = (G.dealer + i) & 3;
        var forced = i === 4;
        if (p === 0) {
          setStatus(forced ? 'Everyone passed. You are the dealer, so you have to name trump.' : 'Your call: name a trump suit, or pass.');
          act = await ask('bid2', { forced: forced });
        } else {
          if (!(await think(p, sp.bid, my))) return;
          act = E.ai.bid2(H, p, G.scores, forced);
        }
        if (my !== gen) return;
        if (act.suit >= 0) {
          E.callSuit(H, p, act.suit, act.alone); called = true;
          say(p, symHTML(act.suit) + ' ' + E.SUIT_NAMES[act.suit] + (act.alone ? ', alone!' : ''), true);
        } else {
          E.pass(H, p); say(p, 'Pass'); Sound.play('pass');
          setStatus(says(p, 'pass', 'passes') + '.');
        }
        renderSeats2(); renderActions();
        if (!called) { await sleep(sp.said); if (my !== gen) return; }
      }
      G.phase = 'deal2'; announceTrump(); renderAll();
    }

    setActive(-1);
    await sleep(Math.max(1500, sp.trick)); if (my !== gen) return;

    // ----- play five tricks -----
    hideToast();
    G.bubbles = [null, null, null, null];
    E.startPlay(H); G.phase = 'play'; renderAll();
    while (H.trickNo < 5) {
      p = H.turn;
      if (p === 0) {
        var legal = E.legalCards(H, 0);
        if (H.hands[0].length === 1) { setActive(0); await sleep(sp.play * 0.6); c = legal[0]; }
        else {
          setStatus(H.trick.length ? 'Your turn.' : 'Your lead.');
          c = await ask('play', { legal: legal });
        }
      } else {
        if (!(await think(p, sp.play, my))) return;
        c = E.ai.play(H, p, G.scores);
      }
      if (my !== gen) return;
      var res = E.play(H, p, c);
      addTrickCard(p, c); Sound.play('card');
      renderSeats2(); renderHand(); renderActions();
      if (res.done) {
        setActive(-1); markWinner(res.winner); renderScore();
        setStatus(says(res.winner, 'take', 'takes') + ' the trick.');
        Sound.play(E.teamOf(res.winner) === 0 ? 'trickUs' : 'trickThem');
        await sleep(sp.trick); if (my !== gen) return;
        if (H.trickNo < 5) { await sweepTrick(res.winner); if (my !== gen) return; clearTrick(); }
      }
    }
    finishHand(my);
  }

  function finishHand(my) {
    var H = G.H, r = E.result(H), mt = E.teamOf(H.maker), us = r.team === 0;
    G.scores[r.team] += r.pts;
    var title, sub, pts = '+' + r.pts + (r.pts === 1 ? ' point' : ' points') + ' for ' + teamName(r.team);
    if (r.kind === 'euchre') { title = 'Euchre!'; sub = teamName(mt) + ' named trump but took only ' + r.makerTricks + (r.makerTricks === 1 ? ' trick. ' : ' tricks. ') + pts + '.'; }
    else if (r.kind === 'loner') { title = 'A lone hand!'; sub = says(H.maker, 'take', 'takes') + ' all five tricks alone. ' + pts + '.'; }
    else if (r.kind === 'march') { title = 'All five tricks!'; sub = pts + '.'; }
    else { title = teamName(mt) + ' made it'; sub = r.makerTricks + ' tricks. ' + pts + '.'; }
    renderScore(r.team); setActive(-1);
    setStatus(teamName(0) + ' <b>' + G.scores[0] + '</b>, ' + teamName(1) + ' <b>' + G.scores[1] + '</b>');
    var over = G.scores[0] >= E.WIN_SCORE || G.scores[1] >= E.WIN_SCORE;
    showToast('<div class="toast-ico">' + (us ? '🎉' : '😮') + '</div>', title, sub, 0, true);
    if (!over) {
      G.phase = 'handover'; Sound.play(us ? 'handUs' : 'handThem');
      renderActions();
      var b = $('#actions .btn.primary'); if (b) b.focus({ preventScroll: true });
      if (Debug.auto) setTimeout(function () { if (my === gen && G.phase === 'handover') nextHand(); }, 300);
      return;
    }
    G.phase = 'over'; renderActions();
    var won = G.scores[0] >= E.WIN_SCORE;
    if (!G.counted) { G.counted = true; if (won) settings.won++; else settings.lost++; saveSettings(); }
    setTimeout(function () { if (my === gen && G.phase === 'over') showGameOver(won); }, 1500);
  }

  function nextHand() {
    if (!G || G.phase !== 'handover') return;
    G.dealer = (G.dealer + 1) & 3;
    runHand(gen);
  }

  function showGameOver(won) {
    hideToast();
    Sound.play(won ? 'win' : 'lose');
    if (won) Confetti.burst(TEAM_COLORS[0]);
    var rows = [0, 1].map(function (t) {
      var lead = (t === 0) === won;
      return '<div class="score-row' + (lead ? ' lead' : '') + '"><span class="nm">' + teamName(t) + '</span><span class="sc">' + G.scores[t] + '</span></div>';
    }).join('');
    var n = settings.won + settings.lost;
    openModal('<div class="modal-ico">' + (won ? '🏆' : '🃏') + '</div><h3>' + (won ? teamName(0) + ' win!' : teamName(1) + ' win') + '</h3>' +
      '<p>' + (won ? 'Well played.' : 'So close. Deal again?') + '</p><div class="scores">' + rows + '</div>' +
      '<p>Games won: ' + settings.won + ' of ' + n + '</p>', [
      { label: 'Play again', cls: 'primary', fn: function () { Sound.play('start'); startGame(); } },
      { label: 'See the table', cls: 'ghost' },
      { label: 'Settings', cls: 'ghost', fn: toSettings }
    ], function () {});
  }

  function askRestart() {
    if (!gameInProgress()) { startGame(); return; }
    confirmModal('↻', 'Start over?', 'This ends the game and sets both scores back to zero.', 'Start over', startGame);
  }
  function askSettings() {
    if (!gameInProgress()) { toSettings(); return; }
    confirmModal('⚙️', 'Leave this game?', 'Going to Settings ends this game and clears the scores.', 'Leave game', toSettings);
  }

  /* ================= Top-bar buttons ================= */
  function updateSoundBtn() {
    var b = $('#sound-btn');
    b.classList.toggle('off', !settings.sound);
    b.setAttribute('aria-label', settings.sound ? 'Sound on' : 'Sound off');
  }
  function bindTopbar() {
    $('#sound-btn').addEventListener('click', function () {
      settings.sound = !settings.sound; saveSettings(); updateSoundBtn(); Sound.play('tick');
    });
    var root = document.documentElement;
    var canFs = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!canFs) $('#fs-btn').hidden = true;
    $('#fs-btn').addEventListener('click', function () {
      var el = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (el) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else { var p = (root.requestFullscreen || root.webkitRequestFullscreen).call(root); if (p && p.catch) p.catch(function () {}); }
      } catch (e) { /* not allowed here */ }
    });
    $('#restart-btn').addEventListener('click', askRestart);
    $('#menu-btn').addEventListener('click', askSettings);
  }

  /* ================= Boot ================= */
  function boot() {
    loadSettings();
    renderSetup(); bindSetup(); bindTable(); bindTopbar(); updateSoundBtn();
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  }

  // Small hook used for testing from the browser console.
  window.EuchreDebug = {
    get game() { return G; },
    get waiting() { return wait; },
    set auto(v) { Debug.auto = !!v; if (v) autoAnswer(); },
    get auto() { return Debug.auto; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
