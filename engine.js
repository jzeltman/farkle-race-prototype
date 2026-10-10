/*
 * Orbital Farkle — game engine (no DOM).
 * Loaded by index.html via a classic <script> tag, and by sim.js via require().
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Config (every value here is a tuning dial; see the Tuning panel in the UI)
  // ---------------------------------------------------------------------------

  const HAND_DEFS = [
    // id, display name, family, base chips, base mult
    { id: 'single1', name: 'Single 1', family: 'single', chips: 10, mult: 1 },
    { id: 'single5', name: 'Single 5', family: 'single', chips: 5, mult: 1 },
    { id: 'twoPair', name: 'Two pair', family: 'set', chips: 25, mult: 3 },
    { id: 'three', name: 'Three of a kind', family: 'set', chips: 30, mult: 3 },
    { id: 'four', name: 'Four of a kind', family: 'set', chips: 60, mult: 4 },
    { id: 'five', name: 'Five of a kind', family: 'set', chips: 100, mult: 5 },
    { id: 'six', name: 'Six of a kind', family: 'set', chips: 150, mult: 7 },
    { id: 'fullHouse', name: 'Full house', family: 'set', chips: 50, mult: 4 },
    { id: 'smallStraight', name: 'Small straight', family: 'run', chips: 30, mult: 3 },
    { id: 'mediumStraight', name: 'Medium straight', family: 'run', chips: 50, mult: 4 },
    { id: 'fullStraight', name: 'Full straight', family: 'run', chips: 80, mult: 6 },
    { id: 'threePairs', name: 'Three pairs', family: 'set', chips: 60, mult: 6 },
    { id: 'twoTriplets', name: 'Two triplets', family: 'set', chips: 100, mult: 7 },
  ];

  const HAND_DICE_TEXT = {
    single1: '1 die (a 1)',
    single5: '1 die (a 5)',
    twoPair: '2 different pairs',
    three: '3 matching',
    four: '4 matching',
    five: '5 matching',
    six: '6 matching',
    fullHouse: '3 matching + a different pair',
    smallStraight: '4 in sequence',
    mediumStraight: '5 in sequence',
    fullStraight: '1-2-3-4-5-6',
    threePairs: '3 pairs (or 4 of a kind + a pair)',
    twoTriplets: '2 different triples',
  };

  function defaultConfig() {
    const hands = {};
    HAND_DEFS.forEach(function (h) {
      hands[h.id] = { chips: h.chips, mult: h.mult };
    });
    return {
      targetScore: 2500,
      // 'pooled': pad resolves as (sum of chips) x (sum of mult), Balatro style.
      // 'perHand': each hand resolves as its own chips x mult, then they are added.
      scoringMode: 'pooled',
      gaugeTiers: 5,
      hotDice: true,
      showFarkleRisk: true,
      hands: hands,
      powerups: {
        single: { enabled: true, chips: 10, appliesTo: ['single1', 'single5'] },
        run: { enabled: true, mult: 2, appliesTo: ['smallStraight', 'mediumStraight'] },
        set: {
          enabled: true,
          xmult: 1.5,
          appliesTo: ['twoPair', 'three', 'four', 'five', 'six', 'fullHouse', 'threePairs', 'twoTriplets'],
        },
      },
      ai: {
        // Launch threshold as a share of the target score, before adjustments.
        baseLaunchShare: 0.2,
        leadingFactor: 0.65, // launch earlier when leading
        trailingMax: 1.8, // launch later when trailing (scaled by how far behind)
        jitter: 0.25, // +/- random spread per burn so the AI is not solvable
        usesItems: true,
      },
      consumables: {
        capacity: 3, // inventory slots per ship
        perLevel: 2, // random items granted at the start of each level (both ships get the same draws)
        earnOnHotDice: false, // hot dice grants one random item (if there is a free slot)
        pool: { nudgeUp: true, nudgeDown: true, reroll: true, intercept: true, copyDie: true },
      },
      levels: {
        multiplier: 1.5, // each level's target = level 1 target x multiplier^(level-1)
      },
    };
  }

  function mergeConfig(base, over) {
    if (!over || typeof over !== 'object') return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    Object.keys(over).forEach(function (k) {
      const bv = base ? base[k] : undefined;
      const ov = over[k];
      if (bv && typeof bv === 'object' && !Array.isArray(bv) && ov && typeof ov === 'object') {
        out[k] = mergeConfig(bv, ov);
      } else if (ov !== undefined) {
        out[k] = ov;
      }
    });
    return out;
  }

  /** Target score for a level (level 1 = cfg.targetScore). */
  function levelTarget(cfg, level) {
    return Math.round((cfg.targetScore * Math.pow(cfg.levels.multiplier, Math.max(0, level - 1))) / 10) * 10;
  }

  /** The config for one level: same dials, scaled target. */
  function levelConfig(cfg, level) {
    return mergeConfig(cfg, { targetScore: levelTarget(cfg, level) });
  }

  // ---------------------------------------------------------------------------
  // RNG
  // ---------------------------------------------------------------------------

  function makeRng(seed) {
    if (seed === undefined || seed === null) return Math.random;
    let a = seed >>> 0;
    return function () {
      // mulberry32
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rollDice(n, rng) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(1 + Math.floor(rng() * 6));
    return out;
  }

  // ---------------------------------------------------------------------------
  // Hands and scoring
  // ---------------------------------------------------------------------------

  const HAND_BY_ID = {};
  HAND_DEFS.forEach(function (h) {
    HAND_BY_ID[h.id] = h;
  });

  /** Chips and mult for one hand after the power-up loadout is applied. */
  function handValue(id, cfg) {
    const base = cfg.hands[id];
    let chips = base.chips;
    let mult = base.mult;
    const boosts = [];
    const p = cfg.powerups;
    if (p.single.enabled && p.single.appliesTo.indexOf(id) >= 0) {
      chips += p.single.chips;
      boosts.push('+' + p.single.chips + ' chips');
    }
    if (p.run.enabled && p.run.appliesTo.indexOf(id) >= 0) {
      mult += p.run.mult;
      boosts.push('+' + p.run.mult + ' mult');
    }
    if (p.set.enabled && p.set.appliesTo.indexOf(id) >= 0) {
      mult = mult * p.set.xmult;
      boosts.push('×' + p.set.xmult + ' mult');
    }
    return { chips: chips, mult: round2(mult), boosts: boosts };
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  function makeHand(id, dice, cfg) {
    const v = handValue(id, cfg);
    return {
      id: id,
      name: HAND_BY_ID[id].name,
      family: HAND_BY_ID[id].family,
      dice: dice.slice().sort(),
      chips: v.chips,
      mult: v.mult,
      label: handLabel(id, dice),
    };
  }

  function handLabel(id, dice) {
    const h = HAND_BY_ID[id];
    if (id === 'twoPair' || id === 'fullHouse') {
      const c = {};
      dice.forEach(function (v) { c[v] = (c[v] || 0) + 1; });
      const faces = Object.keys(c).map(Number).sort();
      if (id === 'twoPair') return h.name + ' (' + faces[0] + 's & ' + faces[1] + 's)';
      const trip = faces.filter(function (f) { return c[f] === 3; })[0];
      const pr = faces.filter(function (f) { return c[f] === 2; })[0];
      return h.name + ' (' + trip + 's over ' + pr + 's)';
    }
    if (h.family === 'set' && id !== 'threePairs' && id !== 'twoTriplets') {
      return h.name + ' (' + dice[0] + 's)';
    }
    if (h.family === 'run') {
      const s = dice.slice().sort();
      return h.name + ' (' + s[0] + '–' + s[s.length - 1] + ')';
    }
    return h.name;
  }

  /**
   * Resolve a list of hands into a launch total.
   * Returns { chips, mult, total, steps[] } where steps describe the reveal.
   */
  function resolvePad(hands, cfg) {
    let chips = 0;
    let mult = 0;
    let perHandTotal = 0;
    const steps = hands.map(function (h) {
      chips += h.chips;
      mult = round2(mult + h.mult);
      const own = Math.round(h.chips * h.mult);
      perHandTotal += own;
      return { label: h.label, chips: h.chips, mult: h.mult, runChips: chips, runMult: mult, own: own, runOwn: perHandTotal };
    });
    const total = cfg.scoringMode === 'perHand' ? perHandTotal : Math.round(chips * mult);
    return { chips: chips, mult: mult, total: total, steps: steps, mode: cfg.scoringMode };
  }

  /**
   * Split a set of selected dice values into scoring hands that use every die.
   * Returns the best-scoring split (array of hands) or null if the selection is not valid.
   */
  function decompose(values, cfg) {
    const n = values.length;
    if (!n) return null;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) {
      counts[v]++;
    });
    let best = null;
    function consider(list) {
      const s = resolvePad(list, cfg).total;
      if (!best || s > best.score || (s === best.score && list.length < best.list.length)) {
        best = { list: list.slice(), score: s };
      }
    }
    // Single pairs don't score; pairs only count inside two pair, full house and three pairs.
    const kinds = { 3: 'three', 4: 'four', 5: 'five', 6: 'six' };
    const straights = [
      [4, 'smallStraight'],
      [5, 'mediumStraight'],
      [6, 'fullStraight'],
    ];
    const acc = [];
    // Take parts ([[face, count], ...]) out of counts as one hand, recurse, then put them back.
    function tryHand(id, parts) {
      for (let i = 0; i < parts.length; i++) if (counts[parts[i][0]] < parts[i][1]) return;
      const dice = [];
      parts.forEach(function (pt) {
        counts[pt[0]] -= pt[1];
        for (let i = 0; i < pt[1]; i++) dice.push(pt[0]);
      });
      acc.push(makeHand(id, dice, cfg));
      recurse();
      acc.pop();
      parts.forEach(function (pt) {
        counts[pt[0]] += pt[1];
      });
    }
    function recurse() {
      let f = 1;
      while (f <= 6 && counts[f] === 0) f++;
      if (f > 6) {
        consider(acc);
        return;
      }
      // The lowest remaining face must belong to some hand; try every hand containing it.
      if (f === 1 || f === 5) {
        counts[f]--;
        acc.push(makeHand(f === 1 ? 'single1' : 'single5', [f], cfg));
        recurse();
        acc.pop();
        counts[f]++;
      }
      for (let k = 3; k <= Math.min(counts[f], 6); k++) {
        tryHand(kinds[k], [[f, k]]);
      }
      // Multi-face set hands built from f and higher faces g < h.
      for (let g = f + 1; g <= 6; g++) {
        tryHand('twoPair', [[f, 2], [g, 2]]);
        tryHand('fullHouse', [[f, 3], [g, 2]]);
        tryHand('fullHouse', [[f, 2], [g, 3]]);
        tryHand('twoTriplets', [[f, 3], [g, 3]]);
        for (let h = g + 1; h <= 6; h++) tryHand('threePairs', [[f, 2], [g, 2], [h, 2]]);
        // Four of a kind plus a pair also counts as three pairs.
        tryHand('threePairs', [[f, 4], [g, 2]]);
        tryHand('threePairs', [[f, 2], [g, 4]]);
      }
      straights.forEach(function (st) {
        const len = st[0];
        if (f + len - 1 > 6) return;
        for (let i = f; i < f + len; i++) if (!counts[i]) return;
        const dice = [];
        for (let i = f; i < f + len; i++) {
          counts[i]--;
          dice.push(i);
        }
        acc.push(makeHand(st[1], dice, cfg));
        recurse();
        acc.pop();
        for (let i = f; i < f + len; i++) counts[i]++;
      });
    }
    recurse();
    return best ? best.list : null;
  }

  /** True if any subset of the roll scores (i.e. the roll is not a farkle). */
  function hasScoring(values) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    values.forEach(function (v) {
      counts[v]++;
    });
    if (counts[1] || counts[5]) return true;
    let pairs = 0;
    for (let f = 1; f <= 6; f++) {
      if (counts[f] >= 3) return true;
      if (counts[f] >= 2) pairs++;
    }
    if (pairs >= 2) return true; // two pair
    for (let s = 1; s <= 3; s++) {
      if (counts[s] && counts[s + 1] && counts[s + 2] && counts[s + 3]) return true;
    }
    return false;
  }

  /** Exact probability that rolling n dice is a farkle. */
  const farkleCache = {};
  function farkleChance(n) {
    if (n <= 0) return 0;
    if (farkleCache[n] !== undefined) return farkleCache[n];
    let bad = 0;
    const total = Math.pow(6, n);
    const vals = new Array(n).fill(1);
    for (let i = 0; i < total; i++) {
      let x = i;
      for (let d = 0; d < n; d++) {
        vals[d] = (x % 6) + 1;
        x = Math.floor(x / 6);
      }
      if (!hasScoring(vals)) bad++;
    }
    farkleCache[n] = bad / total;
    return farkleCache[n];
  }

  /** All valid cache options for a roll: [{ idx:[...], hands:[...] }]. */
  function cacheOptions(values, cfg) {
    const out = [];
    const n = values.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      const idx = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
      const hands = decompose(
        idx.map(function (i) {
          return values[i];
        }),
        cfg
      );
      if (hands) out.push({ idx: idx, hands: hands });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Thrust gauge (coarse tiers)
  // ---------------------------------------------------------------------------

  const TIER_NAMES_5 = ['Cold', 'Spark', 'Burn', 'Roar', 'Inferno'];

  function gaugeThresholds(cfg) {
    const n = Math.max(2, cfg.gaugeTiers | 0);
    const out = [];
    // Tier 0 = empty pad. Tiers 1..n-1 start at target * (k/n)^1.5
    for (let k = 1; k < n; k++) out.push(cfg.targetScore * Math.pow(k / n, 1.5));
    return out;
  }

  /** A rough pad value from a gauge reading: the middle of its tier (the floor of the top tier). */
  function gaugeEstimate(g, cfg) {
    if (!g.tier) return 0;
    const th = gaugeThresholds(cfg);
    const lo = g.tier === 1 ? 0 : th[g.tier - 2];
    const hi = g.tier - 1 < th.length ? th[g.tier - 1] : null;
    return hi === null ? lo : (lo + hi) / 2;
  }

  function gaugeTier(total, handsCount, cfg) {
    if (!handsCount) return { tier: 0, of: cfg.gaugeTiers, name: 'Empty' };
    const th = gaugeThresholds(cfg);
    let t = 1;
    for (let i = 0; i < th.length; i++) if (total >= th[i]) t = i + 2;
    const n = cfg.gaugeTiers;
    const name = n === 5 ? TIER_NAMES_5[t - 1] : 'Tier ' + t;
    return { tier: t, of: n, name: name };
  }

  // ---------------------------------------------------------------------------
  // Consumables
  // ---------------------------------------------------------------------------

  const CONSUMABLE_DEFS = [
    { id: 'nudgeUp', name: 'Nudge up', icon: '▲', kind: 'self', target: 'ownDie', desc: 'Raise one of your dice by 1 (6 wraps to 1).' },
    { id: 'nudgeDown', name: 'Nudge down', icon: '▼', kind: 'self', target: 'ownDie', desc: 'Lower one of your dice by 1 (1 wraps to 6).' },
    { id: 'reroll', name: 'Reroll', icon: '↻', kind: 'self', target: 'ownDie', desc: 'Reroll one of your dice.' },
    { id: 'intercept', name: 'Intercept', icon: '⧉', kind: 'opponent', target: 'oppHand', desc: "Copy one hand from the opponent's pad onto yours. Theirs stays intact." },
    { id: 'copyDie', name: 'Copy die', icon: '⎘', kind: 'opponent', target: 'oppDie', desc: "Copy one of the opponent's dice from this round's roll into your roll as a bonus die." },
  ];
  const CONSUMABLE_BY_ID = {};
  CONSUMABLE_DEFS.forEach(function (c) {
    CONSUMABLE_BY_ID[c.id] = c;
  });
  // Items that can turn a farkle into a scoring roll.
  const RESCUE_ITEMS = ['nudgeUp', 'nudgeDown', 'reroll', 'copyDie'];

  function wrapDie(v) {
    return ((v - 1 + 6) % 6) + 1;
  }

  // ---------------------------------------------------------------------------
  // Match
  // ---------------------------------------------------------------------------

  function emptyInventory() {
    const inv = {};
    CONSUMABLE_DEFS.forEach(function (c) {
      inv[c.id] = 0;
    });
    return inv;
  }

  function inventoryCount(inv) {
    return Object.keys(inv).reduce(function (n, k) {
      return n + (inv[k] || 0);
    }, 0);
  }

  function newSide(id, cfg) {
    return {
      id: id,
      banked: 0,
      pad: [],
      available: 6,
      dice: [], // current roll values (may include bonus dice)
      bonus: [], // bonus[i] true when dice[i] was copied from the opponent
      rolled: null, // this round's roll as rolled, before any items (visible to the opponent)
      items: [], // consumables used this turn
      inventory: emptyInventory(),
      burn: null, // active burn info for logging
      lastTurn: null,
    };
  }

  function Match(cfg, opts) {
    opts = opts || {};
    this.cfg = cfg;
    this.rng = opts.rng || Math.random;
    this.round = 0;
    this.player = newSide('player', cfg);
    this.ai = newSide('ai', cfg);
    this.over = false;
    this.winner = null;
    this.overtime = false;
    this.aiPlan = null;
    this.padAtRoundStart = { player: [], ai: [] };
    this.level = opts.level || 1;
    this.log = { burns: [], rounds: [], items: [], startedAt: Date.now() };
    // Leftover items carry over from the previous level, then both ships draw the same new items.
    const carry = opts.carry || {};
    if (carry.player) this.player.inventory = Object.assign(emptyInventory(), carry.player);
    if (carry.ai) this.ai.inventory = Object.assign(emptyInventory(), carry.ai);
    this.levelGrants = []; // items drawn this level
    this.levelLost = { player: [], ai: [] }; // drawn items that didn't fit in a full inventory
    for (let k = 0; k < cfg.consumables.perLevel; k++) {
      const id = this.drawItem();
      if (!id) break;
      this.levelGrants.push(id);
      [this.player, this.ai].forEach(function (sd) {
        if (!this.giveItem(sd, id)) this.levelLost[sd.id].push(id);
      }, this);
    }
  }

  Match.prototype.other = function (side) {
    return side === this.player ? this.ai : this.player;
  };

  Match.prototype.padTotal = function (side) {
    return resolvePad(side.pad, this.cfg).total;
  };

  Match.prototype.gauge = function (side) {
    return gaugeTier(this.padTotal(side), side.pad.length, this.cfg);
  };

  Match.prototype.beginRound = function () {
    this.round++;
    [this.player, this.ai].forEach(function (s) {
      s.items = [];
      s.rolled = null;
      s.dice = [];
      s.bonus = [];
    });
    // Intercept copies from the opponent's pad as it stood when the round began.
    this.padAtRoundStart = { player: this.player.pad.slice(), ai: this.ai.pad.slice() };
    // The AI commits before it sees anything the player does this round.
    this.aiPlan = aiDecide(this, this.ai, this.player);
  };

  Match.prototype.ensureBurn = function (side) {
    if (!side.burn) {
      const o = this.other(side);
      side.burn = {
        side: side.id,
        startRound: this.round,
        caches: 0,
        rolls: 0,
        hotDice: 0,
        items: 0,
        diffAtStart: side.banked - o.banked,
        jitter: 1 + (this.rng() * 2 - 1) * this.cfg.ai.jitter,
      };
    }
    return side.burn;
  };

  Match.prototype.roll = function (side) {
    this.ensureBurn(side).rolls++;
    side.dice = rollDice(side.available, this.rng);
    side.bonus = side.dice.map(function () { return false; });
    side.rolled = side.dice.slice();
    return { values: side.dice.slice(), farkle: !hasScoring(side.dice) };
  };

  Match.prototype.isFarkle = function (side) {
    return !hasScoring(side.dice);
  };

  /** Number of live (non-bonus) dice among the given indices. */
  Match.prototype.liveCount = function (side, idx) {
    return idx.filter(function (i) { return !side.bonus[i]; }).length;
  };

  // --- consumable use. Each returns a description object, or null if not allowed. ---

  Match.prototype.canUse = function (side, id) {
    if (!(side.inventory[id] > 0)) return false;
    const opp = this.other(side);
    if (id === 'intercept') return this.padAtRoundStart[opp.id].length > 0;
    if (id === 'copyDie') return side.dice.length > 0 && !!opp.rolled && opp.rolled.length > 0;
    return side.dice.length > 0; // nudges and reroll need a roll in front of you
  };

  Match.prototype.spend = function (side, id, detail) {
    side.inventory[id]--;
    const rec = Object.assign({ id: id, name: CONSUMABLE_BY_ID[id].name, icon: CONSUMABLE_BY_ID[id].icon }, detail);
    side.items.push(rec);
    this.ensureBurn(side).items++;
    this.log.items.push(Object.assign({ side: side.id, round: this.round }, rec));
    return rec;
  };

  Match.prototype.useNudge = function (side, i, dir) {
    const id = dir > 0 ? 'nudgeUp' : 'nudgeDown';
    if (!this.canUse(side, id) || i < 0 || i >= side.dice.length) return null;
    const from = side.dice[i];
    side.dice[i] = wrapDie(from + dir);
    return this.spend(side, id, { from: from, to: side.dice[i], text: from + ' → ' + side.dice[i] });
  };

  Match.prototype.useReroll = function (side, i) {
    if (!this.canUse(side, 'reroll') || i < 0 || i >= side.dice.length) return null;
    const from = side.dice[i];
    side.dice[i] = rollDice(1, this.rng)[0];
    return this.spend(side, 'reroll', { from: from, to: side.dice[i], text: from + ' → ' + side.dice[i] });
  };

  Match.prototype.useCopyDie = function (side, oppIdx) {
    const opp = this.other(side);
    if (!this.canUse(side, 'copyDie') || oppIdx < 0 || oppIdx >= opp.rolled.length) return null;
    const v = opp.rolled[oppIdx];
    side.dice.push(v);
    side.bonus.push(true);
    return this.spend(side, 'copyDie', { value: v, text: 'copied a ' + v });
  };

  Match.prototype.useIntercept = function (side, handIdx) {
    const opp = this.other(side);
    const src = this.padAtRoundStart[opp.id];
    if (!this.canUse(side, 'intercept') || handIdx < 0 || handIdx >= src.length) return null;
    const h = Object.assign({}, src[handIdx], { copied: true });
    side.pad = side.pad.concat([h]);
    return this.spend(side, 'intercept', { hand: h.label, text: 'copied ' + h.label });
  };

  /** A random item id from the enabled pool, or null if the pool is empty. */
  Match.prototype.drawItem = function () {
    const pool = this.cfg.consumables.pool;
    const ids = CONSUMABLE_DEFS.map(function (c) { return c.id; }).filter(function (id) {
      return pool[id];
    });
    if (!ids.length) return null;
    return ids[Math.floor(this.rng() * ids.length)];
  };

  /** Add an item if the ship has a free inventory slot. Returns true if it fit. */
  Match.prototype.giveItem = function (side, id) {
    if (inventoryCount(side.inventory) >= this.cfg.consumables.capacity) return false;
    side.inventory[id] = (side.inventory[id] || 0) + 1;
    return true;
  };

  Match.prototype.grantRandomItem = function (side) {
    const id = this.drawItem();
    return id && this.giveItem(side, id) ? id : null;
  };

  /** Cache the dice at the given indices of the current roll. Returns the turn record or null if invalid. */
  Match.prototype.cache = function (side, idx) {
    const vals = idx.map(function (i) {
      return side.dice[i];
    });
    const hands = decompose(vals, this.cfg);
    if (!hands) return null;
    const roll = side.rolled ? side.rolled.slice() : side.dice.slice();
    const finalDice = side.dice.slice();
    side.pad = side.pad.concat(hands);
    // Bonus (copied) dice don't come out of your live dice.
    side.available -= this.liveCount(side, idx);
    const burn = this.ensureBurn(side);
    burn.caches++;
    let hot = false;
    let earned = null;
    if (side.available === 0 && this.cfg.hotDice) {
      side.available = 6;
      burn.hotDice++;
      hot = true;
      if (this.cfg.consumables.earnOnHotDice) earned = this.grantRandomItem(side);
    }
    side.dice = [];
    side.bonus = [];
    return { type: 'cache', roll: roll, finalDice: finalDice, kept: idx.slice(), hands: hands, hot: hot, earned: earned, diceLeft: side.available };
  };

  Match.prototype.farkle = function (side) {
    const lost = resolvePad(side.pad, this.cfg);
    const handsLost = side.pad.slice();
    const roll = side.rolled ? side.rolled.slice() : side.dice.slice();
    const finalDice = side.dice.slice();
    this.endBurn(side, 'farkle', lost.total);
    side.pad = [];
    side.available = 6;
    side.dice = [];
    side.bonus = [];
    return { type: 'farkle', roll: roll, finalDice: finalDice, lost: lost, handsLost: handsLost };
  };

  Match.prototype.launch = function (side) {
    const res = resolvePad(side.pad, this.cfg);
    const hands = side.pad.slice();
    const before = side.banked;
    this.endBurn(side, 'launch', res.total);
    side.banked += res.total;
    side.pad = [];
    side.available = 6;
    side.dice = [];
    side.bonus = [];
    return { type: 'launch', resolution: res, hands: hands, before: before, after: side.banked };
  };

  Match.prototype.endBurn = function (side, outcome, total) {
    const b = side.burn;
    if (!b) return;
    const o = this.other(side);
    b.outcome = outcome;
    b.total = total;
    b.endRound = this.round;
    b.diffAtEnd = side.banked - o.banked;
    b.trailing = b.diffAtEnd < 0;
    this.log.burns.push(b);
    side.burn = null;
  };

  /**
   * Roll for the AI now if it committed to rolling. Called when the player rolls so both
   * rolls are revealed together and each side can see (and copy from) the other's dice.
   */
  Match.prototype.aiRollIfPlanned = function () {
    if (this.aiPlan && this.aiPlan.type === 'roll' && !this.ai.rolled) this.roll(this.ai);
  };

  /** Player commits a full turn (a record from cache(), farkle() or launch()). */
  Match.prototype.resolveRound = function (playerTurnRecord) {
    const aiTurn = executeAiPlan(this, this.ai, this.aiPlan);
    const pTurn = playerTurnRecord;
    pTurn.items = this.player.items.slice();
    this.player.lastTurn = pTurn;
    this.ai.lastTurn = aiTurn;

    const t = this.cfg.targetScore;
    const pR = this.player.banked >= t;
    const aR = this.ai.banked >= t;
    let result = null;
    if (this.overtime) {
      if (this.player.banked !== this.ai.banked) result = this.player.banked > this.ai.banked ? 'player' : 'ai';
    } else if (pR && aR) {
      // Both reached orbit in the same round: a tie, so another round is played.
      // From then on the higher banked score at the end of a round wins.
      this.overtime = true;
      result = 'tie';
    } else if (pR) result = 'player';
    else if (aR) result = 'ai';

    const rec = {
      round: this.round,
      player: summarizeTurn(pTurn),
      ai: summarizeTurn(aiTurn),
      playerBanked: this.player.banked,
      aiBanked: this.ai.banked,
    };
    this.log.rounds.push(rec);

    if (result === 'player' || result === 'ai') {
      this.over = true;
      this.winner = result;
      // close any open burns so they are logged
      [this.player, this.ai].forEach(function (s) {
        if (s.burn) this.endBurn(s, 'matchEnd', this.padTotal(s));
      }, this);
      this.log.endedAt = Date.now();
    }
    return { player: pTurn, ai: aiTurn, result: result, round: this.round };
  };

  function summarizeTurn(t) {
    if (!t) return null;
    const items = (t.items || []).map(function (i) { return i.name + ' (' + i.text + ')'; });
    let s;
    if (t.type === 'cache') s = { type: 'cache', roll: t.roll, hands: t.hands.map(function (h) { return h.label; }), hot: t.hot };
    else if (t.type === 'farkle') s = { type: 'farkle', roll: t.roll, lost: t.lost.total };
    else if (t.type === 'launch') s = { type: 'launch', total: t.resolution.total };
    else s = { type: t.type };
    s.items = items;
    s.reason = t.reason;
    return s;
  }

  // ---------------------------------------------------------------------------
  // AI: readable heuristic. Keeps rolling when trailing, launches earlier when leading.
  // ---------------------------------------------------------------------------

  function aiDecide(match, me, opp) {
    const cfg = match.cfg;
    if (!me.pad.length) return { type: 'roll', reason: 'Pad is empty' };
    if (me.available === 0) return { type: 'launch', reason: 'No dice left' };
    const pad = match.padTotal(me);
    const need = cfg.targetScore - me.banked;
    if (pad >= need) return { type: 'launch', reason: 'Pad reaches orbit' };

    // Judge the race on projected scores: banked plus a read of the pad gauge, so a big
    // unbanked pad on the other ship counts as a threat even before it launches.
    const oppEst = opp.banked + gaugeEstimate(match.gauge(opp), cfg);
    const lead = me.banked + pad - oppEst;

    // The opponent could reach orbit on their next launch. Banking short of orbit won't
    // stop them, so race for a pad that gets us there, unless the next roll is very risky.
    if (oppEst >= cfg.targetScore) {
      const rescues = cfg.ai.usesItems ? (me.inventory.nudgeUp || 0) + (me.inventory.nudgeDown || 0) + (me.inventory.reroll || 0) : 0;
      if (farkleChance(me.available) >= 0.4 && !rescues) return { type: 'launch', reason: 'They are near orbit and my dice are thin: banking' };
      return { type: 'roll', reason: 'They are near orbit: racing to get there first' };
    }

    let threshold = cfg.targetScore * cfg.ai.baseLaunchShare;
    if (lead > 0) threshold *= cfg.ai.leadingFactor;
    else if (lead < 0) threshold *= 1 + Math.min(1, (-lead / cfg.targetScore) * 2) * (cfg.ai.trailingMax - 1);

    // Few dice left means a high farkle chance on the next roll. Rescue items soften that.
    let risk = farkleChance(me.available);
    const rescues = (me.inventory.nudgeUp || 0) + (me.inventory.nudgeDown || 0) + (me.inventory.reroll || 0);
    if (cfg.ai.usesItems && rescues > 0) risk *= 0.5;
    if (risk >= 0.5) threshold *= 0.45;
    else if (risk >= 0.25) threshold *= 0.65;
    else if (risk >= 0.1) threshold *= 0.85;

    threshold *= me.burn ? me.burn.jitter : 1;
    if (threshold > need) threshold = need;
    if (pad >= threshold) return { type: 'launch', reason: lead > 0 ? 'Ahead: banking early' : 'Pad is big enough' };
    return { type: 'roll', reason: lead < 0 ? 'Behind: pressing on' : 'Building thrust' };
  }

  /**
   * Pick the AI's cache from a roll. values/bonus describe the dice; live = live dice count this roll.
   * Returns { opt, score, hot } or null if nothing scores.
   */
  function aiEvalCache(match, me, values, bonus) {
    const cfg = match.cfg;
    const opts = cacheOptions(values, cfg);
    if (!opts.length) return null;
    const live = me.available;
    const cur = resolvePad(me.pad, cfg).total;
    function liveUsed(o) {
      return o.idx.filter(function (i) { return !bonus[i]; }).length;
    }
    function gain(o) {
      return resolvePad(me.pad.concat(o.hands), cfg).total - cur;
    }
    // Hot dice whenever possible: it resets to six dice.
    if (cfg.hotDice) {
      let hotBest = null;
      opts.forEach(function (o) {
        if (liveUsed(o) === live) {
          const g = gain(o);
          if (!hotBest || g > hotBest.score) hotBest = { opt: o, score: g, hot: true };
        }
      });
      if (hotBest) {
        hotBest.score += cfg.targetScore * 0.08; // six fresh dice are worth a lot
        return hotBest;
      }
    }
    // Otherwise prefer keeping at least 3 dice live, taking the best gain; if impossible take everything we can.
    const keep3 = opts.filter(function (o) {
      return live - liveUsed(o) >= 3;
    });
    const pool = keep3.length ? keep3 : opts;
    let best = null;
    pool.forEach(function (o) {
      // value gain, minus a small cost for each live die spent (dice are future rolls)
      const used = liveUsed(o);
      const s = gain(o) - (keep3.length ? used * cfg.targetScore * 0.004 : -used);
      if (!best || s > best.score) best = { opt: o, score: s, hot: false };
    });
    return best;
  }

  function aiChooseCache(match, me, values) {
    const bonus = me.bonus && me.bonus.length === values.length ? me.bonus : values.map(function () { return false; });
    const r = aiEvalCache(match, me, values, bonus);
    return r ? r.opt : null;
  }

  /**
   * Candidate deterministic item uses on the current roll: nudges on each die and copying each opponent die.
   * Each candidate is { id, arg, dice, bonus }.
   */
  function aiItemCandidates(match, me) {
    const out = [];
    const opp = match.other(me);
    [['nudgeUp', 1], ['nudgeDown', -1]].forEach(function (pair) {
      if (!(me.inventory[pair[0]] > 0)) return;
      me.dice.forEach(function (v, i) {
        const d = me.dice.slice();
        d[i] = wrapDie(v + pair[1]);
        out.push({ id: pair[0], arg: i, dice: d, bonus: me.bonus.slice() });
      });
    });
    if (me.inventory.copyDie > 0 && opp.rolled && opp.rolled.length) {
      const seen = {};
      opp.rolled.forEach(function (v, j) {
        if (seen[v]) return;
        seen[v] = true;
        out.push({ id: 'copyDie', arg: j, dice: me.dice.concat([v]), bonus: me.bonus.concat([true]) });
      });
    }
    return out;
  }

  function aiApply(match, me, c) {
    if (c.id === 'nudgeUp') return match.useNudge(me, c.arg, 1);
    if (c.id === 'nudgeDown') return match.useNudge(me, c.arg, -1);
    if (c.id === 'copyDie') return match.useCopyDie(me, c.arg);
    if (c.id === 'reroll') return match.useReroll(me, c.arg);
    return null;
  }

  /** Try to turn a farkle into a scoring roll. Prefers sure things (nudge, copy) over a reroll gamble. */
  function aiRescue(match, me) {
    let best = null;
    aiItemCandidates(match, me).forEach(function (c) {
      const r = aiEvalCache(match, me, c.dice, c.bonus);
      if (r && (!best || r.score > best.score)) best = { c: c, score: r.score };
    });
    if (best) {
      aiApply(match, me, best.c);
      return true;
    }
    // Gamble with rerolls while we have them.
    while (me.inventory.reroll > 0 && match.isFarkle(me)) {
      match.useReroll(me, Math.floor(match.rng() * me.dice.length));
    }
    return !match.isFarkle(me);
  }

  /** Spend at most one item to improve a good roll, but only when it is clearly worth it. */
  function aiImprove(match, me) {
    const base = aiEvalCache(match, me, me.dice, me.bonus);
    if (!base) return;
    // Nudges are saved for farkle rescues unless the AI holds a spare of that kind.
    let best = null;
    aiItemCandidates(match, me).forEach(function (c) {
      if (c.id !== 'copyDie' && me.inventory[c.id] < 2) return;
      const r = aiEvalCache(match, me, c.dice, c.bonus);
      if (!r) return;
      const lift = r.score - base.score;
      const worth = (r.hot && !base.hot) || lift >= Math.max(match.cfg.targetScore * 0.03, Math.abs(base.score) * 0.6);
      if (worth && (!best || lift > best.lift)) best = { c: c, lift: lift };
    });
    if (best) aiApply(match, me, best.c);
  }

  /** Copy the best hand from the opponent's pad when it is big, or when trailing. */
  function aiMaybeIntercept(match, me) {
    if (!match.canUse(me, 'intercept')) return;
    const opp = match.other(me);
    const src = match.padAtRoundStart[opp.id];
    let bestI = -1;
    let bestGain = 0;
    const cur = resolvePad(me.pad, match.cfg).total;
    src.forEach(function (h, i) {
      const g = resolvePad(me.pad.concat([h]), match.cfg).total - cur;
      if (g > bestGain) {
        bestGain = g;
        bestI = i;
      }
    });
    const trailing = me.banked < opp.banked;
    const big = src[bestI] && src[bestI].chips * src[bestI].mult >= (trailing ? 45 : 90);
    if (bestI >= 0 && big) match.useIntercept(me, bestI);
  }

  function executeAiPlan(match, me, plan) {
    const useItems = match.cfg.ai.usesItems;
    let turn;
    if (useItems) aiMaybeIntercept(match, me);
    if (plan.type === 'launch') {
      turn = match.launch(me);
    } else {
      if (!me.rolled) match.roll(me);
      if (match.isFarkle(me) && useItems) aiRescue(match, me);
      if (match.isFarkle(me)) {
        turn = match.farkle(me);
      } else {
        if (useItems) aiImprove(match, me);
        const r = aiEvalCache(match, me, me.dice, me.bonus);
        turn = match.cache(me, r.opt.idx);
      }
    }
    turn.reason = plan.reason;
    turn.items = me.items.slice();
    return turn;
  }

  // ---------------------------------------------------------------------------

  const api = {
    HAND_DEFS: HAND_DEFS,
    HAND_DICE_TEXT: HAND_DICE_TEXT,
    CONSUMABLE_DEFS: CONSUMABLE_DEFS,
    RESCUE_ITEMS: RESCUE_ITEMS,
    defaultConfig: defaultConfig,
    levelTarget: levelTarget,
    levelConfig: levelConfig,
    inventoryCount: inventoryCount,
    gaugeEstimate: gaugeEstimate,
    mergeConfig: mergeConfig,
    makeRng: makeRng,
    rollDice: rollDice,
    handValue: handValue,
    resolvePad: resolvePad,
    decompose: decompose,
    hasScoring: hasScoring,
    farkleChance: farkleChance,
    cacheOptions: cacheOptions,
    gaugeTier: gaugeTier,
    gaugeThresholds: gaugeThresholds,
    Match: Match,
    aiDecide: aiDecide,
    aiChooseCache: aiChooseCache,
    executeAiPlan: executeAiPlan,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OF = api;
})(this);
