import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exportDocument, frontmatterType, isoNow, readFrontmatter, threads } from './linear.mjs';
import { lintText } from './lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const linearScript = join(here, 'linear.mjs');

const URL = 'https://linear.app/thesis/document/intent-weekly-export-1a2b';
const AT = '2026-09-29T00:00:00Z';
const ROOT_A = '0f1e2d3c-0000-4000-8000-00000000000a';
const ROOT_B = '0f1e2d3c-0000-4000-8000-00000000000b';

const TITLE = 'Intent: Weekly export of vault deposits';

// The shape that get_document returns: the frontmatter as a \`\`\`yaml fence,
// anchors on the same line as the text that they wrap, and link targets in
// angle brackets.
const INTENT = `\`\`\`yaml
type: intent
owner: Ana Nowak
status: approved
relates: https://linear.app/thesis/document/spec-1, https://github.com/thesis/vault/pull/7
\`\`\`

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

// The content that Linear stored and returned for a save whose content
// started with a "---" block.
const STORED_SPEC = `\`\`\`yaml
type: spec
owner: Łukasz Zimnoch
status: review
relates: https://linear.app/thesis-co/document/example-1234abcd
\`\`\`

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

describe('readFrontmatter', () => {
  test('the stored form of Linear gives each field with its line', () => {
    assert.deepEqual(readFrontmatter(STORED_SPEC), {
      form: 'fence',
      start: 0,
      end: 5,
      fields: {
        type: { value: 'spec', index: 1 },
        owner: { value: 'Łukasz Zimnoch', index: 2 },
        status: { value: 'review', index: 3 },
        relates: { value: 'https://linear.app/thesis-co/document/example-1234abcd', index: 4 },
      },
      errors: [],
    });
  });

  test('a "---" block gives the same fields', () => {
    const dashes = STORED_SPEC.replace(/^```yaml$/m, '---').replace(/^```$/m, '---');
    assert.deepEqual(readFrontmatter(dashes), { ...readFrontmatter(STORED_SPEC), form: 'dashes' });
  });

  for (const [name, text] of [
    ['a title line first', '# Intent: X\n```yaml\ntype: intent\n```\n'],
    ['a code fence of another language', '```js\ntype: intent\n```\n'],
    ['no text', ''],
  ]) {
    test(`a text with ${name} has no frontmatter`, () => {
      assert.equal(readFrontmatter(text), null);
    });
  }

  test('a block with no closing line has an error and no fields', () => {
    assert.deepEqual(readFrontmatter('```yaml\ntype: intent\n'), {
      form: 'fence',
      start: 0,
      end: -1,
      fields: {},
      errors: [{ index: 0, message: 'the frontmatter has no closing line' }],
    });
  });

  test('a line that is not valid gives an error, and the other fields stay', () => {
    const fm = readFrontmatter('---\ntype: intent\nowner: [Ana]\n---\n');
    assert.deepEqual(fm.fields, { type: { value: 'intent', index: 1 } });
    assert.deepEqual(fm.errors.map((e) => e.index), [2]);
  });

  for (const [name, text, expected] of [
    ['the stored form of Linear', STORED_SPEC, 'spec'],
    ['a type in upper case', '---\ntype: Intent\n---\n', 'intent'],
    ['an anchor around the type', '```yaml\ntype: <linear-comment id="a" resolved="false">intent</linear-comment>\n```\n', 'intent'],
    ['no type field', '---\nowner: Ana\n---\n', null],
    ['no frontmatter', '# Intent: X\n', null],
  ]) {
    test(`frontmatterType of ${name} is ${expected}`, () => {
      assert.equal(frontmatterType(text), expected);
    });
  }
});

