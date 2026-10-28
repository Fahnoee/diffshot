/**
 * Minimal unified-diff parser. Understands `git diff` / `git show` output as
 * well as plain `diff -u` patches.
 *
 * @typedef {{ type: 'context' | 'add' | 'del', text: string, oldNo: number | null, newNo: number | null }} DiffLine
 * @typedef {{ header: string, oldStart: number, newStart: number, lines: DiffLine[] }} Hunk
 * @typedef {{
 *   oldPath: string | null,
 *   newPath: string | null,
 *   status: 'modified' | 'added' | 'deleted' | 'renamed',
 *   binary: boolean,
 *   hunks: Hunk[],
 *   additions: number,
 *   deletions: number,
 * }} FileDiff
 */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Strip the `a/` / `b/` prefix git adds and handle `/dev/null`. */
function cleanPath(raw) {
  if (raw == null) return null;
  let p = raw.trim().replace(/\t.*$/, ''); // `diff -u` appends a timestamp after a tab
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/** @returns {FileDiff} */
function newFile() {
  return { oldPath: null, newPath: null, status: 'modified', binary: false, hunks: [], additions: 0, deletions: 0 };
}

/**
 * @param {string} input raw diff text
 * @returns {FileDiff[]}
 */
export function parseDiff(input) {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  /** @type {FileDiff[]} */
  const files = [];
  /** @type {FileDiff | null} */
  let file = null;
  /** @type {Hunk | null} */
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const startFile = () => {
    file = newFile();
    files.push(file);
    hunk = null;
    return file;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const f = startFile();
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
      if (m) {
        f.oldPath = m[1];
        f.newPath = m[2];
      }
      continue;
    }

    // Inside a hunk the header's line counts tell us exactly how many body
    // lines follow, so a removed "-- foo" line is never mistaken for `---`.
    if (hunk && file && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      const c = line === '' ? ' ' : line[0]; // tolerate whitespace-stripped patches
      const text = line.slice(1);
      if (c === '+') {
        hunk.lines.push({ type: 'add', text, oldNo: null, newNo: newNo++ });
        file.additions++;
        newLeft--;
        continue;
      }
      if (c === '-') {
        hunk.lines.push({ type: 'del', text, oldNo: oldNo++, newNo: null });
        file.deletions++;
        oldLeft--;
        continue;
      }
      if (c === ' ') {
        hunk.lines.push({ type: 'context', text, oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        continue;
      }
      oldLeft = newLeft = 0; // malformed hunk; fall through to header parsing
    }
    if (line.startsWith('\\')) continue;

    const h = HUNK_RE.exec(line);
    if (h) {
      const f = file ?? startFile();
      oldNo = Number(h[1]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newNo = Number(h[3]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
      hunk = { header: h[5] ?? '', oldStart: oldNo, newStart: newNo, lines: [] };
      f.hunks.push(hunk);
      continue;
    }

    if (line.startsWith('--- ')) {
      // A plain `diff -u` patch has no `diff --git` line; `---` starts a file.
      const f = file && file.hunks.length === 0 ? file : startFile();
      const p = cleanPath(line.slice(4));
      f.oldPath = p;
      if (p === null) f.status = 'added';
      continue;
    }
    if (line.startsWith('+++ ') && file) {
      const p = cleanPath(line.slice(4));
      file.newPath = p;
      if (p === null) file.status = 'deleted';
      continue;
    }
    if (!file) continue;

    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) { file.status = 'renamed'; file.oldPath = line.slice(12); }
    else if (line.startsWith('rename to ')) { file.status = 'renamed'; file.newPath = line.slice(10); }
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
  }

  for (const f of files) {
    if (f.status === 'added') f.oldPath = null;
    if (f.status === 'deleted') f.newPath = null;
  }
  return files.filter((f) => f.hunks.length > 0 || f.binary || f.status === 'renamed');
}

/** Display name for a file diff, e.g. `src/a.js` or `old.js → new.js`. */
export function displayPath(file) {
  if (file.status === 'renamed' && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? 'unknown';
}
