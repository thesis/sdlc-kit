import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GATE_BUDGET_MS,
  PATCH_REASON,
  SAVE_TOOL,
  missingDirReason,
  noFrontmatterReason,
  outOfTimeReason,
  typeMismatchReason,
  unresolvedReason,
  decide,
  denyOutput,
  documentType,
  gate,
  judgeAgents,
  parsePush,
  pushedDocuments,
} from './document-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hookScript = join(here, 'document-gate.mjs');
const SAVE = 'mcp__plugin_sdlc-kit_linear__save_document';

function tempDir(prefix = 'sdlc-kit-gate-') {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

// An intent in the Linear form: the frontmatter as Linear stores it, and no
// title line.
const INTENT = `\`\`\`yaml
type: intent
owner: Ana Nowak
status: review
\`\`\`

## 1. Executive summary
- The finance team gets a weekly report of the deposits.

## 2. Problem
The analyst does a manual count every Monday.

## 3. Proposed outcome
The finance team gets the report every Monday.

## 4. Not in scope now
Withdrawals are not in scope.

## 5. Affected users and systems
The finance team reads the report.

## 6. Constraints
The report is ready before the Monday meeting.

## 7. Open problems
None.
`;
const DASHED = INTENT.replace('does a manual count every Monday.', 'does a manual count — every Monday.');

// The same intent in the git form that linear.mjs export writes.
const GIT_INTENT = INTENT.replace(
  /^```yaml\n([\s\S]*?)```\n/,
  '---\n$1exported: https://linear.app/thesis/document/intent-1 · 2026-09-29T00:00:00Z\n---\n\n# Intent: Weekly export of vault deposits\n',
);

// A spec in the git form that linear.mjs export writes.
const GIT_SPEC = `---
type: spec
owner: Ana Nowak
status: approved
relates: https://linear.app/thesis/document/intent-1
exported: https://linear.app/thesis/document/spec-1 · 2026-09-30T00:00:00Z
---

# Spec: Weekly export of vault deposits

## 1. Terms
A report is the list of the deposits of one week.

## 2. Scope
The report is in scope. Withdrawals are out of scope.

## 3. Requirements
- R1: The finance team gets the report every Monday.

## 4. How it works
A script counts the deposits and writes the report.

## 5. Worked example
Ten deposits of 100 USD give a report with a total of 1000 USD.

## 6. Roles and permissions
The finance team reads the report.

## 7. Deliverables
The report script.

## 8. Trade-offs
A weekly report is late for a deposit on Tuesday. The low cost wins.

## 9. Risks
1. The script stops. Response: the analyst does the count.

## 10. Open decisions
None.

## 11. Intent open problems, answered
None.
`;

const PLAN = `---
type: plan
relates: spec.md, intent.md
---

# Plan: Weekly export

## 1. Summary
The export lands in one phase.

## 2. Work order
| Phase | Depends on | Merge gate |
| --- | --- | --- |
| 1. The report script | None | npm test exits with 0 |

## 3. Phases
### 3.1 Phase 1: The report script
#### 3.1.1 Files that change
The report script is new.
#### 3.1.2 Behavior
The script writes the report.
#### 3.1.3 Tests
One test proves the report.
#### 3.1.4 Commands
Run npm test. It exits with 0.
#### 3.1.5 Definition of done
npm test exits with 0.

## 4. Test matrix
R1 maps to the report test.

## 5. Risks before the work starts
None.

## 6. Blockers
None.
`;

// A stand-in for the claude binary. FAKE_MODE picks the answer. In the mode
// "slow-for", the fake sleeps FAKE_SLEEP_MS only when the input holds the
// text FAKE_SLOW_FOR. FAKE_RECORD
// names a file that gets the arguments, the prompt, the cwd and SDLC_KIT_GATE.
const fakeDir = tempDir('sdlc-kit-fake-');
const fakeClaude = join(fakeDir, 'claude');
writeFileSync(
  fakeClaude,
  `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  if (process.env.FAKE_RECORD) {
    writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv: process.argv.slice(2), input, cwd: process.cwd(), gate: process.env.SDLC_KIT_GATE }));
  }
  const result = (structured_output, extra = {}) =>
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.01, result: JSON.stringify(structured_output), structured_output, ...extra }));
  const finding = { section: '3. Proposed outcome', quote: 'the report', rule: 'Altitude', message: 'Name the outcome.' };
  switch (process.env.FAKE_MODE) {
    case 'pass': return result({ verdict: 'PASS', findings: [] });
    case 'fail': return result({ verdict: 'FAIL', findings: [finding] });
    case 'pass-with-findings': return result({ verdict: 'PASS', findings: [finding] });
    case 'no-structured-output': return result(undefined);
    case 'is-error': return result(undefined, { is_error: true, subtype: 'error_max_budget_usd' });
    case 'invalid': return console.log('not json');
    case 'exit': console.error('boom'); process.exit(3);
    case 'sleep': return setTimeout(() => {}, 10000);
    case 'slow-pass': return setTimeout(() => result({ verdict: 'PASS', findings: [] }), Number(process.env.FAKE_SLEEP_MS));
    case 'slow-for':
      return setTimeout(() => result({ verdict: 'PASS', findings: [] }), input.includes(process.env.FAKE_SLOW_FOR) ? Number(process.env.FAKE_SLEEP_MS) : 0);
  }
});
`,
);
chmodSync(fakeClaude, 0o755);

function judgeEnv(mode, extra = {}) {
  const { SDLC_KIT_JUDGE_MODEL, SDLC_KIT_GATE, SDLC_KIT_GATE_LOG, ...env } = process.env;
  return { ...env, SDLC_KIT_CLAUDE_BIN: fakeClaude, FAKE_MODE: mode, ...extra };
}

describe('parsePush', () => {
  const cwd = '/work';
  const push = (fields) => ({ dir: cwd, global: [], remote: null, refspecs: [], delete: false, all: false, ...fields });

  for (const [command, expected] of [
    ['git push', [push({})]],
    ['git push origin HEAD', [push({ remote: 'origin', refspecs: ['HEAD'] })]],
    ['git -C /x push', [push({ dir: '/x' })]],
    ['git -C sub -C deeper push origin', [push({ dir: '/work/sub/deeper', remote: 'origin' })]],
    ['cd a && git push origin HEAD:main', [push({ dir: '/work/a', remote: 'origin', refspecs: ['HEAD:main'] })]],
    ['git push --force-with-lease origin feature', [push({ remote: 'origin', refspecs: ['feature'] })]],
    ['git push --delete origin b', [push({ remote: 'origin', refspecs: ['b'], delete: true })]],
    ['git push origin :b', [push({ remote: 'origin', refspecs: [':b'] })]],
    ['git push -u -o ci.skip origin feature', [push({ remote: 'origin', refspecs: ['feature'] })]],
    ['git push --all origin', [push({ remote: 'origin', all: true })]],
    ['git --git-dir=.git --work-tree . push', [push({ global: ['--git-dir=/work/.git', '--work-tree=/work'] })]],
    ['git -c push.default=current push', [push({ global: ['-c', 'push.default=current'] })]],
    ['GIT_TRACE=1 env -u X git push', [push({})]],
    ['/usr/bin/git push', [push({})]],
    ['npm test; git push', [push({})]],
    ['git fetch || git push', [push({})]],
    ['make && git push origin "my branch"', [push({ remote: 'origin', refspecs: ['my branch'] })]],
    ["bash -c 'cd sub && git push'", [push({ dir: '/work/sub' })]],
    ['(cd b && git status); git push', [push({})]],
    ['{ cd a; git push; }', [push({ dir: '/work/a' })]],
    ['if true; then git push origin main; fi', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['while false; do git push; done', [push({})]],
    ['! git push', [push({})]],
    ['echo `git push origin main`', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['echo "$(git -C /x push)"', [push({ dir: '/x' })]],
    ['timeout 60 git push', [push({})]],
    ['timeout -s KILL 60 git push', [push({})]],
    ['nice -n 5 git push', [push({})]],
    ['sudo -u me git push', [push({})]],
    ['xargs -n 1 git push origin', [push({ remote: 'origin' })]],
    ['eval "git push origin main"', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git -C ~/repo push', [push({ dir: join(process.env.HOME, 'repo') })]],
    ['git -C "$REPO" push', [push({ dir: '/work/$REPO', unresolved: '$REPO' })]],
    ['git -C ${REPO} push', [push({ dir: '/work/${REPO}', unresolved: '${REPO}' })]],
    ['git -C $(pwd) push', [push({ dir: '/work/$SUBST', unresolved: '$SUBST' })]],
    ['cd "$DIR" && git push', [push({ unresolved: '$DIR' })]],
    ['cd - && git push', [push({ unresolved: '-' })]],
    ['git push origin $BRANCH', [push({ remote: 'origin', refspecs: ['$BRANCH'], unresolved: '$BRANCH' })]],
    ['git push origin main 2>&1', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main 2>&1 | tail -3', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main > /dev/null', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main >> push.log', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main 2> err.txt', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main &> push.log', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main >&2', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main < /dev/null', [push({ remote: 'origin', refspecs: ['main'] })]],
    ['git push origin main <<< yes', [push({ remote: 'origin', refspecs: ['main'] })]],
    ["cat > n.md <<'EOF'\nDon't stop.\nEOF\ngit push origin main", [push({ remote: 'origin', refspecs: ['main'] })]],
    ['cat > n.md <<EOF\nIt\'s done.\nEOF\ngit push', [push({})]],
    ["cat <<-EOF\n\tIt's done.\n\tEOF\ngit push", [push({})]],
    ["git commit -m \"$(cat <<'EOF'\nSteps: 1) lint 2) judge\n\nDon't skip it.\nEOF\n)\" && git push", [push({})]],
    ['cd a && out=$(git push origin main 2>&1)', [push({ dir: '/work/a', remote: 'origin', refspecs: ['main'] })]],
    ['cd a; x=`git push`', [push({ dir: '/work/a' })]],
    ['cd a && echo "$(git push)"', [push({ dir: '/work/a' })]],
    ['(cd a; x=$(git push)); git push', [push({ dir: '/work/a' }), push({})]],
    ['cd "$DIR" && x=$(git push)', [push({ unresolved: '$DIR' })]],
    ['$(which git) push', [push({ unresolved: '$SUBST' })]],
    ['$GIT push origin main', [push({ unresolved: '$GIT' })]],
    ['GIT_DIR=/x/.git git push', [{ ...push({}), env: { GIT_DIR: '/x/.git' } }]],
    ['env GIT_WORK_TREE=tree git push', [{ ...push({}), env: { GIT_WORK_TREE: '/work/tree' } }]],
    ['GIT_DIR=$X git push', [{ ...push({ unresolved: '$X' }), env: { GIT_DIR: '/work/$X' } }]],
    ['git push origin a && git -C /y push origin b', [push({ remote: 'origin', refspecs: ['a'] }), push({ dir: '/y', remote: 'origin', refspecs: ['b'] })]],
  ]) {
    test(`finds the push in: ${command}`, () => {
      assert.deepEqual(parsePush(command, cwd), expected);
    });
  }

  for (const command of [
    'gh pr view',
    'git pull',
    'git status | grep push',
    'echo "git push"',
    'git log --grep push',
    'git stash push',
    '# git push',
    'echo $(date)',
    "echo '$(git push)'",
    '$EDITOR notes.md',
    "cat > n.md <<'EOF'\ngit push\nEOF",
    '',
  ]) {
    test(`finds no push in: ${JSON.stringify(command)}`, () => {
      assert.deepEqual(parsePush(command, cwd), []);
    });
  }
});

describe('documentType', () => {
  for (const [input, expected] of [
    [{ content: INTENT }, 'intent'],
    [{ content: '---\ntype: spec\n---\n' }, 'spec'],
    [{ content: '\n```yaml\ntype: Spec\n```\n' }, 'spec'],
    [{ content: '\uFEFF---\ntype: intent\n---\n' }, 'intent'],
    [{ content: '```yaml\ntype: plan\n```\n' }, null],
    [{ content: '---\ntype: memo\n---\n' }, null],
    [{ content: '# Intent: Weekly export\nOwner: A · Status: draft\n' }, null],
    [{ content: 'type: intent\n' }, null],
    [{ title: 'Intent: Weekly export' }, null],
    [{}, null],
    [{ path: '.sdlc-kit/2026-09-probe/intent.md' }, 'intent'],
    [{ path: '.sdlc-kit/2026-09-probe/spec.md' }, 'spec'],
    [{ path: '.sdlc-kit/2026-09-probe/plan.md' }, 'plan'],
    [{ path: '.sdlc-kit/2026-09-probe/notes.md' }, 'prose'],
  ]) {
    test(`the type of ${JSON.stringify(input)} is ${expected}`, () => {
      assert.equal(documentType(input), expected);
    });
  }
});

const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
Object.assign(process.env, GIT_ENV);

function sh(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

// A work repository with a bare remote `origin` and one commit on `main`.
function repository() {
  const root = tempDir('sdlc-kit-repo-');
  const remote = join(root, 'remote.git');
  const work = join(root, 'work');
  sh(root, 'init', '--bare', '-b', 'main', remote);
  sh(root, 'init', '--bare', '-b', 'main', join(root, 'other.git'));
  sh(root, 'init', '-b', 'main', work);
  sh(work, 'remote', 'add', 'origin', remote);
  sh(work, 'remote', 'add', 'upstream', join(root, 'other.git'));
  write(work, 'README.md', 'A repository.\n');
  write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT);
  write(work, '.sdlc-kit/2026-09-probe/spec.md', '# Spec: Weekly export\n');
  write(work, '.sdlc-kit/2026-09-probe/notes.txt', 'Not markdown.\n');
  write(work, 'docs/guide.md', 'Outside the stage directory.\n');
  sh(work, 'add', '-A');
  sh(work, 'commit', '-m', 'Add the stage');
  return { root, remote, work };
}

const pushedPaths = (command, cwd) => parsePush(command, cwd).flatMap((p) => pushedDocuments(p)?.map((d) => d.path) ?? ['<not a repository>']);

describe('pushedDocuments', () => {
  const { root, work } = repository();

  test('a first push lists every markdown file under .sdlc-kit', () => {
    assert.deepEqual(pushedPaths('git push origin main', work), ['.sdlc-kit/2026-09-probe/intent.md', '.sdlc-kit/2026-09-probe/spec.md']);
  });

  test('a second push lists only the changed file', () => {
    sh(work, 'push', 'origin', 'main');
    write(work, '.sdlc-kit/2026-09-probe/spec.md', '# Spec: Weekly export, second version\n');
    sh(work, 'commit', '-am', 'Change the spec');
    assert.deepEqual(pushedPaths('git push', work), ['.sdlc-kit/2026-09-probe/spec.md']);
  });

  test('the text of a file is the text at the pushed ref, not in the working tree', () => {
    write(work, '.sdlc-kit/2026-09-probe/spec.md', 'Not committed.\n');
    const [doc] = pushedDocuments(parsePush('git push', work)[0]);
    assert.equal(doc.text(), '# Spec: Weekly export, second version\n');
    sh(work, 'checkout', '--', '.');
  });

  test('a push of a tree with no stage change lists nothing', () => {
    sh(work, 'push', 'origin', 'main');
    write(work, 'README.md', 'A changed repository.\n');
    sh(work, 'commit', '-am', 'Change the README');
    assert.deepEqual(pushedPaths('git push origin HEAD', work), []);
  });

  test('a deleted file is not listed', () => {
    sh(work, 'rm', '-q', '.sdlc-kit/2026-09-probe/intent.md');
    sh(work, 'commit', '-m', 'Delete the intent');
    assert.deepEqual(pushedPaths('git push origin main', work), []);
  });

  test('a push from a subdirectory lists the paths from the repository root', () => {
    write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
    sh(work, 'add', '-A');
    sh(work, 'commit', '-m', 'Add the plan');
    assert.deepEqual(pushedPaths('cd docs && git push', work), ['.sdlc-kit/2026-09-probe/plan.md']);
  });

  test('a push of HEAD to a new remote branch compares with the upstream', () => {
    sh(work, 'push', 'origin', 'main');
    sh(work, 'branch', '--set-upstream-to', 'origin/main');
    write(work, '.sdlc-kit/2026-09-probe/plan.md', `${PLAN}\n`);
    sh(work, 'commit', '-am', 'Change the plan');
    assert.deepEqual(pushedPaths('git push origin HEAD:feature', work), ['.sdlc-kit/2026-09-probe/plan.md']);
  });

  test('a push to another remote lists only the changes of commits that no remote holds', () => {
    assert.deepEqual(pushedPaths('git push upstream HEAD', work), ['.sdlc-kit/2026-09-probe/plan.md']);
  });

  test('a push with -C lists the files of that repository', () => {
    assert.deepEqual(pushedPaths(`git -C ${work} push origin main`, root), ['.sdlc-kit/2026-09-probe/plan.md']);
  });

  test('a delete push lists nothing', () => {
    assert.deepEqual(pushedPaths('git push --delete origin main', work), []);
  });

  test('a directory outside a repository gives null', () => {
    assert.deepEqual(pushedPaths('git push', root), ['<not a repository>']);
  });

  test('a directory that does not exist gives null', () => {
    assert.deepEqual(pushedPaths('cd missing && git push', root), ['<not a repository>']);
  });

  test('a local ref that does not exist throws', () => {
    assert.throws(() => pushedPaths('git push origin nothing', work), /the local ref "nothing" does not exist/);
  });
});

// A work repository whose remote `origin` holds the intent on `main`. The
// branch `feat` starts from that commit and, with `pushed`, is on the remote.
// Then `main` gets a new intent text on the remote.
function mainMovesOn({ pushed = false } = {}) {
  const root = tempDir('sdlc-kit-repo-');
  const work = join(root, 'work');
  sh(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'remote.git'));
  sh(root, 'init', '-q', '-b', 'main', work);
  sh(work, 'remote', 'add', 'origin', join(root, 'remote.git'));
  write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT);
  sh(work, 'add', '-A');
  sh(work, 'commit', '-q', '-m', 'Add the intent');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(work, 'checkout', '-q', '-b', 'feat');
  write(work, 'a.js', 'export const a = 1;\n');
  sh(work, 'add', '-A');
  sh(work, 'commit', '-q', '-m', 'Add a');
  if (pushed) sh(work, 'push', '-q', 'origin', 'feat');
  sh(work, 'checkout', '-q', 'main');
  write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT.replace('The finance team reads the report.', 'The finance team and the auditors read the report.'));
  sh(work, 'commit', '-q', '-am', 'Name the auditors');
  sh(work, 'push', '-q', 'origin', 'main');
  sh(work, 'checkout', '-q', 'feat');
  return { root, work };
}

describe('the documents of a push', () => {
  const bash = (work, command, mode = 'fail') => decide({ tool_name: 'Bash', cwd: work, tool_input: { command } }, { env: judgeEnv(mode) });

  test('a first push of a code change from a branch cut before main changed a document judges nothing', () => {
    const { work } = mainMovesOn();
    assert.deepEqual(bash(work, 'git push -u origin feat'), { decision: 'allow', documents: [] });
  });

  test('a force push of a code change rebased onto main judges nothing', () => {
    const { work } = mainMovesOn({ pushed: true });
    sh(work, 'rebase', '-q', 'main');
    assert.deepEqual(bash(work, 'git push --force-with-lease origin feat'), { decision: 'allow', documents: [] });
  });

  test('a merge of main into a code-only branch judges nothing', () => {
    const { work } = mainMovesOn({ pushed: true });
    sh(work, 'merge', '-q', '--no-edit', 'origin/main');
    assert.deepEqual(bash(work, 'git push origin feat'), { decision: 'allow', documents: [] });
  });

  test('a merge commit that edits a document gets that document judged', () => {
    const { work } = mainMovesOn({ pushed: true });
    sh(work, 'merge', '-q', '--no-commit', '--no-ff', 'origin/main');
    write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT.replace('The finance team reads the report.', 'The finance team and the board read the report.'));
    sh(work, 'add', '-A');
    sh(work, 'commit', '-q', '--no-edit');
    assert.deepEqual(bash(work, 'git push origin feat').documents, [{ name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'deny' }]);
  });

  test('a merge commit that adds a document with an em-dash is denied by the lint', () => {
    const { work } = mainMovesOn({ pushed: true });
    sh(work, 'merge', '-q', '--no-commit', '--no-ff', 'origin/main');
    write(work, '.sdlc-kit/2026-10-other/spec.md', '# Spec: Other \u2014 new\n');
    sh(work, 'add', '-A');
    sh(work, 'commit', '-q', '--no-edit');
    assert.match(bash(work, 'git push origin feat').reason, /^document-gate: the lint found these lines in \.sdlc-kit\/2026-10-other\/spec\.md:\n.*em-dash/);
  });

  test('a code-only push to a second remote with no remote-tracking ref judges nothing', () => {
    const { root, work } = mainMovesOn();
    sh(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'fork.git'));
    sh(work, 'remote', 'add', 'fork', join(root, 'fork.git'));
    assert.deepEqual(bash(work, 'git push fork feat'), { decision: 'allow', documents: [] });
  });

  for (const [name, path, text, line] of [
    ['an intent in the Linear form', 'intent.md', INTENT, /intent\.md:1: structure-frontmatter: a git file starts on line 1 with the frontmatter between two "---" lines/],
    ['a spec file with the type of an intent', 'spec.md', GIT_INTENT, /spec\.md:2: structure-frontmatter: the "type" field must be "spec"/],
  ]) {
    test(`a push of ${name} is denied by the lint of the git form`, () => {
      const root = tempDir('sdlc-kit-repo-');
      const work = join(root, 'work');
      sh(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'remote.git'));
      sh(root, 'init', '-q', '-b', 'main', work);
      sh(work, 'remote', 'add', 'origin', join(root, 'remote.git'));
      write(work, `.sdlc-kit/2026-09-probe/${path}`, text);
      sh(work, 'add', '-A');
      sh(work, 'commit', '-q', '-m', 'Add the stage');
      const result = bash(work, 'git push origin main', 'pass');
      assert.equal(result.decision, 'deny');
      assert.match(result.reason, line);
    });
  }

  test('a first push to an empty remote judges every document at the local ref', () => {
    const root = tempDir('sdlc-kit-repo-');
    const work = join(root, 'work');
    sh(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'remote.git'));
    sh(root, 'init', '-q', '-b', 'main', work);
    sh(work, 'remote', 'add', 'origin', join(root, 'remote.git'));
    write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT);
    write(work, '.sdlc-kit/2026-09-probe/spec.md', GIT_SPEC);
    write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
    sh(work, 'add', '-A');
    sh(work, 'commit', '-q', '-m', 'Add the stage');
    assert.deepEqual(bash(work, 'git push origin main', 'pass'), {
      decision: 'allow',
      documents: [
        { name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/plan.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/spec.md', decision: 'allow' },
      ],
    });
  });

  test('a push of a plan whose spec is only in the working tree is denied by the lint', () => {
    const root = tempDir('sdlc-kit-repo-');
    const work = join(root, 'work');
    sh(root, 'init', '--bare', '-q', '-b', 'main', join(root, 'remote.git'));
    sh(root, 'init', '-q', '-b', 'main', work);
    sh(work, 'remote', 'add', 'origin', join(root, 'remote.git'));
    write(work, '.sdlc-kit/2026-09-probe/intent.md', GIT_INTENT);
    write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
    sh(work, 'add', '-A');
    sh(work, 'commit', '-q', '-m', 'Add the plan');
    write(work, '.sdlc-kit/2026-09-probe/spec.md', GIT_SPEC);
    const result = bash(work, 'git push origin main', 'pass');
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /\n\.sdlc-kit\/2026-09-probe\/plan\.md:3: structure-relates: the plan relates to spec\.md, but no spec\.md is next to it\n/);
  });
});

