#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GIT_RELATES, readFrontmatter, stripAnchors } from './linear.mjs';

export const FORMS = ['linear', 'git'];

// The frontmatter fields and the top-level headings of each stage template,
// in order. Each must match skills/<type>/template.md. `linear` marks a type
// that also lives in Linear. `exported` marks a type whose git file takes
// the `exported` field. `oldHeader` names the header lines of the form
// before the frontmatter, for the finding that tells how to convert it.
// `relatesOptional` marks a type whose Linear document may have no
// `relates` field. In git, GIT_RELATES gives the `relates` field of each type.
export const TEMPLATES = {
  intent: {
    prefix: 'Intent',
    fields: ['type', 'owner', 'relates'],
    linear: true,
    exported: true,
    relatesOptional: true,
    oldHeader: ['Owner:', 'Linear:', 'Exported:'],
    sections: [
      { title: 'Executive summary', maxBullets: 5 },
      { title: 'Problem' },
      { title: 'Proposed outcome' },
      { title: 'Not in scope now' },
      { title: 'Affected users and systems' },
      { title: 'Constraints' },
      { title: 'Open problems', numbered: 'items' },
    ],
  },
  spec: {
    prefix: 'Spec',
    fields: ['type', 'owner', 'relates'],
    linear: true,
    exported: true,
    oldHeader: ['Implements:', 'Owner:', 'Exported:'],
    sections: [
      { title: 'Terms' },
      { title: 'Scope' },
      { title: 'Requirements', numbered: 'requirements' },
      { title: 'How it works' },
      { title: 'Worked example' },
      { title: 'Roles and permissions' },
      { title: 'Deliverables' },
      { title: 'Trade-offs' },
      { title: 'Risks', numbered: 'items' },
      { title: 'Open decisions', numbered: 'items' },
      { title: 'Intent open problems, answered' },
    ],
  },
  plan: {
    prefix: 'Plan',
    fields: ['type', 'relates'],
    linear: false,
    exported: false,
    oldHeader: ['Implements:'],
    sections: [
      { title: 'Summary' },
      { title: 'Work order', table: ['Phase', 'Depends on', 'Merge gate'] },
      { title: 'Phases', numbered: 'phases', subsections: ['Files that change', 'Behavior', 'Tests', 'Commands', 'Definition of done'] },
      { title: 'Test matrix' },
      { title: 'Risks before the work starts' },
      { title: 'Blockers' },
      { title: 'What changed', optional: true, numbered: 'entries' },
    ],
  },
};

export const TYPES = [...Object.keys(TEMPLATES), 'prose'];

/** The form that the lint checks when the caller names none: Linear for an intent or a spec, git for a plan. */
export function defaultForm(type) {
  return TEMPLATES[type]?.linear ? 'linear' : 'git';
}

// The number pattern for each form of item. An item is a list item, a
// level-3 heading, or a table row after the separator row.
const ITEM_NUMBER = {
  items: {
    list: /^\s*(?:[-*+]\s+(?:\*\*)?)?\d+[.)]\s/,
    heading: /^#{3}\s+(?:\*\*)?\d+(?:\.\d+)*[.)]?\s/,
    table: /^\s*\|\s*(?:\*\*)?\d+[.)]?(?:\*\*)?\s*\|/,
  },
  requirements: {
    list: /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?R\d+\b/,
    heading: /^#{3}\s+(?:\*\*)?R\d+\b/,
    table: /^\s*\|\s*(?:\*\*)?R\d+\b/,
  },
};
const PHASE_HEADING = /^#{3}\s+3\.\d+\s/;
const NUMBER_FORM = { items: '"1."', requirements: '"R1"', phases: '"### 3.1 Phase 1"', entries: '"### 7.1 <date> · Phase 1"' };
const SUBSECTION_NUMBER = /^(\d+\.\d+\.\d+)\s+(.*)$/;

// A match next to a letter, a digit, "_" or "-" is part of a longer word or
// of a compound such as "key-value". The lint skips it.
const WB_BEFORE = '(?<![\\p{L}\\p{N}_-])';
const WB_AFTER = '(?![\\p{L}\\p{N}_-])';

const ADVERB = '(?:not|never|already|still|also|just|only|always|often|recently|now|yet|ever|all|both|long|since)';
const IRREGULAR_PARTICIPLES = [
  'done', 'gone', 'made', 'put', 'got', 'found', 'built', 'sent', 'spent', 'left', 'lost', 'met',
  'paid', 'said', 'sold', 'told', 'thought', 'brought', 'bought', 'caught', 'taught', 'won',
  'begun', 'become', 'kept', 'held', 'meant', 'understood', 'led', 'run', 'come',
];

