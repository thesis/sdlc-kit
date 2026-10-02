---
name: feedback
description: Files a problem report or an improvement idea about the sdlc-kit plugin as a Linear issue in the team that the plugin names. Use it when a skill or the gate of the plugin did something wrong, when the reporter disagrees with a finding, or when the reporter has an idea for the plugin.
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *) Bash(printenv SDLC_KIT_FEEDBACK_TEAM) Bash(claude --version)
---

# Feedback

The feedback skill files one problem report or one improvement idea about the plugin as a Linear issue. The issue goes to the team that the plugin names and stays in Linear. The Linear MCP server creates the issue under the Linear account of the reporter, so the reporter needs no GitHub account.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the issue and every comment that you post.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/feedback/template.md` with the Read tool. The issue body uses the block of its path, with its headings in its order.

## Not in a report

A report holds no body of an intent, a spec or a plan. A complaint about a writing rule quotes the one sentence that fails, with the finding. Put the sentence and the finding in a code block, with no edits. The lint of the draft skips a code block. Name any other document by its type only.

## Procedure

1. Tell the reporter in three or four sentences what a useful report holds. A useful report names the skill or the hook, what was run, what happened and what the reporter expected. It holds the denial text of the gate with no edits, when the gate denied a call. It holds no body of a stage document. The skill adds the version of the plugin and the version of Claude Code.
2. Ask which path the report takes: a problem report or an improvement idea.
3. Interview the reporter. Ask one question at a time, in this order.

   For a problem report:
   1. which skill or hook;
   2. what was run;
   3. what happened;
   4. what the reporter expected;
   5. the exact denial text of the gate, when there was one.

   For an improvement idea:
   1. the situation;
   2. what the plugin should do instead;
   3. why the current behavior is not enough.

   Stop the questions about a field when it has one concrete answer. Put the denial text in a code block, with no edits.
4. Gather the context without a question:
   - the plugin version: the `version` field of `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`;
   - the surface: `Claude Code` when `claude --version` prints a version, else `Cowork`;
   - the Claude Code version: the output of `claude --version`, or `None` in Cowork;
   - the active skill: the sdlc-kit skill that was active in the conversation, or `None`;
   - the target repository: its name from the conversation when the report is about a plan or a push, else `None`.
5. Find the team. Run `printenv SDLC_KIT_FEEDBACK_TEAM`. When it prints a value, that value is the team. Otherwise the team is the `feedbackTeam` field of `${CLAUDE_PLUGIN_ROOT}/config.json`. Do not ask anyone for the team.
6. Check the team with the `get_team` tool of the Linear MCP server. When the team does not exist, stop. Tell the reporter the name of the team and where the name comes from: the variable `SDLC_KIT_FEEDBACK_TEAM` or `config.json`.
7. Write the title as one line that names the problem or the idea. Do not start the title with a type, such as `Bug:` or `Idea:`. The labels of step 12 give the type.
8. Search the team for the same report with the `list_issues` tool. Pass the `team` and the words of the title as `query`. When a match exists, show the reporter its title and its URL. Offer a comment on that issue instead of a new issue.
9. Write the body in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
   - Keep the block of the path of the report, and remove the other block.
   - Fill every section of the block.
   - Remove the guidance comments.
10. Run the lint on the draft:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type prose <draft>
    ```

    When the lint lists findings, fix the lines that it names. Then run the lint again.
11. When the reporter chose the comment of step 8, post the draft with the `save_comment` tool. Pass the `issueId` of the match and the draft as `body`. Then go to step 14.
12. Check the two labels of the issue with the `list_issue_labels` tool. Pass the `team` and the `name` of one label in each call. The first label is `Feedback` for every issue. The second label is `Bug` for a problem report, or `Improvement` for an improvement idea.
13. Create the issue with the `save_issue` tool. Pass the `team`, the `title`, the draft as `description`, `triage` as `state`, and the labels that the team has in `labels`. When the team has neither label, create the issue with no `labels`. Do the same when the save fails because of a label. Then tell the reporter which label the issue does not have. When the save fails because the team has no triage state, create the issue with no `state`. Then tell the reporter that the issue is not in triage. No hook of this plugin judges the issue.
14. Give the reporter the URL of the issue.
