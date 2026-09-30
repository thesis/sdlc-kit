---
name: spec
description: Turns an agreed intent into a spec in the sdlc-kit template, and creates it as a Linear document that implements the intent. Use it when someone has the Linear URL of an agreed intent and wants the spec, the document where all roles agree on how the functionality works.
argument-hint: "<Linear URL of the intent>"
allowed-tools: Read Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs *)
---

# Spec

The spec says how the functionality works, at a level that business, product and engineering people can all follow. It holds components, flows, requirements, risks and trade-offs. It holds no function signatures, storage layouts or file paths. The output is one Linear document titled `Spec: <name>`, linked to the intent, in the template of this skill.

The input is the Linear URL of the intent: $ARGUMENTS

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern the document and every comment that you post.
2. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/spec/template.md` with the Read tool. The document uses its headings, in its order, with its numbers. You may add a subsection under a heading. Do not add a top-level heading.

## Retry

When the lint lists findings, or the gate denies a save, fix the lines or the findings that it names. Then run the lint again, or repeat the save. Stop after three failed attempts. Give the owner the outstanding findings and the path of the draft. Then wait for the owner to decide. A regex check of the lint can give a false positive. When the text is correct, keep it and tell the owner which finding is wrong.

## Procedure

1. Read the intent with the `get_document` tool of the Linear MCP server. Read every comment thread on the intent with the `list_comments` tool. Pass the `documentId` of the intent. A resolved thread is a decision.
2. List the open problems of the intent and the decisions already taken. Show the list to the owner. Get the confirmation of the owner before you write a draft. Ask the owner which Linear team or project gets the spec. Propose the parent of the intent as the default.
3. Do the research read-only, in the repository that the owner gives, in external documents and in on-chain facts.
4. Interview the owner only on the forks that the research cannot settle. Ask one question at a time. A fork that stays open becomes an open decision with an owner and a date, not a paragraph of options.
5. Write the draft in a scratch file outside any repository, such as the session scratchpad directory. Use these steps:
   - Fill every section of the template.
   - Remove the guidance comments.
   - Set the second line of the header to `Implements: Intent <intent URL> · Owner: <owner> · Status: in review`.
   - Give each open decision a number, an owner and a date.
   - In "11. Intent open problems, answered", give each open problem of the intent an answer or an owner.
   - Refer to a section of the intent in the cross-reference form of the writing rules.

   Write at the spec altitude:
   - A section that only an engineer can review goes to the plan, not to the spec.
   - An example from the Robinhood spec: parameters and storage, functions, the deploy script, the automation scripts and the metrics exporter are plan material. Components, flows, risks, roles and deliverables stay in the spec.
   - Put "Risks we accept" material under "9. Risks".
   - Put "Areas of concern" material under "8. Trade-offs".
6. Run the lint on the draft:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type spec <draft>
   ```

   When the lint lists findings, follow the retry rule above.
7. Read the draft again against the rules that the lint cannot check. These rules are one word for one thing, no volatile counts, and the altitude rule above. Fix what you find. Then run the lint again.
8. Create the Linear document with the `save_document` tool of the Linear MCP server:
   - Use the title `Spec: <name>`.
   - Give the document exactly one parent: the team or the project that the owner confirmed.
   - Put the draft in `content` as markdown.

   The gate of the plugin runs on the save. When it denies the save, follow the retry rule above.
9. Post one comment for each open decision with the `save_comment` tool. Pass the `documentId` of the spec. Address each comment to the owner of the decision with an @mention. Each comment follows the writing rules.
10. Give the owner the URL of the spec.

## When the spec is agreed

The spec is agreed when the owner marks it agreed. At that point each open problem of the intent has an answer or an owner, and no open decision blocks the plan.
