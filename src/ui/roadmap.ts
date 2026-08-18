/**
 * What is built and what is still to come, shown inside the game.
 *
 * It lives here as data rather than in the README because the README is not
 * where anyone looks while playing, and because "what were we going to add?" is
 * a question that otherwise gets answered from memory. Keep it honest: an item
 * moves to `done` when it works, not when it is started.
 *
 * Order matters — the not-done items are shown in this order, so it doubles as
 * the priority list.
 */

export type Item = {
  readonly title: string;
  readonly detail: string;
  readonly done?: boolean;
};

export const ROADMAP: readonly Item[] = [
  {
    title: 'Een spel nog eens bekijken',
    detail:
      'Een hand achteraf slag voor slag naspelen, met alle vier de handen open. Zo zie je zelf waar de slagen zijn gebleven.',
  },
  {
    title: 'Hoe goed speelde je het?',
    detail:
      'Na afloop zie je hoeveel slagen er met open kaarten te halen waren. Haalde je er net zoveel, dan staat er “optimaal gespeeld” — en dat is niet makkelijk.',
  },
  {
    title: 'Nog een keer, zelfde kaarten',
    detail:
      'Dezelfde hand nog een keer spelen, nu je weet waar alles zit. De snelste manier om te zien of het anders had gekund.',
  },
  {
    title: 'Uitdagingen',
    detail:
      'Kant-en-klare handen met een opdracht: maak 4♥, of zorg juist dat 3SA niet gemaakt wordt. Het spel rekent vooraf uit dat het kán, dus je krijgt nooit een onmogelijke opgave.',
  },
  {
    title: 'Alleen bieden',
    detail:
      'Krijg een hand, doe je bod, en zie meteen wat het systeem gezegd zou hebben en waarom. Veel handen achter elkaar, zonder ze uit te spelen.',
  },
  {
    title: 'Tegenstanders met karakter',
    detail:
      'Noord, oost en west krijgen een naam en een eigen stijl — de een komt overal tussen, de ander wacht netjes af. Altijd navolgbaar: geen willekeur, maar een speler die je leert kennen.',
  },
  {
    title: 'Een hele robber',
    detail:
      'Naast het spel van vier gevers ook een echte robber, voor als je er eens goed voor gaat zitten.',
  },
  {
    title: 'Een kaart terugnemen',
    detail: 'Ongedaan maken, voor als er per ongeluk een kaart valt.',
  },
  {
    title: 'Meer biedsysteem',
    detail:
      'Blackwood voor slems, en doorbieden als de tegenpartij ertussen komt. Nu passen de computerspelers op plekken waar een mens dat niet zou doen.',
  },
  {
    title: 'Punten bijhouden',
    detail:
      'Een totaal over een hele avond, en cijfers om op terug te kijken: hoeveel contracten je maakt, je beste resultaat, en hoe je het doet tegen elke sterkte. Staat in het menu onder Jouw resultaten.',
    done: true,
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
