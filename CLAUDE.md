# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Two documents, two audiences

- `CLAUDE.md` is for agents that do work in this repository: layout, commands, rules and gotchas.
- `README.md` is for people who use the plugin: what it does, how to install it, how to run the flow, and the commands it adds.
- State each fact in one of the two files. Do not copy install steps or usage into this file. Do not copy commands for the lint, the tests or the validation into the README.

## Layout

- `.claude-plugin/marketplace.json` at the root is the marketplace `thesis-sdlc-kit`. It lists one entry per plugin, with a relative `source`.
- `plugins/` holds one plugin per directory. `plugins/sdlc-kit/` is the only plugin today.
- A plugin holds `.claude-plugin/plugin.json`, `.mcp.json`, `config.json`, `skills/<name>/SKILL.md`, `agents/`, `hooks/` and `scripts/`.
- `config.json` holds `feedbackTeam`, the Linear team that gets the issues of the feedback skill. The value is a team ID, because a team name can match more than one team. The value is the same for every repository. No configuration file exists per repository.
- `skills/intent/`, `skills/spec/` and `skills/plan/` each hold a `SKILL.md` with the procedure and a `template.md` with the numbered headings of the document.
- `skills/steward/SKILL.md` holds the steward: it works the open threads on a Linear document or on a pull request.
- `skills/feedback/` holds a `SKILL.md` with the procedure and a `template.md` with the body of the issue, one block per path.
- `skills/writing/SKILL.md` holds the writing rules and nothing else: no lifecycle text and no description of the checks. It is not user-invocable.
- `agents/writing-judge.md` is the writing judge: its rubric and its verdict format. It names the writing rules by their section titles and does not copy them.
- `hooks/hooks.json` wires the gate, `hooks/document-gate.mjs`, to two PreToolUse matchers: `save_document` on any MCP server, and `Bash`. `hooks/document-gate.test.mjs` holds its tests.
- `scripts/lint.mjs` is the lint. `scripts/linear.mjs` holds the text helpers for a Linear document: the frontmatter parser, the export and the comment threads. It makes no network call. `scripts/github.mjs` reads the unresolved review threads of a pull request and posts a reply in a thread, through `gh`. Each script has its tests in a `.test.mjs` file next to it.
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
- The lint takes `--type intent|spec|plan|prose` and `--form linear|git`. The form is `linear` by default for an intent and a spec, and `git` for a plan. The plan has no `linear` form, and `--form linear` with `--type plan` is a usage error. The `prose` type ignores the form. The `prose` type runs the mechanical checks and skips the structure checks. Each finding is one line, `path:line: rule-id: message`. The exit code is 1 with a finding, 0 when clean and 2 on a usage error. `--json` prints the findings as an array. A line with only `<!-- lint-disable -->` starts a part that the lint skips, and `<!-- lint-enable -->` ends it; the markers work only with `--type prose`.

## How the parts fit

