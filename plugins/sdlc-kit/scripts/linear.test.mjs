import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportDocument, threads, isoNow } from './linear.mjs';
import { lintText } from './lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const linearScript = join(here, 'linear.mjs');

const URL = 'https://linear.app/thesis/document/intent-weekly-export-1a2b';
const AT = '2026-09-29T00:00:00Z';
const ROOT_A = '0f1e2d3c-0000-4000-8000-00000000000a';
const ROOT_B = '0f1e2d3c-0000-4000-8000-00000000000b';

// The shape that get_document returns: anchors on the same line as the text
// that they wrap, and link targets in angle brackets.
const INTENT = `# Intent: Weekly export of vault deposits
Owner: Ana Nowak · Status: agreed
Linear: ${URL}

## 1. Executive summary
- The finance team gets a <linear-comment id="${ROOT_A}" resolved="true">weekly report</linear-comment> of the deposits.
- We ask for a decision on the first report date.

## 2. Problem
The analyst does a manual count every Monday. <linear-comment id="${ROOT_B}" resolved="false">The count takes four hours. </linear-comment>The [explorer](<https://explorer.example.org/vaults>) is the source.

## 3. Proposed outcome
The finance team gets the report every Monday at 09:00 UTC.

## 4. Not in scope now
Withdrawals are not in scope.

## 5. Affected users and systems
The finance team reads the report.

## 6. Constraints
The report is ready before 10:00 UTC on Monday.

## 7. Open problems
None.
`;

const SPEC = `# Spec: Weekly export of vault deposits
Implements: Intent ${URL} · Owner: Ana Nowak · Status: agreed

## 1. Terms
One term.
`;

const comment = (fields) => ({
  body: 'A comment.',
  attachments: [],
  updatedAt: fields.createdAt,
  parentId: null,
  resolvedAt: null,
  quotedText: null,
  author: { id: 'u1', name: 'Reviewer' },
  onBehalfOf: null,
  ...fields,
});

// The shape that list_comments returns: roots and replies interleaved.
const COMMENTS = {
  comments: [
    comment({ id: 'r2', parentId: ROOT_A, createdAt: '2026-09-14T15:00:00.000Z', body: 'Second reply.', author: { id: 'u2', name: 'Owner' } }),
    comment({ id: ROOT_B, createdAt: '2026-09-14T14:00:00.000Z', quotedText: 'The count takes four hours. ', body: 'Source?' }),
    comment({ id: 'top', createdAt: '2026-09-14T16:00:00.000Z', body: 'A thread with no anchor.', resolvedAt: '2026-09-15T08:00:00.000Z' }),
    comment({ id: 'r1', parentId: ROOT_A, createdAt: '2026-09-14T14:30:00.000Z', body: 'First reply.' }),
    comment({ id: ROOT_A, createdAt: '2026-09-14T13:45:47.514Z', quotedText: 'weekly report', body: '@Owner Which format?' }),
    comment({ id: 'lost', parentId: 'deleted-root', createdAt: '2026-09-14T17:00:00.000Z', body: 'A reply to a deleted thread.' }),
  ],
  hasNextPage: false,
};

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sdlc-kit-linear-'));
}