// Present perfect heuristic. The lint looks for "has", "have", "had",
// "hasn't" or "'ve", then at most one adverb, then an optional "been". Last
// comes a word that ends in -ed or -en, or an irregular participle.
// - A match with "been" is always a finding ("has been open").
// - A word in NOT_PARTICIPLES is never a participle ("have open positions").
// - A word in ADJECTIVE_PARTICIPLES is an adjective only when a word that is
//   not in FUNCTION_WORDS follows it directly ("has limited liquidity").
//   Before a function word or punctuation it is a finding ("has agreed.").
// Gaps that remain:
// - an adjective participle before a bare noun object passes ("has fixed bugs");
// - two adverbs between the words hide the match;
// - the lint misses an irregular participle outside IRREGULAR_PARTICIPLES;
// - the lint flags "'s" only before "been": "it's closed" means "it is";
// - the lint does not flag "'d": "we'd done" can also mean "would".
// The lint also flags "had" (past perfect): the rule allows simple tenses only.
const PRESENT_PERFECT = new RegExp(
  `(?:(?<![\\p{L}\\p{N}_'’])(?:has|have|had)(?:n['’]t)?|(?<=\\p{L})['’]ve)\\s+(?:${ADVERB}\\s+)?(?<been>been\\s+)?` +
    `(?<p>\\p{L}+(?:ed|en)|${IRREGULAR_PARTICIPLES.join('|')})(?![\\p{L}\\p{N}_-])` +
    `|(?<=\\p{L})['’]s\\s+(?:${ADVERB}\\s+)?(?<p2>been)(?![\\p{L}\\p{N}_-])`,
  'giu',
);
const NOT_PARTICIPLES = new Set([
  'often', 'open', 'even', 'seven', 'eleven', 'ten', 'token', 'children', 'when', 'then',
  'need', 'speed', 'seed', 'red', 'bed', 'hundred', 'screen', 'green', 'kitchen', 'garden',
]);
const ADJECTIVE_PARTICIPLES = new Set([
  'limited', 'unlimited', 'dedicated', 'mixed', 'fixed', 'advanced', 'established', 'agreed',
  'defined', 'expected', 'required', 'related', 'hidden', 'locked', 'detailed', 'broken', 'frozen',
]);
// Determiners, pronouns, prepositions, conjunctions and adverbs: words that
// cannot be the noun after an adjective.
const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'them', 'they', 'their', 'he',
  'she', 'him', 'her', 'his', 'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'each', 'every',
  'all', 'any', 'some', 'no', 'both', 'either', 'neither', 'to', 'of', 'in', 'on', 'at', 'for',
  'from', 'with', 'by', 'into', 'onto', 'upon', 'about', 'over', 'under', 'after', 'before',
  'between', 'through', 'via', 'as', 'than', 'per', 'against', 'without', 'within', 'across',
  'along', 'around', 'behind', 'beyond', 'during', 'since', 'until', 'toward', 'towards', 'and',
  'or', 'but', 'nor', 'so', 'yet', 'if', 'when', 'while', 'because', 'which', 'who', 'whom',
  'whose', 'where', 'then', 'once', 'not', 'never', 'already', 'still', 'also', 'just', 'only',
  'always', 'often', 'recently', 'now', 'ever', 'again', 'too', 'very', 'here', 'there', 'up',
  'down', 'out', 'off', 'away', 'back',
]);

function nextWord(masked, end) {
  const next = masked.slice(end).match(/^[ \t\n]+(\p{L}+)/u);
  return next ? next[1].toLowerCase() : null;
}

// The lint flags only a progressive construction: a form of "be", at most
// one adverb, then a word that ends in -ing. The forms of "be" include
// "isn't", "'re", "'m", and "'s" after a pronoun such as "it". The lint does
// not flag a bare -ing word: a gerund or an adjective is too often correct.
const PROGRESSIVE = new RegExp(
  `(?:(?<![\\p{L}\\p{N}_'’])(?:am|is|are|was|were|be|been|being)(?:n['’]t)?|(?<=\\p{L})['’](?:re|m)` +
    `|(?<=(?<!\\p{L})(?:it|that|what|there|here|who|he|she))['’]s)` +
    `\\s+(?:${ADVERB}\\s+)?(?<ing>\\p{L}+ing)(?![\\p{L}\\p{N}_-])`,
  'giu',
);
const NOT_VERBS_ING = new Set([
  'thing', 'something', 'nothing', 'anything', 'everything', 'string', 'spring', 'ring', 'king',
  'wing', 'during', 'morning', 'evening', 'ceiling',
  'pending', 'missing', 'outstanding', 'ongoing', 'interesting', 'existing', 'willing',
  'following', 'remaining', 'misleading', 'confusing',
]);
const ING_TECHNICAL_NAMES = new Set(['operating system', 'logging level']);

const MAX_SENTENCE_WORDS = 25;
const EXPORTED_VALUE = /^https?:\/\/\S+[ \t]+·[ \t]+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLACEHOLDER = /<[a-z][a-z -]*>/gi;
const URL_ITEM = /^https?:\/\/\S+$/;

