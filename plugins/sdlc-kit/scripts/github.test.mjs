import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePullRequestUrl, reply, unresolvedThreads } from './github.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const githubScript = join(here, 'github.mjs');

const PR = 'https://github.com/thesis/sdlc-kit/pull/7';

// The fake gh writes its arguments to FAKE_GH_LOG, one JSON array per call.
// It answers a mutation with the "mutation" entry of FAKE_GH_ANSWERS, and a
// query with the entry for its "after" cursor, or "first" with no cursor.
// With FAKE_GH_FAIL set, it prints that text to stderr and exits 1. With
// FAKE_GH_HANG set, it gives no answer for 30 seconds.
const FAKE_GH = `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + '\\n');
if (process.env.FAKE_GH_FAIL) {
  process.stderr.write(process.env.FAKE_GH_FAIL + '\\n');
  process.exit(1);
}
if (process.env.FAKE_GH_HANG) {
  setTimeout(() => {}, 30_000);
  return;
}
const answers = JSON.parse(process.env.FAKE_GH_ANSWERS || '{}');
const query = args[args.indexOf('-f') + 1];
const after = args.find((a) => a.startsWith('after='));
const key = query.startsWith('query=mutation') ? 'mutation' : after ? after.slice('after='.length) : 'first';
process.stdout.write(JSON.stringify(answers[key] ?? {}));
`;

function fakeGh(answers = {}, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-kit-github-'));
  const bin = join(dir, 'gh.cjs');
  writeFileSync(bin, FAKE_GH, { mode: 0o755 });
  const log = join(dir, 'calls.log');
  const env = { ...process.env, SDLC_KIT_GH_BIN: bin, FAKE_GH_LOG: log, FAKE_GH_ANSWERS: JSON.stringify(answers), ...extra };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { dir, env, calls };
}

const comment = (id, createdAt, body = 'A comment.') => ({ id, author: { login: 'reviewer' }, createdAt, body, url: `${PR}#discussion_${id}` });

const thread = (id, { resolved = false, createdAt, path = '.sdlc-kit/2026-09-export/plan.md' }) => ({
  id,
  isResolved: resolved,
  isOutdated: false,
  path,
  line: 12,
  comments: { nodes: [comment(`${id}-c1`, createdAt), comment(`${id}-c2`, '2026-09-30T12:00:00Z', 'A reply.')] },
});

const page = (nodes, next) => ({
  data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: Boolean(next), endCursor: next ?? null }, nodes } } } },
});

// Two pages, each with one resolved thread. The open threads are out of time
// order across the pages.
const TWO_PAGES = {
  first: page(
    [thread('T3', { createdAt: '2026-09-30T10:00:00Z' }), thread('T1', { resolved: true, createdAt: '2026-09-30T08:00:00Z' })],
    'CURSOR1',
  ),
  CURSOR1: page([thread('T2', { resolved: true, createdAt: '2026-09-30T07:00:00Z' }), thread('T4', { createdAt: '2026-09-30T09:00:00Z' })]),
};

function run(args, env) {
  return spawnSync(process.execPath, [githubScript, ...args], { encoding: 'utf8', env });
}

describe('parsePullRequestUrl', () => {
  test('a pull request URL gives the owner, the repository and the number', () => {
    assert.deepEqual(parsePullRequestUrl(PR), { owner: 'thesis', repo: 'sdlc-kit', number: 7 });
  });

  for (const url of [`${PR}/`, `${PR}/files`, `${PR}#discussion_r1`, `${PR}/files#diff-1`]) {
    test(`the URL ${url} gives the same parts`, () => {
      assert.deepEqual(parsePullRequestUrl(url), { owner: 'thesis', repo: 'sdlc-kit', number: 7 });
    });
  }

  for (const [label, url] of [
    ['another host', 'https://gitlab.com/thesis/sdlc-kit/pull/7'],
    ['an issue URL', 'https://github.com/thesis/sdlc-kit/issues/7'],
    ['a commit URL', 'https://github.com/thesis/sdlc-kit/commit/7aeb589'],
    ['a URL with no number', 'https://github.com/thesis/sdlc-kit/pull/'],
    ['a URL with a word in place of the number', 'https://github.com/thesis/sdlc-kit/pull/latest'],
    ['plain http', 'http://github.com/thesis/sdlc-kit/pull/7'],
    ['a repository name of only dots', 'https://github.com/thesis/../pull/7'],
    ['a URL with a query string', `${PR}?diff=split`],
  ]) {
    test(`${label} throws`, () => {
      assert.throws(() => parsePullRequestUrl(url), /is not the URL of a GitHub pull request/);
    });
  }
});

