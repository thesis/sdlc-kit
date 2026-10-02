#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ANCHOR_OPEN = /<linear-comment\b[^>]*>/g;
const ANCHOR_CLOSE = /<\/linear-comment>/g;
const ANCHOR_ATTRS = /<linear-comment\b([^>]*)>/g;
// Linear writes a link target as "(<url>)". The brackets are removed only
// when the URL has no space, because a space in a bare target ends the link.
const WRAPPED_TARGET = /\]\(<([^<>\s]+)>(\s+"[^"\n]*")?\)/g;

// Git holds the frontmatter between "---" lines. Linear stores a "---"
// block of a save as a ```yaml fence, so both forms open a frontmatter.
const DASHES = /^---[ \t]*$/;
const YAML_FENCE = /^```[ \t]*ya?ml[ \t]*$/i;
const FENCE_CLOSE = /^```[ \t]*$/;
const FIELD = /^([a-z][a-z0-9_-]*):(?:[ \t]+(.*?))?[ \t]*$/;
// YAML reads a value with one of these starts, or with ": " or " #" in it,
// as more than plain text. Double quotes around the value make it plain.
const NOT_PLAIN = /^(?:[-?:](?:\s|$)|[,[\]{}#&*!|>'"%@`])|: | #|:$/;
const TITLE_PREFIX = { intent: 'Intent', spec: 'Spec' };

/** The `relates` field of each stage file in git: the other files of its stage directory. */
export const GIT_RELATES = {
  intent: ['spec.md', 'plan.md'],
  spec: ['intent.md', 'plan.md'],
  plan: ['spec.md', 'intent.md'],
};

/** Removes the comment anchors of Linear and keeps the text that they wrap. */
export function stripAnchors(content) {
  return content.replace(ANCHOR_OPEN, '').replace(ANCHOR_CLOSE, '');
}

export function unwrapLinkTargets(content) {
  return content.replace(WRAPPED_TARGET, (_, url, title = '') => `](${url}${title})`);
}

/** The ISO time with no milliseconds, such as 2026-09-29T00:00:00Z. */
export function isoNow(now = new Date()) {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function splitLines(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * Reads the frontmatter at the top of a document. Returns null when the
 * first line that is not blank opens no "---" block and no ```yaml fence.
 * Otherwise returns `form` ("dashes" or "fence"), the 0-based line indexes
 * `start` and `end` of the opening and the closing line, `fields` as
 * {key: {value, index}}, and `errors` as [{index, message}]. A block with
 * no closing line has `end` -1 and no fields. Only flat "key: value" lines
 * with a lowercase key are valid. A valid line still gives its field when
 * another line has an error.
 */
export function readFrontmatter(text) {
  const lines = splitLines(text);
  const start = lines.findIndex((l) => l.trim() !== '');
  if (start < 0) return null;
  const form = DASHES.test(lines[start]) ? 'dashes' : YAML_FENCE.test(lines[start]) ? 'fence' : null;
  if (!form) return null;
  const closes = form === 'dashes' ? (l) => DASHES.test(l) || l === '...' : (l) => FENCE_CLOSE.test(l);
  const end = lines.findIndex((l, i) => i > start && closes(l));
  const result = { form, start, end, fields: {}, errors: [] };
  if (end < 0) {
    result.errors.push({ index: start, message: 'the frontmatter has no closing line' });
    return result;
  }
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() === '') continue;
    const m = lines[i].match(FIELD);
    if (!m) {
      result.errors.push({ index: i, message: 'write each frontmatter line as "key: value", with a lowercase key and no indent' });
      continue;
    }
    const [, key, raw = ''] = m;
    if (key in result.fields) {
      result.errors.push({ index: i, message: `the field "${key}" appears twice` });
      continue;
    }
    const quoted = raw.match(/^"([^"\\]*)"$/);
    if (!quoted && NOT_PLAIN.test(raw)) {
      result.errors.push({ index: i, message: `the value of "${key}" must be plain text on one line; put it in double quotes` });
      continue;
    }
    result.fields[key] = { value: quoted ? quoted[1] : raw, index: i };
  }
  return result;
}

/** The `type` field of the frontmatter in lower case, or null when the content has none. */
export function frontmatterType(content) {
  return readFrontmatter(stripAnchors(content))?.fields.type?.value.toLowerCase() || null;
}

/**
 * Turns the content that get_document returned into the git file of an
 * intent or a spec: the frontmatter between "---" lines with the field
 * `relates` of GIT_RELATES in place of the Linear URLs, then the field
 * `exported: <url> · <time>` last, then the line "# <Type>: <name>", then
 * the body. The name is `title`, the title of the Linear document, with no
 * "Intent:" or "Spec:" prefix. The export removes the comment anchors and
 * the angle brackets of link targets, and replaces an earlier `exported`
 * field. Throws when the content has no valid frontmatter, its type is not
 * intent or spec, or the prefix of the title names the other type.
 */
export function exportDocument(content, { url, title, at = isoNow() }) {
  if (!url) throw new Error('the document URL is missing');
  if (!title?.trim()) throw new Error('the document title is missing');
  if (Number.isNaN(Date.parse(at))) throw new Error(`"${at}" is not an ISO time`);
  const lines = splitLines(unwrapLinkTargets(stripAnchors(content)));
  const fm = readFrontmatter(lines.join('\n'));
  if (!fm) throw new Error('the content has no frontmatter; an intent or a spec in Linear starts with a "---" block or a ```yaml block');
  if (fm.errors.length) throw new Error(`line ${fm.errors[0].index + 1}: ${fm.errors[0].message}`);
  const type = fm.fields.type?.value;
  if (!TITLE_PREFIX[type]) throw new Error(`the frontmatter type is "${type ?? ''}"; only an intent or a spec exports`);
  const named = title.trim().match(/^(intent|spec):\s*(.*)$/i);
  if (named && named[1].toLowerCase() !== type) {
    throw new Error(`the title "${title.trim()}" names a ${named[1].toLowerCase()}, but the frontmatter type is "${type}"`);
  }
  const name = (named ? named[2] : title).trim();
  if (!name) throw new Error(`the title "${title.trim()}" has no name after its prefix`);
  const fields = lines.slice(fm.start + 1, fm.end).filter((l) => l.trim() !== '' && !/^(?:relates|exported):/.test(l));
  const body = lines.slice(fm.end + 1);
  while (body.length && body[0].trim() === '') body.shift();
  return ['---', ...fields, `relates: ${GIT_RELATES[type].join(', ')}`, `exported: ${url} · ${at}`, '---', '', `# ${TITLE_PREFIX[type]}: ${name}`, '', ...body].join('\n');
}

/** Maps the id of each comment anchor in the content to its `resolved` attribute. */
export function anchorStates(content) {
  const states = new Map();
  for (const m of content.matchAll(ANCHOR_ATTRS)) {
    const id = m[1].match(/\bid="([^"]*)"/)?.[1];
    const resolved = m[1].match(/\bresolved="([^"]*)"/)?.[1];
    if (id) states.set(id, resolved === 'true');
  }
  return states;
}

const byTime = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt));

