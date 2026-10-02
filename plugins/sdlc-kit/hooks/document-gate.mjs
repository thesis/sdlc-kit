#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node gives import.meta.url as the real path and argv[1] as the typed path.
// Both sides go through realpath, so a symlink in the plugin path still runs
// the hook.
function isEntry() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isEntry();

// The judge run sets SDLC_KIT_GATE, so a gate inside the judge run exits
// before it loads the lint.
if (isMain && process.env.SDLC_KIT_GATE) process.exit(0);

// Claude Code runs the tool call when a hook fails to start or exits with 1.
// A static import that fails would stop the hook before it can deny, so the
// lint loads here and a load error denies each call.
let lintText;
let isUrlList;
let stripAnchors;
let frontmatterType;
let readFrontmatter;
let lintLoadError = null;
try {
  ({ lintText, isUrlList } = await import('../scripts/lint.mjs'));
  ({ stripAnchors, frontmatterType, readFrontmatter } = await import('../scripts/linear.mjs'));
} catch (e) {
  lintLoadError = e;
}

function requireLint() {
  if (lintLoadError) throw new Error(`the lint did not load: ${lintLoadError.message}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');

export const SAVE_TOOL = /^mcp__.+__save_document$/;
// The gate budget: the time for the whole hook. It stays below the timeout
// in hooks.json, because Claude Code runs the tool call when a hook passes it.
export const GATE_BUDGET_MS = 270_000;
// The gate starts no judge run with less time than this left.
export const JUDGE_FLOOR_MS = 20_000;
export const STAGE_DIR = '.sdlc-kit';

export const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          quote: { type: 'string' },
          rule: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['section', 'quote', 'rule', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'findings'],
  additionalProperties: false,
};

// The stage types that live in Linear. The plan lives only in git, so a
// Linear document of the type `plan` is not a stage document.
const LINEAR_TYPES = ['intent', 'spec'];
const STAGE_PREFIX = /^(intent|spec):/i;
const FILE_TYPES = { 'intent.md': 'intent', 'spec.md': 'spec', 'plan.md': 'plan' };

/**
 * Returns the stage type of a document. With `path`, the file name decides,
 * and every other file is `prose`. Without it, the `type` field of the
 * frontmatter of `content` decides between `intent` and `spec`, and the
 * result is null for every other document.
 */
export function documentType({ content, path } = {}) {
  if (path) return FILE_TYPES[basename(path)] ?? 'prose';
  requireLint();
  const type = frontmatterType(stripBom(content ?? ''));
  return LINEAR_TYPES.includes(type) ? type : null;
}

const article = (type) => (type === 'intent' ? 'an intent' : `a ${type}`);

// The stage type that the title of a save names, or that the first line of
// content in the form before the frontmatter names, such as "# Intent: X".
function namedTypes({ title, content }) {
  const fromTitle = stripBom(title ?? '').trim().match(STAGE_PREFIX)?.[1].toLowerCase() ?? null;
  const firstLine = stripBom(content ?? '').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const fromHeading = firstLine.match(/^\s{0,3}#[ \t]+(intent|spec):/i)?.[1].toLowerCase() ?? null;
  return { fromTitle, fromHeading };
}

export function noFrontmatterReason(name, type) {
  return (
    `document-gate: ${name} is ${article(type)}, but its content has no frontmatter. ` +
    `Start the content with a "---" block that holds "type: ${type}" and the other fields of the ${type} template. Then repeat the call.`
  );
}

export function typeMismatchReason(title, titleType, type) {
  return (
    `document-gate: the title "${title}" names ${article(titleType)}, but the "type" field of the frontmatter is "${type}". ` +
    'Make the title and the "type" field agree. Then repeat the call.'
  );
}

function stripBom(text) {
  return text.replace(/^\uFEFF/, '');
}

const REDIRECTION = /^(?:&>>|&>|<<<|<<-|<<|<>|<&|>&|>>|>\||<|>)/;

// Moves past the bodies of the pending heredocs, which start at `pos`. Each
// body ends at a line equal to its delimiter; `<<-` strips leading tabs first.
function skipHeredocs(command, pos, heredocs) {
  for (const { delimiter, stripTabs } of heredocs.splice(0)) {
    while (pos < command.length) {
      const eol = command.indexOf('\n', pos);
      const line = command.slice(pos, eol < 0 ? command.length : eol);
      pos = eol < 0 ? command.length : eol + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
  return pos;
}

/**
 * Splits shell text into tokens: `{word}` with quotes and backslash escapes
 * resolved, `{op}` for `&&`, `||`, `;`, `|`, `&`, a newline or a parenthesis,
 * and `{sub}` with the body of each `$(...)` or backtick pair, at its place in
 * the text. A substitution adds the text `$SUBST` to its word. A redirection
 * and its target word give no token, and a heredoc body is skipped. With
 * `inSubstitution`, the text is the body of a `$(...)`, and the split stops at
 * its closing parenthesis. Returns the tokens and the index where it stopped.
 */
function shellTokens(command, start = 0, inSubstitution = false) {
  const tokens = [];
  const heredocs = [];
  let word = null;
  let target = null;
  let depth = 0;
  const push = () => {
    if (word === null) return;
    if (target === 'heredoc') heredocs.push({ delimiter: word, stripTabs: false });
    else if (target === 'heredoc-tabs') heredocs.push({ delimiter: word, stripTabs: true });
    else if (target === null) tokens.push({ word });
    target = null;
    word = null;
  };
  const substitution = (at) => {
    const inner = shellTokens(command, at + 2, true);
    tokens.push({ sub: command.slice(at + 2, inner.end) });
    return inner.end;
  };
  const backtick = (at) => {
    let j = at + 1;
    let body = '';
    for (; j < command.length && command[j] !== '`'; j++) {
      if (command[j] === '\\' && command[j + 1] === '`') j++;
      body += command[j];
    }
    tokens.push({ sub: body });
    return j;
  };
  let i = start;
  for (; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end < 0 ? command.length : end;
      word = (word ?? '') + command.slice(i + 1, stop);
      i = stop;
    } else if (ch === '"') {
      let j = i + 1;
      let text = '';
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === '\\' && j + 1 < command.length && '"\\$`\n'.includes(command[j + 1])) {
          j++;
          text += command[j];
        } else if (command[j] === '$' && command[j + 1] === '(') {
          j = substitution(j);
          text += '$SUBST';
        } else if (command[j] === '`') {
          j = backtick(j);
          text += '$SUBST';
        } else text += command[j];
      }
      word = (word ?? '') + text;
      i = j;
    } else if (ch === '\\') {
      if (command[i + 1] !== '\n') word = (word ?? '') + (command[i + 1] ?? '');
      i++;
    } else if (ch === '$' && command[i + 1] === '(') {
      i = substitution(i);
      word = (word ?? '') + '$SUBST';
    } else if (ch === '`') {
      i = backtick(i);
      word = (word ?? '') + '$SUBST';
    } else if (ch === '>' || ch === '<' || (ch === '&' && command[i + 1] === '>')) {
      // Digits right before the operator name a file descriptor, as in 2>&1.
      if (word !== null && /^\d+$/.test(word)) word = null;
      else push();
      const op = command.slice(i).match(REDIRECTION)[0];
      i += op.length - 1;
      target = op === '<<' ? 'heredoc' : op === '<<-' ? 'heredoc-tabs' : 'drop';
    } else if (/\s/.test(ch) && ch !== '\n') {
      push();
    } else if (ch === '\n') {
      push();
      tokens.push({ op: '\n' });
      if (heredocs.length) i = skipHeredocs(command, i + 1, heredocs) - 1;
    } else if (';&|()'.includes(ch)) {
      push();
      if (ch === ')' && inSubstitution && depth === 0) return { tokens, end: i };
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      const two = command.slice(i, i + 2);
      if (two === '&&' || two === '||') {
        tokens.push({ op: two });
        i++;
      } else tokens.push({ op: ch });
    } else if (ch === '#' && word === null) {
      const end = command.indexOf('\n', i);
      i = end < 0 ? command.length : end - 1;
    } else {
      word = (word ?? '') + ch;
    }
  }
  push();
  return { tokens, end: i };
}