describe('export', () => {
  const exported = exportDocument(INTENT, { url: URL, title: TITLE, at: AT });

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
    assert.ok(exportDocument(text, { url: URL, title: TITLE, at: AT }).includes('[explorer](<a b.md>)'));
  });

  test('the frontmatter goes between "---" lines with relative links in relates and the exported field last, then the title line', () => {
    assert.deepEqual(exported.split('\n').slice(0, 11), [
      '---',
      'type: intent',
      'owner: Ana Nowak',
      'status: approved',
      'relates: spec.md, plan.md',
      `exported: ${URL} · ${AT}`,
      '---',
      '',
      '# Intent: Weekly export of vault deposits',
      '',
      '## 1. Executive summary',
    ]);
  });

  test('the stored spec of Linear exports with its fields in order and the relative links of a spec', () => {
    assert.equal(
      exportDocument(STORED_SPEC, { url: URL, title: 'Spec: Weekly export', at: AT }),
      [
        '---',
        'type: spec',
        'owner: Łukasz Zimnoch',
        'status: review',
        'relates: intent.md, plan.md',
        `exported: ${URL} · ${AT}`,
        '---',
        '',
        '# Spec: Weekly export',
        '',
        '## 1. Terms',
        'One term.',
        '',
      ].join('\n'),
    );
  });

  test('a title with no prefix is the name', () => {
    assert.match(exportDocument(INTENT, { url: URL, title: 'Weekly export', at: AT }), /^# Intent: Weekly export$/m);
  });

  test('a second export replaces the exported field', () => {
    const again = exportDocument(exported, { url: URL, title: TITLE, at: '2026-10-01T12:00:00Z' });
    assert.deepEqual(again.split('\n').filter((l) => l.startsWith('exported:')), [`exported: ${URL} · 2026-10-01T12:00:00Z`]);
  });

  test('the exported intent passes the lint of the git form', () => {
    assert.deepEqual(lintText(exported, { type: 'intent', form: 'git' }), []);
  });

  test('the time defaults to now, with no milliseconds', () => {
    assert.match(exportDocument(INTENT, { url: URL, title: TITLE }), /^exported: \S+ · \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
    assert.equal(isoNow(new Date('2026-09-29T10:11:12.345Z')), '2026-09-29T10:11:12Z');
  });

  for (const [name, text, title, message] of [
    ['a document of the old form', `# Intent: X\nOwner: A · Status: approved\nLinear: ${URL}\n`, TITLE, /no frontmatter/],
    ['a plan', '---\ntype: plan\nrelates: spec.md, intent.md\n---\n', 'Plan: X', /type is "plan"; only an intent or a spec exports/],
    ['a frontmatter with an error', '```yaml\ntype: intent\nowner: [A]\n```\n', TITLE, /^Error: line 3: the value of "owner"/],
    ['a title of the other type', INTENT, 'Spec: Weekly export', /names a spec, but the frontmatter type is "intent"/],
    ['a title with no name', INTENT, 'Intent:', /has no name/],
    ['no title', INTENT, undefined, /title is missing/],
  ]) {
    test(`the export of ${name} throws`, () => {
      assert.throws(() => exportDocument(text, { url: URL, title, at: AT }), message);
    });
  }

  test('a time that is not an ISO time throws', () => {
    assert.throws(() => exportDocument(INTENT, { url: URL, title: TITLE, at: 'soon' }), /not an ISO time/);
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
    const r = run('export', '--url', URL, '--title', TITLE, '--at', AT, content);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, exportDocument(INTENT, { url: URL, title: TITLE, at: AT }));
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
    assert.equal(run('export', '--title', TITLE, content).status, 2);
  });

  test('export with no title exits with 2', () => {
    assert.equal(run('export', '--url', URL, content).status, 2);
  });

  test('an unknown command exits with 2', () => {
    assert.equal(run('import', content).status, 2);
  });

  test('a document that the export cannot read exits with 1', () => {
    const plan = join(dir, 'plan.md');
    writeFileSync(plan, '# Plan: X\n');
    const r = run('export', '--url', URL, '--title', 'Plan: X', plan);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no frontmatter/);
  });
});