describe('unresolvedThreads', () => {
  test('the result drops the resolved thread of each page', () => {
    const { env } = fakeGh(TWO_PAGES);
    assert.deepEqual(
      unresolvedThreads(PR, { env }).map((t) => t.id),
      ['T4', 'T3'],
    );
  });

  test('the second page asks for the cursor of the first page', () => {
    const { env, calls } = fakeGh(TWO_PAGES);
    unresolvedThreads(PR, { env });
    const [first, second] = calls();
    assert.equal(calls().length, 2);
    assert.ok(!first.some((a) => a.startsWith('after=')));
    assert.ok(second.includes('after=CURSOR1'));
  });

  test('the result is sorted by the time of the first comment of each thread', () => {
    const { env } = fakeGh(TWO_PAGES);
    const result = unresolvedThreads(PR, { env });
    assert.deepEqual(
      result.map((t) => t.comments[0].createdAt),
      ['2026-09-30T09:00:00Z', '2026-09-30T10:00:00Z'],
    );
  });

  test('each thread has the fields of the result and the login of each author', () => {
    const { env } = fakeGh(TWO_PAGES);
    assert.deepEqual(unresolvedThreads(PR, { env })[0], {
      id: 'T4',
      path: '.sdlc-kit/2026-09-export/plan.md',
      line: 12,
      outdated: false,
      comments: [
        { id: 'T4-c1', author: 'reviewer', createdAt: '2026-09-30T09:00:00Z', body: 'A comment.', url: `${PR}#discussion_T4-c1` },
        { id: 'T4-c2', author: 'reviewer', createdAt: '2026-09-30T12:00:00Z', body: 'A reply.', url: `${PR}#discussion_T4-c2` },
      ],
    });
  });

  test('the owner, the repository and the number go to gh as variables', () => {
    const { env, calls } = fakeGh(TWO_PAGES);
    unresolvedThreads(PR, { env });
    const args = calls()[0];
    assert.deepEqual(args.slice(0, 3), ['api', 'graphql', '-f']);
    assert.ok(args.includes('owner=thesis'));
    assert.ok(args.includes('repo=sdlc-kit'));
    assert.equal(args[args.indexOf('number=7') - 1], '-F');
    const query = args[3];
    assert.ok(!query.includes('thesis') && !query.includes('sdlc-kit'));
  });

  test('a pull request that does not exist throws', () => {
    const { env } = fakeGh({ first: { data: { repository: { pullRequest: null } } } });
    assert.throws(() => unresolvedThreads(PR, { env }), /does not exist/);
  });

  test('a GraphQL error in the answer throws with its message', () => {
    const { env } = fakeGh({ first: { errors: [{ message: 'Could not resolve to a Repository' }] } });
    assert.throws(() => unresolvedThreads(PR, { env }), /Could not resolve to a Repository/);
  });
});

describe('unresolvedThreads on a bad answer', () => {
  const threads = (nodes, pageInfo) => ({ data: { repository: { pullRequest: { reviewThreads: { pageInfo, nodes } } } } });

  test('a next page with no cursor throws after one gh call', () => {
    const gh = fakeGh({ first: threads([], { hasNextPage: true, endCursor: null }) });
    assert.throws(() => unresolvedThreads(PR, { env: gh.env }), /gave no cursor/);
    assert.equal(gh.calls().length, 1);
  });

  test('a page with no pageInfo throws', () => {
    const gh = fakeGh({ first: { data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } } });
    assert.throws(() => unresolvedThreads(PR, { env: gh.env }), /another form/);
  });

  test('a thread with no comments field gives an empty comment list', () => {
    const t = thread('T1', { createdAt: '2026-09-30T10:00:00Z' });
    delete t.comments;
    assert.deepEqual(unresolvedThreads(PR, { env: fakeGh({ first: page([t]) }).env })[0].comments, []);
  });

  test('a gh that gives no answer in time throws', () => {
    const gh = fakeGh({}, { FAKE_GH_HANG: '1' });
    assert.throws(() => unresolvedThreads(PR, { env: gh.env, timeoutMs: 500 }), /gave no answer in 500 ms/);
  });
});

