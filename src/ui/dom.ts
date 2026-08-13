import type { Suit } from '../cards.js';

/** One source of truth for the pips, so the menu and the table cannot drift. */
export const SUIT_SYMBOL: Record<Suit, string> = { C: '♣', D: '♦', H: '♥', S: '♠' };

/** The one DOM helper the interface is built from. */
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A button that does something, with the label and handler in one place. */
export function button(
  className: string, label: string, onClick: () => void,
): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}
