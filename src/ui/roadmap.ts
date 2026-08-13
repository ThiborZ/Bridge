/**
 * What is built and what is still to come, shown inside the game.
 *
 * It lives here as data rather than in the README because the README is not
 * where anyone looks while playing, and because "what were we going to add?" is
 * a question that otherwise gets answered from memory. Keep it honest: an item
 * moves to `done` when it works, not when it is started.
 */

export type Item = {
  readonly title: string;
  readonly detail: string;
  readonly done?: boolean;
};

export const ROADMAP: readonly Item[] = [
  {
    title: 'Keeping score',
    detail:
      'A running total across a session, and something worth beating — best score, longest run of contracts made, how often you find the right game.',
  },
  {
    title: 'Three levels of opponent',
    detail:
      'Kitchen table, Club night and Tournament — and your partner set separately, so he can be better or worse than the opposition.',
  },
  {
    title: 'Picking up where you left off',
    detail:
      'There is no clock on anything — put it down mid-hand and come back whenever you like. But if the tablet closes the app to save memory, the hand is lost and you start a fresh one. Remembering it would fix that.',
  },
  {
    title: 'Taking a card back',
    detail: 'An undo, for when a card goes down by accident.',
  },
  {
    title: 'A hand worth looking at again',
    detail:
      'Replaying a deal trick by trick afterwards, and a hint on where the tricks went.',
  },
  {
    title: 'More of the bidding',
    detail:
      'Blackwood for slams, and bidding on after the opponents come in. The bots pass in places a player would not.',
  },
  {
    title: 'Another look',
    detail: 'A second colour scheme, for a change of scene or an easier read.',
  },
  {
    title: 'A table on screen',
    detail: 'Four seats, the bidding box, and a whole deal played by hand.',
    done: true,
  },
  {
    title: 'Cards played properly',
    detail:
      'The bots follow suit, cash winners, lead through strength and take the finesse. They are beatable, not silly.',
    done: true,
  },
  {
    title: 'Acol bidding',
    detail:
      'Weak no-trump, strong twos, Stayman without transfers. Every bid explains itself — hover a call to see what it showed.',
    done: true,
  },
  {
    title: 'Works without wifi',
    detail:
      'Once it has been opened, it keeps working with the connection off, and updates itself between hands when there is one.',
    done: true,
  },
];