// Splits the tokens into simple commands, each with its words and the bodies
// of its substitutions. The items `(` and `)` mark a subshell, so a `cd`
// inside it does not move the commands after it.
function simpleCommands(tokens) {
  const commands = [];
  let current = { words: [], subs: [] };
  const close = () => {
    if (current.words.length || current.subs.length) commands.push(current);
    current = { words: [], subs: [] };
  };
  for (const token of tokens) {
    if (token.op) {
      close();
      if (token.op === '(' || token.op === ')') commands.push(token.op);
    } else if (token.sub !== undefined) current.subs.push(token.sub);
    else current.words.push(token.word);
  }
  close();
  return commands;
}

const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'while', 'until', 'do', 'done', '!', '{', '}']);
// Each prefix command, with its options that take a value and the count of
// its arguments before the program.
const PREFIX_COMMANDS = {
  command: { values: [], args: 0 },
  builtin: { values: [], args: 0 },
  exec: { values: ['-a'], args: 0 },
  nohup: { values: [], args: 0 },
  time: { values: [], args: 0 },
  nice: { values: ['-n'], args: 0 },
  sudo: { values: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U', '-R'], args: 0 },
  timeout: { values: ['-s', '-k'], args: 1 },
  xargs: { values: ['-I', '-n', '-P', '-L', '-s', '-d', '-E', '-a'], args: 0 },
  env: { values: ['-u', '-C', '-S'], args: 0 },
};
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env', '--list-cmds',
]);
const PUSH_OPTIONS_WITH_VALUE = new Set(['--repo', '-o', '--push-option', '--receive-pack', '--exec']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// A word that the shell expands at run time, so the gate cannot know its value.
const isDynamic = (word) => /[$`]/.test(word);

// Drops the words before the program: shell keywords, variable assignments,
// and prefix commands such as `env`, `sudo` or `timeout` with their options.
// Returns the program with its arguments, and the variable assignments.
function programWords(words) {
  const assignments = [];
  let i = 0;
  for (;;) {
    const w = words[i];
    if (w === undefined) break;
    if (SHELL_KEYWORDS.has(w)) {
      i++;
      continue;
    }
    if (ASSIGNMENT.test(w)) {
      assignments.push(w);
      i++;
      continue;
    }
    const prefix = PREFIX_COMMANDS[basename(w)];
    if (!prefix) break;
    i++;
    while (i < words.length && (words[i].startsWith('-') || (basename(w) === 'env' && ASSIGNMENT.test(words[i])))) {
      if (ASSIGNMENT.test(words[i])) assignments.push(words[i]);
      else if (prefix.values.includes(words[i])) i++;
      i++;
    }
    i += prefix.args;
  }
  return { words: words.slice(i), assignments };
}

// The variables that choose the repository of a git command.
const GIT_REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE'];

function expandHome(path) {
  return path.replace(/^~(?=\/|$)/, process.env.HOME ?? '~');
}

function parseGit(words, dir, assignments = []) {
  const global = [];
  const env = {};
  let unresolved;
  for (const a of assignments) {
    const name = a.slice(0, a.indexOf('='));
    const value = a.slice(a.indexOf('=') + 1);
    if (!GIT_REPOSITORY_VARIABLES.includes(name)) continue;
    if (isDynamic(value)) unresolved ??= value;
    env[name] = resolve(dir, expandHome(value));
  }
  let i = 1;
  for (; i < words.length; i++) {
    const w = words[i];
    if (!w.startsWith('-')) break;
    const [name, inline] = w.startsWith('--') && w.includes('=') ? [w.slice(0, w.indexOf('=')), w.slice(w.indexOf('=') + 1)] : [w, null];
    if (!GIT_OPTIONS_WITH_VALUE.has(name)) continue;
    const value = inline ?? words[++i];
    if (value === undefined) return null;
    if ((name === '-C' || name === '--git-dir' || name === '--work-tree') && isDynamic(value)) unresolved ??= value;
    if (name === '-C') dir = resolve(dir, expandHome(value));
    else if (name === '--git-dir' || name === '--work-tree') global.push(`${name}=${resolve(dir, expandHome(value))}`);
    else if (name === '-c') global.push('-c', value);
  }
  if (words[i] !== 'push') return null;
  const push = { dir, global, remote: null, refspecs: [], delete: false, all: false };
  if (Object.keys(env).length) push.env = env;
  for (let j = i + 1; j < words.length; j++) {
    const w = words[j];
    if (w === '--') {
      const rest = words.slice(j + 1);
      if (push.remote === null && rest.length) push.remote = rest.shift();
      push.refspecs.push(...rest);
      break;
    }
    if (w.startsWith('-') && w !== '-') {
      const name = w.startsWith('--') && w.includes('=') ? w.slice(0, w.indexOf('=')) : w;
      if (name === '--delete' || /^-[a-zA-Z]*d[a-zA-Z]*$/.test(w)) push.delete = true;
      if (name === '--all' || name === '--branches' || name === '--mirror') push.all = true;
      if (name === '--repo') push.remote = w.includes('=') ? w.slice(w.indexOf('=') + 1) : words[++j];
      else if (PUSH_OPTIONS_WITH_VALUE.has(name) && !w.includes('=')) j++;
      continue;
    }
    if (push.remote === null) push.remote = w;
    else push.refspecs.push(w);
  }
  unresolved ??= push.refspecs.find(isDynamic);
  if (unresolved !== undefined) push.unresolved = unresolved;
  return push;
}

/**
 * Finds each `git push` in a shell command line and returns one object per
 * push, with `dir` as an absolute path; an empty array means no push. The
 * parser finds a push:
 * - after git global options such as `-C <dir>`, and after `GIT_DIR=` or
 *   `GIT_WORK_TREE=`, which it passes to the git calls of the gate;
 * - in a chain split by `&&`, `||`, `;`, `|`, `&` or a newline, after a shell
 *   keyword such as `then` or `do`, and with redirections such as `2>&1`;
 * - behind prefix commands such as `env`, `sudo`, `timeout` or `xargs`;
 * - inside `$(...)` or backticks, and inside the string of `sh -c` or `eval`.
 * A `cd <dir>` moves the pushes after it in the chain, a substitution
 * included, until the subshell that holds the `cd` closes. A heredoc body is
 * skipped. A push gets `unresolved` when its directory, a refspec or the
 * program word holds `$` or a backtick. The parser does not find a push inside
 * a script, a shell function, a git alias, `env -S`, a heredoc body, or after
 * an `export` of `GIT_DIR`.
 */
export function parsePush(command, cwd = process.cwd()) {
  const pushes = [];
  const saved = [];
  let dir = cwd;
  let dirUnresolved;
  const nested = (text) => parsePush(text, dir).map((p) => withDir(p, dirUnresolved));
  for (const item of simpleCommands(shellTokens(command ?? '').tokens)) {
    if (item === '(') {
      saved.push([dir, dirUnresolved]);
      continue;
    }
    if (item === ')') {
      [dir, dirUnresolved] = saved.pop() ?? [dir, dirUnresolved];
      continue;
    }
    for (const body of item.subs) pushes.push(...nested(body));
    const { words, assignments } = programWords(item.words);
    if (!words.length) continue;
    const program = basename(words[0]);
    if (isDynamic(words[0])) {
      // The shell picks the program at run time, as in `$(which git) push`.
      if (words.includes('push')) pushes.push({ dir, global: [], remote: null, refspecs: [], delete: false, all: false, unresolved: words[0] });
    } else if (program === 'cd') {
      const target = words.slice(1).find((w) => !/^-[LPe@]+$/.test(w));
      if (target === undefined) dir = process.env.HOME ?? dir;
      else if (target === '-' || isDynamic(target)) dirUnresolved = target;
      else dir = resolve(dir, expandHome(target));
    } else if (program === 'eval') {
      pushes.push(...nested(words.slice(1).join(' ')));
    } else if (SHELLS.has(program)) {
      const c = words.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
      if (c > 0 && words[c + 1] !== undefined) pushes.push(...nested(words[c + 1]));
    } else if (program === 'git') {
      const push = parseGit(words, dir, assignments);
      if (push) pushes.push(withDir(push, dirUnresolved));
    }
  }
  return pushes;
}

function withDir(push, dirUnresolved) {
  return dirUnresolved === undefined || push.unresolved !== undefined ? push : { ...push, unresolved: dirUnresolved };
}

function git(push, args, { allowFail = false } = {}) {
  const r = spawnSync('git', [...push.global, ...args], {
    cwd: push.dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...push.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')}: ${r.stderr.trim() || `exit ${r.status}`}`);
  }
  return r.stdout;
}

