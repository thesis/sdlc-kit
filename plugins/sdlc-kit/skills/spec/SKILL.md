---
name: spec
description: Turns an intent into a spec in the sdlc-kit template, and creates the spec as a Linear document that relates to the intent. Use it when someone has the Linear URL of an intent and wants the spec, the document where all roles agree on how the functionality works.
argument-hint: "<Linear URL of the intent>"
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *) Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads *)
---

# Spec

The spec says how the functionality works, at a level that business, product and engineering people can all follow. It holds components, flows, requirements, risks and trade-offs. It holds no function signatures, storage layouts or file paths. The output is one Linear document titled `Spec: <name>`, linked to the intent, in the template of this skill.

The input is the Linear URL of the intent: $ARGUMENTS

The owner decides when the intent is ready for the spec. The skill reports the open threads of the intent and goes on. After the save of the spec, the skill adds the URL of the spec to the `relates` field of the intent. That change is a patch save, and it is best effort. A patch save holds only `replace`, `insert_before` or `insert_after` ops, and each op writes one `key: value` line of the frontmatter. The gate runs no lint and no judge on a patch save, so keep each patch to these ops.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the document.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/spec/template.md` with the Read tool. The document uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Retry

Each finding of the writing judge has a severity: `high`, `medium` or `low`. The gate denies a save with a high finding. It allows a save with only medium and low findings, and gives you those findings.

Before each save, you may run the `sdlc-kit:writing-judge` agent once on the draft, for an early verdict. Do not run it at other times.

When the lint lists findings, fix the lines that it names. When the gate denies a save, fix each high finding, and each medium and low finding that you can. Fix the findings of an early verdict in the same way. Then run the lint again, or repeat the save. When the gate allows a save with medium or low findings, fix each finding that you can. Then repeat the save, with the `id` that the first save returned.

For a finding of "Source every fact", ask the owner once for the source of that fact. Skip the question when the owner already answered a question about that fact. With no source, you cannot fix the finding.

Stop after three failed attempts. A save only to fix medium or low findings counts as one of these attempts. Also stop when you cannot fix any finding that is left. Give the owner the findings that are left, with their severity, and the path of the draft. Offer to file the findings with `/sdlc-kit:feedback`. Then wait for the owner to decide.

A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

## Procedure

1. Read the intent with the `get_document` tool of the Linear MCP server. Read every comment on the intent with the `list_comments` tool. Pass the `documentId` of the intent. When `hasNextPage` is true, read the next pages too.
2. Write the content of the intent to a scratch file outside any repository, with no edits. Write the comments of every page to one scratch file as one list, in the same way. Group the comments into threads:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads --content <content.md> <comments.json>
   ```

3. Look for a spec of this intent. The search is best effort. A document is a spec of the intent when its `relates` field holds the URL of the intent. Look in three places:
   - the `relates` field of the intent, when it holds the URL of a Linear document;
   - the documents of the parent of the intent: call the `list_documents` tool with the `projectId` or the `teamId` of the parent, `content` in `fields` and a `limit` of 250;
   - the documents whose title holds the name of the intent: call the `list_documents` tool with the `query` `Spec: <name>`.

   When you find a spec, give the owner its URL and ask what to do. Go on only when the owner says so. When you find none, tell the owner that the search is best effort and that the owner checks that no spec exists. Then go on.
4. Tell the owner each open thread. A thread is open when `resolved` is false and `anchorResolved` is not true. Name each open thread by the first words of its first comment. Then go on.
5. Check each resolved thread against the text of the intent. A resolved thread is a decision, and its outcome must be in the text. Tell the owner each resolved thread whose outcome the text lacks. Name each such thread. Do not write the outcome yourself. Then go on.
6. List the open problems of the intent and the decisions already taken. Show the list to the owner. Get the confirmation of the owner before you write a draft. Ask the owner which Linear team or project gets the spec. Propose the parent of the intent as the default.
7. Do the research read-only, in the repository that the owner gives, in external documents and in on-chain facts.
8. Interview the owner only on the forks that the research cannot settle, and on the facts with no source. Ask one question at a time. A fork that stays open becomes an open decision with an owner and a date, not a paragraph of options. For a fact with no source after the research that "Source every fact" of the writing rules covers, ask for its source. When the owner answers "I don't know", keep the sentence with no source note. Do not ask about that fact again.
9. Write the draft in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
    - Fill every section of the template.
    - Remove the guidance comments.
    - Keep the frontmatter of the template at the top, between the `---` lines, with the fields `type`, `owner` and `relates`.
    - Set `owner` to the name of the owner and `relates` to the URL of the intent only.
    - Write the name of the spec in the title line `# Spec: <name>`.
    - Put each open decision under "10. Open decisions". Give it a number and an owner note with the owner and the date, in the form of the writing rules. The section is the only record of the open decisions. Do not post a comment for them.
    - In "11. Intent open problems, answered", give each open problem of the intent an answer or an owner note.
    - Refer to a section of the intent in the cross-reference form of the writing rules.

    Write at the spec altitude:
    - A section that only an engineer can review goes to the plan, not to the spec.
    - An example from the Robinhood spec: parameters and storage, functions, the deploy script, the automation scripts and the metrics exporter are plan material. Components, flows, risks, roles and deliverables stay in the spec.
    - Put "Risks we accept" material under "9. Risks".
    - Put "Areas of concern" material under "8. Trade-offs".

    Then remove the title line and the blank line after it from the draft. Keep the title `Spec: <name>` for the save. Linear shows the title of the document above the content, so the content has no title line.
10. Run the lint on the draft:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type spec <draft>
    ```

    When the lint lists findings, follow the retry rule above.
11. Read the draft again against the writing rules. Fix what you find. Then run the lint again.
12. Create the Linear document with the `save_document` tool of the Linear MCP server:
    - Use the title `Spec: <name>` of step 9.
    - Give the document exactly one parent: the team or the project that the owner confirmed.
    - Put the draft in `content` as markdown, with its frontmatter.

    The gate of the plugin runs on the save. When it denies the save, or allows it with findings, follow the retry rule above.
13. Link the spec from the intent. Call the `save_document` tool with the `id` of the intent and this `patch`, and no `content`. When the intent has no `relates` field, the patch is one `insert_after` op with `anchor` the `owner` line of the intent and `text` `\nrelates: <spec URL>`. When the intent has a `relates` field, the patch is one `replace` op with `old_string` that line and `new_string` the same line with `, <spec URL>` at its end. Copy the anchor or the old line from the scratch file of the intent. The save is best effort. When it fails, tell the owner that the intent does not link the spec. Then go on.
14. Give the owner the URL of the spec.

## After the save

The owner decides when the spec is ready for the plan. The plan skill reports each open thread on the spec and on the intent, and goes on. It exports both documents to git. After it opens the pull request, it adds the URL of the pull request to the `relates` field of the spec and of the intent. No field of the spec holds its state.
