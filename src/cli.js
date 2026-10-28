import { parseArgs } from 'node:util';
import { execFileSync, spawnSync } from 'node:child_process';
import { fstatSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { parseDiff } from './parse.js';
import { renderSvg, BACKGROUNDS } from './render.js';
import { THEMES } from './highlight.js';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const HELP = `diffshot ${VERSION} — turn git diffs into beautiful, shareable images

Usage
  diffshot [options] [<git diff args>...] [-- <paths>...]
  git diff | diffshot [options]

Input (default: working tree changes, falling back to staged changes)
  -c, --commit <rev>       Render a single commit (title defaults to its subject)
      --staged             Render staged changes
  -i, --input <file>       Read a patch file ("-" for stdin)
  -U, --context <n>        Lines of context around changes (git only, default 3)

Output
  -o, --output <file>      Output path, .png or .svg (default: diffshot.png)
      --stdout             Write the image to stdout instead of a file
      --copy               Also copy the PNG to the clipboard
  -s, --scale <n>          PNG pixel density (default: 2)

Style
  -t, --theme <name>       Syntax theme (default: tokyo-night)
  -b, --background <bg>    Preset, color, "c1,c2[,c3]" gradient, or "none" (default: aurora)
  -p, --padding <px>       Space around the window (default: 56)
      --title <text>       Window title
      --font-size <px>     Font size (default: 14)
      --max-cols <n>       Truncate lines longer than this (default: 100)
      --max-lines <n>      Stop after this many diff lines (default: 300)
      --no-line-numbers    Hide line numbers
      --no-chrome          Hide the window title bar
      --no-word-diff       Don't highlight changed words within lines
      --no-hunk-headers    Hide @@ hunk separators
      --no-file-headers    Hide per-file headers
      --no-embed-font      Don't embed the font in SVG output (smaller files)

Other
      --list-themes        List available syntax themes
      --list-backgrounds   List background presets
  -h, --help               Show this help
  -v, --version            Show version

Examples
  diffshot                               # current changes -> diffshot.png
  diffshot -c HEAD -o release.png        # last commit
  diffshot main...feature -- src/        # branch diff, limited to src/
  git diff | diffshot -t github-light -b peach -o diff.svg
`;

const OPTIONS = {
  commit: { type: 'string', short: 'c' },
  staged: { type: 'boolean' },
  input: { type: 'string', short: 'i' },
  context: { type: 'string', short: 'U' },
  output: { type: 'string', short: 'o' },
  stdout: { type: 'boolean' },
  copy: { type: 'boolean' },
  scale: { type: 'string', short: 's' },
  theme: { type: 'string', short: 't' },
  background: { type: 'string', short: 'b' },
  padding: { type: 'string', short: 'p' },
  title: { type: 'string' },
  'font-size': { type: 'string' },
  'max-cols': { type: 'string' },
  'max-lines': { type: 'string' },
  'no-line-numbers': { type: 'boolean' },
  'no-chrome': { type: 'boolean' },
  'no-word-diff': { type: 'boolean' },
  'no-hunk-headers': { type: 'boolean' },
  'no-file-headers': { type: 'boolean' },
  'no-embed-font': { type: 'boolean' },
  'list-themes': { type: 'boolean' },
  'list-backgrounds': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

class UsageError extends Error {}

function num(value, name, { min = 0 } = {}) {
  if (value === undefined) return undefined;
  const v = Number(value);
  if (!Number.isFinite(v) || v < min) throw new UsageError(`--${name} must be a number >= ${min}`);
  return v;
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err.stderr?.toString().trim() || err.message;
    throw new UsageError(`git ${args.join(' ')} failed:\n${msg}`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Read piped stdin if there is any. An open-but-silent pipe (CI runners, editors,
 * agents) must not hang us, so give up if nothing arrives within `waitMs`.
 */
async function readPipedStdin(waitMs = 1500) {
  let stat;
  try {
    stat = fstatSync(0);
  } catch {
    return '';
  }
  if (stat.isFile()) return readStdin();
  // Windows pipes don't report as FIFOs, so anything that isn't a terminal counts.
  if (process.stdin.isTTY) return '';
  return new Promise((resolveText) => {
    const chunks = [];
    const timer = setTimeout(() => {
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      process.stdin.unref?.();
      resolveText('');
    }, waitMs);
    process.stdin.on('data', (c) => {
      clearTimeout(timer);
      chunks.push(c);
    });
    process.stdin.once('end', () => {
      clearTimeout(timer);
      resolveText(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

/** Figure out where the diff comes from and fetch it. Returns { text, title }. */
async function loadDiff(values, gitArgs, paths) {
  if (values.input) {
    return { text: values.input === '-' ? await readStdin() : readFileSync(values.input, 'utf8') };
  }
  const usingGit = values.commit || values.staged || gitArgs.length || paths.length;
  if (!usingGit && !process.stdin.isTTY) {
    const text = await readPipedStdin();
    if (text.trim()) return { text };
  }

  const common = ['--no-color', '--no-ext-diff', `-U${values.context ?? 3}`];
  const pathspec = paths.length ? ['--', ...paths] : [];
  if (values.commit) {
    const text = git(['show', '--format=', ...common, values.commit, ...gitArgs, ...pathspec]);
    const subject = git(['show', '-s', '--format=%s', values.commit]).trim();
    return { text, title: subject };
  }
  if (values.staged) return { text: git(['diff', '--staged', ...common, ...gitArgs, ...pathspec]) };
  const text = git(['diff', ...common, ...gitArgs, ...pathspec]);
  if (text.trim() || gitArgs.length) return { text };
  return { text: git(['diff', '--staged', ...common, ...pathspec]) };
}

function copyToClipboard(file) {
  const attempts =
    process.platform === 'darwin'
      ? [['osascript', ['-e', `set the clipboard to (read (POSIX file "${file}") as «class PNGf»)`]]]
      : process.platform === 'win32'
        ? [['powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::SetImage([Drawing.Image]::FromFile('${file}'))`]]]
        : [
            ['wl-copy', ['--type', 'image/png'], file],
            ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i', file]],
          ];
  for (const [cmd, args, stdinFile] of attempts) {
    const r = spawnSync(cmd, args, { input: stdinFile ? readFileSync(stdinFile) : undefined, stdio: ['pipe', 'ignore', 'ignore'] });
    if (r.status === 0) return true;
  }
  return false;
}

export async function main(argv) {
  const dd = argv.indexOf('--');
  const paths = dd === -1 ? [] : argv.slice(dd + 1);
  const own = dd === -1 ? argv : argv.slice(0, dd);

  let parsed;
  try {
    parsed = parseArgs({ args: own, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(`${err.message}\nRun \`diffshot --help\` for usage.`);
  }
  const { values, positionals } = parsed;

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) return void console.log(VERSION);
  if (values['list-themes']) return void console.log(THEMES.join('\n'));
  if (values['list-backgrounds']) {
    return void console.log(Object.entries(BACKGROUNDS).map(([k, v]) => `${k.padEnd(10)} ${v.join(' → ')}`).join('\n'));
  }

  const output = values.output ?? 'diffshot.png';
  const format = values.stdout && !values.output ? 'png' : extname(output).slice(1).toLowerCase();
  if (format !== 'png' && format !== 'svg') throw new UsageError(`Unsupported output format ".${format}" (use .png or .svg)`);

  const { text, title } = await loadDiff(values, positionals, paths);
  const files = parseDiff(text);
  if (files.length === 0) throw new UsageError('No changes to render.');

  const svg = await renderSvg(files, {
    theme: values.theme,
    background: values.background,
    padding: num(values.padding, 'padding'),
    title: values.title ?? title,
    fontSize: num(values['font-size'], 'font-size', { min: 6 }),
    maxCols: num(values['max-cols'], 'max-cols', { min: 10 }),
    maxLines: num(values['max-lines'], 'max-lines', { min: 1 }),
    lineNumbers: !values['no-line-numbers'],
    chrome: !values['no-chrome'],
    wordDiff: !values['no-word-diff'],
    hunkHeaders: !values['no-hunk-headers'],
    fileHeaders: !values['no-file-headers'],
    embedFont: format === 'svg' && !values['no-embed-font'],
  });

  let data = svg;
  if (format === 'png') {
    const { svgToPng } = await import('./png.js');
    data = await svgToPng(svg, { scale: num(values.scale, 'scale', { min: 0.1 }) ?? 2 });
  }

  if (values.stdout) {
    process.stdout.write(data);
    return;
  }
  writeFileSync(output, data);
  const adds = files.reduce((s, f) => s + f.additions, 0);
  const dels = files.reduce((s, f) => s + f.deletions, 0);
  let msg = `✨ ${output}  (${files.length} file${files.length === 1 ? '' : 's'}, +${adds} −${dels})`;
  if (values.copy) {
    if (format !== 'png') msg += '\n   --copy only works with PNG output';
    else msg += copyToClipboard(resolve(output)) ? '\n📋 copied to clipboard' : '\n   could not copy (install wl-copy or xclip)';
  }
  console.error(msg);
}

export { UsageError };
