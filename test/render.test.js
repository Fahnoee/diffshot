import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parse.js';
import { renderSvg } from '../src/render.js';

const fixture = readFileSync(new URL('./fixtures/server.patch', import.meta.url), 'utf8');
const files = () => parseDiff(fixture); // renderSvg mutates lines, so parse fresh each time
const count = (s, re) => (s.match(re) ?? []).length;

const special = `diff --git a/t.txt b/t.txt
--- a/t.txt
+++ b/t.txt
@@ -1 +1 @@
-<a href="x">Tom & Jerry</a>
+<a href="y">Tom &amp; "Jerry" <b></a>
`;

test('renders the fixture as an SVG document', async () => {
  const svg = await renderSvg(files(), { embedFont: false });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.endsWith('</svg>'));
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<text[^>]*font-weight="700">server\.ts<\/text>/);
  assert.match(svg, /rateLimit/);
  assert.equal(count(svg, /<svg/g), 1);
  assert.equal(count(svg, /<g[ >]/g), count(svg, /<\/g>/g));
  assert.equal(count(svg, /<text[ >]/g), count(svg, /<\/text>/g));
});

test('escapes special characters', async () => {
  const svg = await renderSvg(parseDiff(special), { embedFont: false, title: 'a < b & "c"' });
  assert.ok(svg.includes('a &lt; b &amp; &quot;c&quot;'));
  // Extract all text content and ensure no raw specials remain outside tags.
  const textContent = [...svg.matchAll(/>([^<]*)</g)].map((m) => m[1]).join('');
  assert.ok(!/[<>"]/.test(textContent));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(textContent));
  assert.ok(svg.includes('&lt;'));
  assert.ok(svg.includes('&amp;amp;'), 'literal "&amp;" in code is double-escaped');
  assert.ok(svg.includes('&quot;'));
  assert.ok(svg.includes('Jerry'));
});

test('chrome:false removes traffic lights', async () => {
  const withChrome = await renderSvg(files(), { embedFont: false, title: 'T1' });
  assert.equal(count(withChrome, /<circle /g), 3);
  const without = await renderSvg(files(), { embedFont: false, chrome: false, title: 'T1' });
  assert.equal(count(without, /<circle /g), 0);
  assert.ok(!without.includes('>T1<'));
});

test('lineNumbers:false hides line numbers', async () => {
  const numbered = await renderSvg(files(), { embedFont: false });
  assert.match(numbered, /text-anchor="end"[^>]*>13<\/text>/);
  const plain = await renderSvg(files(), { embedFont: false, lineNumbers: false });
  assert.doesNotMatch(plain, /<text [^>]*>\d+<\/text>/);
});

test("background:'none' removes background rect and gradient", async () => {
  const withBg = await renderSvg(files(), { embedFont: false });
  const [, W, H] = /<svg[^>]*width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(withBg);
  assert.match(withBg, /<linearGradient/);
  assert.ok(withBg.includes(`<rect width="${W}" height="${H}" fill="url(#ds-bg)"/>`));

  const none = await renderSvg(files(), { embedFont: false, background: 'none' });
  const [, W2, H2] = /<svg[^>]*width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(none);
  assert.doesNotMatch(none, /<linearGradient/);
  assert.ok(!none.includes(`<rect width="${W2}" height="${H2}"`));
  assert.ok(!none.includes('url(#ds-shadow)'));
});

test('solid color and custom gradient backgrounds', async () => {
  const solid = await renderSvg(files(), { embedFont: false, background: '#123456' });
  assert.doesNotMatch(solid, /<linearGradient/);
  assert.match(solid, /fill="#123456"/);
  const grad = await renderSvg(files(), { embedFont: false, background: 'red,green,blue' });
  assert.equal(count(grad, /<stop /g), 3);
});

test('embedFont toggles @font-face', async () => {
  const embedded = await renderSvg(files());
  assert.match(embedded, /@font-face/);
  assert.match(embedded, /data:font\/woff2;base64,/);
  const plain = await renderSvg(files(), { embedFont: false });
  assert.doesNotMatch(plain, /@font-face/);
});

test('maxLines truncates and adds a "more lines" note', async () => {
  const total = files()[0].hunks.reduce((s, h) => s + h.lines.length, 0);
  const svg = await renderSvg(files(), { embedFont: false, maxLines: 3 });
  assert.ok(svg.includes(`… ${total - 3} more lines`));
  const full = await renderSvg(files(), { embedFont: false });
  assert.doesNotMatch(full, /more line/);
  const one = await renderSvg(files(), { embedFont: false, maxLines: total - 1 });
  assert.ok(one.includes('… 1 more line<'));
});

test('title is rendered in the chrome', async () => {
  const svg = await renderSvg(files(), { embedFont: false, title: 'My great change' });
  assert.match(svg, /<text [^>]*text-anchor="middle"[^>]*>My great change<\/text>/);
});

test('unknown theme rejects with a helpful error', async () => {
  await assert.rejects(renderSvg(files(), { theme: 'no-such-theme' }), (err) => {
    assert.match(err.message, /Unknown theme "no-such-theme"/);
    assert.match(err.message, /--list-themes/);
    return true;
  });
});

test('light theme works', async () => {
  const dark = await renderSvg(files(), { embedFont: false });
  const light = await renderSvg(files(), { embedFont: false, theme: 'github-light' });
  assert.ok(light.startsWith('<svg') && light.endsWith('</svg>'));
  assert.notEqual(light, dark);
  assert.match(light, /fill="#cf222e"/); // light palette deletion color
  assert.match(light, /fill="#fff(?:fff)?"/i); // github-light background
});

test('binary, renamed and empty inputs render notes', async () => {
  const text = `diff --git a/a.png b/a.png
Binary files a/a.png and b/a.png differ
diff --git a/x b/y
similarity index 100%
rename from x
rename to y
`;
  const svg = await renderSvg(parseDiff(text), { embedFont: false });
  assert.ok(svg.includes('Binary file changed'));
  assert.ok(svg.includes('File renamed without changes'));
  assert.ok(svg.includes('x → y'));
  const empty = await renderSvg([], { embedFont: false });
  assert.ok(empty.includes('No changes'));
});
