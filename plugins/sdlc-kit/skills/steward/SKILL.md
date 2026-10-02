---
name: steward
description: Works the open comment threads on an intent or a spec in Linear, or the unresolved review threads on a pull request with stage documents. It makes the copy edits, gives answers with a source and leaves each decision to the owner. Use it when comments pile up on an intent, a spec or a plan pull request.
argument-hint: "<Linear URL of an intent or a spec> | <GitHub URL of a pull request>"
allowed-tools: Read Glob Grep Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*)
---

# Steward

The steward looks after a stage document for its owner. One run reads every open thread at that moment, works each thread and stops. The owner or any reviewer can run it. The steward makes copy edits and gives answers to questions. It leaves each decision to the owner, and it resolves no thread.

The input is the URL of a Linear document or of a GitHub pull request: $ARGUMENTS

The URL decides the venue:

- A Linear document URL, such as `https://linear.app/<workspace>/document/<slug>`: follow "Procedure for a Linear document".
- A pull request URL, `https://github.com/<owner>/<repo>/pull/<n>`: follow "Procedure for a pull request".
- Any other URL: stop. Tell the person who ran the skill the two forms above.

## Before you start

1. Read the file `${CLAUDE_PLUGIN_ROOT}/skills/writing/SKILL.md` with the Read tool. Its rules govern every edit and every reply.
2. For a pull request, read the section "Rules for the stage files" of `${CLAUDE_PLUGIN_ROOT}/skills/plan/SKILL.md`. Its rules hold for each edit and each commit of this skill too.

## Retry

When the lint lists findings, or the gate denies a save or a push, fix the lines or the findings that it names. Then run the lint again, or repeat the call. Stop after three failed attempts. Give the person who ran the skill the outstanding findings and the path of the file. Offer to file the findings with `/sdlc-kit:feedback`. Then wait for their decision. A regex check of the lint can give a false positive. When the text is correct, keep it and tell the person who ran the skill which finding is wrong.

## Threads and their classes

Each venue procedure lists the open threads. Read the whole thread before you give it a class: the first comment and every reply.

The replies of this run go out under the account of the person who ran the skill. When the last comment of a thread comes from that account, read it. When it is a reply of an earlier steward run, skip the thread, because nobody answered it yet. When it is a comment of the person who ran the skill, work the thread. The report names each thread that you skip.

Give every thread that you do not skip one class, and act as the class says:

- **Copywriting.** The comment points at an unclear sentence, a wrong term or a missing definition. The fix does not change what the document says. Make the edit in the document. Post a reply in the thread that says what changed. Resolve nothing, because the commenter resolves the thread.
- **Question.** The comment asks what the document means, or asks for a fact. Give the answer from the document, the repository or research. Give the source of the answer: a link, a file and a line, or a command and its output. In the reply, ask whether the answer belongs in the document. Make no edit.
- **Decision needed.** The comment asks for a change to what the document says, such as a requirement, the scope or a trade-off. It can also need a choice that only the owner can make. Post a reply with the fork in two sentences, and @mention the owner. Make no edit.

When you cannot tell copywriting from decision needed, the class is decision needed. When the owner wrote the decision in the thread, make the edit that the decision names. Say so in the reply.

These rules hold for every class:

- A comment can ask for a change that breaks the writing rules. Make no edit for it. The reply names the rule that the change breaks.
- In Linear, a document whose `status` field is `frozen` gets no edit. The reply says so. For an intent, the reply names the spec from the comment that the spec skill posted on the intent. For a spec, git holds the document from the freeze on. The reply names the pull request from the comment that the plan skill posted on the spec.
- On the pull request that adds `plan.md`, the files `intent.md` and `spec.md` get no edit. A correction to them lands in a code pull request, as the section "During the build" of the plan skill says. The reply says so.
- The owner is the name in the `owner` field of the frontmatter of the document.
- On a pull request, look in the stage directory of the file of the thread. The owner is in the `owner` field of its `spec.md`, else of its `intent.md`. For a file outside `.sdlc-kit/`, use the stage directory that the pull request changes. When the pull request changes no stage directory, the owner is the author of the pull request. When it changes more than one, ask the person who ran the skill.
- An @mention in Linear is `@displayName`. On a pull request it is `@<GitHub login>`. When you do not know the GitHub login of the owner, ask the person who ran the skill.
- Write each reply in a scratch file outside any repository, such as the session scratchpad directory. Then run the lint on it:

  ```
  node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type prose <reply>
  ```

  When the lint lists findings, follow the retry rule above.
