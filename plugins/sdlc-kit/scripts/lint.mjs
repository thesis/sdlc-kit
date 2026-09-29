#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const STATUSES = ['draft', 'in review', 'agreed', 'frozen'];

// The top-level headings of each stage template, in order. The intent and
// spec lists must match skills/<type>/template.md.
export const TEMPLATES = {
  intent: {
    prefix: 'Intent',
    status: true,
    implements: false,
    owner: true,
    linear: true,
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
    status: true,
    implements: true,
    owner: true,
    linear: false,
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
    status: false,
    implements: true,
    owner: false,
    linear: false,
    sections: [
      { title: 'Summary' },
      { title: 'Work order' },
      { title: 'Phases', numbered: 'phases' },
      { title: 'Test matrix' },
      { title: 'Risks before the work starts' },
      { title: 'Blockers' },
      { title: 'What changed', optional: true },
    ],
  },
};

export const TYPES = [...Object.keys(TEMPLATES), 'prose'];

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
const NUMBER_FORM = { items: '"1."', requirements: '"R1"', phases: '"### 3.1 Phase 1"' };

const WRITE_INSTEAD = {
  leg: 'name the thing: the job, the side, the step',
  'load-bearing': 'say what breaks when you remove it',
  verbatim: 'write "an unchanged copy", "byte for byte" or "with no edits"',
  surface: 'write "show", "report", "print" or "log"',
  leverage: 'write "use"',
  facilitate: 'write "let", "help" or "allow"',
  robust: 'say what it survives',
  seamless: 'cut the word',
  holistic: 'cut the word',
  elegant: 'cut the word',
  crucial: 'say what fails without it',
  vital: 'say what fails without it',
  key: 'say what fails without it',
  critical: 'say what fails without it',
  delve: 'write "read", "study" or "look at"',
  'dive into': 'write "read", "study" or "look at"',
  'deep dive': 'write "read", "study" or "look at"',
  landscape: 'name the actual set of things',
  ecosystem: 'name the actual set of things',
  realm: 'name the actual set of things',
  space: 'name the actual set of things',
  journey: 'name the sequence of events',
  story: 'name the sequence of events',
  narrative: 'name the sequence of events',
  unlock: 'say what the change makes possible',
  empower: 'say what the change makes possible',
  elevate: 'say what the change makes possible',
  supercharge: 'say what the change makes possible',
  streamline: 'name the step you removed',
  testament: 'cut the sentence, state the fact',
  cornerstone: 'cut the sentence, state the fact',
  backbone: 'cut the sentence, state the fact',
  tapestry: 'cut the sentence, state the fact',
};

const VERBS = new Set(['leverage', 'facilitate', 'delve', 'unlock', 'empower', 'elevate', 'supercharge', 'streamline']);
const ADJECTIVES = new Set(['load-bearing', 'verbatim', 'robust', 'seamless', 'holistic', 'elegant', 'crucial', 'vital', 'critical']);

function wordForms(word) {
  if (VERBS.has(word)) {
    return word.endsWith('e')
      ? [word, `${word}s`, `${word}d`, `${word.slice(0, -1)}ing`]
      : [word, `${word}s`, `${word}ed`, `${word}ing`];
  }
  if (ADJECTIVES.has(word)) return [word];
  if (word === 'story') return ['story', 'stories'];
  return [word, `${word}s`];
}

// A match next to a letter, a digit, "_" or "-" is part of a longer word or
// of a compound such as "key-value". The lint skips it.
const WB_BEFORE = '(?<![\\p{L}\\p{N}_-])';
const WB_AFTER = '(?![\\p{L}\\p{N}_-])';