const gitLine = (push, args) => git(push, args, { allowFail: true })?.trim() || null;

function hasRef(push, ref) {
  return git(push, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true }) !== null;
}

/** Lists the local refs that a push sends. */
function pushedRefs(push) {
  let specs = push.refspecs;
  if (push.all) {
    specs = (git(push, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? '').split('\n').filter(Boolean);
  } else if (!specs.length) {
    specs = ['HEAD'];
  }
  const refs = [];
  for (const spec of specs) {
    const plain = spec.replace(/^\+/, '');
    const src = plain.includes(':') ? plain.slice(0, plain.indexOf(':')) : plain;
    if (!src) continue;
    if (!hasRef(push, src)) throw new Error(`the local ref "${src}" does not exist`);
    refs.push(src);
  }
  return refs;
}

/**
 * Lists the markdown files under `.sdlc-kit/` that a push publishes: each
 * file that the new commits of the push change and that exists at the
 * pushed local ref. A new commit is a commit of the local ref that no
 * remote-tracking ref of any remote holds, so the list depends on the last
 * fetch. A change that a merge commit makes itself counts too. When no
 * remote has a remote-tracking ref, as before a first push to an empty
 * remote, every commit is new, so the list holds every markdown file under
 * `.sdlc-kit/` at the local ref. Each document has `exists(name)`, which
 * tells whether the file `name` is next to it at the pushed ref. Returns
 * null when the directory is not in a git repository.
 */
export function pushedDocuments(push) {
  if (!existsSync(push.dir) || !statSync(push.dir).isDirectory()) return null;
  // One call gives the git dir and the top. It fails outside a work tree,
  // such as in a bare repository, and then the git dir alone decides.
  const both = gitLine(push, ['rev-parse', '--git-dir', '--show-toplevel']);
  if (both === null && gitLine(push, ['rev-parse', '--git-dir']) === null) return null;
  if (push.delete) return [];
  const top = both?.split('\n')[1] ?? null;
  const inTop = top ? { ...push, dir: top } : push;
  const documents = [];
  for (const local of pushedRefs(inTop)) {
    const atLocal = new Set(
      git(inTop, ['ls-tree', '-r', '-z', '--name-only', '--full-tree', local, '--', STAGE_DIR]).split('\0').filter(Boolean),
    );
    for (const path of changedPaths(inTop, local)) {
      if (!atLocal.has(path) || !path.endsWith('.md')) continue;
      documents.push({
        ref: local,
        path,
        text: () => git(inTop, ['show', `${local}:${path}`]),
        exists: (name) => atLocal.has(posix.join(posix.dirname(path), name)),
      });
    }
  }
  return documents;
}

// The paths under `.sdlc-kit/` that the commits of `local` change, in path
// order. The commits are those that no remote-tracking ref holds. With
// --diff-merges=combined a merge commit lists the files that it changes
// itself. With -z and an empty format, git prints a status field, then a
// path field, for each changed file.
function changedPaths(push, local) {
  const args = ['log', '--name-status', '--diff-merges=combined', '--format=', '-z', '--no-renames', local, '--not', '--remotes'];
  const fields = git(push, [...args, '--', STAGE_DIR])
    .split('\0')
    .filter(Boolean);
  const paths = new Set();
  for (let i = 0; i + 1 < fields.length; i += 2) paths.add(fields[i + 1]);
  return [...paths].sort();
}

function readPluginFile(relative) {
  return readFileSync(join(pluginRoot, relative), 'utf8').replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot);
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: text };
  const fields = {};
  for (const line of m[1].split('\n')) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim();
  }
  return { fields, body: m[2] };
}