describe('reply', () => {
  const ANSWER = { mutation: { data: { addPullRequestReviewThreadReply: { comment: { id: 'C9', url: `${PR}#discussion_r9` } } } } };
  const BODY = '@owner "Which format?" $(rm -rf /) `x`';

  test('the reply returns the id and the URL of the new comment', () => {
    const { env } = fakeGh(ANSWER);
    assert.deepEqual(reply(PR, 'PRRT_1', BODY, { env }), { id: 'C9', url: `${PR}#discussion_r9` });
  });

  test('the thread id and the body go to gh as variables and not inside the query', () => {
    const { env, calls } = fakeGh(ANSWER);
    reply(PR, 'PRRT_1', BODY, { env });
    const [args] = calls();
    assert.equal(args[args.indexOf('threadId=PRRT_1') - 1], '-f');
    assert.equal(args[args.indexOf(`body=${BODY}`) - 1], '-f');
    const query = args[3];
    assert.ok(query.startsWith('query=mutation'));
    assert.ok(!query.includes('PRRT_1') && !query.includes('Which format'));
  });

  test('an empty body throws with no gh call', () => {
    const { env, calls } = fakeGh(ANSWER);
    assert.throws(() => reply(PR, 'PRRT_1', ' \n', { env }), /empty/);
    assert.deepEqual(calls(), []);
  });
});

describe('the CLI', () => {
  test('threads prints the unresolved threads as JSON', () => {
    const { env } = fakeGh(TWO_PAGES);
    const r = run(['threads', PR], env);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      JSON.parse(r.stdout).map((t) => t.id),
      ['T4', 'T3'],
    );
  });

  test('reply posts the body file and prints the URL of the comment', () => {
    const { dir, env, calls } = fakeGh({ mutation: { data: { addPullRequestReviewThreadReply: { comment: { id: 'C9', url: `${PR}#discussion_r9` } } } } });
    const file = join(dir, 'reply.md');
    writeFileSync(file, 'The sentence now names the export time.\n');
    const r = run(['reply', PR, 'PRRT_1', '--body-file', file], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, `${PR}#discussion_r9\n`);
    assert.ok(calls()[0].includes('body=The sentence now names the export time.\n'));
  });

  test('a gh failure gives exit 1 with the stderr of gh', () => {
    const { env } = fakeGh({}, { FAKE_GH_FAIL: 'HTTP 401: Bad credentials (https://api.github.com/graphql)' });
    const r = run(['threads', PR], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /HTTP 401: Bad credentials/);
    assert.equal(r.stdout, '');
  });

  test('a gh binary that does not exist gives exit 1', () => {
    const { env } = fakeGh();
    const r = run(['threads', PR], { ...env, SDLC_KIT_GH_BIN: join(tmpdir(), 'no-such-gh-binary') });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /gh did not start/);
  });

  test('a bad URL gives exit 1 with no gh call', () => {
    const { dir, env, calls } = fakeGh(TWO_PAGES);
    const file = join(dir, 'reply.md');
    writeFileSync(file, 'A reply.\n');
    assert.equal(run(['threads', 'https://github.com/thesis/sdlc-kit/issues/7'], env).status, 1);
    assert.equal(run(['reply', 'https://github.com/thesis/sdlc-kit/issues/7', 'PRRT_1', '--body-file', file], env).status, 1);
    assert.deepEqual(calls(), []);
  });

  test('a missing body file gives exit 2 with no gh call', () => {
    const { dir, env, calls } = fakeGh();
    const r = run(['reply', PR, 'PRRT_1', '--body-file', join(dir, 'missing.md')], env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read the body file/);
    assert.deepEqual(calls(), []);
  });

  test('an empty body file gives exit 2 with no gh call', () => {
    const { dir, env, calls } = fakeGh();
    const file = join(dir, 'empty.md');
    writeFileSync(file, '\n  \n');
    const r = run(['reply', PR, 'PRRT_1', '--body-file', file], env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is empty/);
    assert.deepEqual(calls(), []);
  });

  for (const [label, args] of [
    ['no command', []],
    ['an unknown command', ['resolve', PR]],
    ['threads with no URL', ['threads']],
    ['reply with no body file', ['reply', PR, 'PRRT_1']],
    ['reply with no thread id', ['reply', PR, '--body-file', 'reply.md']],
    ['an unknown option', ['threads', PR, '--push']],
  ]) {
    test(`${label} gives exit 2`, () => {
      const { env, calls } = fakeGh();
      assert.equal(run(args, env).status, 2);
      assert.deepEqual(calls(), []);
    });
  }
});