const BANNED_PATTERNS = [
  ...Object.keys(WRITE_INSTEAD)
    .filter((w) => !['surface', 'dive into', 'deep dive'].includes(w))
    .map((w) => ({ word: w, forms: wordForms(w).map(escapeRegExp).join('|') })),
  { word: 'dive into', forms: 'd(?:ive|ives|ived|iving|ove)\\s+into' },
  { word: 'deep dive', forms: 'deep[\\s-]+dives?' },
  // The rule bans "surface" only as a verb. A regex cannot tell the part of
  // speech. So the lint flags a form of "surface" before a determiner or a
  // pronoun ("surface the", "surfaced a", "surface it"). A noun use such as
  // "the surface a user sees" is a false positive. A verb use with no object
  // after it is a false negative.
  {
    word: 'surface',
    forms:
      '(?:surface[sd]?|surfacing)\\s+(?:the|a|an|this|that|these|those|it|them|its|their|each|every|all|any|some|our|your|my)',
  },
].map(({ word, forms }) => ({ word, re: new RegExp(`${WB_BEFORE}(?:${forms})${WB_AFTER}`, 'giu') }));

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
export function parse(text, { honorDisable = false } = {}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const info = lines.map(() => ({ kind: 'text', disabled: false, comment: false }));
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
    if (end > 0) {
      for (let i = 0; i <= end; i++) info[i].kind = 'frontmatter';
      start = end + 1;
    }
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
  return { lines, info, blocks };
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

// The rules ban "key" and "space" as vague words, not as technical names.
// Both checks are denylists: the lint flags only the uses below. They cost
// some false positives. The "the space" rule also catches some interface and
// storage sentences, such as "the space before the comma". The "the key to"
// rule catches "the key to the vault".
// "key" is a finding in these uses:
// - after a form of "be" ("is key", "is key to"). It passes when a word that
//   is not in FUNCTION_WORDS or KEY_PRAISE_NOUNS follows ("What is key
//   rotation?");
// - in "the key to" or "a key to" before a word from KEY_TO_NOUNS, such as
//   "the" or "success". A word with a noun ending such as -tion after "to"
//   is also a finding. Any other word after "to" passes, such as a verb
//   ("uses the key to sign");
// - directly before a word in KEY_PRAISE_NOUNS ("a key insight"). The set
//   leaves out "results", because "key results" is the name of an OKR part.
// "space" is a finding in these uses:
// - after "in the" ("in the space");
// - after a word in SPACE_DETERMINERS, such as "the" or "this", with at most
//   one modifier between ("the DeFi space"). A modifier from
//   SPACE_TECHNICAL_MODIFIERS passes ("the address space"). This use is a
//   finding only before punctuation or before a word in FUNCTION_WORDS or
//   AUXILIARY_VERBS. It is also a finding before a word that ends in a single
//   "s", such as a verb ("the space grows"). Before another word, "space" is
//   part of a name ("the space character").
const BE_BEFORE = new RegExp(`(?<!\\p{L})(?:is|are|was|were|be|been|being)\\s+(?:${ADVERB}\\s+)?$`, 'iu');
const KEY_PRAISE_NOUNS = new Set([
  'insight', 'insights', 'step', 'steps', 'point', 'points', 'factor', 'factors', 'takeaway',
  'takeaways', 'finding', 'findings', 'role', 'part', 'aspect', 'benefit', 'reason', 'driver',
  'element', 'feature', 'decision', 'question', 'area', 'metric', 'milestone', 'difference',
  'differences', 'learning', 'learnings', 'message', 'theme', 'priority', 'priorities', 'risk',
  'risks', 'goal', 'goals', 'assumption', 'assumptions', 'consideration', 'considerations',
  'requirement', 'requirements', 'stakeholder', 'stakeholders', 'change', 'changes', 'idea',
  'ideas', 'component', 'components', 'concern', 'concerns', 'issue', 'issues', 'challenge',
  'challenges', 'lesson', 'lessons', 'objective', 'objectives', 'outcome', 'outcomes', 'piece',
  'pieces',
]);
const KEY_TO_NOUNS = new Set([
  'the', 'a', 'an', 'our', 'your', 'their', 'its', 'this', 'that', 'these', 'those', 'any', 'every',
  'success', 'growth', 'adoption', 'safety', 'security', 'trust', 'scale', 'profit',
]);
const AUXILIARY_VERBS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'can', 'could', 'will', 'would',
  'may', 'might', 'must', 'should', 'shall', 'does', 'do', 'did',
]);
const SPACE_DETERMINERS = new Set(['the', 'this', 'that', 'our', 'your', 'their', 'its']);
const SPACE_TECHNICAL_MODIFIERS = new Set([
  'address', 'disk', 'storage', 'name', 'key', 'search', 'memory', 'user', 'kernel', 'swap',
  'heap', 'stack', 'color', 'vector', 'sample', 'state', 'parameter', 'free', 'white',
]);

