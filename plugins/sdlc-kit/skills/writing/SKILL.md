---
name: writing
description: The writing rules for every sdlc-kit document (intent, spec and plan) and for every comment that an sdlc-kit skill posts on Linear or on a pull request. Read this file before you draft, edit or review any of them.
user-invocable: false
---

# Writing rules

These rules apply Simplified Technical English (STE), [ASD-STE100 Issue 9 (2025)](https://www.asd-ste100.org/). STE is a controlled language for technical documents. It has writing rules and a dictionary of approved words with one meaning each. The rules below belong together because each one comes from STE or from the same aim: a reader understands the text on the first read.

The rules govern three documents: the intent, the spec and the plan. They apply in full to all three, the plan included. They also govern every comment that a skill posts, on a Linear document or on a pull request. No judge runs on a comment; the author applies the rules.

## Simplified Technical English

The STE dictionary is not embedded here. Apply the writing rules and the two dictionary principles:

- Use the short, common word.
- Give each word one meaning only.

STE is about how the document explains, not about simpler content. Accuracy wins: a correct technical term stays, with an explanation on first use. Identifiers, quoted text and names that the codebase uses are never rewritten. [The specification](https://www.asd-ste100.org/) is free on request and explains each rule in full.

<!-- lint-disable -->

## Word rules

- Use one word for one thing. Use that word every time. Do not use
  synonyms for variety: if the first mention says "endpoint", every
  later mention says "endpoint", not "route", "URL", or "the API".
- Adopt the name the codebase, docs, ticket, or user already uses,
  even if you would pick a different one.
- A changed word must signal a changed meaning. If both "config" and
  "settings" appear, the reader assumes they are two different things.
- Before you finish, scan your draft for the same concept under two
  names; pick one and replace the rest. One vocabulary spans the
  whole deliverable: a PR description, its commit messages, and the
  code comments name things the same way.
- Use each word as only one part of speech. Example: use "test" as a
  noun. Write "do a test", not "test the function".
- Choose short and common words: "start", not "initiate"; "use", not
  "utilize"; "do", not "perform"; "show", not "demonstrate".
- Keep technical names exactly as the code, spec, or project uses
  them. Do not translate identifiers or API names into plain words.
- Keep other jargon only when it is the precise, accepted term and a
  plainer word would lose meaning. Explain a technical term the first
  time it appears, if it is not obvious from context.

## Banned words

Do not write these words. Each one stands in for a fact you did not
state. Replace the word with the fact.

| Banned | Write instead |
| --- | --- |
| leg | name the thing: the job, the side, the step |
| load-bearing | say what breaks when you remove it |
| verbatim | "an unchanged copy", "byte for byte", "with no edits" |
| surface (as a verb) | "show", "report", "print", "log" |
| leverage | "use" |
| facilitate | "let", "help", "allow" |
| robust | say what it survives |
| seamless, holistic, elegant | cut the word |
| crucial, vital, key, critical | say what fails without it |
| delve, dive into, deep dive | "read", "study", "look at" |
| landscape, ecosystem, realm, space | name the actual set of things |
| journey, story, narrative | name the sequence of events |
| unlock, empower, elevate, supercharge | say what the change makes possible |
| streamline | name the step you removed |
| testament, cornerstone, backbone, tapestry | cut the sentence, state the fact |

The table cannot name every word. Use this test on any word you are
about to write:

1. Does the word name a thing in the code, the spec, or the user's own
   message? Keep it.
2. Does the word stand in for a fact you did not state? Delete the word
   and state the fact.
3. Does the word only add weight or praise? Delete it.

## Banned sentence patterns

- Negate, then elevate: "this is not just X, it is Y". State Y alone.
  A plain contrast is fine: "every job, not only the first".
- Three for rhythm: three adjectives or three clauses where one carries
  the meaning. Keep the one that carries it.
- The false summary: "In essence", "At its core", "Simply put", "The
  key insight is". Delete the opener. Keep the sentence.
- Praise for your own work: "clean", "elegant", "careful", "powerful".
  The reader judges the work.
- The closing flourish: a last sentence that restates the change in
  bigger words. Stop at the last fact.

## Sentence rules

- Say what you mean directly. Skip filler and hedging.
- Keep sentences short. Use a maximum of 20 words in an instruction
  and 25 words in descriptive text.
- Write only one instruction in each sentence.
- Use the active voice. Say who or what does the action.
- Use only the simple tenses: past, present, future. Do not use the
  present perfect. Write "the test failed", not "the test has
  failed".
- Do not use the -ing form of a verb, unless it is part of a
  technical name ("operating system", "logging level").
- Do not omit articles ("a", "an", "the") or demonstrative adjectives
  ("this", "these") to make text shorter.
- Do not put more than three nouns together in a cluster.

## No em-dashes

Do not use em-dashes (the "—" character). Restructure the sentence
instead:

- a comma, colon, or semicolon where the dash joined two clauses
- parentheses for an aside
- two sentences where the dash glued them together

Scope: this governs text you generate. Do not rewrite em-dashes that
already exist in the user's files, quotes, or other content you are
editing or citing; only avoid producing new ones.

## No volatile counts

A volatile count is a number that restates the current size of
something the text describes: how many tests ran, how many files a
directory holds, how many items a list has. The count changes when
the resource changes, and nobody updates the text. Do not write
volatile counts in durable text: PR descriptions, commit messages,
docs, README files, code comments, review comments.

- Write "all tests pass", not "all 78 tests pass".
- Write "the ADRs in /docs/adr", not "nineteen ADRs in /docs/adr".
- Point at the source instead: name the directory, the command, or
  the report that gives the current number.
- Keep a number when it is the subject of the change and fixed at
  one point in time: a version, a configured limit, a threshold, a
  benchmark result tied to one commit.
- A chat response is not durable. An exact count is fine there when
  it reports a result of the current run.

## Paragraph rules

- Keep paragraphs short. Use a maximum of six sentences.
- Write about one topic in each paragraph. Start the paragraph with
  the topic sentence.
- Use a vertical list when you give more than three items or steps.

## Instructions and warnings

- Write instructions in the imperative: "Remove the file", not "The
  file should be removed".
- Put a warning or caution before the instruction it applies to, not
  after it.

<!-- lint-enable -->

## Additions

These rules add to the copied rule.

- **Cross-references.** A reference to another stage document names the document and the numbered section title. The quoted part is a link to that heading. In markdown the form is `spec section ["7. Deliverables"](spec.md#7-deliverables)`. In a Linear document the link goes to the heading of the other Linear document. The lint checks the form. For a local file, the lint also checks that the number and the title match a heading there.
- **Source every fact.** A number, an address or a behavior of an external system carries a link to its source.

## Durable records

A stage document and a comment are durable records. The reader has no access to the conversation, the plan you followed or an earlier review.

- **No meta-context.** The text describes its subject, never the process that produced it. Do not write `as discussed`, `as planned`, `based on the review`, `per your feedback`, `phase 1 of the plan` or `first attempt`. A decision lives in the document text, not in a thread.
- **The end state, not the history.** A document says what the system does, not `we changed X to Y`. Do not describe earlier drafts, renames or the order in which the text grew. The "What changed" section of the plan is the one place for a log.
- **The standalone test.** Before you publish, read the text with no other context. When it does not stand on its own as a statement about the subject, rewrite it.
- **Back a claim with its proof.** A claim in a document or a comment points at its evidence: a link, a file, a command and its output.

## Comments

A comment reads like a teammate wrote it, not a bot.

- Get straight to the point. Do not restate the text that the comment is about.
- No filler openers: `I noticed that`, `It looks like`, `Just to flag`.
- No hedging: `I believe`, `It appears that`.
- No closing offers: `happy to discuss`, `let me know`.
- No thanks and no praise: `Thanks!`, `Good point!`, `Great catch!`.
- No AI tells: `I have addressed this by`, `As you suggested`, `Per your feedback`.
- Plain prose. Use headers, bullets, bold or emoji only when the comment needs them.

## Boundaries

- These rules control style, not content. Keep code, identifiers,
  quoted text, and cited prose from other authors unchanged.
