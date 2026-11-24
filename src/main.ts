// Punkt wejścia: widok zdarzenia + tryby (e⁺e⁻ w TS, pp z Pythią w WASM).
import { EventDisplay } from './ui/display';
import { EEMode } from './ui/eeMode';
import { PPMode } from './ui/ppMode';
import { readUrl } from './ui/url';

interface Mode {
  mount(): void;
  unmount(): void;
}

const display = new EventDisplay(document.getElementById('view') as HTMLCanvasElement);
const left = document.getElementById('left')!;
const right = document.getElementById('right')!;
const modes: Record<string, () => Mode> = {
  ee: () => new EEMode(display, left, right),
  pp: () => new PPMode(display, left, right),
};
let current: Mode | null = null;
let currentKey = '';

function setMode(key: string) {
  if (key === currentKey) return;
  current?.unmount();
  currentKey = key;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === key));
  current = modes[key]();
  current.mount();
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    history.replaceState(null, '', `${location.pathname}?m=${b.dataset.mode}`);
    setMode(b.dataset.mode!);
  }),
);
setMode(readUrl().m ?? 'ee');
