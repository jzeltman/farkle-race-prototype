#!/usr/bin/env node
/*
 * Headless balance sim: AI vs AI using the same engine as the browser game.
 * Usage: node sim.js [matches=2000] [target=<config default>] [mode=pooled|perHand] [noitems]
 */
'use strict';
const OF = require('./engine.js');

const N = +(process.argv[2] || 2000);
const cfg = OF.defaultConfig();
if (process.argv[3]) cfg.targetScore = +process.argv[3];
if (process.argv[4]) cfg.scoringMode = process.argv[4];
if (process.argv[5] === 'noitems') cfg.ai.usesItems = false;
const rng = OF.makeRng(12345);

let rounds = 0, ties = 0, p1 = 0, items = 0;
const burns = [];
const roundsHist = {};
for (let m = 0; m < N; m++) {
  const match = new OF.Match(cfg, { rng });
  let guard = 0;
  while (!match.over && guard++ < 500) {
    match.beginRound();
    // "player" seat is played by the same AI heuristic, deciding before it sees the other side
    const plan = OF.aiDecide(match, match.player, match.ai);
    if (plan.type === 'roll') match.roll(match.player);
    match.aiRollIfPlanned();
    const turn = OF.executeAiPlan(match, match.player, plan);
    const res = match.resolveRound(turn);
    if (res.result === 'tie') ties++;
  }
  rounds += match.round;
  roundsHist[match.round] = (roundsHist[match.round] || 0) + 1;
  if (match.winner === 'player') p1++;
  burns.push(...match.log.burns);
  items += match.log.items.length;
}
const done = burns.filter(b => b.outcome !== 'matchEnd');
const launched = done.filter(b => b.outcome === 'launch');
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = x => (100 * x).toFixed(1) + '%';
console.log(`target=${cfg.targetScore} mode=${cfg.scoringMode} matches=${N}`);
console.log(`avg rounds/match: ${(rounds / N).toFixed(1)}   seat-1 win rate: ${pct(p1 / N)}   tie rounds: ${ties}`);
console.log(`items used per match: ${(items / N).toFixed(2)}`);
console.log(`burns: ${done.length}   farkle rate: ${pct(1 - launched.length / done.length)}`);
console.log(`avg caches/burn: ${avg(done.map(b => b.caches)).toFixed(2)}   launched burns with 3+ caches: ${pct(launched.filter(b => b.caches >= 3).length / launched.length)}`);
console.log(`avg launch: ${avg(launched.map(b => b.total)).toFixed(0)}   max launch: ${Math.max(...launched.map(b => b.total))}`);
console.log(`avg caches when trailing: ${avg(done.filter(b => b.trailing).map(b => b.caches)).toFixed(2)}   leading/even: ${avg(done.filter(b => !b.trailing).map(b => b.caches)).toFixed(2)}`);
for (let i = 1; i <= 6; i++) process.stdout.write(`P(farkle|${i} dice)=${pct(OF.farkleChance(i))}  `);
console.log();