/**
 * Builds the `--agents` value for the judge run: the agent file of the
 * judge, with the body of the writing skill after it. The one tool is the
 * internal tool that returns the `--json-schema` output. With `tools: []`
 * the run loses that tool and returns the verdict as plain text only.
 */
export function judgeAgents() {
  const agent = splitFrontmatter(readPluginFile('agents/writing-judge.md'));
  const writing = splitFrontmatter(readPluginFile('skills/writing/SKILL.md')).body.trim();
  const rules = writing.startsWith('# Writing rules') ? writing : `# Writing rules\n\n${writing}`;
  return {
    [agent.fields.name]: {
      description: agent.fields.description,
      prompt: `${agent.body.trim()}\n\n${rules}\n`,
      tools: ['StructuredOutput'],
    },
  };
}

export function judgeArgs(env = process.env) {
  const agents = judgeAgents();
  const args = [
    '-p',
    '--agents', JSON.stringify(agents),
    '--agent', Object.keys(agents)[0],
    '--output-format', 'json',
    '--json-schema', JSON.stringify(VERDICT_SCHEMA),
    '--tools', '',
    '--max-turns', '2',
    '--no-session-persistence',
    '--setting-sources', '',
    '--strict-mcp-config',
    '--max-budget-usd', '2',
  ];
  if (env.SDLC_KIT_JUDGE_MODEL) args.push('--model', env.SDLC_KIT_JUDGE_MODEL);
  return args;
}

