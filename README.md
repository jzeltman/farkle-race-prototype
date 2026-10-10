# Orbital Farkle: prototype

A 2D browser prototype for testing one question: does press-your-luck stay tense when Balatro-style chips × mult scoring is paired with a visible opponent race?

## Play it

- **GitHub Pages:** open the repo's Pages URL (https://jzeltman.github.io/farkle-race-prototype/). Pages serves the root `index.html`.
- **Locally:** double-click `index.html`. It is one self-contained file with no dependencies, so it is also easy to send to testers.
- **Localhost:** `python3 -m http.server 8000`, then open <http://localhost:8000>.

## Layout

- **Center:** the opponent's board is at the top. It has their power-ups and items, their dice for this round, their velocity (banked score against the target) and their last turn. Your board is at the bottom, with your velocity, Roll and Launch, your dice, and your power-ups and items. Status, your current selection and the farkle chance sit between the two boards.
- **Left:** the hands each ship has cached this turn, with each hand's chips × mult, and a Potential Energy gauge. The gauge is the coarse pending-thrust tier; the pad total stays hidden.
- **Right:** a vertical race track from 0 to the target velocity, with your rocket (blue) and the opponent's (red).
- **Header buttons:** Hand Values (hand table, power-ups, gauge tiers), Rules, Tuning, Log (round log and playtest stats), and New run.

The rocket art is in `assets/` and is embedded in `style.css` as data URIs, so the single-file build needs no extra files.

## What's in Phase 1

- Six numbered dice. Click a die (or press `1`–`6`) to select it. A valid selection shows each hand's name and its chips × mult.
- Simultaneous rounds. The AI commits to roll or launch before it sees your move, then both results are revealed together.
- Turn types: **roll and cache**, **roll and farkle** (your pad is destroyed), and **launch** (the pad resolves and is banked).
- Hot dice: cache all six dice and all six come back.
- Auto-roll: when rolling is your only move (it's your move, your pad is empty, and you can't use Intercept first), the game rolls for you after a short pause. You can turn this off in Tuning.
- The hand set: singles (1, 5), three to six of a kind, two pair, full house, small, medium and full straights, three pairs (four of a kind plus a pair also counts), and two triplets. A lone pair doesn't score.
- Three power-ups, the same on both ships: Single booster (+10 chips), Run booster (+2 mult on small and medium straights), and Set booster (×1.5 mult on of-a-kinds, two pair, full house, three pairs and two triplets).
- A coarse thrust gauge for both pads (5 tiers by default). It never shows the exact pending total.
- The opponent's banked score, its last turn, and the AI's one-line reason, all shown after each round.
- A launch reveal that adds up chips and mult hand by hand, then shows the total.
- Win, lose, ties and overtime, and restart.
- A **Playtest log** that saves every burn (length, outcome, size, whether you were leading or trailing) and an optional 3-question survey after each match. It checks the results against the PRD's pass thresholds and exports to CSV or JSON.
- A **Tuning** panel with these dials: target score, scoring mode, gauge tiers, hot dice, farkle-chance readout, power-up strength, AI aggression, and every hand's base chips and mult.

Keys: `R` roll · `L` launch · `1`–`6` select dice · `Enter` cache or continue · `Esc` close a dialog.

## Levels

Win a level to move on to the next. Each level's target is 1.5× the last (2,500 → 3,750 → 5,630 → 8,440 …). If you lose a level, the run starts again at level 1. Banked scores reset every level. Leftover items carry over. You can change the multiplier in Tuning.

## Consumables

Each ship has **3 inventory slots**. At the start of every level, both ships draw the same **2 random items**. Leftovers carry over, and a drawn item that doesn't fit is lost. Using an item doesn't cost your turn. Click an item, then click its target. `Esc` cancels.

