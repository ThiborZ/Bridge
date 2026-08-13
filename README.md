# Bridge

A contract bridge game, built as a gift. She sits South, the computer plays the
other three hands.

**Live: https://thiborz.github.io/Bridge/** — push to `main` and it deploys.

System: **Acol** — weak no-trump (12–14), traditional strong two-bids, Stayman
without transfers. **The interface is Dutch only**; English was removed rather
than made a toggle. The engine and the tests stay English on purpose — see
[The interface is Dutch, the engine is not](#the-interface-is-dutch-the-engine-is-not).

## A game, start to finish

An empty table → **Nieuw spel** → a setup screen choosing how well the opponents
and your partner play → **four hands, which is one Chicago cycle** → the final
score → clear the table. Nothing is dealt and no bot moves until a game is
started.

The strengths are chosen **when setting a game up, deliberately not in the
settings menu**: how well the opponents play belongs to the game you are sitting
down to, like who deals, not to a list of preferences beside the brightness.

## Running it

```bash
npm run dev
```

Then open the address it prints.

Two switches, both only for development:

| URL | Effect |
| --- | --- |
| `?fast` | Strips every pause out. Deals become unwatchable, which is the point — it is for driving many deals through the interface, not for playing. |
| `?pause=3000` | How long a completed trick is held on the table, in milliseconds. Default 1500. **A number to settle with her, not to guess at.** |

```bash
npm test          # the whole suite, including 10,000 fuzzed deals
npm run typecheck
npm run build     # static output in dist/
```

`window.bridge` in the console exposes `state()`, `describe()` and
`preview('slam' | 'game' | 'partscore' | 'setback')` — the last one shows an
end-of-hand effect without waiting to be dealt a slam.

## Publishing it

Push to `main`. The workflow typechecks, runs the whole suite, regenerates the
icons and deploys to GitHub Pages; a failing test never reaches the tablet.

There is no server. It is a static page, which is what lets it work with the
wifi off — and why Fly, where the other project lives, would be the wrong home
for it.

**Getting it onto her iPad** is a manual step, once, on the device: open the page
in **Safari**, tap Share, then "Zet op beginscherm". No page can do this for
itself — iOS has no install API — which is why the menu shows instructions there
rather than a button. Android and desktop Chrome get a real install button.

**A link opened from a message cannot be installed at all.** WhatsApp, Messenger
and the like open a webview inside themselves, and "Zet op beginscherm" is a
Safari feature that does not exist there. The menu explains both routes, always,
and puts whichever seems to apply first — the detection is a user-agent guess, so
a wrong guess costs a confusing sentence rather than a dead end. WhatsApp hands
off to real Safari and must not be flagged.

**Updating it.** She never has to do anything. The worker's URL carries the build
id, so each deploy is a distinct worker with its own cache; the page is checked
for a new version on every launch and whenever she returns to it. A new version
is applied **between hands, never mid-deal** — reloading while she is looking at
thirteen cards to fix a typo would be its own kind of bug. The version showing in
the corner of the panel is how you tell what she is actually running.

**Offline is tested, not hoped for.** The verification was to stop the server and
reload: the game came back, thirteen cards and all, served entirely from the
cache. iOS behaviour is expected rather than verified — there is no iPad on this
machine.

The fuzz test and the solver comparisons dominate the runtime (~60s). To iterate
faster:

```bash
FUZZ_DEALS=200 npm test
```

Two things are skipped by default because they take minutes rather than seconds:

```bash
DD_FULL=1 npx vitest run test/doubledummy.test.ts    # published full-deal tables
BENCH=1 npx vitest run test/benchmark.test.ts --reporter=verbose
```

## What is where

The engine touches no screen and knows nothing about Dutch. Everything a player
reads lives under `src/ui/`.

| File | What it owns |
| --- | --- |
| `src/cards.ts` | Cards as numbers 0..51, hand evaluation, shape |
| `src/seats.ts` | Seats, partnerships, dealer rotation, vulnerability cycles |
| `src/auction.ts` | Call legality, when bidding ends, contract and **declarer** |
| `src/play.ts` | Following suit, trick winners, trick counts |
| `src/score.ts` | The duplicate scoring table |
| `src/game.ts` | Deals from a seed, and the auction → play → score machine |
| `src/pbn.ts` | Portable Bridge Notation, for importing published deals |
| `src/bots/random.ts` | Legal-but-terrible bots, the fuzz harness |
| `src/bots/heuristic.ts` | Rules of thumb — the Kitchen table player |
| `src/bots/montecarlo.ts` | Sampling the unseen cards and solving the endgame |
| `src/bots/levels.ts` | The three strengths, as card play |
| `src/bidding/acol.ts` | **The system.** One list of rules, first match wins |
| `src/bidding/evaluate.ts` | What a hand is worth and which suit it opens |
| `src/bidding/context.ts` | What a bidder knows: its own hand and the calls so far |
| `src/bidding/index.ts` | Applying the table, and counting what it misses |
| `src/solver/doubleDummy.ts` | The double-dummy solver, including mid-trick entry |
| `src/solver/reference.ts` | A deliberately stupid solver, for checking the real one |
| `src/ui/main.ts` | The table and the game lifecycle |
| `src/ui/screens.ts` | Setting a game up, and finishing one |
| `src/ui/menu.ts` | Everything that is not the game |
| `src/ui/dutch.ts` | **All player-facing wording** |
| `src/ui/welcome.ts` | How-it-works |
| `src/ui/celebrate.ts` | End-of-hand effects, scaled to the score |
| `src/ui/install.ts` | Home-screen install, offline, and updating |
| `src/ui/settings.ts` | Choices that survive closing the tab |
| `src/ui/roadmap.ts` | What is still to come, shown in-app |
| `src/ui/styles.css` | How it looks |
| `scripts/make-icons.mjs` | Generates the home-screen icons, no dependencies |

### The interface is Dutch, the engine is not

`contractToString` and `describeResult` in the engine produce English, and their
tests assert on it. They are for tests and debugging, not for her. Every string a
player sees is built in `src/ui/dutch.ts`, which keeps the engine language-free
and its tests intact.

Dutch bridge terms, not translations of the English ones: **SA** not NT, *kleur*
for suit, *leider*, *blinde*, *slag*, *manche*, *slem*, *kwetsbaar*, *gever*,
*volgbod*, *regelmatige verdeling*. Court cards render **H / V / B**. Cards are
named suit-first — *ruiten vrouw*, not *vrouw ruiten*.

To translate in bulk, **use a Node script, never PowerShell** — the PowerShell
text cmdlets turn en-dashes and curly apostrophes into mojibake.

### The three strengths are measured, not asserted

The solver is hopeless on a whole deal (17 seconds to 17 minutes for one deal's
grid) and sub-millisecond with five tricks left. So the heuristic plays the early
cards and Monte Carlo takes over for the **endgame**, which is where contracts are
decided.

| | Plays by | Solves from |
| --- | --- | --- |
| Huiskamer | rules of thumb only | never |
| Clubavond | thumb, then calculation | last 4 tricks, 12 layouts |
| Wedstrijd | thumb, then calculation | last 6 tricks, 24 layouts |

Over 40 identical deals: clubavond takes 14 more tricks than huiskamer,
wedstrijd 23 more than clubavond, and head to head wedstrijd takes **302 tricks
against the plain heuristic's 218**. Slowest single decision 44ms, against the
750ms pause between cards.

**Seven tricks deep was tried and rejected**: nine times the thinking (387ms) for
a gain inside the noise. Six is a measurement, not a preference — raising it means
re-measuring on the slowest device that matters, which is not this laptop.

**No level cheats.** Every bot sees its own hand, dummy once it is face up, the
cards played, and how many cards each player holds — all of it public at a real
table. The unseen cards are *sampled*. Difficulty is how well they reason. A weak
level is weak by **omission**; noise reads as a bug and a random partner is
infuriating.

### A setting has to reach everything it governs

The strength setting reached the card play and not the bidding, so a *huiskamer*
opponent played badly and still bid the full Acol system. Nothing failed and no
test caught it — `decideCall` simply fell back to its default. When adding a
setting, find every consumer.

### Two-colour or four-colour cards

Bridge software offers a **four-colour deck** — diamonds and clubs get colours of
their own — because in a fan of thirteen cards you see only the corner index, and
reading a diamond as a heart makes you fail to follow suit, which carries a
scoring penalty. It also helps as eyesight goes. It is the default here.

But a deck she may have played with for fifty years is two-colour, so it is a
setting rather than a decision, stored in `localStorage`. The whole thing is four
CSS variables:

```css
:root[data-deck="two"] {
  --diamond: var(--heart);
  --club: var(--spade);
  /* and the two -lit variants for the dark panel */
}
```

Everything that paints a pip, a bid button or an auction cell reads those tokens,
so nothing else has to know the setting exists. Each option in the picker shows
the four pips in the palette it would give you — a sample decides this faster
than any wording of it.

### Three things the table has to get right

**Declarer plays dummy's hand.** If she declares she plays her own cards *and*
her partner's; if her partner declares she is dummy and plays nothing at all.
That last one looks like a broken game and is not, so the panel says so in words.

**A finished trick stays on the table.** Fifteen hundred milliseconds by default,
with the winning card ringed, before it is swept. Clearing it the instant the
fourth card lands is what makes the play impossible to follow.

**The index goes in the top-left corner.** Thirteen cards only fit across if they
overlap, so the sliver of each card that stays visible is its left edge, and that
sliver has to carry the rank and suit. The same applies turned ninety degrees for
a dummy sitting East or West, where the visible strip is horizontal — so those
cards lay their index along it and are drawn smaller.

Three properties are deliberate, and worth keeping:

**Nothing here touches a screen.** No DOM, no timers, no randomness that isn't
passed in. That is what makes ten thousand deals a twenty-second test rather
than a browser session.

**Deals come from a seed.** `dealFromSeed('board-42', 'N', 'None')` gives the
same thirteen cards every time, so "that hand was strange" is answerable.

**Nothing mutates.** Every function takes a state and returns a new one, which
is what will let the solver search a position without corrupting the game.

## What the tests actually check

179 tests over 11 files. The ones that carry weight:

**`fuzz.test.ts` — 10,000 deals, verified independently.** Random legal bots play
them out, then the test re-derives the trick winner, the follow-suit obligation,
the card count and the trick chain *from the original deal* rather than asking the
engine whether it behaved. An engine that marks its own homework agrees with
itself.

It also asserts the run isn't degenerate — at most a quarter slams, and at least a
tenth each of part-scores, made contracts and defeated ones. This matters: the
first version of the bot drew uniformly from the legal calls, which sounds neutral
but leaps about seven ranks per call, and **79% of deals ended in a slam**. Every
part-score path in the scoring table was untested while the suite was green. A
second, smaller run of 400 deals checks the invariants at every single step rather
than only at the end.

**`legality.test.ts` — the auction tree, walked exhaustively.** ~102,000 nodes from
all four dealers. `legalCalls` and `isLegalCall` are separate pieces of code, one
generating and one validating, and this compares them at every node against all 38
possible calls. Declarer is cross-checked against an independently written rule
(earliest naming per seat, rather than a forward scan), and the walk asserts it
actually *found* auctions where declarer isn't the last bidder — 164 of them — so
the hardest rule in the engine is confirmed rather than merely exercised.

**`score-properties.test.ts` — all 2,940 scoreable positions.** Every level,
strain, risk, trick count and vulnerability, checked against properties instead of
remembered numbers: taking one more trick never scores less, doubling a contract
you make never costs you, the parts always sum to the whole, the redoubled penalty
is always exactly twice the doubled one.

**`trumps.test.ts` — deals whose answer is calculable by hand.** Each player holds
one complete suit, so nobody can ever follow anybody and the outcome doesn't depend
on how cards are chosen: whoever owns the trump suit takes all thirteen, and in
no-trumps the opening leader does. The fuzz test proves no rule is broken, but a
consistently *wrong* trick-winner would also pass every legality check ever
written. These pin the count down.

### The scoring numbers are verified

Every value in `src/score.ts` has been checked against published static tables —
trick values, the part-score and game bonuses, both slam bonuses, the insult,
undoubled and doubled overtricks, and both undertrick ladders including the
redoubled doubling rule. This was the biggest open risk in the project, because a
wrong row scores every hand wrong forever and nothing visibly breaks.

One note on method: a JavaScript-driven online score calculator was tried first as
an oracle and rejected — it returned a figure with an internally inconsistent
breakdown, having evidently computed rather than read it. Static tables only.

### The double-dummy solver

`src/solver/doubleDummy.ts` answers "how many tricks does each side take with all
four hands face up and both sides playing perfectly". It is the foundation the
card-play bots are built on: Monte Carlo play deals the unseen cards many times
consistently with what is known, solves each layout here, and plays the card that
wins most often.

It is checked three ways. The one that matters is `src/solver/reference.ts` — a
deliberately stupid exhaustive minimax with no bitmasks, no pruning, no table and
no equivalence, sharing no code with the real solver on purpose. The two are
compared on every combination of trump suit and opening leader across hundreds of
small deals, twenty comparisons per deal. Then there are deals whose answer can be
worked out by hand.

Finally, **both published double-dummy tables reproduce exactly — 40 of 40 entries**,
every declarer in every strain, against the test fixtures of an established solver
library. That is the check that says the solver agrees with the rest of the world's
definition of correct play, not merely with itself.

**This caught a real bug that nothing else would have.** Equivalent-card
collapsing originally measured "cards still in somebody's hand". But a card played
earlier *in the current trick* has left its hand while remaining live on the table
— so with an opponent's queen face up, the king and jack looked adjacent, were
treated as interchangeable, and one side's best option was silently discarded. The
answer was wrong by a trick and every rule was still obeyed. The `useTranspositions`
and `collapseEquivalents` switches exist so a disagreement names its own culprit;
they pointed straight at it.

Performance, on this machine, solving one deal (`BENCH=1 npx vitest run
test/benchmark.test.ts --reporter=verbose`):

| Cards each | Nodes | Time |
| --- | --- | --- |
| 10 | 62k | 0.07s |
| 11 | 123k | 0.13s |
| 12 | 1.4M | 1.5s |
| 13 | 17M | 14s |

Getting there took four goes, and the order is worth knowing because each one
looked like the answer: a null-window binary search instead of a full-width one;
canonical transposition keys, so positions differing only in which absolute ranks
have gone share an entry; move ordering (cheapest winner first, otherwise lowest
card), which alone cut eleven-card deals fourteenfold; and raising the table
ceiling, because at 400,000 entries a full deal wiped its own table thirty-nine
times mid-solve.

**Deals vary by more than the table suggests.** That thirteen-card row is one
deal. Of the two published deals, one solves its whole twenty-entry grid in **17
seconds** and the other needs **1,029** — a sixtyfold spread at identical size. A
single no-trump solve of the slow one takes 67 seconds against the benchmark deal's
14. Quote a range, never a number: the difficulty of a deal is not a property of
how many cards are in it.

**None of this is fast enough yet**, and that is the headline finding for phase 3.
Monte Carlo needs tens of solves per card, so Tournament level needs this one to two
orders of magnitude faster. The remaining levers are the ones real solvers use and
this one does not: storing the best move in the table to try first, killer moves,
and quick-trick bounds to cut nodes before searching them. Kitchen table and Club
night don't depend on any of it, so the game is playable regardless.

### The tests were checked against deliberate bugs

Three bugs were introduced on purpose to confirm the suite bites: declarer taking
the *last* naming of the strain instead of the first, a 200 changed to 250 in the
doubled penalty ladder, and the trump comparison disabled in `trickWinner`. They
produced 15 failures across 7 files. Worth repeating after any significant change
to the engine — a suite nobody has seen fail is a suite of unknown value.

### The Kitchen table player is measured, not asserted

`src/bots/heuristic.ts` plays the rules a beginner is taught: second hand low,
third hand high, win as cheaply as you can, never beat your own partner, ruff
only when the trick is going to the opponents, lead the top of a sequence and
otherwise fourth highest from length.

Each of those has a test on a hand-built deal. But the test that justifies the
file plays **the same deals twice — once with North-South using the heuristic,
once with East-West using it** — so the cards and the random seed are identical
and the only difference is who is choosing. Whatever is left is the player:

| Contract | Heuristic | Random |
| --- | --- | --- |
| 3NT | **7.78** tricks | 5.22 |
| 3♠ | **7.83** tricks | 5.17 |

Roughly two and a half tricks a deal, against a neutral 6.5. "It plays legally"
would have passed on day one and told us nothing — random was already legal.

**It plays dummy blind, on purpose.** Playing a card for dummy it looks only at
dummy's hand, though declarer may see both, so it will crash an ace under its own
king. That is under-using information it legitimately holds, which is exactly
what the weakest level should do. Do not "fix" it — the solver-backed levels use
both hands, and that difference is part of what separates the levels.

### The bidding is a table, and the gaps are counted

`src/bidding/acol.ts` is one list of rules, matched top to bottom, first one
wins. **That ordering is the system** — `open-2C` sits above `open-1NT` because
twenty-three points is not a weak no-trump however balanced it is. Reordering the
list changes what the bots play.

Every rule carries a `meaning` in plain words, shown on hover in the auction and
under it for the latest call, because she has to be able to *read* the auction.
A bid nobody can explain is worse than a bad one.

**Nothing is asserted about the bidding that isn't measured:**

| | Rule table | Random |
| --- | --- | --- |
| Contracts made | **67%** | 39% |
| Declarer's average score | **+95** | −95 |

The random bidder's contracts *lose* on average; these ones earn. Same deals,
same card play on both sides — only the bidding differs.

**The fallback rate is a test, not a comment.** Any auction no rule matches
passes and records itself, and the coverage test fails above 0.2%. That number
started at 1.85% and every point of it was one missing branch — responding after
an opponent overcalls, where 1NT and the one-level suit bids are no longer legal.
Writing that branch, plus responses to partner's 1NT with a dead 10 count and to
a preempt, took it to **0.07%** — six auctions in seven thousand calls. The test
prints the remaining gaps by situation, so extending the table means reading that
list rather than guessing.

Raising the threshold to make a run pass would be the wrong fix, and the comment
in the test says so.

**Known gaps, deliberately:** no Blackwood, no slam machinery beyond bidding one
directly, and competition stops at a simple overcall or takeout double. About
11% of calls are `later-pass` — the system declining to model the third round
onwards. That is the size of the simplification, and it is printed rather than
folklore.

### A correction worth keeping

I changed the opening rule to the Rule of 20 after calling a 0.8% pass-out rate
"suspiciously low", on the basis that roughly one deal in ten is passed out. That
figure was wrong and I had not checked it. For all four hands to be sub-opening
the forty points must split very evenly, and with a standard deviation of about
four points a hand that is genuinely rare — **1.1% is about right.** The Rule of
20 is still the better rule, and it is what Acol actually teaches, but it fixed a
principle rather than the number I claimed it would.

The opening rate itself is now a test: 41.5% of hands, asserted to stay between
26% and 42%, because bots that open too freely make every deal a contested
auction and pass-outs vanish.

### A bug the table had, worth not reintroducing

The bot timer and the completed-trick pause shared one handle. A tap landing
during the pause cancelled the pause itself — `advance` cleared the timer, then
returned early *because* a trick was still showing, so nothing ever cleared it
and the deal froze permanently. They are two handles now, and she cannot act at
all while a trick is on the table. Any timer added later gets its own handle.

## Next

1. **Play a whole game on a real phone or tablet.** Emulation reproduces the
   width and the touch model but not the browser's own bars, and it has already
   missed a real bug that one screenshot from a phone caught immediately. This is
   the most valuable thing left.
2. **Keeping score across games** — the thing she asked for first.
3. **Then put it in front of her.** The real acceptance test, three hands without
   a question, has never been run.

### The game in progress survives being closed

`src/ui/saved.ts`. What is stored is the **history, not the position**: the
deal's seed, the calls made and the cards played, about 750 bytes. Deals come
from a seed and every engine function is pure, so replaying that history
reconstructs the table exactly — and `applyCall`/`applyPlay` refuse anything
illegal, so a corrupt or stale record throws and is discarded rather than
restoring a nonsense position. The round trip is checked at **every step of a
whole hand**, not at one convenient moment.

It is written on every change *including inside `commitCard`*, not only in
`advance`: the card that completes a trick then waits out the pause, and a save
taken after that pause would be one card behind what is on the table.

Deliberately missing, and worth leaving missing until asked: Blackwood,
competition past the first round (about 11% of calls are the system declining to
model further — the coverage test prints them), and undo.

Still open and small: whether she always sits South, and the exact point ranges
in the Acol table, which are conventional defaults rather than hers — especially
the no-trump rebid range. `src/seats.ts` implements both vulnerability cycles;
the game currently runs Chicago, four hands to a game.