/** Whether each item of the comma list `value` is a URL, the form of `relates` in Linear. */
export function isUrlList(value) {
  return value.split(',').every((item) => URL_ITEM.test(item.trim()));
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
const BLOCKQUOTE = /^\s*>\s?/;
const DISABLE = /^\s*<!--\s*lint-disable\s*-->\s*$/;
const ENABLE = /^\s*<!--\s*lint-enable\s*-->\s*$/;
const CROSS_REFERENCE = new RegExp(`${WB_BEFORE}(intent|spec|plan)\\s+section${WB_AFTER}`, 'giu');
const CROSS_REFERENCE_BACKWARD = new RegExp(`${WB_BEFORE}section\\s+\\d+(?:\\.\\d+)*\\s+of\\s+the\\s+(intent|spec|plan)${WB_AFTER}`, 'giu');
const CROSS_REFERENCE_LINK = /^\s+\["(\d+(?:\.\d+)*)\.?\s+([^"\n]+?)"\]\(([^)\s]+)\)/;

function indentWidth(s) {
  let width = 0;
  for (const ch of s) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

function blank(s) {
  return s.replace(/[^\n]/g, ' ');
}

function maskHtmlComments(s) {
  return s.replace(/<!--|-->/g, blank);
}

function maskCode(s) {
  return s.replace(/(`+)[\s\S]*?\1/g, blank);
}

// Masks link targets and bare URLs with blanks. Offsets and line numbers stay
// the same, and the text of a link still counts as prose.
function maskLinks(s) {
  return s
    .replace(/\]\([^)\n]*\)/g, (m) => `]${blank(m.slice(1))}`)
    .replace(/<(?:https?|mailto):[^>\s]*>/gi, blank)
    .replace(/(?:https?:\/\/|www\.)[^\s<>()\]]+/gi, blank);
}

/**
 * Splits markdown into lines, with a kind for each line. Groups the lines
 * outside code into blocks: one block per paragraph or list item, and one
 * block per heading or table row.
 */
export function parse(text, { honorDisable = false, stage = false } = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const info = lines.map(() => ({ kind: 'text', disabled: false, comment: false }));
  // A stage document may open its frontmatter after blank lines and as a
  // ```yaml fence. Other markdown takes only a "---" block on line 1.
  const frontmatter = readFrontmatter(text);
  const counts = frontmatter && frontmatter.end > 0 && (stage || (frontmatter.form === 'dashes' && frontmatter.start === 0));
  let start = 0;
  if (counts) {
    for (let i = 0; i <= frontmatter.end; i++) info[i].kind = i < frontmatter.start ? 'blank' : 'frontmatter';
    start = frontmatter.end + 1;
  }
  let fence = null;
  let disabled = false;
  let inComment = false;
  let previousBlank = true;
  let listIndent = null;
  let inIndentedCode = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      info[i].kind = 'fence';
      previousBlank = false;
      const close = line.match(FENCE);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len && line.trim() === close[1]) fence = null;
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      fence = { ch: open[1][0], len: open[1].length };
      info[i].kind = 'fence';
      previousBlank = false;
      inIndentedCode = false;
      continue;
    }
    if (honorDisable && DISABLE.test(line)) {
      disabled = true;
      info[i].kind = 'directive';
      continue;
    }
    if (honorDisable && ENABLE.test(line)) {
      disabled = false;
      info[i].kind = 'directive';
      continue;
    }
    info[i].disabled = disabled;
    const blankLine = /^\s*$/.test(line);
    const afterBlank = previousBlank;
    previousBlank = blankLine;
    if (blankLine) {
      info[i].kind = 'blank';
      continue;
    }
    // An indented code block starts after a blank line. Its indent is four
    // columns more than the margin, or than the content of its list item.
    const indent = indentWidth(line);
    const codeIndent = (listIndent ?? 0) + 4;
    if (!inComment && (inIndentedCode || afterBlank) && indent >= codeIndent) {
      info[i].kind = 'code';
      inIndentedCode = true;
      continue;
    }
    inIndentedCode = false;
    const startsInComment = inComment || /^\s*<!--/.test(line);
    const opens = line.lastIndexOf('<!--');
    const closes = line.lastIndexOf('-->');
    if (opens > closes) inComment = true;
    else if (closes >= 0) inComment = false;
    info[i].comment = startsInComment;
    const item = line.replace(BLOCKQUOTE, '').match(LIST_ITEM);
    if (item) listIndent = indentWidth(item[1]) + item[0].length - item[1].length;
    else if (indent === 0 && afterBlank) listIndent = null;
    if (!startsInComment && HEADING.test(line)) {
      info[i].kind = 'heading';
      listIndent = null;
    } else if (!startsInComment && TABLE_ROW.test(line)) {
      info[i].kind = TABLE_SEPARATOR.test(line) ? 'separator' : 'table';
    }
  }

  const blocks = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const { kind, disabled: off, comment } = info[i];
    const line = lines[i];
    if (kind === 'heading' || kind === 'table') {
      current = null;
      if (!off) blocks.push({ type: kind, lines: [{ no: i + 1, text: line }] });
      continue;
    }
    if (kind !== 'text' || off) {
      current = null;
      continue;
    }
    let body = line.replace(BLOCKQUOTE, '');
    const item = body.match(LIST_ITEM);
    const startsNew = item || !current || current.comment !== comment;
    if (item) body = body.slice(item[0].length);
    body = body.replace(/^\s+/, '');
    if (startsNew) {
      current = { type: 'prose', comment, lines: [] };
      blocks.push(current);
    }
    current.lines.push({ no: i + 1, text: body });
  }
  for (const block of blocks) {
    block.text = block.lines.map((l) => l.text).join('\n');
    block.lineAt = lineLocator(block);
  }
  return { lines, info, blocks, frontmatter: stage ? frontmatter : null };
}

