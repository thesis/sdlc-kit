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
const HEADER_FIELD = { Intent: 'Linear:', Spec: 'Implements:' };

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

/**
 * Turns the content that the Linear MCP returned into the exported file:
 * no comment anchors, plain link targets, and the line
 * `Exported: <url> · <time>` after the `Linear:` line of an intent or the
 * `Implements:` line of a spec. An earlier `Exported:` line is replaced.
 * Throws when the document is not an intent or a spec, or has no such line.
 */
export function exportDocument(content, { url, at = isoNow() }) {
  if (!url) throw new Error('the document URL is missing');
  if (Number.isNaN(Date.parse(at))) throw new Error(`"${at}" is not an ISO time`);
  const lines = unwrapLinkTargets(stripAnchors(content.replace(/\r\n?/g, '\n'))).split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const title = lines[first]?.match(/^#\s+(Intent|Spec):\s/);
  if (!title) throw new Error('the first line is not "# Intent: <name>" or "# Spec: <name>"');
  const field = HEADER_FIELD[title[1]];
  const headerEnd = () => {
    const end = lines.findIndex((l, i) => i > first && /^##\s/.test(l));
    return end < 0 ? lines.length : end;
  };
  const old = lines.findIndex((l, i) => i > first && i < headerEnd() && /^\s*Exported:/.test(l));
  if (old >= 0) lines.splice(old, 1);
  const fieldLine = lines.findIndex((l, i) => i > first && i < headerEnd() && l.trimStart().startsWith(field));
  if (fieldLine < 0) throw new Error(`the header has no "${field}" line`);
  lines.splice(fieldLine + 1, 0, `Exported: ${url} · ${at}`);
  return lines.join('\n');
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
  node linear.mjs export --url <document url> [--at <ISO time>] <content.md>
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
    const m = arg.match(/^--(url|at|content)(?:=(.*))?$/);
    if (m) options[m[1]] = m[2] ?? rest[++i];
    else if (arg.startsWith('-')) {
      err.write(`unknown option ${arg}\n${USAGE}\n`);
      return 2;
    } else files.push(arg);
  }
  if (!['export', 'threads'].includes(command) || files.length !== 1 || (command === 'export' && !options.url)) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  try {
    if (command === 'export') {
      out.write(`${exportDocument(readInput(files[0]), { url: options.url, at: options.at })}`);
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