function validVerdict(v) {
  return (
    v && typeof v === 'object' && ['PASS', 'FAIL'].includes(v.verdict) && Array.isArray(v.findings) &&
    v.findings.every((f) => f && ['section', 'quote', 'rule', 'message'].every((k) => typeof f[k] === 'string'))
  );
}

/** Runs the judge on one document. Returns the verdict, or throws with the reason. */
export function runJudge(text, type, { env = process.env, timeoutMs = GATE_BUDGET_MS } = {}) {
  const bin = env.SDLC_KIT_CLAUDE_BIN || 'claude';
  const r = spawnSync(bin, judgeArgs(env), {
    cwd: tmpdir(),
    input: `Document type: ${type}\n\n<document>\n${text}\n</document>\n`,
    encoding: 'utf8',
    env: { ...env, SDLC_KIT_GATE: '1' },
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.error?.code === 'ETIMEDOUT') {
    throw new Error(`the judge gave no verdict in the time that the gate had left (${Math.max(1, Math.round(timeoutMs / 1000))} s)`);
  }
  if (r.error) throw new Error(`the judge did not start: ${r.error.message}`);
  let result = null;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    // The checks below report the output that is not JSON.
  }
  const detail = result
    ? [result.subtype, result.api_error_status, result.result].filter(Boolean).join(' ')
    : (r.stderr || r.stdout || '').trim();
  const short = detail.replace(/\s+/g, ' ').slice(0, 300);
  if (r.status !== 0) throw new Error(`the judge stopped with exit code ${r.status ?? r.signal}${short ? ` (${short})` : ''}`);
  if (!result) throw new Error(`the judge output is not JSON (${short})`);
  if (result.is_error) throw new Error(`the judge run failed (${short})`);
  const verdict = result.structured_output;
  if (!validVerdict(verdict)) throw new Error('the judge output has no valid verdict');
  return { ...verdict, costUsd: result.total_cost_usd };
}

