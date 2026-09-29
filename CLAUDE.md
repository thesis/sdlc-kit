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
- `skills/intent/` and `skills/spec/` each hold a `SKILL.md` with the procedure and a `template.md` with the numbered headings of the document.
- `skills/writing/SKILL.md` holds the writing rules and describes what the lint checks. It is not user-invocable.
- `agents/writing-judge.md` is the judge: its rubric and its verdict format. It names the writing rules by their section titles and does not copy them.
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

- The first command runs the tests of the lint and of `linear.mjs`. The second runs the tests of the gate. The third runs the tests whose name matches the pattern.
- The tests of the gate make no model call. They put a fake `claude` script on `SDLC_KIT_CLAUDE_BIN`, and they make their git repositories in the temp directory.
- Do not pass a directory to `node --test`. On Node 22 it fails with `MODULE_NOT_FOUND`. Use the glob.
- `claude plugin validate` checks `plugin.json`, `hooks/hooks.json` and the `skills`, `agents` and `commands` directories. It does not read the skill frontmatter. Run `plugin details` to see the skills, the agents, the hooks and the MCP server that load.
- The section "What the lint checks" of the writing skill has the types of the lint, its output form and its rules. Beyond that, `--json` prints the findings as an array, and the exit code 2 means a usage error.

## How the parts fit

- The `TEMPLATES` object in `lint.mjs` holds the headings, the header fields and the numbered sections of each document type. It must match `skills/<type>/template.md`. A test fills each template the way the skills do and lints it. A change to one side fails the tests until the other side follows.
- The plan type exists in the lint and has no skill yet. Keep it, so a later plan skill does not change the CLI.
- The intent and spec skills call the lint in their procedure, and their `allowed-tools` line permits only that command. The gate runs the lint again on each save of an intent or a spec, and on each push of a stage document. A Linear document with a `Plan:` title passes the gate, because the plan lives only in git.
- The gate imports `lintText` from `lint.mjs`. A lint finding denies the call with no model call.
- The gate composes the judge for each run. It passes the frontmatter and body of `agents/writing-judge.md`, then the body of `skills/writing/SKILL.md`, to a headless `claude -p` with `--agents`. The run has `--setting-sources ""` and starts in the temp directory, so it loads no CLAUDE.md, no memory and no git history.
- The judge run sets `SDLC_KIT_GATE=1`. A gate that starts with this variable set exits at once, so a hook inside the judge run does nothing.
- `SDLC_KIT_CLAUDE_BIN` replaces the `claude` binary of the judge run. `SDLC_KIT_JUDGE_MODEL` sets its model. `SDLC_KIT_GATE_LOG` names a file that gets one line per decision.
- The gate budget, `GATE_BUDGET_MS` in `document-gate.mjs`, is the time for the whole hook. Each judge run gets the part of the gate budget that is left.
- When Claude Code cannot start the hook, or the hook passes its timeout, Claude Code runs the tool call. Keep the gate budget below the timeout in `hooks.json`. Run the tests before every commit. A test fails when the gate budget is less than 20 seconds below that timeout.
- The skills write to Linear through the MCP server in `.mcp.json`.
- The plan skill, the steward and the feedback skill are not in the tree. Do not refer to a command that does not exist yet.

## Writing rules for this repository

- Every markdown file in this repository follows `plugins/sdlc-kit/skills/writing/SKILL.md`, this file and the README included. Commit messages, pull request descriptions and code comments are durable records in the sense of that skill, so its rules apply to them too.
- Before you commit, run the lint with `--type prose` on each markdown file that you changed. Fix every finding.
- Do not edit the block between the `<!-- lint-disable -->` and `<!-- lint-enable -->` markers of the writing skill. It quotes banned words and an em-dash as examples.
