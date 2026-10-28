// Regenerates the images in docs/ from the fixtures: `npm run examples`
import { readFileSync, writeFileSync } from 'node:fs';
import { parseDiff, renderSvg, svgToPng } from '../src/index.js';

const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const examples = [
  { out: 'hero.png', patch: 'server.patch', opts: { title: 'feat: rate-limit the users endpoint' } },
  { out: 'light.png', patch: 'server.patch', opts: { theme: 'github-light', background: 'peach', title: 'github-light · peach' } },
  { out: 'multi.png', patch: 'multi.patch', opts: { theme: 'catppuccin-mocha', background: 'sunset', title: 'Make TTLCache thread safe' } },
  { out: 'minimal.png', patch: 'server.patch', opts: { theme: 'vitesse-dark', background: 'none', padding: 0, chrome: false, fileHeaders: false } },
];

for (const { out, patch, opts } of examples) {
  const svg = await renderSvg(parseDiff(fixture(patch)), { ...opts, embedFont: false });
  writeFileSync(new URL(`../docs/${out}`, import.meta.url), await svgToPng(svg, { scale: 2 }));
  console.log(`docs/${out}`);
}
