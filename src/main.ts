import '@fontsource/b612-mono/400.css';
import '@fontsource/b612-mono/700.css';
import './styles.css';
import { App } from './app/app.ts';

const BOOT_LINES = [
  'REDCOAST AIR SURVEILLANCE SYSTEM',
  'DISPLAY PROCESSOR ........ OK',
  'VIDEO MAP (OSM) ........... LOADED',
  'ANTENNA ................... ROTATING',
  'DATA LINK ................. ESTABLISHING',
  'RADAR ONLINE',
];

/** A short CRT start-up sequence. Skipped with reduced motion; any tap dismisses it. */
function bootSequence(): void {
  const el = document.querySelector<HTMLElement>('.boot');
  if (!el) return;
  const done = () => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 500);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.remove();
    return;
  }
  el.addEventListener('pointerdown', done, { once: true });
  const pre = el.querySelector('pre')!;
  BOOT_LINES.forEach((line, i) => setTimeout(() => (pre.textContent += `${line}\n`), 140 + i * 170));
  setTimeout(done, 140 + BOOT_LINES.length * 170 + 350);
}

async function main(): Promise<void> {
  bootSequence();
  // Canvas text renders with whatever font is loaded at draw time, so wait for B612 (briefly).
  await Promise.race([
    Promise.all([document.fonts.load('11px "B612 Mono"'), document.fonts.load('bold 12px "B612 Mono"')]).catch(() => undefined),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  new App().start();
}

void main();
