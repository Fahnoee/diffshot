import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { displayPath } from './parse.js';
import { annotateWordDiffs } from './worddiff.js';
import { detectLanguage, highlightLines, themeInfo } from './highlight.js';

export const FONT_DIR = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const FONT_STACK = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Background presets: two-stop diagonal gradients. */
export const BACKGROUNDS = {
  aurora: ['#7f5af0', '#2cb67d'],
  sunset: ['#ff7e5f', '#feb47b'],
  ocean: ['#2193b0', '#6dd5ed'],
  candy: ['#f857a6', '#ff5858'],
  grape: ['#5f2c82', '#49a09d'],
  midnight: ['#0f2027', '#2c5364'],
  peach: ['#ffecd2', '#fcb69f'],
  mono: ['#d7d2cc', '#304352'],
};

/**
 * @typedef {{
 *   theme?: string,
 *   background?: string,
 *   padding?: number,
 *   title?: string,
 *   lineNumbers?: boolean,
 *   chrome?: boolean,
 *   wordDiff?: boolean,
 *   hunkHeaders?: boolean,
 *   fileHeaders?: boolean,
 *   maxCols?: number,
 *   maxLines?: number,
 *   fontSize?: number,
 *   tabSize?: number,
 *   embedFont?: boolean,
 * }} RenderOptions
 */

const DEFAULTS = {
  theme: 'tokyo-night',
  background: 'aurora',
  padding: 56,
  title: '',
  lineNumbers: true,
  chrome: true,
  wordDiff: true,
  hunkHeaders: true,
  fileHeaders: true,
  maxCols: 100,
  maxLines: 300,
  fontSize: 14,
  tabSize: 4,
  embedFont: true,
};

const esc = (s) =>
  String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (v) => Math.round(v * 100) / 100;

function expandTabs(s, size) {
  if (!s.includes('\t')) return s;
  let out = '';
  for (const ch of s) {
    if (ch === '\t') out += ' '.repeat(size - (out.length % size));
    else out += ch;
  }
  return out;
}

/** Resolve a background spec into SVG defs + fill, or null for transparent. */
function resolveBackground(spec) {
  if (!spec || spec === 'none' || spec === 'transparent') return null;
  const stops = BACKGROUNDS[spec] ?? spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (stops.length === 1) return { defs: '', fill: esc(stops[0]) };
  const step = 100 / (stops.length - 1);
  const s = stops.map((c, i) => `<stop offset="${n(i * step)}%" stop-color="${esc(c)}"/>`).join('');
  return { defs: `<linearGradient id="ds-bg" x1="0" y1="0" x2="1" y2="1">${s}</linearGradient>`, fill: 'url(#ds-bg)' };
}

/**
 * Render parsed file diffs into an SVG string.
 *
 * @param {import('./parse.js').FileDiff[]} files
 * @param {RenderOptions} [options]
 * @returns {Promise<string>}
 */
