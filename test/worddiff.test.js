import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff, annotateWordDiffs } from '../src/worddiff.js';

const slice = (s, ranges) => ranges.map(([a, b]) => s.slice(a, b));

test('small edit points at the changed token', () => {
  const a = 'const PORT = 3000;';
  const b = 'const PORT = 4000;';
  const d = wordDiff(a, b);
  assert.ok(d);
  assert.deepEqual(slice(a, d.a), ['3000']);
  assert.deepEqual(slice(b, d.b), ['4000']);
});

test('insertion only marks the new side', () => {
  const a = 'foo(a, b);';
  const b = 'foo(a, b, c);';
  const d = wordDiff(a, b);
  assert.ok(d);
  assert.deepEqual(d.a, []);
  assert.equal(slice(b, d.b).join(''), ', c');
});

test('adjacent changed tokens are merged into one range', () => {
  const a = 'return user.name;';
  const b = 'return account.id;';
  const d = wordDiff(a, b);
  assert.ok(d);
  for (const ranges of [d.a, d.b]) {
    for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] > ranges[i - 1][1]);
  }
  assert.deepEqual(slice(a, d.a), ['user', 'name']);
  assert.deepEqual(slice(b, d.b), ['account', 'id']);
});

test('identical lines produce empty ranges', () => {
  assert.deepEqual(wordDiff('same line', 'same line'), { a: [], b: [] });
});

test('totally different lines return null', () => {
  assert.equal(wordDiff('hello world', 'goodbye moon'), null);
  assert.equal(wordDiff('import fs from "fs";', 'x += 42 * y'), null);
});

test('annotateWordDiffs pairs del/add runs', () => {
  const lines = [
    { type: 'context', text: 'keep', oldNo: 1, newNo: 1 },
    { type: 'del', text: 'let a = 1;', oldNo: 2, newNo: null },
    { type: 'del', text: 'let b = 2;', oldNo: 3, newNo: null },
    { type: 'add', text: 'let a = 10;', oldNo: null, newNo: 2 },
    { type: 'add', text: 'let b = 20;', oldNo: null, newNo: 3 },
    { type: 'add', text: 'let c = 30;', oldNo: null, newNo: 4 },
    { type: 'context', text: 'keep', oldNo: 4, newNo: 5 },
    { type: 'del', text: 'completely unrelated text', oldNo: 5, newNo: null },
    { type: 'add', text: '{ "x": [1, 2] }', oldNo: null, newNo: 6 },
  ];
  annotateWordDiffs(lines);
  assert.equal(lines[0].changes, undefined);
  assert.deepEqual(slice(lines[1].text, lines[1].changes), ['1']);
  assert.deepEqual(slice(lines[3].text, lines[3].changes), ['10']);
  assert.deepEqual(slice(lines[2].text, lines[2].changes), ['2']);
  assert.deepEqual(slice(lines[4].text, lines[4].changes), ['20']);
  assert.equal(lines[5].changes, undefined, 'unpaired add gets no ranges');
  assert.equal(lines[7].changes, undefined, 'dissimilar pair gets no ranges');
  assert.equal(lines[8].changes, undefined);
});

test('annotateWordDiffs ignores add runs not preceded by deletions', () => {
  const lines = [
    { type: 'add', text: 'let a = 1;', oldNo: null, newNo: 1 },
    { type: 'del', text: 'let a = 2;', oldNo: 1, newNo: null },
  ];
  annotateWordDiffs(lines);
  assert.equal(lines[0].changes, undefined);
  assert.equal(lines[1].changes, undefined);
});
