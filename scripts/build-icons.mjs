import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

// Keep Safari, PWA and maskable icons in sync with the editable vector source.
const publicDir = new URL('../public/', import.meta.url);
const source = await readFile(new URL('favicon.svg', publicDir), 'utf8');
const icons = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
];

for (const [name, size] of icons) {
  const png = new Resvg(source, {
    fitTo: { mode: 'width', value: size },
  }).render().asPng();
  await writeFile(new URL(name, publicDir), png);
  console.log(`${name}: ${size}×${size}`);
}