function previousWords(masked, index, count) {
  const words = masked.slice(Math.max(0, index - 60), index).match(/\p{L}+/gu) ?? [];
  return words.slice(-count).map((w) => w.toLowerCase());
}

function isVagueKey(masked, m) {
  if (m[0].toLowerCase() !== 'key') return false;
  const end = m.index + m[0].length;
  const next = nextWord(masked, end);
  const before = masked.slice(Math.max(0, m.index - 30), m.index);
  if (BE_BEFORE.test(before)) return !next || FUNCTION_WORDS.has(next) || KEY_PRAISE_NOUNS.has(next);
  if (next && KEY_PRAISE_NOUNS.has(next)) return true;
  if (next === 'to' && /(?<!\p{L})(?:the|a)\s+$/iu.test(before)) {
    const after = nextWord(masked, masked.indexOf('to', end) + 2);
    if (after && (KEY_TO_NOUNS.has(after) || /(?:tion|sion|ment|ness|ity|ance|ence|ship)$/.test(after))) return true;
  }
  return false;
}

function isVagueSpace(masked, m) {
  if (m[0].toLowerCase() !== 'space') return false;
  const [twoBack, oneBack] = previousWords(masked, m.index, 2);
  const inThe = /(?<!\p{L})in\s+the\s+$/iu.test(masked.slice(Math.max(0, m.index - 10), m.index));
  if (inThe) return true;
  let determined = false;
  if (oneBack && SPACE_DETERMINERS.has(oneBack)) determined = true;
  else if (twoBack && SPACE_DETERMINERS.has(twoBack) && !SPACE_TECHNICAL_MODIFIERS.has(oneBack)) determined = true;
  if (!determined) return false;
  const next = nextWord(masked, m.index + m[0].length);
  return !next || FUNCTION_WORDS.has(next) || AUXILIARY_VERBS.has(next) || /[^s]s$/.test(next);
}

