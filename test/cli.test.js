import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'diffshot.js');
const FIXTURE = join(ROOT, 'test', 'fixtures', 'server.patch');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Run the CLI. stdin is closed (/dev/null) unless `input` is given. */
function run(args, { cwd = ROOT, input, encoding = 'utf8' } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    input,
    encoding,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

let tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'diffshot-test-'));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test('--stdout writes a PNG', () => {
  const r = run(['-i', FIXTURE, '--stdout', '-s', '1'], { encoding: 'buffer' });
  assert.equal(r.status, 0, r.stderr?.toString());
  assert.ok(r.stdout.length > 1000);
  assert.deepEqual(r.stdout.subarray(0, 8), PNG_MAGIC);
});

test('-o file.svg writes an SVG', () => {
  const out = join(tmp, 'x.svg');
  const r = run(['-i', FIXTURE, '-o', out, '--no-embed-font', '--title', 'Hello']);
  assert.equal(r.status, 0, r.stderr);
  const svg = readFileSync(out, 'utf8');
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('>Hello</text>'));
  assert.doesNotMatch(svg, /@font-face/);
  assert.match(r.stderr, /x\.svg\s+\(1 file, \+\d+ −\d+\)/);
});

test('-o file.png writes a PNG', () => {
  const out = join(tmp, 'x.png');
  const r = run(['-i', FIXTURE, '-o', out, '-s', '1']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(out).subarray(0, 8), PNG_MAGIC);
});

test('unsupported output format exits 1', () => {
  const out = join(tmp, 'x.gif');
  const r = run(['-i', FIXTURE, '-o', out]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unsupported output format "\.gif"/);
  assert.ok(!existsSync(out));
});

test('unknown option and bad numbers exit 1 with a message', () => {
  const r = run(['--bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--help/);
  const r2 = run(['-i', FIXTURE, '--stdout', '--font-size', 'abc']);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /--font-size must be a number/);
});

test('unknown theme exits 1 with a message', () => {
  const r = run(['-i', FIXTURE, '-o', join(tmp, 't.svg'), '-t', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown theme "nope"/);
});

test('--help', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^diffshot /);
  assert.match(r.stdout, /Usage/);
  assert.match(r.stdout, /--list-themes/);
});

test('--version', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), PKG.version);
  assert.equal(run(['-v']).stdout.trim(), PKG.version);
});

test('--list-themes and --list-backgrounds', () => {
  const r = run(['--list-themes']);
  assert.equal(r.status, 0);
  const themes = r.stdout.trim().split('\n');
  assert.ok(themes.includes('tokyo-night'));
  assert.ok(themes.includes('github-light'));
  const b = run(['--list-backgrounds']);
  assert.equal(b.status, 0);
  assert.match(b.stdout, /^aurora\s+#7f5af0 → #2cb67d$/m);
});

test('reads the diff from piped stdin', () => {
  const input = readFileSync(FIXTURE, 'utf8');
  const out = join(tmp, 'stdin.svg');
  const r = run(['-o', out, '--no-embed-font'], { input, cwd: tmp });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(out, 'utf8'), /server\.ts/);

  const r2 = run(['-i', '-', '--stdout', '-s', '1'], { input: Buffer.from(input), encoding: 'buffer' });
  assert.equal(r2.status, 0, r2.stderr?.toString());
  assert.deepEqual(r2.stdout.subarray(0, 8), PNG_MAGIC);
});

test('inside a git repository', async (t) => {
  const repo = join(tmp, 'repo');
  const g = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' });
  writeFileSync(join(repo, 'hello.js'), 'console.log("hello");\n');
  g('add', 'hello.js');
  g('commit', '-q', '-m', 'Add hello script');
  writeFileSync(join(repo, 'hello.js'), 'console.log("hello");\nconsole.log("world");\n');
  g('add', 'hello.js');
  g('commit', '-q', '-m', 'Say world & more <stuff>');
  writeFileSync(join(repo, 'hello.js'), 'console.log("hello, wonderful");\nconsole.log("world");\n');

  await t.test('no args renders working-tree changes', () => {
    const r = run([], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readFileSync(join(repo, 'diffshot.png')).subarray(0, 8), PNG_MAGIC);
    rmSync(join(repo, 'diffshot.png'));

    const s = run(['-o', 'wt.svg', '--no-embed-font'], { cwd: repo });
    assert.equal(s.status, 0, s.stderr);
    const svg = readFileSync(join(repo, 'wt.svg'), 'utf8');
    assert.ok(svg.includes('wonderful'));
    assert.match(s.stderr, /\(1 file, \+1 −1\)/);
  });

  await t.test('-c HEAD uses the commit subject as title', () => {
    const out = join(tmp, 'head.svg');
    const r = run(['-c', 'HEAD', '-o', out, '--no-embed-font'], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const svg = readFileSync(out, 'utf8');
    assert.match(svg, /text-anchor="middle"[^>]*>Say world &amp; more &lt;stuff&gt;<\/text>/);
    assert.ok(svg.includes('world'));
    assert.ok(!svg.includes('wonderful'), 'commit diff excludes working-tree changes');
    assert.match(r.stderr, /\(1 file, \+1 −0\)/);
  });

  await t.test('--title overrides the commit subject', () => {
    const out = join(tmp, 'head2.svg');
    const r = run(['-c', 'HEAD', '--title', 'Custom', '-o', out, '--no-embed-font'], { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const svg = readFileSync(out, 'utf8');
    assert.ok(svg.includes('>Custom</text>'));
    assert.ok(!svg.includes('Say world'));
  });

  await t.test('clean tree reports no changes; staged-only changes are picked up', () => {
    g('checkout', '--', 'hello.js');
    const r = run(['-o', join(tmp, 'clean.svg')], { cwd: repo });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No changes to render/);

    writeFileSync(join(repo, 'hello.js'), 'console.log("staged");\n');
    g('add', 'hello.js');
    const s = run(['-o', join(tmp, 'staged.svg'), '--no-embed-font'], { cwd: repo });
    assert.equal(s.status, 0, s.stderr);
    assert.ok(readFileSync(join(tmp, 'staged.svg'), 'utf8').includes('staged'));
  });

  await t.test('git failure outside a repository exits 1', () => {
    const outside = mkdtempSync(join(tmpdir(), 'diffshot-norepo-'));
    try {
      const r = spawnSync(process.execPath, [BIN, '-c', 'HEAD', '-o', 'x.svg'], {
        cwd: outside,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 30_000,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() },
      });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /git show .* failed/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
