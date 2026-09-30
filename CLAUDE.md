# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two documents, two audiences

- `CLAUDE.md` is for agents that do work in this repository: layout, commands, rules and gotchas.
- `README.md` is for people who use the plugin: what it does, how to install it, how to run the flow, and the commands it adds.
- State each fact in one of the two files. Do not copy install steps or usage into this file. Do not copy commands for the lint, the tests or the validation into the README.

## Layout

- `.claude-plugin/marketplace.json` at the root is the marketplace `thesis-sdlc-kit`. It lists one entry per plugin, with a relative `source`.
- `plugins/` holds one plugin per directory. `plugins/sdlc-kit/` is the only plugin today.
- A plugin holds `.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md`, `agents/`, `hooks/` and `scripts/`.
- `skills/intent/`, `skills/spec/` and `skills/plan/` each hold a `SKILL.md` with the procedure and a `template.md` with the numbered headings of the document.
- `skills/writing/SKILL.md` holds the writing rules and nothing else: no lifecycle text and no description of the checks. It is not user-invocable.
- `agents/writing-judge.md` is the writing judge: its rubric and its verdict format. It names the writing rules by their section titles and does not copy them.
- `hooks/hooks.json` wires the gate, `hooks/document-gate.mjs`, to two PreToolUse matchers: `save_document` on any MCP server, and `Bash`. `hooks/document-gate.test.mjs` holds its tests.
- `scripts/lint.mjs` is the lint. `scripts/linear.mjs` holds the text helpers for a Linear document: the export and the comment threads. It makes no network call. Each script has its tests in a `.test.mjs` file next to it.
- The scripts and the hook are plain Node 22 with no dependencies and no `package.json`.
- A skill refers to a file of the plugin through `${CLAUDE_PLUGIN_ROOT}`, in its body and in `allowed-tools`.

## Commands

Run every command from the repository root.

```
node --test 'plugins/sdlc-kit/scripts/*.test.mjs'
node --test 'plugins/sdlc-kit/hooks/*.test.mjs'
node --test --test-name-pattern 'em-dash' 'plugins/sdlc-kit/scripts/*.test.mjs'
claude plugin validate ./plugins/sdlc-kit --strict
claude plugin validate . --strict
claude --plugin-dir ./plugins/sdlc-kit plugin details sdlc-kit
node plugins/sdlc-kit/scripts/lint.mjs --type prose README.md CLAUDE.md
```

- The first command runs the tests of the scripts. The second runs the tests of the hooks. A new `.test.mjs` file in either directory runs under the same glob. The third command runs the tests whose name matches the pattern.
- The tests of the gate make no model call. They put a fake `claude` script on `SDLC_KIT_CLAUDE_BIN`, and they make their git repositories in the temp directory.
- Do not pass a directory to `node --test`. On Node 22 it fails with `MODULE_NOT_FOUND`. Use the glob.
- `claude plugin validate` checks `plugin.json`, `hooks/hooks.json` and the `skills`, `agents` and `commands` directories. It does not read the skill frontmatter. Run `plugin details` to see the skills, the agents, the hooks and the MCP server that load.
- The lint takes `--type intent|spec|plan|prose`. The `prose` type runs the mechanical checks and skips the structure checks. Each finding is one line, `path:line: rule-id: message`. The exit code is 1 with a finding, 0 when clean and 2 on a usage error. `--json` prints the findings as an array. A line with only `<!-- lint-disable -->` starts a part that the lint skips, and `<!-- lint-enable -->` ends it; the markers work only with `--type prose`.

## How the parts fit

- The `TEMPLATES` object in `lint.mjs` holds the headings, the header fields and the numbered sections of each document type. It must match `skills/<type>/template.md`. A test fills each template the way the skills do and lints it. A change to one side fails the tests until the other side follows.
- The intent and spec skills call the lint in their procedure, and their `allowed-tools` line permits only that command. The `allowed-tools` line of the plan skill permits `Read`, `Glob`, `Grep`, `Agent` and the scripts of the plugin. It permits no git command, no `gh` command and no MCP tool. The gate runs the lint again on each save of an intent or a spec, and on each push of a stage document. A Linear document with a `Plan:` title passes the gate, because the plan lives only in git.
- The gate imports `lintText` from `lint.mjs`. A lint finding denies the call with no model call.
- The gate composes the judge for each run. It passes the frontmatter and body of `agents/writing-judge.md`, then the body of `skills/writing/SKILL.md`, to a headless `claude -p` with `--agents`. The run has `--setting-sources ""` and starts in the temp directory, so it loads no CLAUDE.md, no memory and no git history.
- The judge run sets `SDLC_KIT_GATE=1`. A gate that starts with this variable set exits at once, so a hook inside the judge run does nothing.
- `SDLC_KIT_CLAUDE_BIN` replaces the `claude` binary of the judge run. `SDLC_KIT_JUDGE_MODEL` sets its model. `SDLC_KIT_GATE_LOG` names a file that gets one line per decision.
- The gate budget, `GATE_BUDGET_MS` in `document-gate.mjs`, is the time for the whole hook. Each judge run gets the part of the gate budget that is left.
- When Claude Code cannot start the hook, or the hook passes its timeout, Claude Code runs the tool call. Keep the gate budget below the timeout in `hooks.json`. Run the tests before every commit. A test fails when the gate budget is less than 20 seconds below that timeout.
- The skills write to Linear through the MCP server in `.mcp.json`.
- The documents of a push are the markdown files under `.sdlc-kit/` that its new commits change and that exist at the pushed ref. The gate lists them with `git log --diff-merges=combined <local ref> --not --remotes`, so a change that a merge commit makes itself counts too. A new commit is one that no remote-tracking ref of any remote holds, so the list depends on the last fetch. Before a first push to an empty remote, every commit is new, and the gate judges every stage document at the local ref.
- The judge run has `--strict-mcp-config`, so it loads no MCP server. Without it the run loads the instructions of the claude.ai connectors of the user, and its context grows by about a third.
- The plan skill runs its completeness check with the Agent tool. The subagent is `general-purpose`, never a fork, and gets the rubric inline from the skill, so it has a fresh context. The gate does not run it. The time of the check grows with the repository and has no bound. The gate budget must cover the writing judge of every document in a push.
- The steward and the feedback skill are not in the tree. Do not refer to a command that does not exist yet.

## Writing rules for this repository

- Every markdown file in this repository follows `plugins/sdlc-kit/skills/writing/SKILL.md`, this file and the README included. Commit messages, pull request descriptions and code comments are durable records in the sense of that skill, so its rules apply to them too.
- Before you commit, run the lint with `--type prose` on each markdown file that you changed. Fix every finding.
- Do not edit the block between the `<!-- lint-disable -->` and `<!-- lint-enable -->` markers of the writing skill. It quotes banned words and an em-dash as examples.
