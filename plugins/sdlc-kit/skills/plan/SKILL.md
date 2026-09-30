---
name: plan
description: Freezes an agreed intent and spec, exports them to the target repository, and writes the plan in the sdlc-kit template, in one draft pull request. Use it when the owner marked the spec agreed and someone has the Linear URL of the spec.
argument-hint: "<Linear URL of the spec>"
allowed-tools: Read Glob Grep Agent Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# Plan

The plan says how agents build what the spec describes. Its first readers are the agents that build. Engineers read "1. Summary" and "2. Work order" of the plan for the big picture. The plan holds files, tests, commands and checks. An agent with a fresh context can build from the plan, the spec and the intent alone. Every requirement of the spec traces to a file and a test.

The output is one branch and one draft pull request in the target repository, the repository where the feature lands. The pull request adds the stage directory `.sdlc-kit/YYYY-MM-<slug>/` with `intent.md`, `spec.md` and `plan.md`. The output never goes to thesis/sdlc-kit.

Run the skill when the owner marked the spec agreed in Linear. The skill stops when the working directory is not a git checkout with a GitHub remote. It also stops when the `Status:` line of the spec is not `agreed`.

The input is the Linear URL of the spec: $ARGUMENTS

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the plan, every comment that you post and the pull request description.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/plan/template.md` with the Read tool. The plan uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Rules for the stage files

- Change a stage file only with a commit and a plain `git push`. Do not write repository contents through `gh api`, `curl` or any other route. The gate sees only the push.
- The branch name, the commit messages and the pull request description follow the rules of the target repository. These rules are in files such as its CLAUDE.md and its pull request template. Write the pull request description with the writing skill loaded. No hook of this plugin judges it.

## Retry

When the lint lists findings, or the gate denies a save or a push, fix the lines or the findings that it names. Then run the lint again, or repeat the call. Stop after three failed attempts. Give the owner or the engineer the outstanding findings and the path of the file. Then wait for their decision. A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

## Procedure

1. Check that the working directory is a git checkout with a remote on GitHub. Stop when it is not.
2. Read the spec with the `get_document` tool of the Linear MCP server.
3. Read every comment on the spec with the `list_comments` tool. Pass the `documentId` of the spec. When `hasNextPage` is true, read the next pages too.
4. Stop when the `Status:` line of the spec is not `agreed`. Tell the owner the status that you found.
5. Follow the `Implements: Intent <url>` line of the spec to the intent. Read the intent and its comments in the same way.
6. Write the content of each document to a scratch file outside the repository, with no edits. Write each comment list to a scratch file in the same way.
7. Group the comments of each document into threads:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads --content <content.md> <comments.json>
   ```

8. Check each resolved thread against the document text. A thread is resolved when `resolved` or `anchorResolved` is true. The outcome of each resolved thread must be in the text.
9. Check each open decision of the spec and each open problem of the intent for an answer in the text. An open problem of the intent can also point at the spec.
10. Stop when the text lacks the outcome of a resolved thread, or an open decision has no answer. Name each such thread or decision. Ask the owner to write the outcome into the document. Do not write it yourself.
11. Propose the stage directory name `.sdlc-kit/YYYY-MM-<slug>/` from the current month and the title of the spec. Wait for the owner to accept or change it.
12. Run `git fetch`.
13. Create the branch from the default branch of the remote. The name follows the rules of the target repository.
14. In the content of each document, set the `Status:` line to `Status: frozen`. Change nothing else.
15. Save each document with the `save_document` tool: the `id` of the document and the full content in `content`. The gate of the plugin runs on each save. When it denies a save, follow the retry rule above.
16. Export each document into the stage directory, the intent to `intent.md` and the spec to `spec.md`:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs export --url <document URL> <content.md>
    ```

17. Run the lint on both files, with `--type intent` and `--type spec`. Do not edit the agreed text. When the lint lists findings, stop. Give the owner the findings and the path of each file. Then wait for the owner to decide.
18. Commit `intent.md` and `spec.md` as the first commit of the branch.
19. Push the branch with `git push`. The gate runs on the push. When it denies the push, follow the retry rule above.
20. Open the pull request as a draft with `gh pr create --draft`.
21. Post a comment with the URL of the pull request on each Linear document, with the `save_comment` tool. Each comment follows the writing rules.
22. Survey the repository read-only, for every deliverable in "7. Deliverables" of the spec. Find the files, the tests and the commands that each deliverable touches.
23. Write down each fact from the survey that the spec did not know. These facts go to "5. Risks before the work starts" of the plan.
24. Interview the engineer only on repository choices. Ask one question at a time. The choices are these:
    - the CI gates of a phase;
    - the test budget of a phase;
    - whether the phases depart from stacked pull requests, which are the default.

    Do not ask about a decision of the spec. A gap in the spec becomes a blocker in "6. Blockers" that names the section of the spec.
25. Write `plan.md` in the stage directory, in the template. Use these steps:
    - Fill every section of the template.
    - Remove the guidance comments.
    - Set the two shas of the `Implements:` line of the template to the sha of the export commit.
    - Keep the heading "7. What changed". In the first plan, the section holds no entry.
    - Map every requirement of the spec to at least one file change and one test.
    - Give every phase a merge gate that a script can check.
    - Refer to a section of the spec or the intent in the cross-reference form of the writing rules.
26. Run the lint on the plan:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type plan <stage directory>/plan.md
    ```

    When the lint lists findings, follow the retry rule above.
27. Run the completeness judge with the Agent tool. Use the agent `sdlc-kit:completeness-judge`. Never run it as a fork.
28. Give the judge a prompt with two lines only:
    - the absolute path of the stage directory;
    - the absolute path of the repository root.

    Add no other text, because the judge must see only the files.
29. When the verdict lists items, fix the plan. Then run the judge again. Do not do more than three judge runs. After the third failed run, give the engineer the outstanding items and the path of the plan. Then wait for the engineer to decide.
30. Commit the plan. Then push the branch with `git push`. The gate runs on the push. When it denies the push, follow the retry rule above.
31. Mark the pull request ready with `gh pr ready`.
32. Give the owner the URL of the pull request.

## During the build

- Each phase lands in its own pull request.
- A code pull request edits the plan only when the work found something unexpected that changes the plan itself.
- Such an edit is an entry in "7. What changed", in the form of the template, and the correction to the phase, the spec or the intent. The gate judges the changed documents on the push.
- When the last phase merges, the stage is done. Nothing in it changes again. A new need starts a new intent.
