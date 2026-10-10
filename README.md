# Orbital Farkle: prototype

A 2D browser prototype for testing one question: does press-your-luck stay tense when Balatro-style chips × mult scoring is paired with a visible opponent race?

## Run it

No build step and no dependencies.

- **Simplest:** double-click `orbital-farkle.html`. It is a single self-contained file and easy to send to testers. `index.html` is the same game split into separate files for editing.
- **Localhost:** `python3 -m http.server 8000`, then open <http://localhost:8000>.

## What's in Phase 1

- Six numbered dice. Click a die (or press `1`–`6`) to select it. A valid selection shows each hand's name and its chips × mult.
- Simultaneous rounds. The AI commits to roll or launch before it sees your move, then both results are revealed together.
- Turn types: **roll and cache**, **roll and farkle** (your pad is destroyed), and **launch** (the pad resolves and is banked).
- Hot dice: cache all six dice and all six come back.
- The hand set: singles (1, 5), three to six of a kind, two pair, full house, small, medium and full straights, three pairs (four of a kind plus a pair also counts), and two triplets. A lone pair doesn't score.
- Three power-ups, the same on both ships: Single booster (+10 chips), Run booster (+2 mult on small and medium straights), and Set booster (×1.5 mult on of-a-kinds, two pair, full house, three pairs and two triplets).
- A coarse thrust gauge for both pads (5 tiers by default). It never shows the exact pending total.
- The opponent's banked score, its last turn, and the AI's one-line reason, all shown after each round.
- A launch reveal that adds up chips and mult hand by hand, then shows the total.
- Win, lose, ties and overtime, and restart.
- A **Playtest log** that saves every burn (length, outcome, size, whether you were leading or trailing) and an optional 3-question survey after each match. It checks the results against the PRD's pass thresholds and exports to CSV or JSON.
- A **Tuning** panel with these dials: target score, scoring mode, gauge tiers, hot dice, farkle-chance readout, power-up strength, AI aggression, and every hand's base chips and mult.

Keys: `R` roll · `L` launch · `1`–`6` select dice · `Enter` cache or continue · `Esc` close a dialog.

## Consumables (phase 2 start)

Each ship starts with one of each item, and both ships have the same items. Using an item doesn't cost your turn. Click an item, then click its target. `Esc` cancels.

| Item | Target | Effect |
| --- | --- | --- |
| ▲ Nudge up | One of your dice | +1, and 6 wraps to 1 |
| ▼ Nudge down | One of your dice | −1, and 1 wraps to 6 |
| ↻ Reroll | One of your dice | Rerolls that die |
| ⧉ Intercept | A hand on the opponent's pad | Copies the hand onto your pad. Theirs stays. You can use it before rolling or launching. |
| ⎘ Copy die | One of the opponent's dice this round | Adds a bonus die with that value to your roll. It doesn't use up one of your live dice. |

- **Both rolls are visible.** When you roll, the AI rolls too (if it committed to rolling), and its dice appear under yours. Its choice of roll or launch stays hidden until you've committed.
- **Farkle rescue.** If you farkle while holding a nudge, a reroll or a usable copy die, the game tells you and lets you try them. You can also accept the farkle and lose your pad.
- **AI items.** The AI rescues its farkles, intercepts big hands (smaller ones when it is trailing), and spends copy die to improve a roll. It keeps a nudge for rescues unless it has a spare. Everything the AI used appears in the round reveal and in its last turn.
- **Tuning.** You can set the starting count of each item, whether hot dice earns a random item (off by default because it snowballs), the most of each item a ship can hold, and whether the AI uses items.

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

- `index.html`, `style.css`: the page
- `engine.js`: rules, scoring, gauge, match flow and the AI (no DOM)
- `game.js`: UI, reveal animation, logging and tuning
- `sim.js`: headless AI-vs-AI balance sim: `node sim.js [matches] [target] [pooled|perHand] [noitems]`

In the browser console, `orbitalFarkle.match` gives you the live match for debugging. For example, set `orbitalFarkle.match.player.inventory.reroll = 5` and then call `orbitalFarkle.render()`.

## Collecting playtest data

Logs are stored in each tester's browser (localStorage). After a session, open **Playtest log**, enter the tester's name and click **Export burns CSV** or **Export JSON**.

`orbital-farkle.html` is built from the source files. After editing them, rebuild it with:

```sh
python3 -c "s=open('index.html').read();s=s.replace('<link rel=\"stylesheet\" href=\"style.css\">','<style>\n'+open('style.css').read()+'</style>');[s:=s.replace(f'<script src=\"{f}\"></script>','<script>\n'+open(f).read()+'</script>') for f in ('engine.js','game.js')];open('orbital-farkle.html','w').write(s)"
```