describe('gate', () => {
  test('a lint finding denies with the lines and runs no judge', () => {
    const record = join(tempDir(), 'record.json');
    const result = gate(DASHED, { type: 'intent', name: 'Intent: Weekly export', env: judgeEnv('pass', { FAKE_RECORD: record }) });
    assert.equal(result.decision, 'deny');
    assert.equal(
      result.reason,
      'document-gate: the lint found these lines in Intent: Weekly export:\n' +
        'Intent: Weekly export:11: em-dash: em-dash (U+2014); use a comma, a colon, parentheses or two sentences\n' +
        'Fix the named lines. Then repeat the call.',
    );
    assert.equal(existsSync(record), false);
  });

  test('a PASS verdict allows', () => {
    assert.equal(gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('pass') }).decision, 'allow');
  });

  test('the comment anchors of Linear are removed before the lint and the judge', () => {
    const anchored = INTENT.replace('## 1. Executive summary', '## 1. <linear-comment id="a1" resolved="true">Executive summary</linear-comment>');
    assert.notEqual(anchored, INTENT);
    assert.equal(gate(anchored, { type: 'intent', name: 'x', env: judgeEnv('pass') }).decision, 'allow');
  });

  test('a FAIL verdict denies with one line per finding', () => {
    const result = gate(INTENT, { type: 'intent', name: 'Intent: Weekly export', env: judgeEnv('fail') });
    assert.equal(result.decision, 'deny');
    assert.equal(
      result.reason,
      'document-gate: the writing judge failed Intent: Weekly export:\n' +
        '3. Proposed outcome: "the report": Altitude: Name the outcome.\n' +
        'Fix each finding. Then repeat the call.',
    );
  });

  test('a PASS verdict with a finding denies', () => {
    assert.equal(gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('pass-with-findings') }).decision, 'deny');
  });

  for (const [mode, message] of [
    ['invalid', 'the judge output is not JSON (not json)'],
    ['exit', 'the judge stopped with exit code 3 (boom)'],
    ['no-structured-output', 'the judge output has no valid verdict'],
    ['is-error', 'the judge run failed (error_max_budget_usd)'],
  ]) {
    test(`a judge run with ${mode} denies with the error`, () => {
      const result = gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv(mode) });
      assert.equal(result.decision, 'deny');
      assert.equal(result.reason, `document-gate: the writing judge gave no verdict for x: ${message}. Repeat the call.`);
    });
  }

  test('a judge that does not answer in time denies', () => {
    const result = gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('sleep'), deadline: Date.now() + 2000, floorMs: 0 });
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /the judge gave no verdict in the time that the gate had left \(2 s\)/);
  });

  test('with less time left than the floor, the gate denies and runs no judge', () => {
    const record = join(tempDir(), 'record.json');
    const result = gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('pass', { FAKE_RECORD: record }), deadline: Date.now() + 1000, floorMs: 20_000 });
    assert.deepEqual(result, { decision: 'deny', stage: 'judge', reason: outOfTimeReason('x') });
    assert.equal(existsSync(record), false);
  });

  test('a document with a byte order mark passes the lint', () => {
    assert.equal(gate(`\uFEFF${INTENT}`, { type: 'intent', name: 'x', env: judgeEnv('pass') }).decision, 'allow');
  });

  test('a binary that does not exist denies', () => {
    const result = gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('pass', { SDLC_KIT_CLAUDE_BIN: join(fakeDir, 'none') }) });
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /the judge did not start/);
  });

  describe('the judge run', () => {
    const run = (extra = {}) => {
      const record = join(tempDir(), 'record.json');
      gate(INTENT, { type: 'intent', name: 'x', env: judgeEnv('pass', { FAKE_RECORD: record, ...extra }) });
      return JSON.parse(readFileSync(record, 'utf8'));
    };
    const seen = run();
    const option = (name) => seen.argv[seen.argv.indexOf(name) + 1];

    test('the prompt holds the type and the document and nothing else', () => {
      assert.equal(seen.input, `Document type: intent\n\n<document>\n${INTENT}\n</document>\n`);
    });

    test('the run is headless, with the judge agent, no tools, no settings and no MCP servers', () => {
      assert.equal(seen.argv[0], '-p');
      assert.equal(option('--agent'), 'writing-judge');
      assert.equal(option('--tools'), '');
      assert.equal(option('--setting-sources'), '');
      assert.ok(seen.argv.includes('--strict-mcp-config'));
      assert.equal(option('--output-format'), 'json');
      assert.equal(option('--max-turns'), '2');
      assert.equal(option('--max-budget-usd'), '2');
      assert.ok(seen.argv.includes('--no-session-persistence'));
      assert.deepEqual(JSON.parse(option('--json-schema')).required, ['verdict', 'findings']);
      assert.deepEqual(JSON.parse(option('--agents')), judgeAgents());
    });

    test('the run starts in the temp directory with SDLC_KIT_GATE set', () => {
      assert.equal(realpathSync(seen.cwd), realpathSync(tmpdir()));
      assert.equal(seen.gate, '1');
    });

    test('the run has no --model option by default', () => {
      assert.ok(!seen.argv.includes('--model'));
    });

    test('SDLC_KIT_JUDGE_MODEL sets the model', () => {
      const withModel = run({ SDLC_KIT_JUDGE_MODEL: 'sonnet' });
      assert.equal(withModel.argv[withModel.argv.indexOf('--model') + 1], 'sonnet');
    });
  });

  test('the judge prompt is the agent body, then the writing rules once', () => {
    const agent = judgeAgents()['writing-judge'];
    assert.match(agent.prompt, /^# Writing judge\n/);
    assert.equal(agent.prompt.match(/^# Writing rules$/gm).length, 1);
    assert.ok(agent.prompt.indexOf('# Writing judge') < agent.prompt.indexOf('# Writing rules'));
    assert.ok(!agent.prompt.includes('${CLAUDE_PLUGIN_ROOT}'));
    assert.ok(agent.prompt.includes(join(here, '..', 'skills', 'writing', 'SKILL.md')));
    assert.deepEqual(agent.tools, ['StructuredOutput']);
    assert.match(agent.description, /^Judges one sdlc-kit document/);
  });
});

describe('decide', () => {
  const save = (tool_input, tool_name = SAVE) => decide({ tool_name, tool_input }, { env: judgeEnv('pass') });

  test('a patch save denies and asks for the full content', () => {
    assert.deepEqual(save({ id: 'doc-1', patch: [{ replace: { old_string: 'a', new_string: 'b' } }] }), {
      decision: 'deny',
      reason: PATCH_REASON,
      documents: [{ name: 'doc-1', decision: 'deny' }],
    });
  });

  test('a patch save with a title that is not a stage title denies', () => {
    assert.equal(save({ id: 'doc-1', title: 'Meeting notes', patch: [] }).reason, PATCH_REASON);
  });

  test('a patch save with content too denies', () => {
    assert.equal(save({ id: 'doc-1', content: INTENT, patch: [] }).reason, PATCH_REASON);
  });

  test('a save of a document that is not a stage document allows with no judge run', () => {
    const record = join(tempDir(), 'record.json');
    const result = decide({ tool_name: SAVE, tool_input: { title: 'Meeting notes', content: 'We leverage it — always.' } }, { env: judgeEnv('fail', { FAKE_RECORD: record }) });
    assert.equal(result.decision, 'allow');
    assert.equal(existsSync(record), false);
  });

  test('a save with no content allows', () => {
    assert.equal(save({ id: 'doc-1', title: 'Intent: Weekly export', icon: 'Book' }).decision, 'allow');
  });

  test('a save of an intent with an em-dash denies', () => {
    const result = save({ title: 'Intent: Weekly export', team: 'ENG', content: DASHED });
    assert.equal(result.decision, 'deny');
    assert.match(result.reason, /^document-gate: the lint found these lines in Intent: Weekly export:\n.*:11: em-dash:/);
  });

  test('an update by id with no title is gated by the type of its frontmatter', () => {
    const result = save({ id: 'doc-1', content: DASHED });
    assert.match(result.reason, /in doc-1:\ndoc-1:11: em-dash/);
  });

  test('a save of an intent with a title line denies, because Linear shows the title twice', () => {
    const result = save({ id: 'doc-1', content: INTENT.replace('```\n\n', '```\n\n# Intent: Weekly export\n\n') });
    assert.match(result.reason, /\ndoc-1:7: structure-title: a Linear document has no "# " title line/);
  });

  test('a save of a spec in the form that Linear stores is gated as a spec', () => {
    const stored =
      '```yaml\ntype: spec\nowner: Łukasz Zimnoch\nstatus: review\n' +
      'relates: https://linear.app/thesis-co/document/example-1234abcd\n```\n\n## 1. Terms\nOne term.\n';
    assert.match(save({ id: 'doc-2', content: stored }).reason, /^document-gate: the lint found these lines in doc-2:\ndoc-2:1: structure-heading-missing: the spec has no "## 2\. Scope" heading/);
  });

  test('a save of an intent that passes the lint and the judge allows', () => {
    assert.deepEqual(save({ title: 'Intent: Weekly export', content: INTENT }), {
      decision: 'allow',
      stage: 'judge',
      costUsd: 0.01,
      documents: [{ name: 'Intent: Weekly export', decision: 'allow' }],
    });
  });

  test('a save with a stage title and no frontmatter denies with no judge run', () => {
    const record = join(tempDir(), 'record.json');
    const result = decide(
      { tool_name: SAVE, tool_input: { title: 'Spec: Weekly export', content: '## 1. Terms\nOne term.\n' } },
      { env: judgeEnv('pass', { FAKE_RECORD: record }) },
    );
    assert.deepEqual(result, {
      decision: 'deny',
      reason: noFrontmatterReason('Spec: Weekly export', 'spec'),
      documents: [{ name: 'Spec: Weekly export', decision: 'deny' }],
    });
    assert.equal(existsSync(record), false);
  });

  test('an update by id of a document in the old form denies and asks for the frontmatter', () => {
    const old = '# Intent: Weekly export\nOwner: Ana Nowak · Status: review\nLinear: pending\n\n## 1. Executive summary\n';
    assert.equal(save({ id: 'doc-1', content: old }).reason, noFrontmatterReason('doc-1', 'intent'));
  });

  for (const [title, content, titleType, type] of [
    ['Spec: Weekly export', INTENT, 'spec', 'intent'],
    ['intent: weekly export', '```yaml\ntype: plan\n```\n', 'intent', 'plan'],
  ]) {
    test(`a save titled "${title}" with the type "${type}" denies`, () => {
      assert.equal(save({ title, content }).reason, typeMismatchReason(title, titleType, type));
    });
  }

  test('a save of a plan in Linear allows with no judge run', () => {
    const record = join(tempDir(), 'record.json');
    const result = decide({ tool_name: SAVE, tool_input: { title: 'Plan: Weekly export', content: PLAN } }, { env: judgeEnv('fail', { FAKE_RECORD: record }) });
    assert.equal(result.decision, 'allow');
    assert.equal(existsSync(record), false);
  });

  test('a save with a title that names no stage type is gated by its frontmatter', () => {
    assert.match(save({ title: 'Weekly export', content: DASHED }).reason, /in Weekly export:\nWeekly export:11: em-dash/);
  });

  test('a save through another Linear server name is gated', () => {
    assert.equal(save({ title: 'Intent: Weekly export', content: DASHED }, 'mcp__linear__save_document').decision, 'deny');
  });

  test('another tool allows', () => {
    assert.equal(save({ title: 'Intent: Weekly export', content: DASHED }, 'mcp__linear__get_document').decision, 'allow');
  });

  for (const [tool, matches] of [
    ['mcp__plugin_sdlc-kit_linear__save_document', true],
    ['mcp__claude_ai_Linear__save_document', true],
    ['mcp__linear__save_documents', false],
    ['save_document', false],
    ['mcp__linear__save_comment', false],
  ]) {
    test(`the save matcher ${matches ? 'matches' : 'does not match'} ${tool}`, () => {
      assert.equal(SAVE_TOOL.test(tool), matches);
    });
  }

  test('a push with a redirection in a repository with no stage directory allows', () => {
    const plain = tempDir('sdlc-kit-plain-');
    sh(plain, 'init', '-q', '-b', 'main');
    write(plain, 'README.md', 'A repository.\n');
    sh(plain, 'add', '-A');
    sh(plain, 'commit', '-m', 'Add the README');
    for (const command of ['git push origin main 2>&1 | tail -3', 'git push origin main > /dev/null 2>&1']) {
      assert.deepEqual(decide({ tool_name: 'Bash', cwd: plain, tool_input: { command } }, { env: judgeEnv('fail') }), { decision: 'allow', documents: [] });
    }
  });

  describe('a push', () => {
    const { root, work } = repository();
    write(work, '.sdlc-kit/2026-09-probe/spec.md', GIT_SPEC);
    write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN.replace('lands in one phase.', 'lands in one phase — the first.'));
    sh(work, 'add', '-A');
    sh(work, 'commit', '-m', 'Add a plan');
    const bash = (command, cwd = work, mode = 'pass') => decide({ tool_name: 'Bash', cwd, tool_input: { command } }, { env: judgeEnv(mode) });

    test('a push of a plan with an em-dash denies with the lint line', () => {
      const result = bash('git push origin HEAD');
      assert.equal(result.decision, 'deny');
      assert.match(result.reason, /\n\.sdlc-kit\/2026-09-probe\/plan\.md:9: em-dash: /);
    });

    test('the first denial stops the run', () => {
      const result = bash('git push origin HEAD', work, 'fail');
      assert.deepEqual(result.documents, [{ name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'deny' }]);
    });

    test('a push where every document passes allows', () => {
      write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
      sh(work, 'commit', '-am', 'Fix the plan');
      const result = bash('git push origin HEAD');
      assert.equal(result.decision, 'allow');
      assert.deepEqual(result.documents, [
        { name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/plan.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/spec.md', decision: 'allow' },
      ]);
    });

    test('a command with no push allows', () => {
      assert.deepEqual(bash('git status'), { decision: 'allow', documents: [] });
    });

    test('a push with a directory that the shell sets denies and asks for a literal path', () => {
      assert.deepEqual(bash('git -C "$REPO" push'), {
        decision: 'deny',
        reason: unresolvedReason('$REPO'),
        documents: [{ name: '$REPO', decision: 'deny' }],
      });
    });

    test('a push with a -C directory that does not exist denies', () => {
      const missing = join(root, 'missing');
      assert.equal(bash(`git -C ${missing} push`).reason, missingDirReason(missing));
    });

    test('a push after a cd to a directory that does not exist denies', () => {
      assert.equal(bash('cd missing && git push', root).reason, missingDirReason(join(root, 'missing')));
    });

    test('the judge runs of one push share one budget', () => {
      write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
      if (sh(work, 'status', '--porcelain')) sh(work, 'commit', '-qam', 'Fix the plan for the budget test');
      const slow = (slowFor, sleepMs, deadlineMs, floorMs) =>
        decide(
          { tool_name: 'Bash', cwd: work, tool_input: { command: 'git push origin HEAD' } },
          { env: judgeEnv('slow-for', { FAKE_SLOW_FOR: slowFor, FAKE_SLEEP_MS: String(sleepMs) }), deadline: Date.now() + deadlineMs, floorMs },
        );
      // The intent judge answers at once, and the plan judge never answers
      // in the time left.
      const timedOut = slow('# Plan:', 60_000, 5000, 100);
      assert.deepEqual(timedOut.documents, [
        { name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/plan.md', decision: 'deny' },
      ]);
      assert.match(timedOut.reason, /the judge gave no verdict in the time that the gate had left/);
      // The intent judge uses 4 of the 6 seconds, so less than the floor is
      // left for the plan.
      const floor = slow('# Intent:', 4000, 6000, 2500);
      assert.deepEqual(floor.documents, [
        { name: '.sdlc-kit/2026-09-probe/intent.md', decision: 'allow' },
        { name: '.sdlc-kit/2026-09-probe/plan.md', decision: 'deny' },
      ]);
      assert.equal(floor.reason, outOfTimeReason('.sdlc-kit/2026-09-probe/plan.md'));
    });

    test('a push inside a substitution after a cd is gated in that directory', () => {
      write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN.replace('lands in one phase.', 'lands in one phase \u2014 the first.'));
      sh(work, 'commit', '-am', 'Break the plan');
      const result = bash(`cd ${work} && out=$(git push origin HEAD 2>&1)`, root);
      assert.equal(result.decision, 'deny');
      assert.match(result.reason, /plan\.md:9: em-dash/);
    });

    test('a push with GIT_DIR from another directory reads that repository', () => {
      const result = bash(`GIT_DIR=${join(work, '.git')} GIT_WORK_TREE=${work} git push origin HEAD`, root);
      assert.match(result.reason, /plan\.md:9: em-dash/);
      write(work, '.sdlc-kit/2026-09-probe/plan.md', PLAN);
      sh(work, 'commit', '-am', 'Fix the plan again');
    });

    test('a push whose program word the shell sets denies and asks for a literal value', () => {
      assert.equal(bash('$(which git) push origin HEAD').reason, unresolvedReason('$SUBST'));
    });

    test('a push outside a repository allows', () => {
      assert.deepEqual(bash('git push', root), { decision: 'allow', documents: [] });
    });
  });
});

describe('the hook process', () => {
  const run = (input, env = {}) =>
    spawnSync(process.execPath, [hookScript], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...judgeEnv('pass'), ...env } });

  test('a denial prints the PreToolUse deny JSON and exits with 0', () => {
    const r = run({ hook_event_name: 'PreToolUse', tool_name: SAVE, tool_input: { id: 'doc-1', patch: [] } });
    assert.equal(r.status, 0);
    assert.equal(
      r.stdout,
      `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":${JSON.stringify(PATCH_REASON)}}}\n`,
    );
    assert.equal(r.stdout.trim(), denyOutput(PATCH_REASON));
  });

  test('an allow prints nothing and exits with 0', () => {
    const r = run({ tool_name: 'Bash', cwd: tmpdir(), tool_input: { command: 'ls' } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('the hook runs through a symlink to the plugin', () => {
    const link = join(tempDir(), 'plugin-link');
    symlinkSync(join(here, '..'), link);
    const r = spawnSync(process.execPath, [join(link, 'hooks', 'document-gate.mjs')], {
      input: JSON.stringify({ tool_name: SAVE, tool_input: { id: 'doc-1', patch: [] } }),
      encoding: 'utf8',
      env: judgeEnv('pass'),
    });
    assert.equal(r.stdout.trim(), denyOutput(PATCH_REASON));
  });

  test('with SDLC_KIT_GATE set, the hook exits at once with no output', () => {
    const { work } = repository();
    write(work, '.sdlc-kit/2026-09-probe/plan.md', DASHED);
    sh(work, 'add', '-A');
    sh(work, 'commit', '-m', 'Add a plan');
    const r = run({ tool_name: 'Bash', cwd: work, tool_input: { command: 'git push' } }, { SDLC_KIT_GATE: '1' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('input that is not JSON denies with the error', () => {
    const r = run('not json');
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /^document-gate: the gate failed: .*JSON.*\. Repeat the call\.$/);
  });

  test('a lint that does not load denies a stage document', () => {
    const plugin = tempDir();
    mkdirSync(join(plugin, 'hooks'));
    mkdirSync(join(plugin, 'scripts'));
    writeFileSync(join(plugin, 'hooks', 'document-gate.mjs'), readFileSync(hookScript));
    writeFileSync(join(plugin, 'scripts', 'lint.mjs'), 'export const = ;\n');
    const r = spawnSync(process.execPath, [join(plugin, 'hooks', 'document-gate.mjs')], {
      input: JSON.stringify({ tool_name: SAVE, tool_input: { title: 'Intent: Weekly export', content: INTENT } }),
      encoding: 'utf8',
      env: judgeEnv('pass'),
    });
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason, /^document-gate: the gate failed: the lint did not load: /);
  });

  test('SDLC_KIT_GATE_LOG gets one line per decision', () => {
    const log = join(tempDir(), 'gate.log');
    run({ tool_name: SAVE, tool_input: { title: 'Intent: Weekly export', content: DASHED } }, { SDLC_KIT_GATE_LOG: log });
    run({ tool_name: 'Bash', cwd: tmpdir(), tool_input: { command: 'ls' } }, { SDLC_KIT_GATE_LOG: log });
    const lines = readFileSync(log, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(`^\\d{4}-\\d{2}-\\d{2}T\\S+Z ${SAVE} Intent: Weekly export deny \\d+ms$`));
    rmSync(log);
  });
});

describe('hooks.json', () => {
  const config = JSON.parse(readFileSync(join(here, 'hooks.json'), 'utf8'));
  const entries = config.hooks.PreToolUse;

  test('one command hook serves the save matcher and the Bash matcher', () => {
    assert.deepEqual(entries.map((e) => e.matcher), ['^mcp__.+__save_document$', '^Bash$']);
    for (const entry of entries) {
      assert.deepEqual(entry.hooks, [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/document-gate.mjs"', timeout: 300 }]);
    }
  });

  test('the gate budget is at least 20 seconds below the hook timeout', () => {
    for (const entry of entries) {
      assert.ok(GATE_BUDGET_MS <= entry.hooks[0].timeout * 1000 - 20_000, `budget ${GATE_BUDGET_MS} ms, timeout ${entry.hooks[0].timeout} s`);
    }
  });

  test('the save matcher of hooks.json is the matcher of the hook', () => {
    assert.equal(entries[0].matcher, SAVE_TOOL.source);
  });
});
