import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, displayPath } from '../src/parse.js';

const multi = `diff --git a/src/a.js b/src/a.js
index 1111111..2222222 100644
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 export { a, b };
diff --git a/src/new.js b/src/new.js
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,2 @@
+export const x = 1;
+export const y = 2;
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
diff --git a/before.js b/after.js
similarity index 100%
rename from before.js
rename to after.js
diff --git a/lib/x.js b/lib/y.js
similarity index 80%
rename from lib/x.js
rename to lib/y.js
index 5555555..6666666 100644
--- a/lib/x.js
+++ b/lib/y.js
@@ -10,2 +10,2 @@ function f() {
 keep();
-old();
+fresh();
diff --git a/img.png b/img.png
index 7777777..8888888 100644
Binary files a/img.png and b/img.png differ
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..9999999
Binary files /dev/null and b/logo.png differ
`;

test('parses a multi-file git diff', () => {
  const files = parseDiff(multi);
  assert.equal(files.length, 7);
  assert.deepEqual(
    files.map((f) => [f.status, f.oldPath, f.newPath, f.binary]),
    [
      ['modified', 'src/a.js', 'src/a.js', false],
      ['added', null, 'src/new.js', false],
      ['deleted', 'old.txt', null, false],
      ['renamed', 'before.js', 'after.js', false],
      ['renamed', 'lib/x.js', 'lib/y.js', false],
      ['modified', 'img.png', 'img.png', true],
      ['added', null, 'logo.png', true],
    ],
  );
});

test('modified file: line numbering and counts', () => {
  const [f] = parseDiff(multi);
  assert.equal(f.additions, 1);
  assert.equal(f.deletions, 1);
  assert.equal(f.hunks.length, 1);
  assert.deepEqual(f.hunks[0].lines, [
    { type: 'context', text: 'const a = 1;', oldNo: 1, newNo: 1 },
    { type: 'del', text: 'const b = 2;', oldNo: 2, newNo: null },
    { type: 'add', text: 'const b = 3;', oldNo: null, newNo: 2 },
    { type: 'context', text: 'export { a, b };', oldNo: 3, newNo: 3 },
  ]);
});

test('added and deleted files', () => {
  const files = parseDiff(multi);
  const added = files[1];
  assert.equal(added.additions, 2);
  assert.equal(added.deletions, 0);
  assert.deepEqual(added.hunks[0].lines.map((l) => [l.oldNo, l.newNo]), [[null, 1], [null, 2]]);
  const deleted = files[2];
  assert.equal(deleted.additions, 0);
  assert.equal(deleted.deletions, 2);
  assert.deepEqual(deleted.hunks[0].lines.map((l) => [l.oldNo, l.newNo]), [[1, null], [2, null]]);
});

test('renames with and without content changes', () => {
  const files = parseDiff(multi);
  const pure = files[3];
  assert.equal(pure.hunks.length, 0);
  assert.equal(displayPath(pure), 'before.js → after.js');
  const changed = files[4];
  assert.equal(changed.hunks.length, 1);
  assert.equal(changed.hunks[0].header, 'function f() {');
  assert.equal(changed.hunks[0].oldStart, 10);
  assert.equal(changed.hunks[0].newStart, 10);
  assert.equal(changed.additions, 1);
  assert.equal(changed.deletions, 1);
  assert.equal(displayPath(changed), 'lib/x.js → lib/y.js');
  assert.deepEqual(changed.hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo]), [
    ['context', 10, 10],
    ['del', 11, null],
    ['add', null, 11],
  ]);
});

test('displayPath for non-renames', () => {
  const files = parseDiff(multi);
  assert.equal(displayPath(files[0]), 'src/a.js');
  assert.equal(displayPath(files[1]), 'src/new.js');
  assert.equal(displayPath(files[2]), 'old.txt');
  assert.equal(displayPath({ status: 'modified', oldPath: null, newPath: null }), 'unknown');
});

