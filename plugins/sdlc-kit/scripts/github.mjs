#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PULL_REQUEST_URL = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)\/pull\/([1-9]\d*)(?:\/files)?\/?(?:#.*)?$/;

/** The time that one gh call gets before it counts as failed. */
export const GH_TIMEOUT_MS = 60_000;

const THREADS_QUERY = `query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) { nodes { id author { login } createdAt body url } }
        }
      }
    }
  }
}`;

const REPLY_MUTATION = `mutation($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id url }
  }
}`;

/**
 * Splits `https://github.com/<owner>/<repo>/pull/<n>` into its parts. The URL
 * may end with a slash, `/files` or a `#` fragment. Throws on every other URL.
 */
export function parsePullRequestUrl(url) {
  const m = String(url ?? '').match(PULL_REQUEST_URL);
  if (!m || /^\.+$/.test(m[2])) throw new Error(`"${url}" is not the URL of a GitHub pull request, such as https://github.com/<owner>/<repo>/pull/<n>`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

// Each value goes to gh as a GraphQL variable, so no value can change the
// text of the query. `-F` sends the number as an Int; `-f` sends a raw
// string, so a body that starts with "@" is not read as a file name.
function graphql(query, strings, numbers, env, timeoutMs) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [name, value] of Object.entries(strings)) if (value !== undefined) args.push('-f', `${name}=${value}`);
  for (const [name, value] of Object.entries(numbers)) args.push('-F', `${name}=${value}`);
  const bin = env.SDLC_KIT_GH_BIN || 'gh';
  const r = spawnSync(bin, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`gh api graphql gave no answer in ${timeoutMs} ms`);
  if (r.error) throw new Error(`gh did not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh api graphql failed: ${(r.stderr || '').trim() || `exit ${r.status ?? r.signal}`}`);
  let result;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    throw new Error(`gh api graphql printed output that is not JSON: ${r.stdout.trim().slice(0, 300)}`);
  }
  if (result.errors?.length) throw new Error(`gh api graphql failed: ${result.errors.map((e) => e.message).join('; ')}`);
  return result.data;
}

const firstTime = (thread) => String(thread.comments[0]?.createdAt ?? '');

/**
 * Lists the unresolved review threads of a pull request, sorted by the time
 * of the first comment. Each thread holds its first 100 comments. Throws when
 * gh fails, answers in another form or does not answer in `timeoutMs`, and
 * when the pull request does not exist.
 */
export function unresolvedThreads(url, { env = process.env, timeoutMs = GH_TIMEOUT_MS } = {}) {
  const { owner, repo, number } = parsePullRequestUrl(url);
  const threads = [];
  let after;
  for (;;) {
    const data = graphql(THREADS_QUERY, { owner, repo, after }, { number }, env, timeoutMs);
    const page = data?.repository?.pullRequest?.reviewThreads;
    if (!page) throw new Error(`the pull request ${url} does not exist or gh cannot read it`);
    if (!Array.isArray(page.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('gh api graphql answered with a review thread page in another form');
    }
    for (const t of page.nodes) {
      if (t.isResolved) continue;
      threads.push({
        id: t.id,
        path: t.path,
        line: t.line,
        outdated: t.isOutdated,
        comments: (t.comments?.nodes ?? []).map((c) => ({ id: c.id, author: c.author?.login ?? null, createdAt: c.createdAt, body: c.body, url: c.url })),
      });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
    if (typeof after !== 'string' || !after) throw new Error('gh api graphql said that a next page exists and gave no cursor for it');
  }
  return threads.sort((a, b) => firstTime(a).localeCompare(firstTime(b)));
}

/**
 * Posts `body` as a reply in one review thread. The URL is checked for its
 * form only; the thread is not checked against the pull request. A call that
 * ran out of time can still have posted the reply, so read the thread before
 * a second try.
 */
export function reply(url, threadId, body, { env = process.env, timeoutMs = GH_TIMEOUT_MS } = {}) {
  parsePullRequestUrl(url);
  if (!threadId) throw new Error('the thread id is missing');
  if (!String(body ?? '').trim()) throw new Error('the reply is empty');
  const data = graphql(REPLY_MUTATION, { threadId, body }, {}, env, timeoutMs);
  const comment = data?.addPullRequestReviewThreadReply?.comment;
  if (!comment) throw new Error(`gh returned no comment for the reply in thread ${threadId}`);
  return { id: comment.id, url: comment.url };
}

const USAGE = `usage:
  node github.mjs threads <pull request URL>
  node github.mjs reply <pull request URL> <thread id> --body-file <path>`;

/** Runs the CLI and returns the exit code: 0 done, 1 bad input or a gh failure, 2 usage error. */
export function main(argv, out = process.stdout, err = process.stderr, env = process.env) {
  const [command, ...rest] = argv;
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const m = arg.match(/^--(body-file)(?:=(.*))?$/);
    if (m) options[m[1]] = m[2] ?? rest[++i];
    else if (arg.startsWith('-')) {
      err.write(`unknown option ${arg}\n${USAGE}\n`);
      return 2;
    } else positional.push(arg);
  }
  const threadsCall = command === 'threads' && positional.length === 1 && options['body-file'] === undefined;
  const replyCall = command === 'reply' && positional.length === 2 && Boolean(options['body-file']);
  if (!threadsCall && !replyCall) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  let body;
  if (replyCall) {
    try {
      body = readFileSync(options['body-file'], 'utf8');
    } catch (e) {
      err.write(`cannot read the body file: ${e.message}\n${USAGE}\n`);
      return 2;
    }
    if (!body.trim()) {
      err.write(`the body file ${options['body-file']} is empty\n${USAGE}\n`);
      return 2;
    }
  }
  try {
    if (threadsCall) {
      out.write(`${JSON.stringify(unresolvedThreads(positional[0], { env }), null, 2)}\n`);
    } else {
      out.write(`${reply(positional[0], positional[1], body, { env }).url}\n`);
    }
    return 0;
  } catch (e) {
    err.write(`${e.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