const REPEAT_SAVE = 'Fix the named lines. Then repeat the call.';
const REPEAT_JUDGE = 'Fix each finding. Then repeat the call.';

/**
 * Gates one document: the lint first, then the judge. The gate removes the
 * comment anchors of Linear first, so the judge reads the text without them.
 * A lint finding denies with no judge run. A judge verdict with a finding, or with a FAIL, denies.
 * Every error of the judge run denies too. The judge run gets the time left
 * until `deadline`, and with less than `floorMs` left the gate denies with no
 * judge run. `form` is the form of the lint: "linear" for a save, "git"
 * for a file of a push. `exists` goes to the lint, for the files of the
 * `relates` field. Returns the decision, the reason of a denial, the stage
 * that decided and the cost of the judge run.
 */
export function gate(text, { type, form, name, exists, env = process.env, deadline = Date.now() + GATE_BUDGET_MS, floorMs = JUDGE_FLOOR_MS } = {}) {
  requireLint();
  text = stripAnchors(stripBom(text));
  const findings = lintText(text, { type, form, path: name, exists });
  if (findings.length) {
    const lines = findings.map((f) => `${f.path}:${f.line}: ${f.rule}: ${f.message}`);
    return { decision: 'deny', stage: 'lint', reason: `document-gate: the lint found these lines in ${name}:\n${lines.join('\n')}\n${REPEAT_SAVE}` };
  }
  const left = deadline - Date.now();
  if (left < floorMs) return { decision: 'deny', stage: 'judge', reason: outOfTimeReason(name) };
  let verdict;
  try {
    verdict = runJudge(text, type, { env, timeoutMs: left });
  } catch (e) {
    return { decision: 'deny', stage: 'judge', reason: `document-gate: the writing judge gave no verdict for ${name}: ${e.message}. Repeat the call.` };
  }
  if (verdict.verdict === 'PASS' && !verdict.findings.length) return { decision: 'allow', stage: 'judge', costUsd: verdict.costUsd };
  const lines = verdict.findings.map((f) => `${f.section}: "${f.quote}": ${f.rule}: ${f.message}`);
  const list = lines.length ? `\n${lines.join('\n')}` : ' the verdict is FAIL with no findings.';
  return { decision: 'deny', stage: 'judge', costUsd: verdict.costUsd, reason: `document-gate: the writing judge failed ${name}:${list}\n${REPEAT_JUDGE}` };
}

