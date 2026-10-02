---
name: spec
description: Turns an intent whose status is review into a spec in the sdlc-kit template, creates it as a Linear document that relates to the intent, and freezes the intent. Use it when someone has the Linear URL of an intent whose comment threads are all resolved, and wants the spec, the document where all roles agree on how the functionality works.
argument-hint: "<Linear URL of the intent> [<Linear URL of the spec>]"
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads *)
---

# Spec

The spec says how the functionality works, at a level that business, product and engineering people can all follow. It holds components, flows, requirements, risks and trade-offs. It holds no function signatures, storage layouts or file paths. The output is one Linear document titled `Spec: <name>`, linked to the intent, in the template of this skill. The skill also freezes the intent.

The input is the Linear URL of the intent: $ARGUMENTS

The skill saves the spec first and freezes the intent after it. A failure before the freeze leaves the intent in `review`, and the plan skill does not start from a spec whose intent is not frozen. A second URL in the input is the URL of a spec from an earlier run that stopped before the freeze. With it, do steps 1 to 6, then read the spec with `get_document`. Stop when its `relates` field is not the URL of the intent. Then go on at step 14.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the document and every comment that you post.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/spec/template.md` with the Read tool. The document uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Retry

When the lint lists findings, or the gate denies a save, fix the lines or the findings that it names. Then run the lint again, or repeat the save. Stop after three failed attempts. Give the owner the outstanding findings and the path of the draft. Offer to file the findings with `/sdlc-kit:feedback`. Then wait for the owner to decide. A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

## Procedure

1. Read the intent with the `get_document` tool of the Linear MCP server. Read every comment on the intent with the `list_comments` tool. Pass the `documentId` of the intent. When `hasNextPage` is true, read the next pages too.
2. Write the content of the intent to a scratch file outside any repository, with no edits. Write the comments of every page to one scratch file as one list, in the same way. Group the comments into threads:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads --content <content.md> <comments.json>
   ```

3. Stop when the `status` field in the frontmatter of the intent is not `review`. Tell the owner the status that you found. A `frozen` intent has a spec already. The comment of this skill on the intent names it.
4. Stop when a thread is open. A thread is open when `resolved` is false and `anchorResolved` is not true. Name each open thread by the first words of its first comment. Ask the owner to settle it and resolve it.
5. Check each resolved thread against the text of the intent. A resolved thread is a decision, and its outcome must be in the text. Stop when the text lacks the outcome of a resolved thread. Name each such thread. Ask the owner to write the outcome into the intent. Do not write it yourself.
6. Copy the scratch file of the intent. In the copy, set the `status` field to `frozen`. Change nothing else. Run the lint on the copy with `--type intent`. When the lint lists findings, stop. Give the owner the findings. The copy is the content of the freeze in step 14.
7. List the open problems of the intent and the decisions already taken. Show the list to the owner. Get the confirmation of the owner before you write a draft. Ask the owner which Linear team or project gets the spec. Propose the parent of the intent as the default.
8. Do the research read-only, in the repository that the owner gives, in external documents and in on-chain facts.
9. Interview the owner only on the forks that the research cannot settle. Ask one question at a time. A fork that stays open becomes an open decision with an owner and a date, not a paragraph of options.
10. Write the draft in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
    - Fill every section of the template.
    - Remove the guidance comments.
    - Keep the frontmatter of the template at the top, between the `---` lines, with the fields `type`, `owner`, `status` and `relates`.
    - Set `owner` to the name of the owner, `status` to `review` and `relates` to the URL of the intent.
    - Write the name of the spec in the title line `# Spec: <name>`.
    - Give each open decision a number, an owner and a date.
    - In "11. Intent open problems, answered", give each open problem of the intent an answer or an owner.
    - Refer to a section of the intent in the cross-reference form of the writing rules.

    Write at the spec altitude:
    - A section that only an engineer can review goes to the plan, not to the spec.
    - An example from the Robinhood spec: parameters and storage, functions, the deploy script, the automation scripts and the metrics exporter are plan material. Components, flows, risks, roles and deliverables stay in the spec.
    - Put "Risks we accept" material under "9. Risks".
    - Put "Areas of concern" material under "8. Trade-offs".

    Then remove the title line and the blank line after it from the draft. Keep the title `Spec: <name>` for the save. Linear shows the title of the document above the content, so the content has no title line.
11. Run the lint on the draft:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type spec <draft>
    ```

    When the lint lists findings, follow the retry rule above.
12. Read the draft again against the writing rules. Fix what you find. Then run the lint again.
13. Create the Linear document with the `save_document` tool of the Linear MCP server:
    - Use the title `Spec: <name>` of step 10.
    - Give the document exactly one parent: the team or the project that the owner confirmed.
    - Put the draft in `content` as markdown, with its frontmatter.

    The gate of the plugin runs on the save. When it denies the save, follow the retry rule above.
14. Freeze the intent. Save it with the `save_document` tool: the `id` and the `title` of the intent, and the copy of step 6 in `content`. The gate of the plugin runs on the save. When it denies the save, follow the retry rule above. Change only the lines that the gate names. When the save still fails after the retries, stop. Give the owner the URL of the spec and the findings. Tell the owner that the intent stays in `review`, and that `/sdlc-kit:spec <intent URL> <spec URL>` repeats the freeze.
15. Post a comment on the intent with the `save_comment` tool. Pass the `documentId` of the intent. The comment says that the intent is frozen, and gives the URL of the spec. The comment follows the writing rules.
16. Post one comment for each open decision with the `save_comment` tool. Pass the `documentId` of the spec. Address each comment to the owner of the decision with an @mention. Each comment follows the writing rules.
17. Give the owner the URL of the spec.

## When the spec is frozen

The plan skill freezes the spec: it sets the `status` field to `frozen` when it exports the spec. It does so only when the status is `review`, the intent is `frozen` and every comment thread on the spec is resolved. At that point each open problem of the intent has an answer or an owner, and no open decision blocks the plan. Nobody sets the status by hand.
