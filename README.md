# Bridge

A contract bridge game. She sits South, the computer plays the other three hands.

System: **Acol** — weak no-trump (12–14), traditional strong two-bids, Stayman
without transfers. Interface in English.

## Running it

```bash
npm run dev
```

Then open the address it prints. She sits South and plays with a mouse or a
finger; three random-legal bots fill the other seats until phase 3 replaces them.

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

## Phases 1 and 2 are done

The engine is complete and touches no screen. On top of it there is now a table
you can play a whole deal on.

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
| `src/bots/heuristic.ts` | The Kitchen table card player |
| `src/bidding/acol.ts` | **The system.** One list of rules, first match wins |
| `src/bidding/evaluate.ts` | What a hand is worth and which suit it opens |
| `src/bidding/context.ts` | What a bidder knows: its own hand and the calls so far |
| `src/bidding/index.ts` | Applying the table, and counting what it misses |
| `src/solver/doubleDummy.ts` | The double-dummy solver (phase 3, started early) |
| `src/solver/reference.ts` | A deliberately stupid solver, for checking the real one |
| `src/ui/main.ts` | The table: seats, bidding box, trick, result. The only file that knows a screen exists |
| `src/ui/settings.ts` | Choices that survive closing the tab |
| `src/ui/styles.css` | How it looks |

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

- **Phase 3, the rest of it** — the solver into a worker, and fast enough to run
  Monte Carlo behind it. That is Club night and Tournament. Kitchen table is done.
- **Phase 5** — undo, the difficulty picker, larger cards, PWA install. The tiers
  are already tagged on every rule; nothing reads them yet but `decideCall`.
- **Phase 4, the rest** — Blackwood, and competition past the first round.
  The coverage test says where.

Still open, and worth settling before phase 4: the exact point ranges (especially
the no-trump rebid), whether scoring is Chicago or duplicate, and whether she always
sits South. `src/seats.ts` already implements both vulnerability cycles.