function entry(c) {
  return { author: c.author?.name ?? null, createdAt: c.createdAt, body: c.body };
}

/**
 * Groups the comments that `list_comments` returned into threads, sorted by
 * time. `resolved` comes from `resolvedAt` of the root comment. With
 * `content`, each thread also gets `anchorResolved` from the anchor with the
 * same id, or null when the content has no such anchor. The two values can
 * disagree, so both stay. A reply whose parent is not in the list becomes a
 * thread of its own, with `orphan: true`.
 */
export function threads(input, { content } = {}) {
  const comments = Array.isArray(input) ? input : input?.comments;
  if (!Array.isArray(comments)) throw new Error('the input has no "comments" array');
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c) => {
    const seen = new Set();
    let current = c;
    while (current.parentId) {
      if (seen.has(current.id)) return null;
      seen.add(current.id);
      current = byId.get(current.parentId);
      if (!current) return null;
    }
    return current;
  };
  const anchors = content === undefined ? null : anchorStates(content);
  const result = new Map();
  const thread = (c, orphan) => {
    const t = {
      id: c.id,
      resolved: Boolean(c.resolvedAt),
      inline: c.quotedText != null,
      quotedText: c.quotedText ?? null,
      ...entry(c),
      replies: [],
    };
    if (anchors) t.anchorResolved = anchors.has(c.id) ? anchors.get(c.id) : null;
    if (orphan) {
      t.orphan = true;
      t.parentId = c.parentId;
    }
    return t;
  };
  for (const c of comments) if (!c.parentId) result.set(c.id, thread(c, false));
  for (const c of [...comments].sort(byTime)) {
    if (!c.parentId) continue;
    const root = rootOf(c);
    if (root) result.get(root.id).replies.push(entry(c));
    else result.set(c.id, thread(c, true));
  }
  return [...result.values()].sort(byTime);
}

const USAGE = `usage:
  node linear.mjs export --url <document url> --title <document title> [--at <ISO time>] <content.md>
  node linear.mjs threads [--content <content.md>] <comments.json>`;

function readInput(path) {
  return readFileSync(path, 'utf8');
}

/** Runs the CLI and returns the exit code: 0 done, 1 bad input, 2 usage error. */
export function main(argv, out = process.stdout, err = process.stderr) {
  const [command, ...rest] = argv;
  const options = {};
  const files = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const m = arg.match(/^--(url|title|at|content)(?:=(.*))?$/);
    if (m) options[m[1]] = m[2] ?? rest[++i];
    else if (arg.startsWith('-')) {
      err.write(`unknown option ${arg}\n${USAGE}\n`);
      return 2;
    } else files.push(arg);
  }
  if (!['export', 'threads'].includes(command) || files.length !== 1 || (command === 'export' && (!options.url || !options.title))) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  try {
    if (command === 'export') {
      out.write(`${exportDocument(readInput(files[0]), { url: options.url, title: options.title, at: options.at })}`);
      return 0;
    }
    const input = JSON.parse(readInput(files[0]));
    if (input?.hasNextPage) err.write('the comment list has more pages; list them all before you read the threads\n');
    const content = options.content === undefined ? undefined : readInput(options.content);
    out.write(`${JSON.stringify(threads(input, { content }), null, 2)}\n`);
    return 0;
  } catch (e) {
    err.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