- The `TEMPLATES` object in `lint.mjs` holds the headings, the frontmatter fields and the numbered sections of each document type. It must match `skills/<type>/template.md`. A test fills each template the way the skills do and lints it. A change to one side fails the tests until the other side follows.
- Each stage document starts with a frontmatter of flat `key: value` lines with lowercase keys: `type`, `owner`, `relates` and `exported`. `readFrontmatter` in `linear.mjs` parses only this subset, with no YAML library, and reports every other line as an error.
- No field holds the state of a document. The owner decides when a document is ready for the next skill. The spec skill and the plan skill report the open threads and the resolved threads with no outcome in the text, and go on. The lint rejects a `status` field as a field that the type does not take. A document of an earlier version loses the line on its next save.
- The `relates` field is a comma list of links. In Linear each item is a URL. The spec has `relates: <intent URL>` from its creation. The intent template has the line `relates: <spec URL>, <plan PR URL>`. The intent skill removes it before the first save. So the intent has no `relates` field until the spec skill saves the spec. The spec skill sets the `relates` line of the spec template, `relates: <intent URL>, <plan PR URL>`, to the intent URL only. Then the spec skill adds `relates: <spec URL>` to the intent. After the plan skill opens the pull request, it appends the pull request URL to the `relates` field of the intent and of the spec. Each of these saves is best effort: a failure is a notice to the owner, not a stop.
- The skills change a frontmatter field with a patch save: `save_document` with `id` and `patch`, and no `content`. Each op of a skill writes one `key: value` line of the frontmatter.
- The gate cannot read the document of a patch, so it cannot tell a stage document from another document. It allows every patch save with no lint and no judge run. A save with `patch` and `content` is gated by its content. Only the skills keep a patch of a stage document to frontmatter fields.
- Before it drafts, the spec skill looks for a spec of the intent. It looks in the `relates` field of the intent, in the documents of the parent of the intent and by title. After `git fetch`, the plan skill looks for a plan of the spec. It looks in the `relates` field of the spec, in the pull requests of the remote and in the `spec.md` files of every remote branch. Both searches are best effort. A find is a question to the owner, and no find is a notice that the owner checks.
- In git, each stage file links the other two files of its stage directory by relative path. `GIT_RELATES` in `linear.mjs` holds the lists: `spec.md, plan.md` for the intent, `intent.md, plan.md` for the spec and `spec.md, intent.md` for the plan. `linear.mjs export` writes that list in place of the Linear URLs. With a path, the lint checks that each file of the list is next to the file. The `exists` option of `lintText` replaces that look. The gate passes an `exists` that looks at the files of the pushed ref, not at the working tree.
- The plan skill pushes once, with the commit of the export and the commit of the plan. So the lint of the exported files in the git form runs after `plan.md` exists.
- A stage document has two forms. The Linear form of an intent or a spec has no `#` title line, because Linear shows the title of the document. The skills save the frontmatter between `---` lines, and Linear stores it as a `yaml` code block, so the Linear form accepts both. The git form is a file under `.sdlc-kit/`: the frontmatter between `---` lines on line 1, then the line `# Intent: <name>`, `# Spec: <name>` or `# Plan: <name>`. The intent and the spec in git also have `exported: <document URL> · <ISO time>`, the only link back to Linear.
- `linear.mjs export` turns the Linear form into the git form. It takes the name of the title line from `--title`, the title of the Linear document.
- Each template has the layout of the git form: the frontmatter between `---` lines on line 1, a blank line, then the title line. The intent and spec skills remove the title line before the lint and the save, and pass the name in the `title` of `save_document`. A test lints the Linear form of each template, the template with no title line.
- An old document has header lines such as `Owner:` and `Status:` and no frontmatter. Its lint finding says how to move the header lines into the frontmatter. The lint has no other path for that form.
- The intent and spec skills call the lint in their procedure. The `allowed-tools` line of the intent skill permits only that command. The line of the spec skill also permits `linear.mjs threads`, for the threads of the intent. The `allowed-tools` line of the plan skill permits `Read`, `Glob`, `Grep`, `Agent` and the scripts of the plugin. It permits no git command, no `gh` command and no MCP tool. The `allowed-tools` line of the steward skill is the same, with no `Agent`. The gate runs the lint again on each save of an intent or a spec, and on each push of a stage document.
- The gate reads the type of a save from the `type` field of the frontmatter of `content`, and lints the save in the Linear form. A save with no frontmatter is not a stage document and passes, unless its title or its first line names an intent or a spec. Then the gate denies it. The gate also denies a save whose title prefix, `Intent:` or `Spec:`, names another type than the `type` field, when that field is `intent`, `spec` or `plan`. A `type` field of another value is not a stage type, so the save passes. A save of the type `plan` passes the gate, because the plan lives only in git.
- On a push, the file name gives the type, and the gate lints the file in the git form. The lint checks that the `type` field matches the file name.
- The gate imports `lintText` from `lint.mjs`. A lint finding denies the call with no model call.
- The lint and the gate remove the `<linear-comment>` anchors of Linear before they read a document. So a skill can lint and save the content that `get_document` returned, with its anchors in place.
- The gate composes the judge for each run. It passes the frontmatter and body of `agents/writing-judge.md`, then the body of `skills/writing/SKILL.md`, to a headless `claude -p` with `--agents`. The run has `--setting-sources ""` and starts in the temp directory, so it loads no CLAUDE.md, no memory and no git history.
- The judge run sets `SDLC_KIT_GATE=1`. A gate that starts with this variable set exits at once, so a hook inside the judge run does nothing.
- `SDLC_KIT_CLAUDE_BIN` replaces the `claude` binary of the judge run. `SDLC_KIT_JUDGE_MODEL` sets its model. `SDLC_KIT_GATE_LOG` names a file that gets one line per decision.
- The gate budget, `GATE_BUDGET_MS` in `document-gate.mjs`, is the time for the whole hook. Each judge run gets the part of the gate budget that is left.
- When Claude Code cannot start the hook, or the hook passes its timeout, Claude Code runs the tool call. Keep the gate budget below the timeout in `hooks.json`. Run the tests before every commit. A test fails when the gate budget is less than 20 seconds below that timeout.
- The skills write to Linear through the MCP server in `.mcp.json`.
- The documents of a push are the markdown files under `.sdlc-kit/` that its new commits change and that exist at the pushed ref. The gate lists them with `git log --diff-merges=combined <local ref> --not --remotes`, so a change that a merge commit makes itself counts too. A new commit is one that no remote-tracking ref of any remote holds, so the list depends on the last fetch. Before a first push to an empty remote, every commit is new, and the gate judges every stage document at the local ref.
- The gate cannot list the documents of a push when the shell sets its directory or a refspec, or when its directory does not exist. The gate allows such a push with no lint and no judge run. The skills push with a plain `git push`, which the gate can always list.
- The gate finds a push only when the program word is a literal `git`, such as `git` or `/usr/bin/git`. So `$(which git) push` is not a push for the gate.
- A push of a local ref that does not exist publishes nothing, because git stops it. The gate skips the ref.
- The judge run has `--strict-mcp-config`, so it loads no MCP server. Without it the run loads the instructions of the claude.ai connectors of the user, and its context grows by about a third.
- The plan skill runs its completeness check with the Agent tool. The subagent is `general-purpose`, never a fork, and gets the rubric inline from the skill, so it has a fresh context. The gate does not run it. The time of the check grows with the repository and has no bound. The gate budget must cover the writing judge of every document in a push.
- `github.mjs` wraps `gh api graphql`. It reads threads and posts replies. It never pushes, never resolves a thread and never writes repository contents. It passes each value to `gh` as a GraphQL variable, never inside the text of the query.
- `SDLC_KIT_GH_BIN` replaces the `gh` binary of `github.mjs`. The tests of `github.mjs` put a fake `gh` script there. A `gh` failure is an error with the stderr of `gh`, never an empty list of threads.
- The steward pushes its edits with a plain `git push`, so the gate judges them. Its replies go through `save_comment` or `github.mjs`, and no gate runs on them.
- The feedback skill reads the team from `SDLC_KIT_FEEDBACK_TEAM` first, then from `feedbackTeam` in `config.json`. It creates the issue with `save_issue` in the triage state of the team. That call is not a `save_document` call, so no gate runs on a feedback issue.

## Writing rules for this repository

- Every markdown file in this repository follows `plugins/sdlc-kit/skills/writing/SKILL.md`, this file and the README included. Commit messages, pull request descriptions and code comments are durable records in the sense of that skill, so its rules apply to them too.
- Before you commit, run the lint with `--type prose` on each markdown file that you changed. Fix every finding.
- Do not edit the block between the `<!-- lint-disable -->` and `<!-- lint-enable -->` markers of the writing skill. It quotes banned words and an em-dash as examples.