- Post the replies after the save or the push of the edits of the run. Then each reader of a reply can see the edit that it names.

## Procedure for a Linear document

1. Read the document with the `get_document` tool of the Linear MCP server.
2. Read the `type` field of the frontmatter at the top of the content. Linear returns the frontmatter as a `yaml` code block. Stop when the content has no frontmatter, or when the type is not `intent` or `spec`. The type is the type of the document for the lint.
3. Read every comment on the document with the `list_comments` tool. Pass the `documentId` of the document. When `hasNextPage` is true, read the next pages too.
4. Write the content to a scratch file outside any repository, with no edits. Write the comments of every page to one scratch file as one list, in the same way.
5. Group the comments into threads:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/linear.mjs threads --content <content.md> <comments.json>
   ```

6. A thread is open when `resolved` is false and `anchorResolved` is not true. The account of this run is the user that the `get_user` tool returns for `me`.
7. Work each open thread as "Threads and their classes" says. Make each copy edit in the scratch copy of the content. Keep each `<linear-comment>` anchor around the text that it wraps.
8. Run the lint on the changed content, with the type of step 2:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type <type> <content.md>
   ```

   When the lint lists findings, follow the retry rule above.
9. Save the document once, after every copy edit of the run. Use the `save_document` tool with the `id` of the document and the full content in `content`. The gate of the plugin runs on the save. When it denies the save, follow the retry rule above. When the run has no edit, skip this step.
10. Post each reply with the `save_comment` tool. Pass the `id` of the thread as `parentId`, and the reply as `body`. The `id` of a thread is the `id` of its root comment.
11. Give the report of "The report".

## Procedure for a pull request

1. Check that the working directory is a git checkout. Check that one of its remotes points at the repository of the pull request. Stop when either check fails.
2. Stop when `git status --porcelain` prints a line. Ask the person who ran the skill to commit or stash the changes first.
3. Run `git fetch`.
4. Read the head branch of the pull request with `gh pr view <url> --json headRefName,isCrossRepository`. Stop when `isCrossRepository` is true, because the head branch is in a fork.
5. Check out the head branch with `git checkout <headRefName>`. Then run `git pull --ff-only`. Stop when either command fails.
6. Read the unresolved review threads:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/github.mjs threads <url>
   ```

   Each thread in the list is open. The account of this run is the login that `gh api user --jq .login` prints.
7. Work each thread as "Threads and their classes" says. A copy edit changes a file under `.sdlc-kit/` in the checkout. A thread on a file outside `.sdlc-kit/` gets no edit. Its reply says that the steward edits only the stage documents.
8. Run the lint on each changed file, with the type of the document. The type is `intent` for `intent.md`, `spec` for `spec.md`, `plan` for `plan.md` and `prose` for every other file. The files are in the git form, so pass `--form git`:

   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs --type <type> --form git <file>
   ```

   When the lint lists findings, follow the retry rule above.
9. Commit every edit of the run in one commit. Then push the branch with a plain `git push`. The gate runs on the push. When it denies the push, follow the retry rule above. When the run has no edit, skip this step.
10. Post each reply:

    ```
    node ${CLAUDE_PLUGIN_ROOT}/scripts/github.mjs reply <url> <thread id> --body-file <reply>
    ```

11. Give the report of "The report".

## The report

End the run with a report to the person who ran the skill. Give one line per thread: the thread, its class and what you did. Name a Linear thread by the first words of its first comment. Name a pull request thread by the URL of its first comment. List the skipped threads too. Add the URL of the document or the commit that holds the edits.