export function outOfTimeReason(name) {
  return `document-gate: the gate ran out of time before it judged ${name}. Push fewer changed documents at a time. When only one document changed, repeat the call.`;
}

export function unresolvedReason(word) {
  return `document-gate: the gate cannot read the value "${word}" in this push, because the shell sets it at run time. Repeat the push with a literal value in its place.`;
}

export function missingDirReason(dir) {
  return `document-gate: the directory ${dir} of this push does not exist. Repeat the push with the literal path of the repository.`;
}

export const PATCH_REASON =
  'document-gate: a patch save may only change frontmatter fields. Each op is a "replace" of one "key: value" line with a line of the same key, ' +
  'or an "insert_before" or "insert_after" of one "key: value" line at a "key: value" line. The key is type, owner or relates. ' +
  'The type is intent or spec, and relates is a comma list of URLs. ' +
  'For any other edit, repeat the save with the full document in the content field and no patch field.';

// The fields of the Linear frontmatter, which a frontmatter patch may write.
// `exported` is a field of the git file only.
const PATCH_KEYS = ['type', 'owner', 'relates'];

// The key and the value of `text` when it is one frontmatter line, else null.
function fieldLine(text) {
  if (typeof text !== 'string' || text.includes('\n')) return null;
  const field = Object.entries(readFrontmatter(`---\n${text}\n---\n`)?.fields ?? {});
  return field.length === 1 ? { key: field[0][0], value: field[0][1].value } : null;
}

function validNewField(line) {
  if (!line || !PATCH_KEYS.includes(line.key) || !line.value) return false;
  if (line.key === 'type') return LINEAR_TYPES.includes(line.value);
  if (line.key === 'relates') return isUrlList(line.value);
  return true;
}

/**
 * Whether a patch only replaces or inserts frontmatter lines, so that the
 * gate can allow it with no lint of the body and no judge run. The gate
 * cannot read the document, so it checks the text of each op: an anchor or
 * an old line must be one "key: value" line, and each new line must be one
 * line of a key in PATCH_KEYS with a valid value. A "replace" keeps the key.
 */
export function isFrontmatterPatch(patch) {
  if (!Array.isArray(patch) || !patch.length) return false;
  return patch.every((op) => {
    if (op?.op === 'replace') {
      const before = fieldLine(op.old_string);
      const after = fieldLine(op.new_string);
      return !op.replace_all && before !== null && after !== null && before.key === after.key && validNewField(after);
    }
    if (op?.op === 'insert_after' || op?.op === 'insert_before') {
      const text = typeof op.text === 'string' ? op.text : '';
      const line = op.op === 'insert_after' ? text.match(/^\n([^\n]*)$/)?.[1] : text.match(/^([^\n]*)\n$/)?.[1];
      return fieldLine(op.anchor) !== null && validNewField(fieldLine(line));
    }
    return false;
  });
}

