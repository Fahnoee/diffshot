import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundledLanguages } from 'shiki';
import { detectLanguage, THEMES } from '../src/highlight.js';

test('detectLanguage for common extensions', () => {
  const cases = {
    'src/app.js': ['javascript', 'js'],
    'src/app.mjs': ['javascript'],
    'src/app.ts': ['typescript', 'ts'],
    'main.py': ['python', 'py'],
    'lib.rs': ['rust'],
    'main.go': ['go'],
    'config.yml': ['yaml'],
    'package.json': ['json'],
    'run.sh': ['shellscript'],
    'x.h': ['c'],
    'x.cpp': ['cpp'],
    'index.html': ['html'],
    'README.md': ['markdown', 'md'],
  };
  for (const [path, expected] of Object.entries(cases)) {
    const lang = detectLanguage(path);
    assert.ok(expected.includes(lang), `${path} -> ${lang}`);
    assert.ok(lang in bundledLanguages, `${lang} is a shiki language`);
  }
});

test('detectLanguage is case-insensitive on extension', () => {
  assert.equal(detectLanguage('FOO.RS'), 'rust');
});

test('detectLanguage for special file names', () => {
  assert.equal(detectLanguage('Dockerfile'), 'docker');
  assert.equal(detectLanguage('deploy/Dockerfile'), 'docker');
  assert.equal(detectLanguage('Dockerfile.dev'), 'docker');
  assert.equal(detectLanguage('Makefile'), 'make');
  assert.equal(detectLanguage('sub/dir/GNUmakefile'), 'make');
});

test('detectLanguage falls back to text', () => {
  assert.equal(detectLanguage('file.unknownext'), 'text');
  assert.equal(detectLanguage('LICENSE'), 'text');
  assert.equal(detectLanguage(''), 'text');
  assert.equal(detectLanguage(null), 'text');
  assert.equal(detectLanguage(undefined), 'text');
});

test('THEMES lists bundled themes', () => {
  assert.ok(THEMES.includes('tokyo-night'));
  assert.ok(THEMES.includes('github-light'));
});
