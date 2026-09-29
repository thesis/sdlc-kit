# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two documents, two audiences

- `CLAUDE.md` is for agents that do work in this repository: layout, commands, rules and gotchas.
- `README.md` is for people who use the plugin: what it does, how to install it, how to run the flow, and the commands it adds.
- State each fact in one of the two files. Do not copy install steps or usage into this file. Do not copy commands for the lint, the tests or the validation into the README.

## Layout

- `.claude-plugin/marketplace.json` at the root is the marketplace `thesis-sdlc-kit`. It lists one entry per plugin, with a relative `source`.
- `plugins/` holds one plugin per directory. `plugins/sdlc-kit/` is the only plugin today.
- A plugin holds `.claude-plugin/plugin.json`, `.mcp.json`, `skills/<name>/SKILL.md` and `scripts/`.
- `skills/intent/` and `skills/spec/` each hold a `SKILL.md` with the procedure and a `template.md` with the numbered headings of the document.
- `skills/writing/SKILL.md` holds the writing rules and the description of what the lint checks. It is not user-invocable. The other skills read it with the Read tool.
- `scripts/lint.mjs` is the lint. `scripts/lint.test.mjs` holds its tests. Both are plain Node 22 with no dependencies and no `package.json`.
- A skill refers to a file of the plugin through `${CLAUDE_PLUGIN_ROOT}`, in its body and in `allowed-tools`.

## Commands

Run every command from the repository root.

```
node --test 'plugins/sdlc-kit/scripts/*.test.mjs'
node --test --test-name-pattern 'em-dash' 'plugins/sdlc-kit/scripts/*.test.mjs'
claude plugin validate ./plugins/sdlc-kit --strict
claude plugin validate . --strict
claude --plugin-dir ./plugins/sdlc-kit plugin details sdlc-kit
node plugins/sdlc-kit/scripts/lint.mjs --type prose README.md CLAUDE.md
```

- The first command runs all tests. The second runs the tests whose name matches the pattern.
- Do not pass a directory to `node --test`. On Node 22 it fails with `MODULE_NOT_FOUND`. Use the glob.
- `claude plugin validate` checks the manifests only. It does not read the skill frontmatter. Run `plugin details` to see the skills and the MCP server that load.
- The lint takes `--type intent|spec|plan|prose` and `--json`. The exit code is 0 when clean, 1 on a finding, 2 on a usage error. The writing skill lists the rules that it checks.

## How the parts fit

- The `TEMPLATES` object in `lint.mjs` holds the headings, the header fields and the numbered sections of each document type. It must match `skills/<type>/template.md`. A test fills each template the way the skills do and lints it. A change to one side fails the tests until the other side follows.
- The plan type exists in the lint and has no skill yet. Keep it, so a later plan skill does not change the CLI.
- The intent and spec skills run the lint on every draft themselves, through the `allowed-tools` line. No hook runs it.
- The skills write to Linear through the MCP server in `.mcp.json`. `save_document` has no status field, so the `Status:` line in the header is the status of the document.
- The judge, the gate hook, the plan skill, the steward and the feedback skill are not in the tree. Do not refer to a command that does not exist yet.

## Writing rules for this repository

- Every markdown file in this repository follows the writing skill, this file and the README included. Run the lint with `--type prose` on each file that you change, and fix every finding before you commit.
- The block between `<!-- lint-disable -->` and `<!-- lint-enable -->` in the writing skill quotes banned words and an em-dash as examples. The lint skips it. Do not edit it in place.
- Commit messages, pull request descriptions and code comments follow the same rules. They describe the end state of the repository, not the steps that led there.
- Do not write a volatile count in a durable text, such as the number of tests or of rules. The lint cannot find one, so check for it yourself.