| Item | Target | Effect |
| --- | --- | --- |
| ▲ Nudge up | One of your dice | +1, and 6 wraps to 1 |
| ▼ Nudge down | One of your dice | −1, and 1 wraps to 6 |
| ↻ Reroll | One of your dice | Rerolls that die |
| ⧉ Intercept | A hand on the opponent's pad | Copies the hand onto your pad. Theirs stays. You can use it before rolling or launching. |
| ⎘ Copy die | One of the opponent's dice this round | Adds a bonus die with that value to your roll. It doesn't use up one of your live dice. |

- **Every round, both ships roll and cache, or launch.** When you roll, the AI rolls too if it committed to rolling, and its dice appear under yours. If it chose to launch, that area says so.
- **Farkle rescue.** If you farkle while holding a nudge, a reroll or a usable copy die, the game tells you and lets you try them. You can also accept the farkle and lose your pad.
- **AI items.** The AI rescues its farkles, intercepts big hands (smaller ones when it is behind), and spends copy die to improve a roll. It keeps a nudge for rescues unless it has a spare. Everything the AI used appears in the round reveal and in its last turn.
- **AI racing.** The AI judges the race on projected scores: banked points plus a read of the other ship's thrust gauge. If your pad looks big enough to reach orbit, it stops banking small pads and keeps rolling to get there first.
- **Tuning.** You can set the inventory slots, the items drawn per level, which items can be drawn, whether hot dice earns an item (off by default because it snowballs), and whether the AI uses items.

## Design calls the PRD left open

These are starting guesses. You can change all of them in the Tuning panel.

| Call | Default | Why |
| --- | --- | --- |
| How a pad resolves | **Pooled**: (sum of chips) × (sum of mult) | Matches Balatro. Totals grow faster than linearly, so they are hard to calculate exactly but still possible to estimate. A per-hand mode is available to compare. |
| Base values | Single 1 10×1, Single 5 5×1, Two pair 25×3, 3-kind 30×3, 4-kind 60×4, Full house 50×4, 5-kind 100×5, 6-kind 150×7, Small straight 30×3, Medium 50×4, Full 80×6, Three pairs 60×6, Two triplets 100×7 | Single 5 comes from the PRD. The rest are placeholders. |
| Target score | 2,500 | In AI-vs-AI sims a match lasts about 13 rounds. |
| Splitting a selection into hands | Automatic: the best-scoring split of the selected dice | This means players never lose points to how they labelled their dice. |
| Farkle-chance readout | On | Supports the fairness test ("I should have stopped at X"). It shows risk, not the total. Turn it off in Tuning to test without it. |
| After a farkle | The reveal shows what the lost pad would have launched for | This helps players calibrate their estimates over time. |
| Ties | Both ships reach orbit in the same round → overtime. The higher banked score at the end of a later round wins. | |

Lone pairs are out of the hand set because they made rolls of 5 or 6 dice impossible to farkle, and a single nudge could turn almost any die into one. The farkle chance is now 3%, 13%, 28%, 44% and 67% for 5, 4, 3, 2 and 1 dice. Six dice still can't farkle.

## Files

- `index.html`: the built, playable game. **Don't edit it by hand**: it is generated from `src/`.
- `src/index.html`, `src/style.css`: the page source (`assets/`: rocket images, also inlined in the CSS)
- `src/engine.js`: rules, scoring, gauge, match flow and the AI (no DOM)
- `src/game.js`: UI, reveal animation, logging and tuning
- `build.py`: bundles `src/` into the root `index.html`
- `sim.js`: headless AI-vs-AI balance sim: `node sim.js [matches] [target] [pooled|perHand] [noitems]`

In the browser console, `orbitalFarkle.match` gives you the live match for debugging. For example, set `orbitalFarkle.match.player.inventory.reroll = 5` and then call `orbitalFarkle.render()`.

## Collecting playtest data

Logs are stored in each tester's browser (localStorage). After a session, open **Log**, enter the tester's name and click **Export burns CSV** or **Export JSON**.

## Editing

Edit the files in `src/`, then rebuild the root `index.html` and commit both:

```sh
python3 build.py
```

To work on the source directly without rebuilding, open `src/index.html`; it loads the separate files.