function lineLocator(block) {
  const starts = [];
  let offset = 0;
  for (const l of block.lines) {
    starts.push(offset);
    offset += l.text.length + 1;
  }
  return (pos) => {
    let idx = 0;
    while (idx + 1 < starts.length && starts[idx + 1] <= pos) idx++;
    return block.lines[idx].no;
  };
}

/** GitHub's heading anchor: lower case, punctuation removed, whitespace as hyphens. */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function normalizeSectionName(s) {
  return s
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/^(\d+(?:\.\d+)*)\.?\s+/, '$1 ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function headingTexts(text) {
  const { lines, info } = parse(text);
  return lines.filter((_, i) => info[i].kind === 'heading').map((l) => l.match(HEADING)[2].trim());
}

const EM_DASH_MESSAGE = 'em-dash (U+2014); use a comma, a colon, parentheses or two sentences';

function checkEmDash(doc, add) {
  const lines = new Set();
  doc.lines.forEach((line, i) => {
    if (doc.info[i].kind === 'frontmatter' && line.includes('\u2014')) lines.add(i + 1);
  });
  for (const block of doc.blocks) {
    const text = maskCode(block.text);
    for (let at = text.indexOf('\u2014'); at >= 0; at = text.indexOf('\u2014', at + 1)) {
      lines.add(block.lineAt(at));
    }
  }
  for (const line of lines) add(line, 'em-dash', EM_DASH_MESSAGE);
}

function checkPresentPerfect(block, masked, add) {
  for (const m of masked.matchAll(PRESENT_PERFECT)) {
    const participle = (m.groups.p ?? m.groups.p2).toLowerCase();
    if (!m.groups.been && participle !== 'been') {
      if (NOT_PARTICIPLES.has(participle)) continue;
      if (ADJECTIVE_PARTICIPLES.has(participle)) {
        const next = nextWord(masked, m.index + m[0].length);
        if (next && !FUNCTION_WORDS.has(next)) continue;
      }
    }
    add(
      block.lineAt(m.index),
      'present-perfect',
      `perfect tense "${m[0].replace(/\s+/g, ' ')}"; use the simple past or present`,
    );
  }
}

function checkProgressive(block, masked, add) {
  for (const m of masked.matchAll(PROGRESSIVE)) {
    const ing = m.groups.ing.toLowerCase();
    if (NOT_VERBS_ING.has(ing)) continue;
    const next = masked.slice(m.index + m[0].length).match(/^\s+(\p{L}+)/u);
    if (next && ING_TECHNICAL_NAMES.has(`${ing} ${next[1].toLowerCase()}`)) continue;
    add(
      block.lineAt(m.index),
      'progressive-ing',
      `-ing verb form "${m[0].replace(/\s+/g, ' ')}"; use a simple tense`,
    );
  }
}

// Protects the full stops of common abbreviations, so "e.g. the file" does
// not end a sentence. Caveat: a sentence that ends with one of these
// abbreviations ("..., etc.") joins the next sentence in the word count.
function protectAbbreviations(s) {
  return s.replace(/\b(e\.g|i\.e|etc|vs|cf|approx)\./gi, (m) => m.replace(/\./g, '_'));
}

