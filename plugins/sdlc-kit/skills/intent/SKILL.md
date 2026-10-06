---
name: intent
description: Interviews the owner of a need, writes the intent in the sdlc-kit template, and creates it as a Linear document. Use it when someone wants to start an intent, to write down a problem and its outcome for business, product and engineering readers, or to start a new stage of work.
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *)
---

# Intent

The intent says what problem exists, who has it, and what outcome we want. Its readers are business, product and engineering people. It holds the problem and the outcome only, with no solution internals. The output is one Linear document titled `Intent: <name>`, in the template of this skill. This skill does not write to GitHub.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the document.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/intent/template.md` with the Read tool. The document uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Retry

Each finding of the writing judge has a severity: `high`, `medium` or `low`. The gate denies a save with a high finding. It allows a save with only medium and low findings, and gives you those findings.

Before each save, you may run the `sdlc-kit:writing-judge` agent once on the draft, for an early verdict. Do not run it at other times.

When the lint lists findings, fix the lines that it names. When the gate denies a save, fix each high finding, and each medium and low finding that you can. Fix the findings of an early verdict in the same way. Then run the lint again, or repeat the save. When the gate allows a save with medium or low findings, fix each finding that you can. Then repeat the save, with the `id` that the first save returned.

Stop after three failed attempts. A save only to fix medium or low findings counts as one of these attempts. Also stop when you cannot fix any finding that is left. Give the owner the findings that are left, with their severity, and the path of the draft. Offer to file the findings with `/sdlc-kit:feedback`. Then wait for the owner to decide.

A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

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

   Stop the questions about a section when it has one concrete answer. Also stop when the owner says "unknown". An unknown answer becomes an open problem. When the owner gives a number with no measurement, ask who gives the estimate. Write the number with the source note `(Source: an estimate of <name>)` after its sentence.
3. Push back on solution talk. When the owner names a contract function, a file or a parameter, ask what outcome it serves. Write down that outcome. Write the named detail under "6. Constraints" only when it is a real constraint.
4. Write the draft in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
   - Fill every section of the template.
   - Remove the guidance comments.
   - Keep the frontmatter of the template at the top, between the `---` lines, with the fields `type` and `owner`. Remove its `relates` line. The spec skill and the plan skill add the field later.
   - Set `owner` to the name of the owner.
   - Write the name of the intent in the title line `# Intent: <name>`.
   - Put each open problem under "7. Open problems". Give it a number and an owner note in the form of the writing rules. The section is the only record of the open problems. Do not post a comment for them.
5. Remove the title line and the blank line after it from the draft. Keep the title `Intent: <name>` for the save. Linear shows the title of the document above the content, so the content has no title line.
6. Run the lint on the draft:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type intent <draft>
   ```

   When the lint lists findings, follow the retry rule above.
7. Read the draft again against the writing rules. Fix what you find. Then run the lint again.
8. Create the Linear document with the `save_document` tool of the Linear MCP server:
   - Use the title `Intent: <name>` of step 5.
   - Give the document exactly one parent: the team or the project that the owner named.
   - Put the draft in `content` as markdown, with its frontmatter.

   The gate of the plugin runs on the save. When it denies the save, or allows it with findings, follow the retry rule above.
9. Give the owner the URL of the document.

## After the save

The owner decides when the intent is ready for the spec. The spec skill reports each open thread on the intent and goes on. Each open problem has an answer in the intent, or it goes to the spec as an open problem. After the save of the spec, the spec skill adds the URL of the spec to the `relates` field of the intent. No field of the intent holds its state.