function checkBannedWords(block, masked, add) {
  for (const { word, re } of BANNED_PATTERNS) {
    for (const m of masked.matchAll(re)) {
      if (word === 'key' && !isVagueKey(masked, m)) continue;
      if (word === 'space' && !isVagueSpace(masked, m)) continue;
      add(block.lineAt(m.index), 'banned-word', `banned word "${m[0].replace(/\s+/g, ' ')}": ${WRITE_INSTEAD[word]}`);
    }
  }
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

function checkStructure(doc, type, add) {
  const template = TEMPLATES[type];
  const headingLines = [];
  doc.lines.forEach((line, i) => {
    if (doc.info[i].kind !== 'heading') return;
    const [, hashes, text] = line.match(HEADING);
    headingLines.push({ index: i, level: hashes.length, text: text.trim() });
  });

  const first = doc.lines.findIndex((l, i) => doc.info[i].kind !== 'frontmatter' && l.trim() !== '');
  const title = headingLines[0];
  const titleRe = new RegExp(`^${template.prefix}:\\s+(\\S.*)$`);
  if (!title || title.index !== first || title.level !== 1 || !titleRe.test(title.text)) {
    add(first + 1, 'structure-title', `the first line must be "# ${template.prefix}: <name>"`);
  }

  const h2 = headingLines.filter((h) => h.level === 2);
  const headerEnd = h2.length ? h2[0].index : doc.lines.length;
  const headerStart = title && title.index === first ? title.index : first;
  const header = [];
  for (let i = headerStart; i < headerEnd; i++) {
    if (doc.info[i].kind !== 'fence') header.push({ no: i + 1, text: doc.lines[i] });
  }
  for (const { no, text } of header) {
    for (const m of text.matchAll(/<[a-z][a-z -]*>/gi)) {
      add(no, 'structure-placeholder', `fill in the placeholder ${m[0]}`);
    }
  }
  if (template.status) {
    const found = header.map((h) => ({ ...h, m: h.text.match(/(?:^|[\s·|])Status:[ \t]*([^·\n]*)/) })).find((h) => h.m);
    if (!found) {
      add(headerStart + 1, 'structure-status', 'the header has no "Status:" field');
    } else {
      const value = found.m[1].trim().toLowerCase();
      if (!STATUSES.includes(value)) {
        add(found.no, 'structure-status', `status "${found.m[1].trim()}" is not one of: ${STATUSES.join(', ')}`);
      }
    }
  }
  if (template.implements) {
    const found = header.map((h) => ({ ...h, m: h.text.match(/(?:^|[\s·|])Implements:[ \t]*([^\n]*)/) })).find((h) => h.m);
    if (!found) add(headerStart + 1, 'structure-implements', 'the header has no "Implements:" field');
    else if (!found.m[1].trim()) add(found.no, 'structure-implements', 'the "Implements:" field is empty');
  }
  if (template.owner) {
    const found = header.map((h) => ({ ...h, m: h.text.match(/(?:^|[\s·|])Owner:[ \t]*([^·\n]*)/) })).find((h) => h.m);
    if (!found) add(headerStart + 1, 'structure-owner', 'the header has no "Owner:" field');
    else if (!found.m[1].trim()) add(found.no, 'structure-owner', 'the "Owner:" field is empty');
  }
  if (template.linear) {
    const found = header.map((h) => ({ ...h, m: h.text.match(/^\s*Linear:[ \t]*(.*?)\s*$/) })).find((h) => h.m);
    const value = found?.m[1] ?? '';
    if (!found) {
      add(headerStart + 1, 'structure-linear', 'the header has no "Linear:" line');
    } else if (!/^<[^>]*>$/.test(value) && value !== 'pending' && !/^https?:\/\/\S+$/.test(value)) {
      add(found.no, 'structure-linear', 'the "Linear:" line must hold the document URL, or "pending" before the first save');
    }
  }

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
    if (section.numbered && !/^\s*none\b/i.test(content[0].text)) {
      const form = NUMBER_FORM[section.numbered];
      if (section.numbered === 'phases') {
        if (!body.some((b) => b.kind === 'heading' && PHASE_HEADING.test(b.text))) {
          add(range.start, 'structure-numbered-items', `section "${want}" has no phase subsection; add one as ${form}`);
        }
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

/** Returns the findings for one document as {path, line, rule, message}. */
export function lintText(text, { type, path = '<input>' } = {}) {
  if (!TYPES.includes(type)) throw new Error(`unknown type "${type}"`);
  const findings = [];
  const add = (line, rule, message) => findings.push({ path, line, rule, message });
  const doc = parse(text, { honorDisable: type === 'prose' });
  const context = { path: path === '<input>' ? null : path, headings: new Map() };

  if (type !== 'prose') checkStructure(doc, type, add);
  checkEmDash(doc, add);
  for (const block of doc.blocks) {
    const codeMasked = maskCode(maskHtmlComments(block.text));
    const masked = maskLinks(codeMasked);
    checkBannedWords(block, masked, add);
    checkPresentPerfect(block, masked, add);
    checkProgressive(block, masked, add);
    checkCrossReferences(block, codeMasked, context, add);
    if (block.type === 'prose') checkSentenceLength(block, masked, add);
  }
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

const USAGE = `usage: node lint.mjs --type ${TYPES.join('|')} [--json] <file>...`;

/** Runs the CLI and returns the exit code: 0 clean, 1 findings, 2 usage error. */
export function main(argv, out = process.stdout, err = process.stderr) {
  let type = null;
  let json = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') json = true;
    else if (arg === '--type') type = argv[++i];
    else if (arg.startsWith('--type=')) type = arg.slice('--type='.length);
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
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      err.write(`${file}: cannot read: ${e.message}\n`);
      return 2;
    }
    findings.push(...lintText(text, { type, path: file }));
  }
  if (json) out.write(`${JSON.stringify(findings, null, 2)}\n`);
  else for (const f of findings) out.write(`${f.path}:${f.line}: ${f.rule}: ${f.message}\n`);
  return findings.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