describe('export', () => {
  const exported = exportDocument(INTENT, { url: URL, at: AT });

  test('the anchors go and the text that they wrap stays', () => {
    assert.ok(!exported.includes('linear-comment'));
    assert.ok(exported.includes('gets a weekly report of the deposits.'));
    assert.ok(exported.includes('The count takes four hours. The [explorer]'));
  });

  test('a link target in angle brackets loses the brackets', () => {
    assert.ok(exported.includes('[explorer](https://explorer.example.org/vaults)'));
  });

  test('a link target with a space keeps the brackets', () => {
    const text = INTENT.replace('(<https://explorer.example.org/vaults>)', '(<a b.md>)');
    assert.ok(exportDocument(text, { url: URL, at: AT }).includes('[explorer](<a b.md>)'));
  });

  test('the Exported line follows the Linear line of an intent', () => {
    const lines = exported.split('\n');
    assert.equal(lines[2], `Linear: ${URL}`);
    assert.equal(lines[3], `Exported: ${URL} · ${AT}`);
  });

  test('the Exported line follows the Implements line of a spec', () => {
    assert.deepEqual(exportDocument(SPEC, { url: URL, at: AT }).split('\n').slice(1, 3), [
      `Implements: Intent ${URL} · Owner: Ana Nowak · Status: agreed`,
      `Exported: ${URL} · ${AT}`,
    ]);
  });

  test('a second export replaces the Exported line', () => {
    const again = exportDocument(exported, { url: URL, at: '2026-10-01T12:00:00Z' });
    assert.deepEqual(again.split('\n').filter((l) => l.startsWith('Exported:')), [`Exported: ${URL} · 2026-10-01T12:00:00Z`]);
  });

  test('the exported intent passes the lint', () => {
    assert.deepEqual(lintText(exported, { type: 'intent' }), []);
  });

  test('the time defaults to now, with no milliseconds', () => {
    assert.match(exportDocument(INTENT, { url: URL }), /^Exported: \S+ · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    assert.equal(isoNow(new Date('2026-09-29T10:11:12.345Z')), '2026-09-29T10:11:12Z');
  });

  for (const [name, text, message] of [
    ['a plan', '# Plan: X\nImplements: spec.md @ 1a2b\n', /is not "# Intent/],
    ['an intent with no Linear line', '# Intent: X\nOwner: A · Status: agreed\n\n## 1. Executive summary\n', /no "Linear:" line/],
  ]) {
    test(`the export of ${name} throws`, () => {
      assert.throws(() => exportDocument(text, { url: URL, at: AT }), message);
    });
  }

  test('a time that is not an ISO time throws', () => {
    assert.throws(() => exportDocument(INTENT, { url: URL, at: 'soon' }), /not an ISO time/);
  });
});

describe('threads', () => {
  const list = threads(COMMENTS);

  test('the roots come sorted by time, each with its fields', () => {
    assert.deepEqual(list.map((t) => t.id), [ROOT_A, ROOT_B, 'top', 'lost']);
    assert.deepEqual(list[0], {
      id: ROOT_A,
      resolved: false,
      inline: true,
      quotedText: 'weekly report',
      author: 'Reviewer',
      createdAt: '2026-09-14T13:45:47.514Z',
      body: '@Owner Which format?',
      replies: [
        { author: 'Reviewer', createdAt: '2026-09-14T14:30:00.000Z', body: 'First reply.' },
        { author: 'Owner', createdAt: '2026-09-14T15:00:00.000Z', body: 'Second reply.' },
      ],
    });
  });

  test('a thread with resolvedAt is resolved', () => {
    assert.equal(list.find((t) => t.id === 'top').resolved, true);
  });

  test('a thread with no quoted text is not inline', () => {
    assert.equal(list.find((t) => t.id === 'top').inline, false);
  });

  test('a reply whose parent is not in the list is an orphan thread', () => {
    const lost = list.find((t) => t.id === 'lost');
    assert.equal(lost.orphan, true);
    assert.equal(lost.parentId, 'deleted-root');
    assert.deepEqual(lost.replies, []);
  });

  test('a bare array works as the input', () => {
    assert.deepEqual(threads(COMMENTS.comments), list);
  });

  test('with the content, each thread reports the anchor state next to resolvedAt', () => {
    const withAnchors = threads(COMMENTS, { content: INTENT });
    assert.deepEqual(
      withAnchors.map((t) => [t.id, t.resolved, t.anchorResolved]),
      [
        [ROOT_A, false, true],
        [ROOT_B, false, false],
        ['top', true, null],
        ['lost', false, null],
      ],
    );
  });

  test('without the content, no thread has an anchor state', () => {
    assert.ok(list.every((t) => !('anchorResolved' in t)));
  });

  test('an input with no comments array throws', () => {
    assert.throws(() => threads({ nodes: [] }), /no "comments" array/);
  });
});

describe('cli', () => {
  const dir = tempDir();
  const content = join(dir, 'content.md');
  const comments = join(dir, 'comments.json');
  writeFileSync(content, INTENT);
  writeFileSync(comments, JSON.stringify(COMMENTS));
  const run = (...args) => spawnSync(process.execPath, [linearScript, ...args], { encoding: 'utf8' });

  test('export prints the exported document', () => {
    const r = run('export', '--url', URL, '--at', AT, content);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, exportDocument(INTENT, { url: URL, at: AT }));
  });

  test('threads prints the threads as JSON', () => {
    const r = run('threads', '--content', content, comments);
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), threads(COMMENTS, { content: INTENT }));
  });

  test('threads warns when the list has more pages', () => {
    const more = join(dir, 'more.json');
    writeFileSync(more, JSON.stringify({ ...COMMENTS, hasNextPage: true }));
    const r = run('threads', more);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /more pages/);
  });

  test('export with no URL exits with 2', () => {
    assert.equal(run('export', content).status, 2);
  });

  test('an unknown command exits with 2', () => {
    assert.equal(run('import', content).status, 2);
  });

  test('a document that the export cannot read exits with 1', () => {
    const plan = join(dir, 'plan.md');
    writeFileSync(plan, '# Plan: X\n');
    const r = run('export', '--url', URL, plan);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is not "# Intent/);
  });
});
