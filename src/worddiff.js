/**
 * Word-level diffing for paired removed/added lines, so the image can
 * emphasise exactly which part of a line changed.
 *
 * @typedef {[start: number, end: number]} Range  character offsets, end exclusive
 */

const TOKEN_RE = /\w+|\s+|[^\w\s]/gu;
const MAX_TOKENS = 500;

function tokenize(s) {
  return s.match(TOKEN_RE) ?? [];
}

/** Merge adjacent/overlapping ranges. */
function merge(ranges) {
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/**
 * Compute changed character ranges between two lines.
 * Returns null when the lines are too different for a word diff to be useful.
 *
 * @param {string} a old line
 * @param {string} b new line
 * @returns {{ a: Range[], b: Range[] } | null}
 */
export function wordDiff(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.length > MAX_TOKENS || tb.length > MAX_TOKENS) return null;

  // Classic LCS table over tokens.
  const n = ta.length;
  const m = tb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  /** @type {Range[]} */ const ra = [];
  /** @type {Range[]} */ const rb = [];
  let i = 0, j = 0, pa = 0, pb = 0, common = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) {
      if (ta[i].trim()) common += ta[i].length;
      pa += ta[i++].length;
      pb += tb[j++].length;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      rb.push([pb, pb + tb[j].length]);
      pb += tb[j++].length;
    } else {
      ra.push([pa, pa + ta[i].length]);
      pa += ta[i++].length;
    }
  }

  // If barely anything is shared, highlighting fragments is just noise.
  const nonWs = (s) => s.replace(/\s+/g, '').length;
  const total = nonWs(a) + nonWs(b) || 1;
  if ((2 * common) / total < 0.4) return null;

  return { a: merge(ra), b: merge(rb) };
}

/**
 * Pair up removed/added lines inside a hunk and attach `changes` ranges.
 * Mutates the given lines.
 *
 * @param {import('./parse.js').DiffLine[]} lines
 */
export function annotateWordDiffs(lines) {
  let k = 0;
  while (k < lines.length) {
    if (lines[k].type !== 'del') { k++; continue; }
    const delStart = k;
    while (k < lines.length && lines[k].type === 'del') k++;
    const addStart = k;
    while (k < lines.length && lines[k].type === 'add') k++;
    const dels = lines.slice(delStart, addStart);
    const adds = lines.slice(addStart, k);
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p++) {
      const d = wordDiff(dels[p].text, adds[p].text);
      if (d && (d.a.length || d.b.length)) {
        dels[p].changes = d.a;
        adds[p].changes = d.b;
      }
    }
  }
}
