/* ================= Euchre engine =================
   The rules of euchre and the computer players. No screen code in this file.

   Cards are numbers 0-23: suit = floor(card / 6), rank = card % 6.
   Suits: 0 spades, 1 hearts, 2 clubs, 3 diamonds (so the same-colour suit is suit + 2).
   Ranks: 0 nine, 1 ten, 2 jack, 3 queen, 4 king, 5 ace.
   Seats: 0 you (south), 1 west, 2 partner (north), 3 east. Play goes 0 -> 1 -> 2 -> 3.
   Teams: seats 0 and 2 are team 0, seats 1 and 3 are team 1.

   How the computer players think: for every decision they deal out the unseen
   cards many different ways that fit what they have seen (cards played, suits
   players have run out of, who bid and who passed), work out the best possible
   play of each deal, and pick the bid or card that wins the game most often. */
(function (root) {
  'use strict';

  var RANK_LABELS = ['9', '10', 'J', 'Q', 'K', 'A'];
  var RANK_NAMES = ['nine', 'ten', 'jack', 'queen', 'king', 'ace'];
  var SUIT_NAMES = ['Spades', 'Hearts', 'Clubs', 'Diamonds'];
  var SUIT_SYMS = ['♠', '♥', '♣', '♦'];
  var WIN_SCORE = 10;

  var rand = Math.random;
  function setRandom(fn) { rand = fn || Math.random; }
  function rnd(n) { return Math.floor(rand() * n); }

  function suitOf(c) { return (c / 6) | 0; }
  function rankOf(c) { return c % 6; }
  function teamOf(p) { return p & 1; }
  function partnerOf(p) { return (p + 2) & 3; }

  /* Per-trump tables. EFF = the suit a card counts as (the left bower counts as trump).
     VAL = strength inside that suit: plain suits 0-5; trump 6 (nine) up to 11 (left) and 12 (right). */
  var EFF = [], VAL = [], SMASK = [];
  (function () {
    for (var t = 0; t < 4; t++) {
      EFF[t] = []; VAL[t] = []; SMASK[t] = [0, 0, 0, 0];
      for (var c = 0; c < 24; c++) {
        var s = suitOf(c), r = rankOf(c), e = s, v = r;
        if (r === 2 && s === t) v = 12;
        else if (r === 2 && s === ((t + 2) & 3)) { e = t; v = 11; }
        else if (s === t) v = r < 2 ? 6 + r : 5 + r;
        EFF[t][c] = e; VAL[t][c] = v; SMASK[t][e] |= 1 << c;
      }
    }
  })();
  function effSuit(c, trump) { return trump < 0 ? suitOf(c) : EFF[trump][c]; }

  /* Chance of winning the game from a score, used so the computer players weigh
     points by how much they matter (a point at 9-9 is worth more than at 2-2). */
  var WT = [];
  (function () {
    var outs = [[1, 0.36], [2, 0.11], [4, 0.03]], a, b;
    for (a = 0; a <= WIN_SCORE; a++) WT[a] = [];
    function get(x, y) { if (x >= WIN_SCORE) return 1; if (y >= WIN_SCORE) return 0; return WT[x][y]; }
    for (var sum = 2 * WIN_SCORE - 2; sum >= 0; sum--) {
      for (a = 0; a < WIN_SCORE; a++) {
        b = sum - a; if (b < 0 || b >= WIN_SCORE) continue;
        var w = 0;
        for (var i = 0; i < outs.length; i++) w += outs[i][1] * (get(a + outs[i][0], b) + get(a, b + outs[i][0]));
        WT[a][b] = w;
      }
    }
  })();
  function winChance(us, them) { if (us >= WIN_SCORE) return 1; if (them >= WIN_SCORE) return 0; return WT[us][them]; }

  /* ================= Rules ================= */
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function deal(dealer) {
    var deck = []; for (var c = 0; c < 24; c++) deck.push(c);
    shuffle(deck);
    var H = {
      dealer: dealer,
      hands: [deck.slice(0, 5), deck.slice(5, 10), deck.slice(10, 15), deck.slice(15, 20)],
      upcard: deck[20],
      upState: 'shown',        // 'shown' | 'dealer' (picked up) | 'out' (turned down or dealer sitting out)
      round: 1,
      bids: [],                // { p, round, action: 'pass' | 'call', suit, alone }
      trump: -1, maker: -1, alone: false, sitting: -1,
      needDiscard: false, discard: -1,
      played: [],              // every card played this hand: { p, c }
      trick: [],               // cards in the current trick: { p, c }
      tricks: [0, 0],          // tricks won by each team
      trickNo: 0, turn: -1, leader: -1,
      voids: [[false, false, false, false], [false, false, false, false], [false, false, false, false], [false, false, false, false]]
    };
    return H;
  }

  function pass(H, p) { H.bids.push({ p: p, round: H.round, action: 'pass' }); }
  function turnDown(H) { H.round = 2; H.upState = 'out'; }

  function setTrump(H, p, suit, alone) {
    H.trump = suit; H.maker = p; H.alone = !!alone; H.sitting = alone ? partnerOf(p) : -1;
    H.bids.push({ p: p, round: H.round, action: 'call', suit: suit, alone: !!alone });
  }
  // Round 1: the turned-up card's suit becomes trump and the dealer picks the card up.
  function orderUp(H, p, alone) {
    setTrump(H, p, suitOf(H.upcard), alone);
    if (H.sitting === H.dealer) { H.upState = 'out'; H.needDiscard = false; }
    else { H.hands[H.dealer].push(H.upcard); H.upState = 'dealer'; H.needDiscard = true; }
  }
  // Round 2: name any suit except the one turned down.
  function callSuit(H, p, suit, alone) { setTrump(H, p, suit, alone); }

  function discard(H, c) {
    var h = H.hands[H.dealer], i = h.indexOf(c);
    if (i < 0) return false;
    h.splice(i, 1); H.discard = c; H.needDiscard = false;
    return true;
  }

  function nextSeat(H, p) { p = (p + 1) & 3; if (p === H.sitting) p = (p + 1) & 3; return p; }
  function startPlay(H) { H.leader = nextSeat(H, H.dealer); H.turn = H.leader; }

  function legalCards(H, p) {
    var hand = H.hands[p];
    if (!H.trick.length) return hand.slice();
    var lead = EFF[H.trump][H.trick[0].c];
    var follow = hand.filter(function (c) { return EFF[H.trump][c] === lead; });
    return follow.length ? follow : hand.slice();
  }

  function trickWinner(trick, trump) {
    var lead = EFF[trump][trick[0].c], best = -2, who = -1;
    for (var i = 0; i < trick.length; i++) {
      var c = trick[i].c, e = EFF[trump][c];
      var v = e === trump ? 100 + VAL[trump][c] : (e === lead ? VAL[trump][c] : -1);
      if (v > best) { best = v; who = trick[i].p; }
    }
    return who;
  }

  // Plays a card. Returns { done: false } or, when the trick is complete, { done: true, winner, cards }.
  function play(H, p, c) {
    var hand = H.hands[p], i = hand.indexOf(c);
    hand.splice(i, 1);
    if (H.trick.length) {
      var lead = EFF[H.trump][H.trick[0].c];
      if (EFF[H.trump][c] !== lead) H.voids[p][lead] = true;
    }
    H.trick.push({ p: p, c: c }); H.played.push({ p: p, c: c });
    var n = H.sitting < 0 ? 4 : 3;
    if (H.trick.length < n) { H.turn = nextSeat(H, p); return { done: false }; }
    var w = trickWinner(H.trick, H.trump), cards = H.trick;
    H.tricks[teamOf(w)]++; H.trickNo++; H.trick = []; H.leader = w; H.turn = w;
    return { done: true, winner: w, cards: cards };
  }

  function pointsFor(makerTricks, alone) {
    if (makerTricks < 3) return -2;                 // euchred: the other team scores 2
    if (makerTricks < 5) return 1;
    return alone ? 4 : 2;
  }
  // After five tricks: who scores and how many.
  function result(H) {
    var mt = teamOf(H.maker), tr = H.tricks[mt], pts = pointsFor(tr, H.alone);
    if (pts < 0) return { team: 1 - mt, pts: 2, kind: 'euchre', makerTricks: tr };
    return { team: mt, pts: pts, kind: pts === 4 ? 'loner' : pts === 2 ? 'march' : 'made', makerTricks: tr };
  }

  /* ================= Perfect-play solver =================
     Given all four hands, finds how many of the remaining tricks team 0 takes
     when every player plays perfectly. Hands are 24-bit masks. */
  function makeSolver(trump, sitting) {
    var eff = EFF[trump], val = VAL[trump], sm = SMASK[trump];
    var n = sitting < 0 ? 4 : 3;
    var h = [0, 0, 0, 0], memo = new Map();
    var tPos = 0, tLead = -1, tBestV = -2, tBestP = -1;

    function nxt(p) { p = (p + 1) & 3; if (p === sitting) p = (p + 1) & 3; return p; }

    function lead(leader, a, b) {
      if (h[leader] === 0) return 0;
      var key = h[0] + ',' + h[1] + ',' + h[2] + ',' + h[3] + ',' + leader;
      var e = memo.get(key), lo = 0, hi = 5;
      if (e !== undefined) {
        lo = e >> 3; hi = e & 7;
        if (lo >= b) return lo;
        if (hi <= a) return hi;
        if (lo === hi) return lo;
        if (lo > a) a = lo;
        if (hi < b) b = hi;
      }
      var v = node(0, leader, -1, -2, -1, a, b);
      if (v <= a) { if (v < hi) hi = v; }
      else if (v >= b) { if (v > lo) lo = v; }
      else { lo = v; hi = v; }
      memo.set(key, (lo << 3) | hi);
      return v;
    }

    function after(pos, p, c, leadSuit, bestV, bestP, a, b) {
      var bit = 1 << c;
      var ls = pos === 0 ? eff[c] : leadSuit;
      var v = eff[c] === trump ? 100 + val[c] : (eff[c] === ls ? val[c] : -1);
      if (v > bestV) { bestV = v; bestP = p; }
      h[p] ^= bit;
      var r;
      if (pos === n - 1) { var add = (bestP & 1) === 0 ? 1 : 0; r = add + lead(bestP, a - add, b - add); }
      else r = node(pos + 1, nxt(p), ls, bestV, bestP, a, b);
      h[p] ^= bit;
      return r;
    }

    function node(pos, p, leadSuit, bestV, bestP, a, b) {
      var moves = h[p];
      if (pos > 0) { var f = moves & sm[leadSuit]; if (f) moves = f; }
      var maxing = (p & 1) === 0, best = maxing ? -1 : 99;
      while (moves) {
        var bit = moves & -moves; moves ^= bit;
        var r = after(pos, p, 31 - Math.clz32(bit), leadSuit, bestV, bestP, a, b);
        if (maxing) { if (r > best) best = r; if (best > a) a = best; }
        else { if (r < best) best = r; if (best < b) b = best; }
        if (a >= b) break;
      }
      return best;
    }

    return {
      // masks: the four hands. trick: cards already on the table in this trick ([{p, c}]).
      set: function (masks, trick) {
        h[0] = masks[0]; h[1] = masks[1]; h[2] = masks[2]; h[3] = masks[3];
        memo.clear();
        tPos = 0; tLead = -1; tBestV = -2; tBestP = -1;
        if (trick) for (var i = 0; i < trick.length; i++) {
          var c = trick[i].c;
          if (i === 0) tLead = eff[c];
          var v = eff[c] === trump ? 100 + val[c] : (eff[c] === tLead ? val[c] : -1);
          if (v > tBestV) { tBestV = v; tBestP = trick[i].p; }
          tPos++;
        }
      },
      // Tricks team 0 takes from here on if player p now plays card c.
      evalMove: function (p, c) { return after(tPos, p, c, tLead, tBestV, tBestP, -1, 9); },
      // Tricks team 0 takes with `leader` leading to a fresh trick.
      solveLead: function (leader) { return lead(leader, -1, 9); }
    };
  }

  function maskOf(cards) { var m = 0; for (var i = 0; i < cards.length; i++) m |= 1 << cards[i]; return m; }

  /* ================= Hand strength (rule of thumb) =================
     Used to throw out unlikely deals ("she passed, so she can't be holding
     both bowers") and to skip the heavy thinking on hopeless hands. */
  var TRUMP_PTS = [1.0, 1.15, 1.3, 1.5, 2.0, 2.5, 3.0]; // nine ... right bower
  function strength(cards, trump) {
    var pts = 0, ntr = 0, cnt = [0, 0, 0, 0];
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (EFF[trump][c] === trump) { ntr++; pts += TRUMP_PTS[VAL[trump][c] - 6]; }
      else { cnt[suitOf(c)]++; var r = rankOf(c); if (r === 5) pts += 1; else if (r === 4) pts += 0.3; }
    }
    var voids = 0; for (var s = 0; s < 4; s++) if (s !== trump && cnt[s] === 0) voids++;
    if (ntr >= 2) pts += 0.5 * Math.min(voids, 2);
    if (ntr >= 3) pts += 0.5;
    return pts;
  }

  // Which card a dealer would most happily throw away (lowest "keep" value first).
  function keepOrder(hand, trump) {
    var cnt = [0, 0, 0, 0], i;
    for (i = 0; i < hand.length; i++) if (EFF[trump][hand[i]] !== trump) cnt[suitOf(hand[i])]++;
    function keep(c) {
      if (EFF[trump][c] === trump) return 100 + VAL[trump][c];
      var r = rankOf(c), k = r;
      if (r === 5) k += 6;                                   // hold on to aces
      if (cnt[suitOf(c)] === 1 && r < 5) k -= 7;             // a lone low card: throwing it leaves a suit empty
      return k;
    }
    return hand.slice().sort(function (x, y) { return keep(x) - keep(y) || x - y; });
  }
  function quickDiscard(hand, trump) { return keepOrder(hand, trump)[0]; }

  /* ================= Dealing out the unseen cards ================= */
  // Deals the cards player p cannot see to the other players, respecting what p knows.
  // Returns an array of four card lists (index p holds p's real hand; a sitting-out seat gets []).
  function sampleOnce(H, p) {
    var seen = 0, i, q, c;
    seen |= maskOf(H.hands[p]);
    for (i = 0; i < H.played.length; i++) seen |= 1 << H.played[i].c;
    seen |= 1 << H.upcard;
    if (p === H.dealer && H.discard >= 0) seen |= 1 << H.discard;

    var upPlayed = false;
    for (i = 0; i < H.played.length; i++) if (H.played[i].c === H.upcard) upPlayed = true;
    var fixedUp = H.upState === 'dealer' && p !== H.dealer && !upPlayed && H.discard !== H.upcard;

    var pool = [];
    for (c = 0; c < 24; c++) if (!(seen & (1 << c))) pool.push(c);

    var need = [0, 0, 0, 0], order = [];
    for (q = 0; q < 4; q++) {
      if (q === p || q === H.sitting) continue;
      need[q] = H.hands[q].length - (fixedUp && q === H.dealer ? 1 : 0);
      order.push(q);
    }
    var trump = H.trump;
    function allowed(q, card) { return trump < 0 || !H.voids[q][EFF[trump][card]]; }

    for (var attempt = 0; attempt < 40; attempt++) {
      var relax = attempt >= 30;                 // give up on the "ran out of a suit" clues if they cannot be met
      shuffle(pool);
      // most restricted players choose first
      var ord = order.slice().sort(function (x, y) {
        var ax = 0, ay = 0;
        for (var k = 0; k < pool.length; k++) { if (allowed(x, pool[k])) ax++; if (allowed(y, pool[k])) ay++; }
        return (ax - need[x]) - (ay - need[y]);
      });
      var used = 0, out = [[], [], [], []], ok = true;
      for (i = 0; i < ord.length && ok; i++) {
        q = ord[i];
        for (var k2 = 0; k2 < pool.length && out[q].length < need[q]; k2++) {
          if (used & (1 << pool[k2])) continue;
          if (!relax && !allowed(q, pool[k2])) continue;
          out[q].push(pool[k2]); used |= 1 << pool[k2];
        }
        if (out[q].length < need[q]) ok = false;
      }
      if (!ok) continue;
      if (fixedUp) out[H.dealer].push(H.upcard);
      out[p] = H.hands[p].slice();
      return out;
    }
    return null;
  }

  // Would the bidding we saw make sense if the players held these cards?
  function fitsBidding(H, p, hands) {
    var up = suitOf(H.upcard);
    for (var i = 0; i < H.bids.length; i++) {
      var b = H.bids[i], q = b.p;
      if (q === p || q === H.sitting) continue;
      var orig = hands[q].slice();
      for (var k = 0; k < H.played.length; k++) if (H.played[k].p === q) orig.push(H.played[k].c);
      if (b.action === 'pass' && b.round === 1) {
        var s = strength(orig, up);
        if (q === H.dealer) s += TRUMP_PTS[VAL[up][H.upcard] - 6] - 0.5;
        else if (teamOf(q) === teamOf(H.dealer)) s += 0.6;
        else s -= 0.5;
        if (s >= 8.3) return false;
      } else if (b.action === 'pass') {
        for (var t = 0; t < 4; t++) if (t !== up && strength(orig, t) >= 8.3) return false;
      } else {
        if (strength(orig, b.suit) < (b.alone ? 6.5 : 4.3)) return false;
      }
    }
    return true;
  }

  function sampleDeal(H, p) {
    var last = null;
    for (var tries = 0; tries < 12; tries++) {
      var s = sampleOnce(H, p);
      if (!s) continue;
      last = s;
      if (fitsBidding(H, p, s)) return s;
    }
    return last;
  }

  /* ================= Computer players ================= */
  var DEFAULTS = {
    bidSamples: 36,      // deals imagined per bidding decision
    playSamples: 40,     // deals imagined per card played
    bidOffset: 0.35      // how cautious the bidding is; tuned by playing thousands of hands against itself
  };
  // What passing is roughly worth, in points, by seat (1 = left of dealer ... 0 = dealer).
  var PASS1 = [0.0, -0.3, 0.3, -0.2];
  var PASS2 = [0.0, 0.1, -0.2, 0.3];

  function utilAfter(team, scores, makerTeam, makerTricks, alone) {
    var pts = pointsFor(makerTricks, alone), s0 = scores[0], s1 = scores[1];
    if (pts > 0) { if (makerTeam === 0) s0 += pts; else s1 += pts; }
    else { if (makerTeam === 0) s1 += 2; else s0 += 2; }
    return team === 0 ? winChance(s0, s1) : winChance(s1, s0);
  }
  function passValue(team, scores, pe) {
    var us = scores[team], them = scores[1 - team], base = winChance(us, them);
    if (pe >= 0) return base + pe * (winChance(us + 1, them) - base);
    return base - pe * (winChance(us, them + 1) - base);
  }

  // Average result (as chance of winning the game) of each calling option for player p.
  // options: [{ suit, alone }]. round 1 options make the dealer pick up the turned-up card.
  function evalCalls(H, p, options, scores, n) {
    var tot = options.map(function () { return 0; }), team = teamOf(p), count = 0;
    for (var i = 0; i < n; i++) {
      var s = sampleDeal(H, p); if (!s) continue;
      count++;
      for (var j = 0; j < options.length; j++) {
        var o = options[j], sitting = o.alone ? partnerOf(p) : -1;
        var hands = [s[0], s[1], s[2], s[3]];
        if (H.round === 1 && sitting !== H.dealer) {
          var dh = s[H.dealer].concat([H.upcard]);
          var d = quickDiscard(dh, o.suit);
          hands[H.dealer] = dh.filter(function (c) { return c !== d; });
        }
        var masks = [0, 0, 0, 0];
        for (var q = 0; q < 4; q++) if (q !== sitting) masks[q] = maskOf(hands[q]);
        var sol = makeSolver(o.suit, sitting);
        sol.set(masks, null);
        var leader = (H.dealer + 1) & 3; if (leader === sitting) leader = (leader + 1) & 3;
        var t0 = sol.solveLead(leader);
        tot[j] += utilAfter(team, scores, team, team === 0 ? t0 : 5 - t0, o.alone);
      }
    }
    return tot.map(function (x) { return count ? x / count : 0; });
  }

  // Round 1: order up the turned-up card? Returns { order, alone }.
  function bid1(H, p, scores, cfg) {
    cfg = cfg || DEFAULTS;
    var up = suitOf(H.upcard), seat = (p - H.dealer + 4) & 3, team = teamOf(p);
    var mine = p === H.dealer ? H.hands[p].concat([H.upcard]) : H.hands[p];
    var st = strength(mine, up);
    if (st < 3.6) return { order: false, alone: false };
    var opts = [{ suit: up, alone: false }];
    if (st >= 6.5) opts.push({ suit: up, alone: true });
    var u = evalCalls(H, p, opts, scores, cfg.bidSamples);
    var pv = passValue(team, scores, PASS1[seat] + (cfg.bidOffset || 0));
    var best = u[0], alone = false;
    if (u.length > 1 && u[1] > u[0]) { best = u[1]; alone = true; }
    if (best > pv) return { order: true, alone: alone };
    return { order: false, alone: false };
  }

  // Round 2: name a suit? Returns { suit (-1 = pass), alone }. forced = stuck dealer.
  function bid2(H, p, scores, forced, cfg) {
    cfg = cfg || DEFAULTS;
    var up = suitOf(H.upcard), seat = (p - H.dealer + 4) & 3, team = teamOf(p);
    var opts = [], t;
    for (t = 0; t < 4; t++) {
      if (t === up) continue;
      var st = strength(H.hands[p], t);
      if (forced || st >= 3.6) {
        opts.push({ suit: t, alone: false });
        if (st >= 6.5) opts.push({ suit: t, alone: true });
      }
    }
    if (!opts.length) return { suit: -1, alone: false };
    var u = evalCalls(H, p, opts, scores, cfg.bidSamples), bi = 0;
    for (var i = 1; i < u.length; i++) if (u[i] > u[bi]) bi = i;
    if (!forced) {
      var pv = passValue(team, scores, PASS2[seat] + (cfg.bidOffset || 0));
      if (u[bi] <= pv) return { suit: -1, alone: false };
    }
    return { suit: opts[bi].suit, alone: opts[bi].alone };
  }

  // The dealer has picked up the turned-up card (six cards in hand): which one to throw away.
  function chooseDiscard(H, scores, cfg) {
    cfg = cfg || DEFAULTS;
    var d = H.dealer, hand = H.hands[d], trump = H.trump, team = teamOf(d), makerTeam = teamOf(H.maker);
    var order = keepOrder(hand, trump);
    var cands = order.filter(function (c) { return EFF[trump][c] !== trump; });
    if (cands.length <= 1) return order[0];
    var tot = cands.map(function () { return 0; });
    var leader = nextSeat(H, d);
    for (var i = 0; i < cfg.playSamples; i++) {
      var s = sampleDeal(H, d); if (!s) continue;
      var masks = [0, 0, 0, 0];
      for (var q = 0; q < 4; q++) if (q !== H.sitting) masks[q] = maskOf(s[q]);
      var sol = makeSolver(trump, H.sitting);
      for (var j = 0; j < cands.length; j++) {
        masks[d] = maskOf(hand) & ~(1 << cands[j]);
        sol.set(masks, null);
        var t0 = sol.solveLead(leader);
        tot[j] += utilAfter(team, scores, makerTeam, makerTeam === 0 ? t0 : 5 - t0, H.alone) +
          0.002 * (team === 0 ? t0 : 5 - t0);
      }
    }
    var best = Math.max.apply(null, tot);
    // among near-equal choices, take the one the rule of thumb likes best (cands is already in that order)
    for (var k = 0; k < cands.length; k++) if (tot[k] >= best - 0.004 * cfg.playSamples) return cands[k];
    return cands[0];
  }

  function cardCost(c, trump) { return EFF[trump][c] === trump ? 20 + VAL[trump][c] : rankOf(c); }

  // Which card to play.
  function choosePlay(H, p, scores, cfg) {
    cfg = cfg || DEFAULTS;
    var legal = legalCards(H, p);
    if (legal.length === 1) return legal[0];
    var trump = H.trump, team = teamOf(p), makerTeam = teamOf(H.maker);
    var tot = legal.map(function () { return 0; });
    for (var i = 0; i < cfg.playSamples; i++) {
      var s = sampleDeal(H, p); if (!s) continue;
      var masks = [0, 0, 0, 0];
      for (var q = 0; q < 4; q++) if (q !== H.sitting) masks[q] = maskOf(s[q]);
      var sol = makeSolver(trump, H.sitting);
      sol.set(masks, H.trick);
      for (var j = 0; j < legal.length; j++) {
        var v = sol.evalMove(p, legal[j]);            // tricks team 0 still takes
        var t0 = H.tricks[0] + v;
        tot[j] += utilAfter(team, scores, makerTeam, makerTeam === 0 ? t0 : 5 - t0, H.alone) +
          0.002 * (team === 0 ? v : -v);              // when the result is settled, still take what tricks we can
      }
    }
    var best = -Infinity, pick = legal[0], pickCost = 999;
    for (var k = 0; k < legal.length; k++) {
      var cost = cardCost(legal[k], trump);
      if (tot[k] > best + 1e-9 || (Math.abs(tot[k] - best) <= 1e-9 && cost < pickCost)) {
        if (tot[k] > best) best = tot[k];
        pick = legal[k]; pickCost = cost;
      }
    }
    return pick;
  }

  root.Euchre = {
    RANK_LABELS: RANK_LABELS, RANK_NAMES: RANK_NAMES, SUIT_NAMES: SUIT_NAMES, SUIT_SYMS: SUIT_SYMS, WIN_SCORE: WIN_SCORE,
    suitOf: suitOf, rankOf: rankOf, teamOf: teamOf, partnerOf: partnerOf, effSuit: effSuit,
    trumpValue: function (c, trump) { return VAL[trump][c]; },
    deal: deal, pass: pass, turnDown: turnDown, orderUp: orderUp, callSuit: callSuit, discard: discard,
    startPlay: startPlay, nextSeat: nextSeat, legalCards: legalCards, play: play, result: result, trickWinner: trickWinner,
    ai: { bid1: bid1, bid2: bid2, discard: chooseDiscard, play: choosePlay, strength: strength, defaults: DEFAULTS },
    _test: { setRandom: setRandom, makeSolver: makeSolver, maskOf: maskOf, sampleDeal: sampleDeal, winChance: winChance, evalCalls: evalCalls }
  };
})(typeof window !== 'undefined' ? window : globalThis);