export async function renderSvg(files, options = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) };
  const theme = await themeInfo(o.theme);

  const fs = o.fontSize;
  const charW = fs * 0.6; // JetBrains Mono advance width is exactly 600/1000 em
  const lineH = Math.round(fs * 1.6);
  const scale = fs / 14;

  const palette = theme.dark
    ? { add: '#2ea043', del: '#f85149', addSign: '#3fb950', delSign: '#ff7b72', tint: 0.16, word: 0.42 }
    : { add: '#2da44e', del: '#cf222e', addSign: '#1a7f37', delSign: '#cf222e', tint: 0.12, word: 0.3 };
  const dim = theme.lineNumber ?? theme.fg;
  const dimOpacity = theme.lineNumber ? 1 : 0.45;

  // ---- 1. Flatten everything into rows, highlighting per file ----
  /** @type {any[]} */
  const rows = [];
  let budget = o.maxLines;
  let hidden = 0;
  let maxOld = 0;
  let maxNew = 0;
  let longest = 0;

  for (const file of files) {
    if (o.fileHeaders) rows.push({ kind: 'file', file });
    if (file.binary) {
      rows.push({ kind: 'note', text: 'Binary file changed' });
      continue;
    }
    if (file.hunks.length === 0) {
      rows.push({ kind: 'note', text: file.status === 'renamed' ? 'File renamed without changes' : 'No textual changes' });
      continue;
    }
    const lang = detectLanguage(file.newPath ?? file.oldPath);
    const oldSide = [];
    const newSide = [];
    for (const hunk of file.hunks) {
      for (const l of hunk.lines) {
        l.text = expandTabs(l.text, o.tabSize);
        if (l.type !== 'add') { l.oldIdx = oldSide.length; oldSide.push(l.text); }
        if (l.type !== 'del') { l.newIdx = newSide.length; newSide.push(l.text); }
      }
      if (o.wordDiff) annotateWordDiffs(hunk.lines);
    }
    const [oldTok, newTok] = await Promise.all([
      highlightLines(oldSide, lang, o.theme),
      highlightLines(newSide, lang, o.theme),
    ]);

    file.hunks.forEach((hunk, hi) => {
      if (budget <= 0) { hidden += hunk.lines.length; return; }
      if (o.hunkHeaders && (hi > 0 || hunk.oldStart > 1 || hunk.newStart > 1)) {
        rows.push({ kind: 'hunk', hunk });
      }
      for (const l of hunk.lines) {
        if (budget <= 0) { hidden++; continue; }
        budget--;
        const tokens = l.type === 'del' ? oldTok[l.oldIdx] : newTok[l.newIdx];
        rows.push({ kind: 'line', line: l, tokens: tokens ?? [{ content: l.text }] });
        if (l.oldNo != null) maxOld = Math.max(maxOld, l.oldNo);
        if (l.newNo != null) maxNew = Math.max(maxNew, l.newNo);
        longest = Math.max(longest, l.text.length);
      }
    });
    if (o.fileHeaders) rows.push({ kind: 'spacer' });
  }
  if (rows.length && rows[rows.length - 1].kind === 'spacer') rows.pop();
  if (hidden > 0) rows.push({ kind: 'note', text: `… ${hidden} more line${hidden === 1 ? '' : 's'}` });
  if (rows.length === 0) rows.push({ kind: 'note', text: 'No changes' });

  // ---- 2. Horizontal layout ----
  const cols = Math.min(Math.max(longest, 20), o.maxCols);
  const numCols = o.lineNumbers ? Math.max(String(maxOld).length, String(maxNew).length, 2) : 0;
  const innerPad = 18 * scale;
  const xOld = innerPad;
  const xNew = o.lineNumbers ? xOld + (numCols + 1.5) * charW : xOld;
  const xSign = o.lineNumbers ? xNew + (numCols + 1.5) * charW : xOld;
  const xCode = xSign + 2 * charW;
  const fileNames = files.map((f) => displayPath(f).length + 14);
  const contentW = Math.max(xCode + cols * charW + innerPad, ...fileNames.map((c) => innerPad * 2 + c * charW), 420 * scale);
  const winW = Math.ceil(contentW);

  // ---- 3. Vertical layout ----
  const chromeH = o.chrome ? Math.round(44 * scale) : Math.round(10 * scale);
  const heights = { file: Math.round(lineH * 1.7), hunk: lineH + 6 * scale, line: lineH, note: lineH * 1.5, spacer: 8 * scale };
  let y = chromeH;
  for (const r of rows) {
    r.y = y;
    y += heights[r.kind];
  }
  const winH = Math.ceil(y + 12 * scale);

  const pad = o.padding;
  const W = winW + pad * 2;
  const H = winH + pad * 2;
  const radius = 12 * scale;
  const bg = resolveBackground(o.background);
  const baseline = (top, h) => n(top + h / 2 + fs * 0.36);

  // ---- 4. Emit SVG ----
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xml:space="preserve">`,
  );
  const defs = [];
  if (bg?.defs) defs.push(bg.defs);
  defs.push(
    `<filter id="ds-shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="${n(18 * scale)}"/></filter>`,
    `<clipPath id="ds-win"><rect x="0" y="0" width="${winW}" height="${winH}" rx="${radius}"/></clipPath>`,
  );
  if (o.embedFont) {
    const woff2 = readFileSync(new URL('JetBrainsMono-Regular.woff2', `file://${FONT_DIR}`)).toString('base64');
    defs.push(
      `<style>@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,${woff2}) format('woff2');font-weight:400 800;}</style>`,
    );
  }
  out.push(`<defs>${defs.join('')}</defs>`);
  if (bg) out.push(`<rect width="${W}" height="${H}" fill="${bg.fill}"/>`);

  out.push(`<g transform="translate(${pad} ${pad})" font-family="${esc(FONT_STACK)}" font-size="${fs}">`);
  if (bg && pad > 0) {
    out.push(
      `<rect x="${n(6 * scale)}" y="${n(16 * scale)}" width="${winW - 12 * scale}" height="${winH}" rx="${radius}" fill="#000" opacity="0.45" filter="url(#ds-shadow)"/>`,
    );
  }
  out.push(`<rect width="${winW}" height="${winH}" rx="${radius}" fill="${esc(theme.bg)}"/>`);
  out.push(`<g clip-path="url(#ds-win)">`);

  if (o.chrome) {
    const cy = chromeH / 2;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      out.push(`<circle cx="${n(innerPad + 6 * scale + i * 20 * scale)}" cy="${n(cy)}" r="${n(6 * scale)}" fill="${c}"/>`);
    });
    if (o.title) {
      out.push(
        `<text x="${n(winW / 2)}" y="${baseline(0, chromeH)}" text-anchor="middle" fill="${esc(theme.fg)}" fill-opacity="0.7">${esc(o.title)}</text>`,
      );
    }
  }

  for (const r of rows) {
    const h = heights[r.kind];
    if (r.kind === 'file') {
      const f = r.file;
      const by = baseline(r.y, h);
      out.push(`<rect x="0" y="${n(r.y)}" width="${winW}" height="${n(h)}" fill="${esc(theme.fg)}" fill-opacity="0.05"/>`);
      out.push(`<rect x="0" y="${n(r.y + h - 1)}" width="${winW}" height="1" fill="${esc(theme.fg)}" fill-opacity="0.08"/>`);
      const badge = { added: 'new', deleted: 'deleted', renamed: 'renamed' }[f.status];
      let tx = innerPad;
      out.push(`<text x="${n(tx)}" y="${by}" fill="${esc(theme.fg)}" font-weight="700">${esc(displayPath(f))}</text>`);
      tx += (displayPath(f).length + 1.5) * charW;
      if (badge) {
        const bw = (badge.length + 1.6) * charW * 0.85;
        out.push(
          `<rect x="${n(tx)}" y="${n(r.y + h / 2 - lineH * 0.42)}" width="${n(bw)}" height="${n(lineH * 0.84)}" rx="${n(lineH * 0.42)}" fill="${esc(theme.fg)}" fill-opacity="0.12"/>`,
          `<text x="${n(tx + bw / 2)}" y="${n(by - fs * 0.04)}" text-anchor="middle" font-size="${n(fs * 0.85)}" fill="${esc(theme.fg)}" fill-opacity="0.8">${badge}</text>`,
        );
      }
      if (!f.binary) {
        const del = `−${f.deletions}`;
        const add = `+${f.additions}`;
        const xr = winW - innerPad;
        out.push(
          `<text x="${n(xr)}" y="${by}" text-anchor="end" fill="${palette.delSign}">${del}</text>`,
          `<text x="${n(xr - (del.length + 1) * charW)}" y="${by}" text-anchor="end" fill="${palette.addSign}">${add}</text>`,
        );
      }
    } else if (r.kind === 'hunk') {
      const hk = r.hunk;
      out.push(`<rect x="0" y="${n(r.y + 3 * scale)}" width="${winW}" height="${n(lineH)}" fill="${esc(theme.fg)}" fill-opacity="0.035"/>`);
      const label = `@@ -${hk.oldStart} +${hk.newStart} @@${hk.header ? ' ' + hk.header : ''}`;
      out.push(
        `<text x="${n(o.lineNumbers ? xOld : xCode)}" y="${baseline(r.y + 3 * scale, lineH)}" fill="${esc(dim)}" fill-opacity="${dimOpacity}">${esc(truncate(label, Math.floor((winW - 2 * innerPad) / charW)))}</text>`,
      );
    } else if (r.kind === 'note') {
      out.push(
        `<text x="${n(xCode)}" y="${baseline(r.y, h)}" fill="${esc(dim)}" fill-opacity="${dimOpacity}" font-style="italic">${esc(r.text)}</text>`,
      );
    } else if (r.kind === 'line') {
      const l = r.line;
      const by = baseline(r.y, h);
      const color = l.type === 'add' ? palette.add : l.type === 'del' ? palette.del : null;
      if (color) {
        out.push(`<rect x="0" y="${n(r.y)}" width="${winW}" height="${h}" fill="${color}" fill-opacity="${palette.tint}"/>`);
        out.push(`<rect x="0" y="${n(r.y)}" width="${n(3 * scale)}" height="${h}" fill="${color}"/>`);
        for (const [s, e] of l.changes ?? []) {
          const cs = Math.min(s, cols);
          const ce = Math.min(e, cols);
          if (ce <= cs) continue;
          out.push(
            `<rect x="${n(xCode + cs * charW)}" y="${n(r.y + 1)}" width="${n((ce - cs) * charW)}" height="${h - 2}" rx="${n(3 * scale)}" fill="${color}" fill-opacity="${palette.word}"/>`,
          );
        }
      }
      if (o.lineNumbers) {
        const numAttrs = `text-anchor="end" fill="${esc(dim)}" fill-opacity="${dimOpacity}"`;
        if (l.oldNo != null) out.push(`<text x="${n(xOld + numCols * charW)}" y="${by}" ${numAttrs}>${l.oldNo}</text>`);
        if (l.newNo != null) out.push(`<text x="${n(xNew + numCols * charW)}" y="${by}" ${numAttrs}>${l.newNo}</text>`);
      }
      if (color) {
        const sign = l.type === 'add' ? '+' : '−';
        out.push(`<text x="${n(xSign)}" y="${by}" fill="${l.type === 'add' ? palette.addSign : palette.delSign}">${sign}</text>`);
      }
      out.push(`<text y="${by}">${renderTokens(r.tokens, xCode, charW, cols, theme.fg, dim)}</text>`);
    }
  }

  out.push('</g>');
  // Hairline border so the window edge reads on any background.
  out.push(
    `<rect x="0.5" y="0.5" width="${winW - 1}" height="${winH - 1}" rx="${radius}" fill="none" stroke="${theme.dark ? '#ffffff' : '#000000'}" stroke-opacity="${theme.dark ? 0.1 : 0.12}"/>`,
  );
  out.push('</g></svg>');
  return out.join('\n');
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, Math.max(0, max - 1)) + '…' : s;
}

/** Turn highlighted tokens into absolutely positioned tspans (robust across renderers). */
function renderTokens(tokens, x0, charW, cols, fg, dim) {
  const parts = [];
  let col = 0;
  for (const t of tokens) {
    if (col >= cols) break;
    let text = t.content;
    let cut = false;
    if (col + text.length > cols) {
      text = text.slice(0, cols - col - 1);
      cut = true;
    }
    const lead = text.length - text.trimStart().length;
    const body = text.trimEnd().slice(lead);
    if (body) {
      const bold = t.fontStyle && t.fontStyle & 2 ? ' font-weight="700"' : '';
      parts.push(`<tspan x="${n(x0 + (col + lead) * charW)}" fill="${esc(t.color ?? fg)}"${bold}>${esc(body)}</tspan>`);
    }
    col += text.length;
    if (cut) {
      parts.push(`<tspan x="${n(x0 + col * charW)}" fill="${esc(dim)}">…</tspan>`);
      break;
    }
  }
  return parts.join('');
}
