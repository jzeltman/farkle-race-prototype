/* Orbital Farkle — browser UI. Depends on engine.js (window.OF). */
(function () {
  'use strict';

  const OF = window.OF;
  const $ = function (id) { return document.getElementById(id); };
  const fmt = function (n) { return Math.round(n).toLocaleString(); };

  // ---------------------------------------------------------------------------
  // Persistence (localStorage is best-effort: the game works without it)
  // ---------------------------------------------------------------------------

  const LS_CONFIG = 'orbitalFarkle.config.v1';
  const LS_LOGS = 'orbitalFarkle.logs.v1';
  const LS_TESTER = 'orbitalFarkle.tester.v1';

  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* ignore */ }
  }

  function loadConfig() {
    return OF.mergeConfig(OF.defaultConfig(), lsGet(LS_CONFIG, null));
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let cfg = loadConfig();
  let match = null;
  let phase = 'choose'; // choose | select | farkled | reveal | over
  let selected = [];
  let pendingPlayerTurn = null;
  let rolledFresh = false;
  let matchSaved = false;
  let targeting = null; // consumable id waiting for the player to pick a target
  let changedDie = -1; // die index to flash after an item changed it
  const roundLog = [];
  const ITEM = {};
  OF.CONSUMABLE_DEFS.forEach(function (c) { ITEM[c.id] = c; });

  let level = 1;
  let runId = '';

  /** Start a fresh run at level 1 with empty inventories. */
  function newRun() {
    runId = Date.now().toString(36);
    startLevel(1, null);
  }

  /** After a level ends: a win moves on to the next level (items carry over); a loss starts a new run. */
  function continueRun() {
    if (match.winner === 'player') {
      startLevel(level + 1, { player: Object.assign({}, match.player.inventory), ai: Object.assign({}, match.ai.inventory) });
    } else {
      newRun();
    }
  }

  function startLevel(lv, carry) {
    if (match && !matchSaved && match.round > 1) saveMatch(true);
    level = lv;
    cfg = OF.levelConfig(loadConfig(), lv);
    match = new OF.Match(cfg, { level: lv, carry: carry });
    matchSaved = false;
    roundLog.length = 0;
    selected = [];
    pendingPlayerTurn = null;
    targeting = null;
    match.beginRound();
    phase = 'choose';
    closeModal();
    render();
    if ($('overlay').hidden && lsGet('orbitalFarkle.seenRules', false)) showLevelIntro();
  }

  function showLevelIntro() {
    const grants = match.levelGrants.map(function (id) { return ITEM[id].icon + ' ' + ITEM[id].name; });
    const cap = cfg.consumables.capacity;
    openModal(
      '<div class="winbox"><h3>Level ' + level + '</h3>' +
      '<div class="big">Orbit at ' + fmt(cfg.targetScore) + '</div>' +
      '<p>' + (grants.length ? 'Both ships drew: <b>' + grants.join(', ') + '</b>.' : 'No new items this level.') + '<br>' +
      (match.levelLost.player.length ? '<span style="color:var(--bad)">Your inventory was full, so you lost: ' + match.levelLost.player.map(function (id) { return ITEM[id].name; }).join(', ') + '.</span><br>' : '') +
      '<span style="color:var(--muted)">Inventory: ' + OF.inventoryCount(match.player.inventory) + '/' + cap + ' slots (drawn items that don\u2019t fit are lost).</span></p></div>' +
      '<div class="foot"><button class="primary" id="l-go">Start level<kbd>Enter</kbd></button></div>',
      closeModal
    );
    bind('l-go', closeModal);
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------

  function onRoll() {
    if (phase !== 'choose' || match.player.available === 0) return;
    match.roll(match.player);
    // Both ships roll together, so each can see (and copy from) the other's dice.
    match.aiRollIfPlanned();
    selected = [];
    targeting = null;
    rolledFresh = true;
    phase = match.isFarkle(match.player) ? 'farkled' : 'select';
    render();
    rolledFresh = false;
  }

  function onLaunch() {
    if (phase !== 'choose' || !match.player.pad.length) return;
    targeting = null;
    commit(match.launch(match.player));
  }

  function onCache() {
    if (phase !== 'select' || !currentSelection()) return;
    const turn = match.cache(match.player, selected.slice().sort());
    if (turn) commit(turn);
  }

  function onFarkleContinue() {
    if (phase !== 'farkled') return;
    targeting = null;
    commit(match.farkle(match.player));
  }

  function toggleDie(i) {
    if (i >= match.player.dice.length) return;
    if (targeting && ITEM[targeting].target === 'ownDie') return applyItem(i);
    if (phase !== 'select') return;
    const at = selected.indexOf(i);
    if (at >= 0) selected.splice(at, 1);
    else selected.push(i);
    render();
  }

  // --- consumables ---

  function itemPhaseOk(id) {
    if (ITEM[id].target === 'oppHand') return phase === 'choose' || phase === 'select' || phase === 'farkled';
    return phase === 'select' || phase === 'farkled';
  }

  function itemUsable(id) {
    return itemPhaseOk(id) && match.canUse(match.player, id);
  }

  function hasRescue() {
    return OF.RESCUE_ITEMS.some(function (id) { return match.canUse(match.player, id); });
  }

  function onItem(id) {
    if (!itemUsable(id)) return;
    targeting = targeting === id ? null : id;
    render();
  }

  function applyItem(arg) {
    const p = match.player;
    const id = targeting;
    targeting = null;
    let rec = null;
    if (id === 'nudgeUp') rec = match.useNudge(p, arg, 1);
    else if (id === 'nudgeDown') rec = match.useNudge(p, arg, -1);
    else if (id === 'reroll') rec = match.useReroll(p, arg);
    else if (id === 'copyDie') rec = match.useCopyDie(p, arg);
    else if (id === 'intercept') rec = match.useIntercept(p, arg);
    if (rec) {
      changedDie = id === 'copyDie' ? p.dice.length - 1 : id === 'intercept' ? -1 : arg;
      selected = [];
      if (phase === 'select' || phase === 'farkled') phase = match.isFarkle(p) ? 'farkled' : 'select';
    }
    render();
    changedDie = -1;
  }

  function currentSelection() {
    if (!selected.length) return null;
    return OF.decompose(selected.map(function (i) { return match.player.dice[i]; }), cfg);
  }

  function commit(turn) {
    pendingPlayerTurn = turn;
    const res = match.resolveRound(turn);
    roundLog.push(res);
    phase = 'reveal';
    render();
    showReveal(res);
  }

  function afterReveal() {
    closeModal();
    if (match.over) {
      phase = 'over';
      if (!matchSaved) saveMatch(false);
      render();
      showGameOver();
      return;
    }
    match.beginRound();
    phase = 'choose';
    render();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function render() {
    $('level').textContent = level;
    $('round').textContent = match.round;
    $('target').textContent = fmt(cfg.targetScore);
    $('overtime').hidden = !match.overtime;
    renderSide($('side-player'), match.player, true);
    renderSide($('side-ai'), match.ai, false);
    renderCenter();
    renderValues();
    renderLog();
  }

  function gaugeHtml(side) {
    const g = match.gauge(side);
    let segs = '';
    for (let i = 0; i < g.of; i++) segs += '<div class="seg' + (i < g.tier ? ' on' : '') + '"></div>';
    return (
      '<div class="gauge"><div class="label"><span>Pending thrust</span><b>' + g.name + '</b></div>' +
      '<div class="segs">' + segs + '</div></div>'
    );
  }

  function renderSide(el, side, isPlayer) {
    const pct = Math.min(1, side.banked / cfg.targetScore);
    const need = Math.max(0, cfg.targetScore - side.banked);
    let html =
      '<div class="name"><span>' + (isPlayer ? 'You' : 'Opponent (AI)') + '</span>' +
      '<span class="muted" style="font-size:12px;color:var(--muted)">' + side.available + ' dice live</span></div>' +
      '<div class="banked">' + fmt(side.banked) + ' <small>banked · ' + fmt(need) + ' to orbit</small></div>' +
      '<div class="track"><div class="stars"></div><div class="orbit">ORBIT ' + fmt(cfg.targetScore) + '</div>' +
      '<div class="fill" style="height:' + (pct * 85) + '%"></div>' +
      '<div class="rocket" style="bottom:' + (8 + pct * 80) + '%">🚀</div></div>' +
      gaugeHtml(side);

    // Pad hands are listed by name for both ships (never the total). The opponent's are
    // what Intercept copies from, so they become clickable while targeting.
    const pickHand = !isPlayer && targeting === 'intercept';
    // The AI doesn't act until the round resolves, so during your turn its pad is the round-start pad Intercept copies from.
    const pad = side.pad;
    html += '<div><h2 style="margin:4px 0 6px">' + (isPlayer ? 'Launch pad' : 'Their pad') + ' · ' + pad.length + ' hand' + (pad.length === 1 ? '' : 's') + '</h2>';
    if (!pad.length) {
      html += '<ul class="padlist"><li class="empty">' + (isPlayer ? 'Empty. Roll and cache hands to build thrust.' : 'Empty.') + '</li></ul>';
    } else {
      html += '<ul class="padlist">' + pad.map(function (h, i) {
        return '<li' + (pickHand ? ' class="pick" data-h="' + i + '"' : '') + '><span>' + h.label + (h.copied ? ' <span class="copied">copied</span>' : '') + '</span><span class="dice">' + h.dice.join(' ') + '</span></li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    if (!isPlayer) {
      html += '<div><h2 style="margin:4px 0 6px">Last turn</h2><div class="lastturn">' + describeTurn(side.lastTurn, false) + '</div></div>';
    }
    html += '<div><h2 style="margin:4px 0 6px">' + (isPlayer ? 'Your items' : 'Their items') + ' · ' + OF.inventoryCount(side.inventory) + '/' + cfg.consumables.capacity + '</h2>' + inventoryHtml(side, isPlayer) + '</div>';
    el.innerHTML = html;
    el.querySelectorAll('li.pick').forEach(function (li) {
      li.addEventListener('click', function () { applyItem(+li.dataset.h); });
    });
    el.querySelectorAll('button.item').forEach(function (b) {
      b.addEventListener('click', function () { onItem(b.dataset.id); });
    });
  }

  /** One chip per inventory slot: owned items, then empty slots up to capacity. */
  function inventoryHtml(side, isPlayer) {
    let html = '';
    OF.CONSUMABLE_DEFS.forEach(function (c) {
      for (let k = 0; k < (side.inventory[c.id] || 0); k++) {
        if (!isPlayer) {
          html += '<span class="item static" title="' + c.desc + '"><span class="ico">' + c.icon + '</span>' + c.name + '</span>';
        } else {
          html += '<button class="item' + (targeting === c.id ? ' active' : '') + '" data-id="' + c.id + '"' + (itemUsable(c.id) ? '' : ' disabled') +
            ' title="' + c.desc + '"><span class="ico">' + c.icon + '</span>' + c.name + '</button>';
        }
      }
    });
    for (let k = OF.inventoryCount(side.inventory); k < cfg.consumables.capacity; k++) html += '<span class="item slot">empty</span>';
    return '<div class="items">' + html + '</div>';
  }

  function itemsText(items) {
    if (!items || !items.length) return '';
    return items.map(function (i) { return i.icon + ' ' + i.name + ' (' + i.text + ')'; }).join(', ');
  }

  function describeTurn(t, short) {
    if (!t) return '<span class="muted" style="color:var(--muted)">No turns yet.</span>';
    let s = '';
    if (t.type === 'cache') {
      s = '<span class="t-cache">Rolled ' + t.roll.join(' ') + ', cached</span> ' + t.hands.map(function (h) { return h.label; }).join(' + ');
      if (t.hot) s += ' · <b>Hot dice!</b>';
    } else if (t.type === 'farkle') {
      s = '<span class="t-farkle">Farkle!</span> Rolled ' + t.roll.join(' ') + (t.handsLost.length ? ' and lost a pad of ' + t.handsLost.length + ' hand' + (t.handsLost.length === 1 ? '' : 's') : '');
    } else if (t.type === 'launch') {
      s = '<span class="t-launch">Launched</span> for ' + fmt(t.resolution.total);
    }
    if (t.items && t.items.length) s += ' · <span class="t-item">used ' + itemsText(t.items) + '</span>';
    if (!short && t.reason) s += '<span class="why">“' + t.reason + '”</span>';
    return s;
  }

  function cmHtml(chips, mult) {
    return '<span class="cm"><span class="c">' + fmt(chips) + '</span> × <span class="m">' + mult + '</span></span>';
  }

  function pctText(ch) {
    return (ch * 100).toFixed(ch < 0.1 && ch > 0 ? 1 : 0) + '%';
  }

  function renderCenter() {
    const p = match.player;
    const tray = $('tray');
    const status = $('status');
    const sel = $('selinfo');
    const actions = $('actions');
    const risk = $('risk');

    // Status line
    if (targeting) {
      const t = ITEM[targeting];
      const what = t.target === 'ownDie' ? 'Click one of your dice' : t.target === 'oppDie' ? "Click one of the opponent's dice to copy" : "Click a hand on the opponent's pad to copy";
      status.innerHTML = '<b>' + t.icon + ' ' + t.name + ':</b> ' + what + '. <span class="lock">Esc to cancel.</span>';
    } else if (phase === 'choose') {
      status.innerHTML = '<b>Your move.</b> Roll ' + p.available + ' dice to build thrust, or launch your pad. <span class="lock">Opponent has locked in their move.</span>';
    } else if (phase === 'select') {
      status.innerHTML = '<b>Select one or more scoring hands</b> to cache on your pad, then confirm. Items can change your dice first.';
    } else if (phase === 'farkled') {
      status.innerHTML = hasRescue()
        ? '<b style="color:var(--bad)">You farkled</b>, but you can try a consumable to make a scoring hand. Or accept the farkle.'
        : '<b>No scoring hand.</b> Your pad is destroyed.';
    } else if (phase === 'reveal') {
      status.innerHTML = 'Revealing round…';
    } else {
      status.innerHTML = '<b>Match over.</b>';
    }

    // Dice tray
    const pickOwn = targeting && ITEM[targeting].target === 'ownDie';
    let dice = '';
    if (phase === 'select' || phase === 'farkled') {
      p.dice.forEach(function (v, i) {
        const cls = 'die' + (phase === 'select' || pickOwn ? ' clickable' : ' dead') + (selected.indexOf(i) >= 0 ? ' sel' : '') +
          (rolledFresh && !p.bonus[i] ? ' rolling' : '') + (p.bonus[i] ? ' bonus' : '') + (pickOwn ? ' target' : '') + (i === changedDie ? ' changed' : '');
        dice += '<button class="' + cls + '" data-i="' + i + '" style="animation-delay:' + (i * 40) + 'ms" aria-label="Die ' + (i + 1) + ': ' + v + '">' + v + '</button>';
      });
    } else {
      for (let i = 0; i < p.available; i++) dice += '<div class="die blank">?</div>';
      if (!p.available) dice = '<div class="hint" style="color:var(--muted);align-self:center">No dice left. Launch!</div>';
    }
    if (phase === 'farkled') dice += '<div class="farkle-banner" style="flex-basis:100%">FARKLE</div>';
    tray.innerHTML = dice;
    tray.querySelectorAll('.die[data-i]').forEach(function (b) {
      b.addEventListener('click', function () { toggleDie(+b.dataset.i); });
    });

    renderOppTray();

    // Selection info
    if (phase === 'select') {
      if (!selected.length) {
        sel.innerHTML = '<span class="hint">Click dice (or press 1–' + p.dice.length + ') to select a hand.' + (p.bonus.some(Boolean) ? ' Copied dice (blue) are free: they don’t use up your live dice.' : '') + '</span>';
      } else {
        const hands = currentSelection();
        if (!hands) {
          sel.innerHTML = '<span class="invalid">Not a valid hand: every selected die must be part of a scoring hand.</span>';
        } else {
          const left = p.available - match.liveCount(p, selected);
          sel.innerHTML = hands.map(function (h) {
            return '<span class="hand">' + h.label + ' · ' + cmHtml(h.chips, h.mult) + '</span>';
          }).join('') +
            '<div class="hint">' + (left === 0 && cfg.hotDice ? '<b style="color:var(--accent)">Hot dice!</b> All six dice come back.' : left + ' dice left for the next roll') + '</div>';
        }
      }
    } else if (phase === 'farkled') {
      sel.innerHTML = '<span class="invalid">Accepting the farkle destroys your pad of ' + p.pad.length + ' hand' + (p.pad.length === 1 ? '' : 's') + '.</span>';
    } else {
      sel.innerHTML = '';
    }

    // Buttons
    let a = '';
    if (phase === 'choose') {
      a += '<button class="primary" id="a-roll"' + (p.available ? '' : ' disabled') + '>Roll ' + p.available + ' dice<kbd>R</kbd></button>';
      a += '<button class="danger" id="a-launch"' + (p.pad.length ? '' : ' disabled') + '>Launch pad<kbd>L</kbd></button>';
    } else if (phase === 'select') {
      a += '<button class="primary" id="a-cache"' + (currentSelection() ? '' : ' disabled') + '>Cache & end turn<kbd>Enter</kbd></button>';
    } else if (phase === 'farkled') {
      a += '<button class="danger" id="a-fcont">' + (hasRescue() ? 'Accept farkle (lose pad)' : 'End turn') + '<kbd>Enter</kbd></button>';
    } else if (phase === 'over') {
      a += '<button class="primary" id="a-again">Play again</button>';
    }
    actions.innerHTML = a;
    bind('a-roll', onRoll);
    bind('a-launch', onLaunch);
    bind('a-cache', onCache);
    bind('a-fcont', onFarkleContinue);
    bind('a-again', continueRun);

    // Farkle risk readout
    if (cfg.showFarkleRisk && phase === 'choose' && p.available) {
      risk.innerHTML = 'Farkle chance on a ' + p.available + '-die roll: <b>' + pctText(OF.farkleChance(p.available)) + '</b>';
    } else if (cfg.showFarkleRisk && phase === 'select' && selected.length && currentSelection()) {
      let left = p.available - match.liveCount(p, selected);
      if (left === 0 && cfg.hotDice) left = 6;
      risk.innerHTML = left ? 'Next roll would be ' + left + ' dice: <b>' + pctText(OF.farkleChance(left)) + '</b> farkle chance' : 'No dice left after this: you will have to launch.';
    } else risk.innerHTML = '';
  }

  /** The opponent's roll for this round, shown once both ships have rolled. */
  function renderOppTray() {
    const el = $('opptray');
    const ai = match.ai;
    const pick = targeting === 'copyDie';
    let body = '';
    if (phase === 'choose') {
      body = '<span class="hint">Their move is locked in. Their dice appear when you roll.</span>';
    } else if (phase === 'select' || phase === 'farkled') {
      if (ai.rolled) {
        body = ai.rolled.map(function (v, j) {
          return '<button class="die mini' + (pick ? ' clickable target' : '') + (rolledFresh ? ' rolling' : '') + '" data-j="' + j + '"' + (pick ? '' : ' tabindex="-1"') + '>' + v + '</button>';
        }).join('');
        if (!OF.hasScoring(ai.rolled)) body += '<span class="hint" style="align-self:center">No scoring dice… unless they use an item.</span>';
      } else {
        body = '<span class="hint">They chose to <b>launch</b> this round, so they have no roll.</span>';
      }
    } else {
      body = '<span class="hint">—</span>';
    }
    el.innerHTML = '<div class="opplabel">Opponent’s roll</div><div class="oppdice">' + body + '</div>';
    if (pick) {
      el.querySelectorAll('.die[data-j]').forEach(function (b) {
        b.addEventListener('click', function () { applyItem(+b.dataset.j); });
      });
    }
  }

  function bind(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  function renderValues() {
    $('mode-tag').textContent = cfg.scoringMode === 'pooled' ? 'pooled scoring' : 'per-hand scoring';
    let rows = '<tr><th>Hand</th><th>Dice</th><th class="num">Base</th><th class="num">With power-ups</th></tr>';
    OF.HAND_DEFS.forEach(function (h) {
      const base = cfg.hands[h.id];
      const v = OF.handValue(h.id, cfg);
      rows += '<tr><td>' + h.name + '</td><td style="color:var(--muted)">' + OF.HAND_DICE_TEXT[h.id] + '</td>' +
        '<td class="num">' + cmHtml(base.chips, base.mult) + '</td>' +
        '<td class="num">' + cmHtml(v.chips, v.mult) + (v.boosts.length ? '<br><span class="boost">' + v.boosts.join(', ') + '</span>' : '') + '</td></tr>';
    });
    $('values').innerHTML = rows;
    $('formula').innerHTML = cfg.scoringMode === 'pooled'
      ? 'At launch the pad resolves as <b>(total chips) × (total mult)</b> across every cached hand. Longer burns grow faster than linearly.'
      : 'At launch each cached hand resolves as its own <b>chips × mult</b>, and the results are added.';

    const p = cfg.powerups;
    $('powerups').innerHTML =
      '<div class="pu' + (p.single.enabled ? '' : ' off') + '"><span>⚡ Single booster</span><span>Singles: +' + p.single.chips + ' chips</span></div>' +
      '<div class="pu' + (p.run.enabled ? '' : ' off') + '"><span>🌀 Run booster</span><span>Small/medium straights: +' + p.run.mult + ' mult</span></div>' +
      '<div class="pu' + (p.set.enabled ? '' : ' off') + '"><span>💎 Set booster</span><span>Of-a-kinds, two pair, full house, three pairs, two triplets: ×' + p.set.xmult + ' mult</span></div>';

    const th = OF.gaugeThresholds(cfg);
    const names = [];
    for (let t = 1; t <= cfg.gaugeTiers; t++) {
      const lo = t === 1 ? 0 : th[t - 2];
      const hi = t - 1 < th.length ? th[t - 1] : null;
      const nm = OF.gaugeTier(t === 1 ? 0 : lo, 1, cfg).name;
      names.push('<b style="color:var(--text)">' + nm + '</b> ' + (hi === null ? fmt(lo) + '+' : fmt(lo) + '–' + fmt(hi)));
    }
    $('tiers').innerHTML = names.join(' · ') + '<br>The gauge shows a tier, never the exact launch total.';
  }

  function renderLog() {
    $('log').innerHTML = roundLog.map(function (r) {
      return '<div><span class="r">R' + r.round + '</span> You: ' + describeTurn(r.player, true) + ' &nbsp;|&nbsp; AI: ' + describeTurn(r.ai, true) + '</div>';
    }).join('') || '<div style="color:var(--muted)">Nothing yet.</div>';
  }

  // ---------------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------------

  let modalOnEnter = null;
  let revealTimers = [];

  function openModal(html, onEnter) {
    $('modal').innerHTML = html;
    $('overlay').hidden = false;
    modalOnEnter = onEnter || null;
  }
  function closeModal() {
    revealTimers.forEach(clearTimeout);
    revealTimers = [];
    $('overlay').hidden = true;
    $('modal').innerHTML = '';
    modalOnEnter = null;
  }

  function turnCard(who, t, idPrefix) {
    let cls = 'card';
    let body = '';
    if (t.type === 'cache') {
      body = '<div class="big" style="color:var(--accent)">Cached</div>' +
        '<div>' + t.hands.map(function (h) { return h.label + ' ' + cmHtml(h.chips, h.mult); }).join('<br>') + '</div>' +
        '<div class="muted">Rolled ' + t.roll.join(' ') + afterItems(t) + (t.hot ? ' · <b style="color:var(--accent)">Hot dice! Six dice return.</b>' : ' · ' + t.diceLeft + ' dice left') + '</div>' +
        (t.earned ? '<div class="muted">Earned an item: <b style="color:var(--text)">' + ITEM[t.earned].icon + ' ' + ITEM[t.earned].name + '</b></div>' : '');
    } else if (t.type === 'farkle') {
      cls += ' farkle';
      body = '<div class="big" style="color:var(--bad)">Farkle!</div><div class="muted">Rolled ' + t.roll.join(' ') + afterItems(t) + ' with no scoring hand.</div>';
      if (t.handsLost.length) {
        body += '<div>Pad destroyed: ' + t.handsLost.length + ' hand' + (t.handsLost.length === 1 ? '' : 's') + '.</div>' +
          '<div class="muted">It would have launched for <b style="color:var(--text)">' + fmt(t.lost.total) + '</b>.</div>';
      }
    } else if (t.type === 'launch') {
      cls += ' launch';
      const r = t.resolution;
      body = '<div class="big" style="color:var(--good)">Launch!</div><ul class="steps" id="' + idPrefix + '-steps">' +
        r.steps.map(function (s) {
          return '<li><span>' + s.label + '</span><span>' +
            (r.mode === 'pooled' ? '+<span class="cm"><span class="c">' + s.chips + '</span></span> / +<span class="cm"><span class="m">' + s.mult + '</span></span>'
              : cmHtml(s.chips, s.mult) + ' = ' + fmt(s.own)) + '</span></li>';
        }).join('') + '</ul>' +
        '<div class="resolve">' +
        (r.mode === 'pooled' ? '<span id="' + idPrefix + '-cm">' + cmHtml(0, 0) + '</span>' : '<span id="' + idPrefix + '-cm">' + fmt(0) + '</span>') +
        '<span class="total" id="' + idPrefix + '-total">= ' + fmt(r.total) + '</span></div>' +
        '<div class="muted" style="text-align:center">Banked ' + fmt(t.before) + ' → <b style="color:var(--text)">' + fmt(t.after) + '</b></div>';
    }
    const used = t.items && t.items.length ? '<div class="used">Used ' + itemsText(t.items) + '</div>' : '';
    const why = t.reason ? '<div class="why">“' + t.reason + '”</div>' : '';
    return '<div class="' + cls + '"><h4><span>' + who + '</span></h4>' + body + used + why + '</div>';
  }

  function afterItems(t) {
    if (!t.finalDice || t.finalDice.join() === t.roll.join()) return '';
    return ' → <b style="color:var(--text)">' + t.finalDice.join(' ') + '</b> after items';
  }

  function animateLaunch(idPrefix, t, delay) {
    if (t.type !== 'launch') return delay;
    const r = t.resolution;
    const items = document.querySelectorAll('#' + idPrefix + '-steps li');
    const cm = $(idPrefix + '-cm');
    r.steps.forEach(function (s, i) {
      delay += 380;
      revealTimers.push(setTimeout(function () {
        if (items[i]) items[i].classList.add('show');
        if (cm) cm.innerHTML = r.mode === 'pooled' ? cmHtml(s.runChips, s.runMult) : fmt(s.runOwn);
      }, delay));
    });
    delay += 450;
    revealTimers.push(setTimeout(function () {
      const tot = $(idPrefix + '-total');
      if (tot) tot.classList.add('show');
    }, delay));
    return delay;
  }

  function showReveal(res) {
    let title = 'Round ' + res.round + ' results';
    let note = '';
    if (res.result === 'tie') {
      note = '<div class="card" style="margin-top:12px;border-color:var(--accent)"><b>Both ships reached orbit in the same round!</b> It is a tie, so another round is played. After it, the higher banked score wins.</div>';
    }
    openModal(
      '<h3>' + title + '</h3><div class="row">' + turnCard('You', res.player, 'rp') + turnCard('Opponent', res.ai, 'ra') + '</div>' + note +
      '<div class="foot"><button class="primary" id="m-next">' + (match.over ? 'See result' : 'Next round') + '<kbd>Enter</kbd></button></div>',
      afterReveal
    );
    bind('m-next', afterReveal);
    let d = animateLaunch('rp', res.player, 100);
    animateLaunch('ra', res.ai, res.player.type === 'launch' ? d : 100);
  }

  function showGameOver() {
    const w = match.winner;
    const nextTarget = OF.levelTarget(loadConfig(), level + 1);
    const title = w === 'player' ? 'Level ' + level + ' cleared! 🎉' : 'The opponent reached orbit first.';
    const sub = w === 'player'
      ? 'Next: level ' + (level + 1) + ', orbit at <b>' + fmt(nextTarget) + '</b>. Your leftover items carry over.'
      : 'Run over at level ' + level + '. A new run starts at level 1.';
    const btn = w === 'player' ? 'Save & next level' : 'Save & new run';
    const q = function (name, text) {
      let s = '<label>' + text + '<div class="scale">';
      for (let i = 1; i <= 5; i++) s += '<label><input type="radio" name="' + name + '" value="' + i + '">' + i + '</label>';
      return s + '</div><span style="color:var(--muted);font-size:12px">1 = not at all · 5 = completely</span></label>';
    };
    openModal(
      '<div class="winbox"><h3>' + title + '</h3>' +
      '<div class="big">' + fmt(match.player.banked) + ' – ' + fmt(match.ai.banked) + '</div>' +
      '<div style="color:var(--muted)">' + match.round + ' rounds</div><p>' + sub + '</p></div>' +
      '<form class="survey" id="survey"><b>Quick questions (optional, saved to the playtest log)</b>' +
      q('q_bet', 'Launching felt like a bet, not a routine.') +
      q('q_opp', 'The opponent\'s score changed when I launched.') +
      q('q_fair', 'Losses felt explained by my own choices.') +
      '<label>After a farkle, what should you have done? (or anything else)<textarea name="q_note"></textarea></label></form>' +
      '<div class="foot"><button id="m-log">Playtest log</button><button class="primary" id="m-again">' + btn + '<kbd>Enter</kbd></button></div>',
      function () { saveSurvey(); continueRun(); }
    );
    bind('m-again', function () { saveSurvey(); continueRun(); });
    bind('m-log', function () { saveSurvey(); showStats(); });
  }

  // ---------------------------------------------------------------------------
  // Playtest logging
  // ---------------------------------------------------------------------------

  function tester() {
    return lsGet(LS_TESTER, '') || '';
  }

  function saveMatch(abandoned) {
    const logs = lsGet(LS_LOGS, []);
    const burns = match.log.burns.map(function (b) {
      return {
        side: b.side, startRound: b.startRound, endRound: b.endRound, caches: b.caches, rolls: b.rolls, hotDice: b.hotDice, items: b.items || 0,
        outcome: b.outcome, total: b.total, diffAtStart: b.diffAtStart, diffAtEnd: b.diffAtEnd, trailing: b.trailing,
      };
    });
    let comeback = false;
    if (!abandoned && match.winner) {
      const wins = burns.filter(function (b) { return b.side === match.winner && b.outcome === 'launch'; });
      const last = wins[wins.length - 1];
      comeback = !!(last && last.trailing && last.caches >= 3);
    }
    logs.push({
      id: Date.now().toString(36),
      tester: tester(),
      startedAt: new Date(match.log.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      abandoned: !!abandoned,
      runId: runId,
      level: level,
      winner: abandoned ? null : match.winner,
      rounds: match.round,
      playerBanked: match.player.banked,
      aiBanked: match.ai.banked,
      comeback: comeback,
      config: { targetScore: cfg.targetScore, levelMultiplier: cfg.levels.multiplier, scoringMode: cfg.scoringMode, gaugeTiers: cfg.gaugeTiers, hotDice: cfg.hotDice, showFarkleRisk: cfg.showFarkleRisk, consumables: cfg.consumables, aiUsesItems: cfg.ai.usesItems },
      burns: burns,
      items: match.log.items,
      roundLog: match.log.rounds,
      survey: null,
    });
    lsSet(LS_LOGS, logs);
    matchSaved = true;
  }

  function saveSurvey() {
    const form = $('survey');
    if (!form) return;
    const data = {};
    let any = false;
    ['q_bet', 'q_opp', 'q_fair'].forEach(function (k) {
      const el = form.querySelector('input[name=' + k + ']:checked');
      data[k] = el ? +el.value : null;
      if (el) any = true;
    });
    data.q_note = form.querySelector('textarea').value.trim();
    if (data.q_note) any = true;
    if (!any) return;
    const logs = lsGet(LS_LOGS, []);
    if (logs.length) {
      logs[logs.length - 1].survey = data;
      lsSet(LS_LOGS, logs);
    }
  }

  function computeStats(logs) {
    const done = logs.filter(function (m) { return !m.abandoned; });
    const pb = [];
    logs.forEach(function (m) {
      m.burns.forEach(function (b) { if (b.side === 'player' && b.outcome !== 'matchEnd') pb.push(b); });
    });
    const launched = pb.filter(function (b) { return b.outcome === 'launch'; });
    const avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    const trailing = pb.filter(function (b) { return b.trailing; }).map(function (b) { return b.caches; });
    const leading = pb.filter(function (b) { return !b.trailing; }).map(function (b) { return b.caches; });
    return {
      matches: done.length,
      wins: done.filter(function (m) { return m.winner === 'player'; }).length,
      burns: pb.length,
      long: launched.length ? launched.filter(function (b) { return b.caches >= 3; }).length / launched.length : null,
      farkleRate: pb.length ? pb.filter(function (b) { return b.outcome === 'farkle'; }).length / pb.length : null,
      avgLaunch: avg(launched.map(function (b) { return b.total; })),
      trailingCaches: avg(trailing),
      leadingCaches: avg(leading),
      trailingN: trailing.length,
      leadingN: leading.length,
      comebacks: done.length ? done.filter(function (m) { return m.comeback; }).length / done.length : null,
      avgRounds: avg(done.map(function (m) { return m.rounds; })),
      bestLevel: done.reduce(function (b, m) { return m.winner === 'player' ? Math.max(b, m.level || 1) : b; }, 0),
      itemsPerMatch: avg(done.map(function (m) { return (m.items || []).filter(function (i) { return i.side === 'player'; }).length; })),
    };
  }

  function showStats() {
    const logs = lsGet(LS_LOGS, []);
    const s = computeStats(logs);
    const pct = function (x) { return x === null ? '–' : Math.round(x * 100) + '%'; };
    const num = function (x, d) { return x === null ? '–' : x.toFixed(d || 0); };
    const pass = function (ok, text) { return ok === null ? '' : '<div class="' + (ok ? 'pass' : 'fail') + '">' + (ok ? '✓ ' : '✗ ') + text + '</div>'; };
    const stat = function (v, k, extra) { return '<div class="stat"><div class="v">' + v + '</div><div class="k">' + k + '</div>' + (extra || '') + '</div>'; };
    openModal(
      '<h3>Playtest log</h3>' +
      '<div class="form" style="margin-bottom:12px"><label>Tester name (saved with each match)<input type="text" id="tester" value="' + escapeHtml(tester()) + '" style="background:var(--bg2);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px;font:inherit"></label></div>' +
      '<div class="stats">' +
      stat(s.matches + ' <small style="font-size:13px;color:var(--muted)">(' + s.wins + ' won)</small>', 'Completed matches on this browser') +
      stat(pct(s.long), 'Your launched burns with 3+ cache turns', pass(s.long === null ? null : s.long >= 0.4, 'target ≥ 40%')) +
      stat(num(s.trailingCaches, 2) + ' vs ' + num(s.leadingCaches, 2), 'Avg cache turns per burn: trailing vs leading (n=' + s.trailingN + ' / ' + s.leadingN + ')',
        pass(s.trailingCaches === null || s.leadingCaches === null ? null : s.trailingCaches > s.leadingCaches, 'trailing should go longer')) +
      stat(pct(s.comebacks), 'Matches won by a trailing ship after a 3+ cache burn', pass(s.comebacks === null ? null : s.comebacks >= 0.25, 'target ≥ 1 in 4')) +
      stat(pct(s.farkleRate), 'Your farkle rate (per burn)') +
      stat(num(s.avgLaunch), 'Your average launch size') +
      stat(num(s.avgRounds, 1), 'Average rounds per match') +
      stat(s.burns, 'Your burns logged') +
      stat(num(s.itemsPerMatch, 1), 'Items you used per match') +
      stat(s.bestLevel || '–', 'Highest level cleared') +
      '</div>' +
      '<p style="color:var(--muted);font-size:13px">Logs live in this browser only (localStorage). Export them to collect results from each tester.</p>' +
      '<div class="foot"><button id="s-clear">Clear log</button><button id="s-csv">Export burns CSV</button><button id="s-json">Export JSON</button><button class="primary" id="s-close">Close<kbd>Esc</kbd></button></div>',
      null
    );
    $('tester').addEventListener('change', function (e) { lsSet(LS_TESTER, e.target.value.trim()); });
    bind('s-close', function () { closeModal(); if (phase === 'over') showGameOver(); });
    bind('s-json', function () { download('orbital-farkle-log.json', JSON.stringify(lsGet(LS_LOGS, []), null, 2), 'application/json'); });
    bind('s-csv', function () { download('orbital-farkle-burns.csv', burnsCsv(lsGet(LS_LOGS, [])), 'text/csv'); });
    bind('s-clear', function () {
      if (confirm('Delete every logged match on this browser?')) { lsSet(LS_LOGS, []); showStats(); }
    });
  }

  function burnsCsv(logs) {
    const cols = ['matchId', 'runId', 'level', 'tester', 'winner', 'side', 'startRound', 'endRound', 'caches', 'rolls', 'hotDice', 'items', 'outcome', 'total', 'diffAtStart', 'diffAtEnd', 'trailing', 'targetScore', 'scoringMode'];
    const rows = [cols.join(',')];
    logs.forEach(function (m) {
      m.burns.forEach(function (b) {
        const r = Object.assign({ matchId: m.id, runId: m.runId, level: m.level, tester: m.tester, winner: m.winner, targetScore: m.config.targetScore, scoringMode: m.config.scoringMode }, b);
        rows.push(cols.map(function (c) { const v = r[c]; return v === null || v === undefined ? '' : JSON.stringify(v); }).join(','));
      });
    });
    return rows.join('\n');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // ---------------------------------------------------------------------------
  // Tuning panel
  // ---------------------------------------------------------------------------

  function showTuning() {
    const c = loadConfig();
    let handRows = '<tr><th>Hand</th><th>Chips</th><th>Mult</th></tr>';
    OF.HAND_DEFS.forEach(function (h) {
      handRows += '<tr><td>' + h.name + '</td><td><input type="number" min="0" step="1" data-hand="' + h.id + '" data-k="chips" value="' + c.hands[h.id].chips + '"></td>' +
        '<td><input type="number" min="0" step="0.5" data-hand="' + h.id + '" data-k="mult" value="' + c.hands[h.id].mult + '"></td></tr>';
    });
    openModal(
      '<h3>Tuning dials</h3><p style="color:var(--muted);font-size:13px;margin-top:0">Changes apply when you save, and start a new run at level 1. Saved in this browser.</p>' +
      '<form class="form" id="tune">' +
      '<label>Level 1 target score (orbital velocity)<input type="number" name="targetScore" min="100" step="100" value="' + c.targetScore + '"></label>' +
      '<label>Scoring at launch<select name="scoringMode"><option value="pooled"' + (c.scoringMode === 'pooled' ? ' selected' : '') + '>Pooled: total chips × total mult</option><option value="perHand"' + (c.scoringMode === 'perHand' ? ' selected' : '') + '>Per hand: sum of each chips × mult</option></select></label>' +
      '<label>Gauge tiers (granularity)<input type="number" name="gaugeTiers" min="2" max="12" step="1" value="' + c.gaugeTiers + '"></label>' +
      '<label class="inline"><input type="checkbox" name="hotDice"' + (c.hotDice ? ' checked' : '') + '>Hot dice (all six return when every die is cached)</label>' +
      '<label class="inline"><input type="checkbox" name="showFarkleRisk"' + (c.showFarkleRisk ? ' checked' : '') + '>Show farkle chance for the next roll</label>' +
      '<h4>Power-ups</h4>' +
      '<label class="inline"><input type="checkbox" name="pu_single"' + (c.powerups.single.enabled ? ' checked' : '') + '>Single booster: + chips <input type="number" name="pu_single_v" min="0" step="1" value="' + c.powerups.single.chips + '" style="width:70px"></label>' +
      '<label class="inline"><input type="checkbox" name="pu_run"' + (c.powerups.run.enabled ? ' checked' : '') + '>Run booster: + mult <input type="number" name="pu_run_v" min="0" step="0.5" value="' + c.powerups.run.mult + '" style="width:70px"></label>' +
      '<label class="inline"><input type="checkbox" name="pu_set"' + (c.powerups.set.enabled ? ' checked' : '') + '>Set booster: × mult <input type="number" name="pu_set_v" min="1" step="0.1" value="' + c.powerups.set.xmult + '" style="width:70px"></label>' +
      '<span></span>' +
      '<h4>AI</h4>' +
      '<label>Base launch point (share of target)<input type="number" name="ai_base" min="0.02" max="1" step="0.01" value="' + c.ai.baseLaunchShare + '"></label>' +
      '<label>Leading: launch-point factor (&lt;1 = earlier)<input type="number" name="ai_lead" min="0.1" max="2" step="0.05" value="' + c.ai.leadingFactor + '"></label>' +
      '<label>Trailing: max launch-point factor (&gt;1 = later)<input type="number" name="ai_trail" min="1" max="4" step="0.1" value="' + c.ai.trailingMax + '"></label>' +
      '<label>Randomness per burn (±)<input type="number" name="ai_jitter" min="0" max="0.9" step="0.05" value="' + c.ai.jitter + '"></label>' +
      '<label class="inline"><input type="checkbox" name="ai_items"' + (c.ai.usesItems ? ' checked' : '') + '>AI uses consumables</label>' +
      '<h4>Levels</h4>' +
      '<label>Target multiplier per level<input type="number" name="lv_mult" min="1" max="4" step="0.05" value="' + c.levels.multiplier + '"></label>' +
      '<span></span>' +
      '<h4>Consumables</h4>' +
      '<label>Inventory slots per ship<input type="number" name="cs_cap" min="0" max="10" step="1" value="' + c.consumables.capacity + '"></label>' +
      '<label>Random items granted each level (same for both ships)<input type="number" name="cs_per" min="0" max="10" step="1" value="' + c.consumables.perLevel + '"></label>' +
      '<label class="inline"><input type="checkbox" name="cs_earn"' + (c.consumables.earnOnHotDice ? ' checked' : '') + '>Hot dice earns one random item</label>' +
      '<span></span>' +
      '<div style="grid-column:1/-1;color:var(--muted)">Items that can be drawn:</div>' +
      OF.CONSUMABLE_DEFS.map(function (it) {
        return '<label class="inline"><input type="checkbox" name="cs_' + it.id + '"' + (c.consumables.pool[it.id] ? ' checked' : '') + '>' + it.icon + ' ' + it.name + '</label>';
      }).join('') +
      '<h4>Base hand values</h4>' +
      '<table class="values edit" style="grid-column:1/-1">' + handRows + '</table>' +
      '</form>' +
      '<div class="foot"><button id="t-reset">Reset to defaults</button><button id="t-cancel">Cancel</button><button class="primary" id="t-save">Save & restart</button></div>',
      null
    );
    bind('t-cancel', closeModal);
    bind('t-reset', function () {
      try { localStorage.removeItem(LS_CONFIG); } catch (e) { /* ignore */ }
      newRun();
    });
    bind('t-save', function () {
      const f = $('tune');
      const val = function (n) { return parseFloat(f.elements[n].value); };
      const chk = function (n) { return f.elements[n].checked; };
      const over = {
        targetScore: Math.max(100, val('targetScore') || 2500),
        scoringMode: f.elements.scoringMode.value,
        gaugeTiers: Math.min(12, Math.max(2, Math.round(val('gaugeTiers')) || 5)),
        hotDice: chk('hotDice'),
        showFarkleRisk: chk('showFarkleRisk'),
        powerups: {
          single: { enabled: chk('pu_single'), chips: val('pu_single_v') || 0 },
          run: { enabled: chk('pu_run'), mult: val('pu_run_v') || 0 },
          set: { enabled: chk('pu_set'), xmult: val('pu_set_v') || 1 },
        },
        ai: { baseLaunchShare: val('ai_base'), leadingFactor: val('ai_lead'), trailingMax: val('ai_trail'), jitter: val('ai_jitter'), usesItems: chk('ai_items') },
        consumables: {
          capacity: Math.max(0, Math.round(val('cs_cap')) || 0),
          perLevel: Math.max(0, Math.round(val('cs_per')) || 0),
          earnOnHotDice: chk('cs_earn'),
          pool: {},
        },
        levels: { multiplier: Math.max(1, val('lv_mult') || 1.5) },
        hands: {},
      };
      OF.CONSUMABLE_DEFS.forEach(function (it) {
        over.consumables.pool[it.id] = chk('cs_' + it.id);
      });
      f.querySelectorAll('input[data-hand]').forEach(function (inp) {
        const id = inp.dataset.hand;
        over.hands[id] = over.hands[id] || {};
        over.hands[id][inp.dataset.k] = Math.max(0, parseFloat(inp.value) || 0);
      });
      lsSet(LS_CONFIG, over);
      newRun();
    });
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------

  function showRules() {
    openModal(
      '<h3>How to play</h3><div class="rules"><ul>' +
      '<li><b>Race to orbit.</b> First ship to bank <b>' + fmt(cfg.targetScore) + '</b> points wins the level.</li>' +
      '<li><b>Levels.</b> Win a level to move on. Each level\'s target is ×' + cfg.levels.multiplier + ' the last. Lose and the run starts over at level 1.</li>' +
      '<li><b>Simultaneous rounds.</b> Each round you and the AI each take one turn at the same time. The AI locks in before seeing yours; results are revealed together.</li>' +
      '<li><b>Your turn is one of:</b><ol>' +
      '<li><b>Roll and cache</b>: roll your live dice, select one or more scoring hands, and cache them on your launch pad.</li>' +
      '<li><b>Roll and farkle</b>: no scoring hand in the roll. Your whole pad is destroyed. The turn is still used.</li>' +
      '<li><b>Launch</b>: your pad resolves as chips × mult and is banked. The pad empties and the next burn starts with six dice.</li></ol></li>' +
      '<li><b>Nothing scores until launch.</b> You see your cached hands by name and a coarse thrust gauge, never the exact total.</li>' +
      '<li><b>Hot dice:</b> cache all six dice and they all come back for the same burn.</li>' +
      '<li><b>Tempo:</b> a launch costs a whole turn. A burn of N hands takes N + 1 turns. Long burns are efficient but risk a farkle.</li>' +
      '<li><b>Ties:</b> if both ships reach orbit in the same round, another round is played; then the higher banked score wins.</li>' +
      '<li><b>Both rolls are visible.</b> Each round both ships either roll and cache or launch. When you roll, you see the opponent\'s dice too, or that they chose to launch.</li>' +
      '<li><b>Consumables</b> are single-use and don\'t cost your turn. You have ' + cfg.consumables.capacity + ' inventory slots. Each level both ships draw ' + cfg.consumables.perLevel + ' random items, and leftovers carry over. Click an item, then click its target:<ul>' +
      OF.CONSUMABLE_DEFS.map(function (c) { return '<li>' + c.icon + ' <b>' + c.name + '</b>: ' + c.desc + '</li>'; }).join('') +
      '</ul>If you farkle while holding a die item, you can use it to try to make a scoring hand, or accept the farkle. The AI has the same items and uses them too.</li>' +
      '</ul><p style="color:var(--muted)">Keys: <kbd>R</kbd> roll · <kbd>L</kbd> launch · <kbd>1</kbd>–<kbd>7</kbd> select dice · <kbd>Enter</kbd> confirm / continue · <kbd>Esc</kbd> close</p></div>' +
      '<div class="foot"><button class="primary" id="r-close">Got it<kbd>Enter</kbd></button></div>',
      closeModal
    );
    bind('r-close', closeModal);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  bind('btn-rules', showRules);
  bind('btn-tuning', showTuning);
  bind('btn-stats', showStats);
  bind('btn-restart', function () {
    if ((level === 1 && match.round <= 1) || confirm('Start a new run at level 1? This level is logged as abandoned.')) newRun();
  });

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
    const modalOpen = !$('overlay').hidden;
    if (modalOpen) {
      if (e.key === 'Enter' && modalOnEnter) { e.preventDefault(); modalOnEnter(); }
      else if (e.key === 'Escape' && phase !== 'reveal' && phase !== 'over') closeModal();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') onRoll();
    else if (k === 'l') onLaunch();
    else if (k >= '1' && k <= '7') toggleDie(+k - 1);
    else if (k === 'escape' && targeting) { targeting = null; render(); }
    else if (k === 'enter' || k === 'c') {
      e.preventDefault();
      if (phase === 'select') onCache();
      else if (phase === 'farkled') onFarkleContinue();
    }
  });

  // Debug handle for the browser console (e.g. orbitalFarkle.match.player.inventory.reroll = 5; orbitalFarkle.render()).
  window.orbitalFarkle = {
    get match() { return match; },
    setPhase: function (p) { phase = p; },
    render: function () { render(); },
  };

  newRun();
  if (!lsGet('orbitalFarkle.seenRules', false)) {
    lsSet('orbitalFarkle.seenRules', true);
    showRules();
  }
})();
