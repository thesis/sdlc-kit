---
name: intent
description: Interviews the owner of a need, writes the intent in the sdlc-kit template, and creates it as a Linear document. Use it when someone wants to start an intent, to write down a problem and its outcome for business, product and engineering readers, or to start a new stage of work.
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *)
---

# Intent

The intent says what problem exists, who has it, and what outcome we want. Its readers are business, product and engineering people. It holds the problem and the outcome only, with no solution internals. The output is one Linear document titled `Intent: <name>`, in the template of this skill. This skill does not write to GitHub.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the document and every comment that you post.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/intent/template.md` with the Read tool. The document uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Retry

When the lint lists findings, or the gate denies a save, fix the lines or the findings that it names. Then run the lint again, or repeat the save. Stop after three failed attempts. Give the owner the outstanding findings and the path of the draft. Then wait for the owner to decide. A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

## Procedure

1. Ask who the owner is. Then ask which Linear team or project gets the document. Nothing comes from a configuration file.
2. Interview the owner section by section. Ask one question at a time, in this order:
   1. the problem;
   2. who has the problem today;
   3. what changes for them;
   4. what is out of scope;
   5. which users and systems the outcome touches;
   6. the constraints;
   7. what nobody knows yet.

   Stop the questions about a section when it has one concrete answer. Also stop when the owner says "unknown". An unknown answer becomes an open problem.
3. Push back on solution talk. When the owner names a contract function, a file or a parameter, ask what outcome it serves. Write down that outcome. Write the named detail under "6. Constraints" only when it is a real constraint.
4. Write the draft in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
   - Fill every section of the template.
   - Remove the guidance comments.
   - Set the second line of the header to `Owner: <owner> · Status: in review`.
   - Set the third line of the header to `Linear: pending`. The lint accepts `pending` until the document has a URL.
   - Give each open problem a number and an owner.
5. Run the lint on the draft:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type intent <draft>
   ```

   When the lint lists findings, follow the retry rule above.
6. Read the draft again against the writing rules. Fix what you find. Then run the lint again.
7. Create the Linear document with the `save_document` tool of the Linear MCP server:
   - Use the title `Intent: <name>`.
   - Give the document exactly one parent: the team or the project that the owner named.
   - Put the draft in `content` as markdown.

   The gate of the plugin runs on the save. When it denies the save, follow the retry rule above.
8. Replace `pending` on the `Linear:` line with the URL of the new document. Run the lint on the changed draft. Then save the document again with `save_document`, the `id` of the document and the full draft in `content`. The gate runs on this save too.
9. Post a first comment on the document with the `save_comment` tool. Pass the `documentId` of the document. In the comment, list the open problems. Ask the named stakeholders for answers, with an @mention for each one. The comment follows the writing rules.
10. Give the owner the URL of the document.

## When the intent is agreed

The intent is agreed when the owner marks it agreed. At that point each open problem has an answer, or it goes to the spec as an open problem.