test('plain diff -u output with timestamps', () => {
  const text = [
    '--- foo.txt\t2024-01-01 10:00:00.000000000 +0100',
    '+++ foo.txt\t2024-01-02 11:00:00.000000000 +0100',
    '@@ -1,2 +1,2 @@',
    ' hello',
    '-world',
    '+there',
    '--- bar.c\t2024-01-01 10:00:00',
    '+++ bar.c\t2024-01-02 10:00:00',
    '@@ -5 +5 @@',
    '-int x;',
    '+int y;',
    '',
  ].join('\n');
  const files = parseDiff(text);
  assert.equal(files.length, 2);
  assert.equal(files[0].oldPath, 'foo.txt');
  assert.equal(files[0].newPath, 'foo.txt');
  assert.equal(files[0].status, 'modified');
  assert.equal(files[0].additions, 1);
  assert.equal(files[0].deletions, 1);
  assert.equal(files[1].oldPath, 'bar.c');
  assert.equal(files[1].newPath, 'bar.c');
  assert.deepEqual(files[1].hunks[0].lines.map((l) => [l.type, l.oldNo, l.newNo]), [
    ['del', 5, null],
    ['add', null, 5],
  ]);
});

test('hunk headers without counts', () => {
  const text = `diff --git a/v b/v
--- a/v
+++ b/v
@@ -1 +1 @@
-1.0.0
+1.0.1
`;
  const [f] = parseDiff(text);
  assert.equal(f.hunks.length, 1);
  assert.equal(f.hunks[0].header, '');
  assert.deepEqual(f.hunks[0].lines, [
    { type: 'del', text: '1.0.0', oldNo: 1, newNo: null },
    { type: 'add', text: '1.0.1', oldNo: null, newNo: 1 },
  ]);
});

test('removed line starting with "-- " is a deletion, not a file header', () => {
  const text = `diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,3 +1,2 @@
 SELECT 1;
--- foo
+++ bar
 SELECT 2;
`;
  const files = parseDiff(text);
  assert.equal(files.length, 1);
  const [f] = files;
  assert.equal(f.oldPath, 'q.sql');
  assert.equal(f.newPath, 'q.sql');
  assert.equal(f.deletions, 1);
  assert.equal(f.additions, 1);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.type, l.text, l.oldNo, l.newNo]), [
    ['context', 'SELECT 1;', 1, 1],
    ['del', '-- foo', 2, null],
    ['add', '++ bar', null, 2],
    ['context', 'SELECT 2;', 3, 3],
  ]);
});

test('"\\ No newline at end of file" is ignored', () => {
  const text = `diff --git a/n b/n
--- a/n
+++ b/n
@@ -1,2 +1,2 @@
 a
-b
\\ No newline at end of file
+c
\\ No newline at end of file
`;
  const [f] = parseDiff(text);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.type, l.text]), [
    ['context', 'a'],
    ['del', 'b'],
    ['add', 'c'],
  ]);
  assert.equal(f.additions, 1);
  assert.equal(f.deletions, 1);
});

test('CRLF input', () => {
  const text = multi.split('\n').join('\r\n');
  const files = parseDiff(text);
  assert.equal(files.length, 7);
  assert.equal(files[0].newPath, 'src/a.js');
  assert.equal(files[0].hunks[0].lines[1].text, 'const b = 2;');
  for (const f of files) {
    for (const h of f.hunks) for (const l of h.lines) assert.ok(!l.text.includes('\r'));
  }
});

test('multiple hunks keep independent numbering', () => {
  const text = `diff --git a/m b/m
--- a/m
+++ b/m
@@ -1,2 +1,3 @@
 a
+inserted
 b
@@ -20,3 +21,2 @@ section
 x
-y
 z
`;
  const [f] = parseDiff(text);
  assert.equal(f.hunks.length, 2);
  assert.deepEqual(f.hunks[0].lines.map((l) => [l.oldNo, l.newNo]), [[1, 1], [null, 2], [2, 3]]);
  assert.deepEqual(f.hunks[1].lines.map((l) => [l.oldNo, l.newNo]), [[20, 21], [21, null], [22, 22]]);
  assert.equal(f.hunks[1].header, 'section');
  assert.equal(f.additions, 1);
  assert.equal(f.deletions, 1);
});

test('empty input yields no files', () => {
  assert.deepEqual(parseDiff(''), []);
  assert.deepEqual(parseDiff('not a diff\n'), []);
});