/**
 * Decides one PreToolUse call. Returns {decision, reason, documents}, where
 * `documents` lists the name and the decision of each gated document.
 */
export function decide(input, { env = process.env, deadline = Date.now() + GATE_BUDGET_MS, floorMs = JUDGE_FLOOR_MS } = {}) {
  const tool = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};
  const limits = { env, deadline, floorMs };
  if (SAVE_TOOL.test(tool)) {
    // The gate cannot read the document that a patch produces, or its type.
    // A patch of frontmatter fields only needs no lint and no judge run.
    if (toolInput.patch !== undefined) {
      const name = toolInput.title ?? toolInput.id;
      requireLint();
      if (toolInput.content === undefined && isFrontmatterPatch(toolInput.patch)) return { decision: 'allow', documents: [{ name, decision: 'allow' }] };
      return { decision: 'deny', reason: PATCH_REASON, documents: [{ name, decision: 'deny' }] };
    }
    if (typeof toolInput.content !== 'string') return { decision: 'allow', documents: [] };
    const name = toolInput.title ?? toolInput.id ?? 'the document';
    const denied = (reason) => ({ decision: 'deny', reason, documents: [{ name, decision: 'deny' }] });
    requireLint();
    const declared = frontmatterType(stripBom(toolInput.content));
    const { fromTitle, fromHeading } = namedTypes(toolInput);
    if (!declared && (fromTitle || fromHeading)) return denied(noFrontmatterReason(name, fromTitle ?? fromHeading));
    if (declared && fromTitle && declared !== fromTitle) return denied(typeMismatchReason(toolInput.title.trim(), fromTitle, declared));
    const type = documentType({ content: toolInput.content });
    if (type === null) return { decision: 'allow', documents: [{ name, decision: 'allow' }] };
    const result = gate(toolInput.content, { type, form: 'linear', name, ...limits });
    return { ...result, documents: [{ name, decision: result.decision }] };
  }
  if (tool === 'Bash') {
    const documents = [];
    for (const push of parsePush(toolInput.command, input.cwd ?? process.cwd())) {
      if (push.unresolved !== undefined) {
        return { decision: 'deny', reason: unresolvedReason(push.unresolved), documents: [{ name: push.unresolved, decision: 'deny' }] };
      }
      if (!existsSync(push.dir) || !statSync(push.dir).isDirectory()) {
        return { decision: 'deny', reason: missingDirReason(push.dir), documents: [{ name: push.dir, decision: 'deny' }] };
      }
      const pushed = pushedDocuments(push);
      if (pushed === null) continue;
      for (const doc of pushed) {
        const result = gate(doc.text(), { type: documentType({ path: doc.path }), form: 'git', name: doc.path, exists: doc.exists, ...limits });
        documents.push({ name: doc.path, decision: result.decision });
        if (result.decision === 'deny') return { ...result, documents };
      }
    }
    return { decision: 'allow', documents };
  }
  return { decision: 'allow', documents: [] };
}

export function denyOutput(reason) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function log(env, tool, documents, ms) {
  if (!env.SDLC_KIT_GATE_LOG) return;
  const lines = documents.map((d) => `${new Date().toISOString()} ${tool} ${d.name} ${d.decision} ${ms}ms\n`);
  if (lines.length) appendFileSync(env.SDLC_KIT_GATE_LOG, lines.join(''));
}

async function main() {
  const started = Date.now();
  let tool = 'unknown';
  let out = null;
  try {
    let raw = '';
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw);
    tool = input.tool_name ?? tool;
    const result = decide(input, { deadline: started + GATE_BUDGET_MS });
    log(process.env, tool, result.documents, Date.now() - started);
    if (result.decision === 'deny') out = denyOutput(result.reason);
  } catch (e) {
    log(process.env, tool, [{ name: '-', decision: 'deny' }], Date.now() - started);
    out = denyOutput(`document-gate: the gate failed: ${e.message}. Repeat the call.`);
  }
  if (out) process.stdout.write(`${out}\n`);
}

if (isMain) await main();