function checkSentenceLength(block, masked, add) {
  const text = protectAbbreviations(masked);
  // A closing "**" or "_" after the full stop belongs to the sentence, so a
  // bold lead such as "**Lead.** Next sentence." splits into two.
  const ends = /[.!?]+["'”’)\]*_]*(?=\s|$)/g;
  let from = 0;
  const sentences = [];
  for (const m of text.matchAll(ends)) {
    sentences.push([from, m.index + m[0].length]);
    from = m.index + m[0].length;
  }
  if (from < text.length) sentences.push([from, text.length]);
  for (const [a, b] of sentences) {
    const words = [...text.slice(a, b).matchAll(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu)];
    if (words.length > MAX_SENTENCE_WORDS) {
      add(
        block.lineAt(a + words[0].index),
        'sentence-length',
        `sentence has ${words.length} words; the limit is ${MAX_SENTENCE_WORDS}`,
      );
    }
  }
}

function checkCrossReferences(block, codeMasked, context, add) {
  for (const m of codeMasked.matchAll(CROSS_REFERENCE_BACKWARD)) {
    const docType = m[1].toLowerCase();
    add(
      block.lineAt(m.index),
      'xref-form',
      `write the reference as ${docType} section ["<n>. <title>"](<link to the heading>)`,
    );
  }
  for (const m of codeMasked.matchAll(CROSS_REFERENCE)) {
    const after = codeMasked.slice(m.index + m[0].length);
    const link = after.match(CROSS_REFERENCE_LINK);
    const line = block.lineAt(m.index);
    const docType = m[1].toLowerCase();
    if (!link) {
      add(
        line,
        'xref-form',
        `write the reference as ${docType} section ["<n>. <title>"](<link to the heading>)`,
      );
      continue;
    }
    const [, number, title, target] = link;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const [pathPart, anchor] = target.split('#');
    if (!pathPart.endsWith('.md')) continue;
    const name = basename(pathPart);
    if (['intent.md', 'spec.md', 'plan.md'].includes(name) && name !== `${docType}.md`) {
      add(line, 'xref-doc', `"${docType} section" links to ${name}`);
      continue;
    }
    if (!context.path) continue;
    const sibling = resolve(dirname(context.path), pathPart);
    if (!existsSync(sibling)) continue;
    if (!context.headings.has(sibling)) {
      context.headings.set(sibling, headingTexts(readFileSync(sibling, 'utf8')));
    }
    const wanted = normalizeSectionName(`${number} ${title}`);
    const heading = context.headings.get(sibling).find((h) => normalizeSectionName(h) === wanted);
    if (!heading) {
      add(line, 'xref-target', `${pathPart} has no heading "${number}. ${title}"`);
    } else if (anchor !== slug(heading)) {
      add(line, 'xref-anchor', `the anchor for "${heading}" is #${slug(heading)}`);
    }
  }
}

function listWords(words) {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The fields that a document of `type` must have in `form`. */
function requiredFields(type, form) {
  const template = TEMPLATES[type];
  return template.fields.filter((f) => f !== 'relates' || form === 'git' || !template.relatesOptional);
}

function missingFrontmatter(type, form) {
  const template = TEMPLATES[type];
  const fields = listWords(requiredFields(type, form));
  const start = form === 'git'
    ? `the file has no frontmatter; start it with a "---" block of the fields ${fields}, above the "# ${template.prefix}: <name>" line`
    : `the document has no frontmatter; start it with a "---" block of the fields ${fields}`;
  const lines = listWords(template.oldHeader.map((l) => `"${l}"`));
  const title = form === 'git' ? '' : `, and remove the "# ${template.prefix}:" line`;
  return `${start}. To convert a document of the old form, move the values of its ${lines} lines into these fields${title}`;
}

// Checks the frontmatter fields of a stage document. The `type` field must
// name the type of the lint. The `exported` field belongs only to the git
// file of a type that Linear exports, and there it is required. In Linear,
// each item of `relates` is a URL. In git, `relates` is the list of
// GIT_RELATES, and with `exists` the lint checks that each file is there.
function checkFields(frontmatter, type, form, exists, add) {
  const template = TEMPLATES[type];
  const { fields } = frontmatter;
  const top = frontmatter.start + 1;
  for (const [key, field] of Object.entries(fields)) {
    if (key !== 'exported' && !template.fields.includes(key)) {
      add(field.index + 1, 'structure-frontmatter', `the ${type} takes no "${key}" field; its fields are ${listWords(template.fields)}`);
    }
    for (const m of field.value.matchAll(PLACEHOLDER)) add(field.index + 1, 'structure-placeholder', `fill in the placeholder ${m[0]}`);
  }
  const required = (key, rule) => {
    const field = fields[key];
    if (!field) add(top, rule, `the frontmatter has no "${key}" field`);
    else if (!field.value) add(field.index + 1, rule, `the "${key}" field is empty`);
    else return field;
    return null;
  };
  const typeField = required('type', 'structure-frontmatter');
  if (typeField && typeField.value !== type) add(typeField.index + 1, 'structure-frontmatter', `the "type" field must be "${type}"`);
  if (template.fields.includes('owner')) required('owner', 'structure-owner');
  const relates = requiredFields(type, form).includes('relates') ? required('relates', 'structure-relates') : fields.relates;
  if (relates && !new RegExp(PLACEHOLDER.source, 'i').test(relates.value)) {
    if (form === 'linear') {
      if (!isUrlList(relates.value)) {
        add(relates.index + 1, 'structure-relates', 'each item of the "relates" field must be a URL; write the field as "relates: <URL>, <URL>"');
      }
    } else if (relates.value !== GIT_RELATES[type].join(', ')) {
      add(relates.index + 1, 'structure-relates', `write the field as "relates: ${GIT_RELATES[type].join(', ')}"`);
    } else if (exists) {
      for (const name of GIT_RELATES[type]) {
        if (!exists(name)) add(relates.index + 1, 'structure-relates', `the ${type} relates to ${name}, but no ${name} is next to it`);
      }
    }
  }
  const exported = fields.exported;
  if (!template.exported) {
    if (exported) add(exported.index + 1, 'structure-exported', `the ${type} takes no "exported" field`);
  } else if (form === 'linear') {
    if (exported) add(exported.index + 1, 'structure-exported', 'a Linear document takes no "exported" field; linear.mjs export adds it to the git file');
  } else if (!exported) {
    add(top, 'structure-exported', 'the git file has no "exported" field; write the file with linear.mjs export');
  } else if (!EXPORTED_VALUE.test(exported.value)) {
    add(exported.index + 1, 'structure-exported', 'write the field as "exported: <document URL> · <ISO time>"');
  }
}

function checkStructure(doc, type, form, exists, add) {
  const template = TEMPLATES[type];
  const headingLines = [];
  doc.lines.forEach((line, i) => {
    if (doc.info[i].kind !== 'heading') return;
    const [, hashes, text] = line.match(HEADING);
    headingLines.push({ index: i, level: hashes.length, text: text.trim() });
  });

  const { frontmatter } = doc;
  const first = doc.lines.findIndex((l, i) => doc.info[i].kind !== 'frontmatter' && l.trim() !== '');
  if (!frontmatter) {
    add(Math.max(first, 0) + 1, 'structure-frontmatter', missingFrontmatter(type, form));
  } else {
    for (const e of frontmatter.errors) add(e.index + 1, 'structure-frontmatter', e.message);
    if (form === 'git' && (frontmatter.form !== 'dashes' || frontmatter.start !== 0)) {
      add(frontmatter.start + 1, 'structure-frontmatter', 'a git file starts on line 1 with the frontmatter between two "---" lines');
    }
    if (frontmatter.end > 0) checkFields(frontmatter, type, form, exists, add);
  }

  // Linear shows the title of the document above the content, so a title
  // line in the content shows the title twice. Only the git file has one.
  if (form === 'linear') {
    for (const h of headingLines.filter((h) => h.level === 1)) {
      add(h.index + 1, 'structure-title', 'a Linear document has no "# " title line, because Linear shows the document title; remove the line');
    }
  } else {
    const title = headingLines[0];
    const titleRe = new RegExp(`^${template.prefix}:\\s+(\\S.*)$`);
    if (!title || title.index !== first || title.level !== 1 || !titleRe.test(title.text)) {
      add(Math.max(first, 0) + 1, 'structure-title', `the first line after the frontmatter must be "# ${template.prefix}: <name>"`);
    } else {
      for (const m of title.text.matchAll(PLACEHOLDER)) add(title.index + 1, 'structure-placeholder', `fill in the placeholder ${m[0]}`);
    }
  }

  const h2 = headingLines.filter((h) => h.level === 2);

  const expected = template.sections.map((s) => s.title.toLowerCase());
  const seen = new Map();
  let last = -1;
  h2.forEach((h, pos) => {
    const m = h.text.match(/^(\d+)\.?\s+(.+)$/);
    const name = (m ? m[2] : h.text).trim().toLowerCase();
    const idx = expected.indexOf(name);
    const no = h.index + 1;
    if (idx < 0) {
      add(no, 'structure-heading-unknown', `"${h.text}" is not a ${type} template heading; move it under one as a subsection`);
      return;
    }
    const want = `${idx + 1}. ${template.sections[idx].title}`;
    if (!m || Number(m[1]) !== idx + 1) {
      add(no, 'structure-heading-number', `write the heading as "## ${want}"`);
    }
    if (seen.has(idx)) {
      add(no, 'structure-heading-order', `"${want}" appears twice`);
      return;
    }
    if (idx < last) {
      add(no, 'structure-heading-order', `"${want}" must come before "${last + 1}. ${template.sections[last].title}"`);
    }
    last = Math.max(last, idx);
    const end = pos + 1 < h2.length ? h2[pos + 1].index : doc.lines.length;
    seen.set(idx, { start: h.index + 1, end });
  });

  template.sections.forEach((section, idx) => {
    const want = `${idx + 1}. ${section.title}`;
    const range = seen.get(idx);
    if (!range) {
      if (!section.optional) add(1, 'structure-heading-missing', `the ${type} has no "## ${want}" heading`);
      return;
    }
    const body = [];
    for (let i = range.start; i < range.end; i++) {
      const { kind, comment } = doc.info[i];
      if (kind === 'blank' || comment) continue;
      body.push({ i, kind, text: doc.lines[i] });
    }
    const content = body.filter((b) => b.kind !== 'heading');
    if (!content.length) {
      if (!section.optional) add(range.start, 'structure-empty-section', `section "${want}" is empty`);
      return;
    }
    if (section.maxBullets) {
      const bullets = content.filter((b) => b.kind === 'text' && /^ {0,1}(?:[-*+]|\d+[.)])[ \t]/.test(b.text));
      if (bullets.length > section.maxBullets) {
        add(range.start, 'structure-summary-bullets', `section "${want}" has ${bullets.length} bullets; the limit is ${section.maxBullets}`);
      }
    }
    if (section.table) checkTable(doc, range, section, want, add);
    if (section.subsections) checkSubsections(doc, range, section, add);
    if (section.numbered && !/^\s*none\b/i.test(content[0].text)) {
      const form = NUMBER_FORM[section.numbered];
      if (section.numbered === 'phases') {
        if (!body.some((b) => b.kind === 'heading' && PHASE_HEADING.test(b.text))) {
          add(range.start, 'structure-numbered-items', `section "${want}" has no phase subsection; add one as ${form}`);
        }
        return;
      }
      if (section.numbered === 'entries') {
        const number = want.match(/^(\d+)\./)[1];
        const entries = body.filter((b) => b.kind === 'heading' && /^#{3}\s/.test(b.text));
        if (!entries.length) add(range.start, 'structure-numbered-items', `section "${want}" has no entry heading; add one as ${form}`);
        entries.forEach((entry, i) => {
          const heading = entry.text.match(HEADING)[2].trim();
          if (!heading.startsWith(`${number}.${i + 1} `)) {
            add(entry.i + 1, 'structure-numbered-items', `the entry "${heading}" in "${want}" needs the number ${number}.${i + 1}`);
          }
        });
        return;
      }
      const items = sectionItems(body);
      if (!items.length) {
        add(range.start, 'structure-numbered-items', `section "${want}" has no numbered items; number them as ${form}`);
      }
      for (const item of items) {
        if (!ITEM_NUMBER[section.numbered][item.form].test(item.text)) {
          add(item.i + 1, 'structure-numbered-items', `an item in "${want}" has no number; number it as ${form}`);
        }
      }
    }
  });
}

/** Splits one markdown table row into its trimmed cells. An escaped pipe stays in its cell. */
function tableCells(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

// The first table in the lines from `start` to `end`: its header row and the
// rows after the separator row, up to the first line that is not a row.
function firstTable(doc, start, end) {
  const at = doc.info.findIndex((l, i) => i >= start && i < end && l.kind === 'table');
  if (at < 0) return null;
  const table = { headerLine: at + 1, header: tableCells(doc.lines[at]), rows: [] };
  if (doc.info[at + 1]?.kind !== 'separator') return table;
  for (let i = at + 2; i < end && doc.info[i].kind === 'table'; i++) {
    table.rows.push({ line: i + 1, cells: tableCells(doc.lines[i]) });
  }
  return table;
}

function checkTable(doc, range, section, want, add) {
  const table = firstTable(doc, range.start, range.end);
  const columns = section.table.join(' | ');
  if (!table) {
    add(range.start, 'structure-work-order', `section "${want}" has no table; add one with the columns ${columns}`);
    return;
  }
  if (table.header.join('|').toLowerCase() !== section.table.join('|').toLowerCase()) {
    add(table.headerLine, 'structure-work-order', `the table of "${want}" must have the columns ${columns}, in this order`);
    return;
  }
  if (!table.rows.length) add(table.headerLine, 'structure-work-order', `the table of "${want}" has no row; add one row per phase`);
}

// Each "### 3.N" phase holds the level-4 headings of the template in order,
// numbered 3.N.1, 3.N.2 and so on. A phase may add its own level-4 headings
// between them; they take the next numbers.
function checkSubsections(doc, range, section, add) {
  const wanted = section.subsections.map((t) => t.toLowerCase());
  let phase = null;
  const phases = [];
  for (let i = range.start; i < range.end; i++) {
    if (doc.info[i].kind !== 'heading') continue;
    const [, hashes, text] = doc.lines[i].match(HEADING);
    if (hashes.length <= 3) {
      const number = text.trim().match(/^(\d+\.\d+)\s/);
      phase = PHASE_HEADING.test(doc.lines[i]) ? { line: i + 1, name: text.trim(), number: number[1], titles: [] } : null;
      if (phase) phases.push(phase);
    } else if (hashes.length === 4 && phase) {
      const m = text.trim().match(SUBSECTION_NUMBER);
      const expected = `${phase.number}.${phase.titles.length + 1}`;
      if (!m || m[1] !== expected) {
        add(i + 1, 'structure-phase-sections', `the heading "#### ${text.trim()}" in phase "${phase.name}" needs the number ${expected}`);
      }
      phase.titles.push((m ? m[2] : text).trim().toLowerCase());
    }
  }
  for (const p of phases) {
    const found = p.titles.filter((t) => wanted.includes(t));
    if (found.join('|') !== wanted.join('|')) {
      const list = section.subsections.map((t, i) => `"#### ${p.number}.${i + 1} ${t}"`).join(', ');
      add(p.line, 'structure-phase-sections', `phase "${p.name}" must hold the headings ${list}, once each and in this order`);
    }
  }
}

// The items of a section are its level-3 headings when it has any. Otherwise
// they are its top-level list items and the rows of its tables.
function sectionItems(body) {
  const headings = body.filter((b) => b.kind === 'heading' && /^#{3}\s/.test(b.text));
  if (headings.length) return headings.map((b) => ({ ...b, form: 'heading' }));
  const items = [];
  let afterSeparator = false;
  for (const b of body) {
    if (b.kind === 'separator') {
      afterSeparator = true;
    } else if (b.kind === 'table') {
      if (afterSeparator) items.push({ ...b, form: 'table' });
    } else {
      afterSeparator = false;
      const item = b.kind === 'text' && b.text.match(LIST_ITEM);
      if (item && indentWidth(item[1]) <= 1) items.push({ ...b, form: 'list' });
    }
  }
  return items;
}

/**
 * Returns the findings for one document as {path, line, rule, message}.
 * `form` is the form of a stage document: "linear" for the content of a
 * Linear document, "git" for a file under .sdlc-kit/. It defaults to
 * defaultForm(type), and the prose type ignores it. `exists(name)` tells
 * whether the file `name` is next to the document. It defaults to a look in
 * the directory of `path`, and with no `path` the lint skips that check.
 */
export function lintText(text, { type, form = defaultForm(type), path = '<input>', exists } = {}) {
  if (!TYPES.includes(type)) throw new Error(`unknown type "${type}"`);
  const formError = checkForm(type, form);
  if (formError) throw new Error(formError);
  const findings = [];
  const add = (line, rule, message) => findings.push({ path, line, rule, message });
  // A document that the Linear MCP returned wraps commented text in anchors.
  // They are not part of the text, so the lint removes them before any check.
  const doc = parse(stripAnchors(text), { honorDisable: type === 'prose', stage: type !== 'prose' });
  const context = { path: path === '<input>' ? null : path, headings: new Map() };
  exists ??= context.path ? (name) => existsSync(resolve(dirname(context.path), name)) : null;

  if (type !== 'prose') checkStructure(doc, type, form, exists, add);
  checkEmDash(doc, add);
  for (const block of doc.blocks) {
    const codeMasked = maskCode(maskHtmlComments(block.text));
    const masked = maskLinks(codeMasked);
    checkPresentPerfect(block, masked, add);
    checkProgressive(block, masked, add);
    checkCrossReferences(block, codeMasked, context, add);
    if (block.type === 'prose') checkSentenceLength(block, masked, add);
  }
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

function checkForm(type, form) {
  if (type === 'prose') return null;
  if (!FORMS.includes(form)) return `unknown form "${form}"`;
  if (form === 'linear' && !TEMPLATES[type].linear) return `the ${type} has no Linear form`;
  return null;
}

const USAGE = `usage: node lint.mjs --type ${TYPES.join('|')} [--form ${FORMS.join('|')}] [--json] <file>...`;

/** Runs the CLI and returns the exit code: 0 clean, 1 findings, 2 usage error. */
export function main(argv, out = process.stdout, err = process.stderr) {
  let type = null;
  let form;
  let json = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--type') type = argv[++i];
    else if (arg.startsWith('--type=')) type = arg.slice('--type='.length);
    else if (arg === '--form') form = argv[++i];
    else if (arg.startsWith('--form=')) form = arg.slice('--form='.length);
    else if (arg === '-h' || arg === '--help') {
      out.write(`${USAGE}\n`);
      return 0;
    } else if (arg.startsWith('-')) {
      err.write(`unknown option ${arg}\n${USAGE}\n`);
      return 2;
    } else files.push(arg);
  }
  if (!TYPES.includes(type) || !files.length) {
    err.write(`${USAGE}\n`);
    return 2;
  }
  form ??= defaultForm(type);
  const formError = checkForm(type, form);
  if (formError) {
    err.write(`${formError}\n${USAGE}\n`);
    return 2;
  }
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      err.write(`${file}: cannot read: ${e.message}\n`);
      return 2;
    }
    findings.push(...lintText(text, { type, form, path: file }));
  }
  if (json) out.write(`${JSON.stringify(findings, null, 2)}\n`);
  else for (const f of findings) out.write(`${f.path}:${f.line}: ${f.rule}: ${f.message}\n`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
