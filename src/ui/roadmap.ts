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
    title: 'Punten bijhouden',
    detail:
      'Een totaal over een hele avond, en iets om te verslaan — je beste score, hoeveel contracten je op rij maakt, hoe vaak je de goede manche vindt.',
  },
  {
    title: 'Een kaart terugnemen',
    detail: 'Ongedaan maken, voor als er per ongeluk een kaart valt.',
  },
  {
    title: 'Een spel nog eens bekijken',
    detail:
      'Een hand achteraf slag voor slag naspelen, met een hint over waar de slagen zijn gebleven.',
  },
  {
    title: 'Meer biedsysteem',
    detail:
      'Blackwood voor slems, en doorbieden als de tegenpartij ertussen komt. Nu passen de computerspelers op plekken waar een mens dat niet zou doen.',
  },
  {
    title: 'Drie sterktes',
    detail:
      'Huiskamer speelt op gevoel, wedstrijd rekent het hele eindspel uit. Je partner staat apart in te stellen, zodat hij beter of juist zwakker mag zijn dan de tegenstanders.',
    done: true,
  },
  {
    title: 'Een ander uiterlijk',
    detail: 'Groen laken of licht, en klassieke kaarten of grote cijfers.',
    done: true,
  },
  {
    title: 'De speeltafel',
    detail: 'Vier plaatsen, de biedbox, en een heel spel dat je met de hand speelt.',
    done: true,
  },
  {
    title: 'Fatsoenlijk kaartspel',
    detail:
      'De computer bekent kleur, incasseert zijn slagen, speelt door de sterkte heen en neemt de snit. Te verslaan, maar niet dom.',
    done: true,
  },
  {
    title: 'Acol bieden',
    detail:
      'Zwakke SA, sterke tweeën, Stayman zonder transfers. Elk bod legt zichzelf uit — houd je vinger op een bod in het biedverloop.',
    done: true,
  },
  {
    title: 'Verdergaan waar je gebleven was',
    detail:
      'Er staat nergens een klok. Leg het spel midden in een hand weg en pak het een uur later weer op — ook als de tablet de app ondertussen heeft afgesloten. Je komt terug bij precies dezelfde kaarten.',
    done: true,
  },
  {
    title: 'Werkt zonder wifi',
    detail:
      'Eenmaal geopend blijft het spel werken zonder verbinding, en het werkt zichzelf bij tussen twee spellen door.',
    done: true,
  },
];
