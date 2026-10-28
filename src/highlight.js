import { createHighlighter, bundledLanguages, bundledThemes } from 'shiki';

/**
 * @typedef {{ content: string, color?: string, fontStyle?: number }} Token
 */

const EXT_ALIASES = {
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  h: 'c', hh: 'cpp', hpp: 'cpp', hxx: 'cpp', cc: 'cpp', cxx: 'cpp',
  kt: 'kotlin', kts: 'kotlin', gradle: 'groovy', pyi: 'python', pyw: 'python',
  zsh: 'shellscript', bash: 'shellscript', sh: 'shellscript', fish: 'fish',
  yml: 'yaml', htm: 'html', svg: 'xml', plist: 'xml', csproj: 'xml',
  jsonc: 'jsonc', json5: 'json5', lock: 'json', tf: 'hcl', mdx: 'mdx',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', rs: 'rust', go: 'go',
};

const FILENAME_LANGS = {
  dockerfile: 'docker', containerfile: 'docker', makefile: 'make', gnumakefile: 'make',
  cmakelists: 'cmake', 'cmakelists.txt': 'cmake', gemfile: 'ruby', rakefile: 'ruby',
  justfile: 'just', '.bashrc': 'shellscript', '.zshrc': 'shellscript', '.gitignore': 'text',
  'flake.lock': 'json', 'cargo.lock': 'toml',
};

/**
 * Guess a Shiki language id from a file path.
 * @param {string | null} path
 * @returns {string}
 */
export function detectLanguage(path) {
  if (!path) return 'text';
  const base = path.split('/').pop().toLowerCase();
  if (FILENAME_LANGS[base]) return FILENAME_LANGS[base];
  if (base.startsWith('dockerfile')) return 'docker';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 && !base.startsWith('.')) return 'text';
  const ext = base.slice(dot + 1);
  const lang = EXT_ALIASES[ext] ?? ext;
  return lang in bundledLanguages ? lang : 'text';
}

export const THEMES = Object.keys(bundledThemes);

/** @type {Map<string, Promise<import('shiki').Highlighter>>} */
const cache = new Map();

/** @param {string} theme */
async function getHighlighter(theme) {
  if (!(theme in bundledThemes)) {
    throw new Error(`Unknown theme "${theme}". Run \`diffshot --list-themes\` to see all themes.`);
  }
  if (!cache.has(theme)) cache.set(theme, createHighlighter({ themes: [theme], langs: [] }));
  return cache.get(theme);
}

/**
 * Info about a theme: background, foreground and whether it is dark.
 * @param {string} theme
 */
export async function themeInfo(theme) {
  const hl = await getHighlighter(theme);
  const t = hl.getTheme(theme);
  const colors = t.colors ?? {};
  return {
    bg: t.bg,
    fg: t.fg,
    dark: t.type !== 'light',
    lineNumber: colors['editorLineNumber.foreground'],
    border: colors['editorGroup.border'] ?? colors['panel.border'],
  };
}

/**
 * Highlight a block of lines (joined with "\n") and return one token list per line.
 *
 * @param {string[]} lines
 * @param {string} lang
 * @param {string} theme
 * @returns {Promise<Token[][]>}
 */
export async function highlightLines(lines, lang, theme) {
  if (lines.length === 0) return [];
  const hl = await getHighlighter(theme);
  if (lang !== 'text' && !hl.getLoadedLanguages().includes(lang)) {
    try {
      await hl.loadLanguage(lang);
    } catch {
      lang = 'text';
    }
  }
  const { tokens } = hl.codeToTokens(lines.join('\n'), { lang, theme });
  // Shiki may drop trailing empty lines; pad so indices always line up.
  while (tokens.length < lines.length) tokens.push([]);
  return tokens.map((line) => line.map((t) => ({ content: t.content, color: t.color, fontStyle: t.fontStyle })));
}
