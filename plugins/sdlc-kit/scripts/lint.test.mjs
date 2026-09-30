import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintText, TEMPLATES, slug } from './lint.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');
const lintScript = join(here, 'lint.mjs');

function rules(text, type = 'prose', path) {
  return lintText(text, { type, path }).map((f) => f.rule);
}

function templateText(type) {
  return readFileSync(join(pluginRoot, 'skills', type, 'template.md'), 'utf8');
}

const SECTION_TEXT = {
  'Executive summary': '- The vault pays lenders a fixed rate.\n- We ask for a decision on the launch date.',
  'Open problems': '1. The rate after the first term is unknown. Owner: Ana.',
  Requirements: '- R1: A lender can withdraw at any time.\n- R2: The page shows the rate.',
  Risks: '1. A large withdrawal can empty the buffer. Response: monitoring refills it.',
  'Open decisions': '1. The launch date. Owner: Ana Nowak. Date: 2026-10-15.',
};

const INTENT_URL = 'https://linear.app/thesis/document/intent-1';

// Builds a first draft the way the intent and spec skills do. The title holds
// the name, and the header holds the lines that the skill sets before the
// first save. Text replaces each guidance comment, and the draft drops the
// closing "Not here" comment.
function fillTemplate(type) {
  const lines = templateText(type)
    .replace(/\n<!--\n[\s\S]*?-->\n/, '\n')
    .split('\n')
    .map((line, i) => {
      if (i === 0) return line.replace('<name>', 'Vault on Robinhood');
      if (line.startsWith('Owner:')) return 'Owner: Ana Nowak · Status: in review';
      if (line.startsWith('Linear:')) return 'Linear: pending';
      if (line.startsWith('Implements:')) return `Implements: Intent ${INTENT_URL} · Owner: Ana Nowak · Status: in review`;
      return line;
    });
  let heading = null;
  return lines
    .map((line) => {
      const h = line.match(/^## \d+\. (.+)$/);
      if (h) heading = h[1];
      if (line.startsWith('<!--')) return SECTION_TEXT[heading] ?? 'The text of this section.';
      return line;
    })
    .join('\n');
}

const PLAN_TEXT = {
  Summary: 'The deploy script lands in phase 1.',
  'Risks before the work starts': 'None.',
  Blockers: 'None.',
};

// Builds a first plan the way the plan skill does: no guidance comments,
// the export commit in the header, one row per phase in the work order, and
// text under each heading. "7. What changed" stays empty.
function fillPlan() {
  const text = templateText('plan')
    .replace(/\n?<!--[\s\S]*?-->\n?/g, '\n')
    .replace('<name>', 'Vault on Robinhood')
    .replace(/^Implements: .*$/m, 'Implements: spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8')
    .replace('<title>', 'The deploy script')
    .replace('| --- | --- | --- |', '| --- | --- | --- |\n| 1. The deploy script | None | npm test exits with 0 |');
  return text
    .split('\n')
    .flatMap((line) => {
      const h = line.match(/^#{2,4} (?:\d+(?:\.\d+)*\.? )?(.+)$/);
      if (!h || line.startsWith('### ') || ['Work order', 'Phases', 'What changed'].includes(h[1])) return [line];
      return [line, PLAN_TEXT[h[1]] ?? 'The text of this section.'];
    })
    .join('\n');
}

const PLAN = `# Plan: Vault on Robinhood
Implements: spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8

## 1. Summary
Each deliverable lands in one phase.

## 2. Work order
| Phase | Depends on | Merge gate |
| --- | --- | --- |
| 1. The deploy script | None | npm test exits with 0 |

## 3. Phases
### 3.1 Phase 1: The deploy script
#### 3.1.1 Files that change
The deploy script changes.
#### 3.1.2 Behavior
The script deploys the vault.
#### 3.1.3 Tests
One test proves the deploy.
#### 3.1.4 Commands
Run the tests.
#### 3.1.5 Definition of done
All tests pass.

## 4. Test matrix
R1 maps to the deploy test.

## 5. Risks before the work starts
None.

## 6. Blockers
None.
`;

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'sdlc-kit-lint-'));
}

describe('templates', () => {
  for (const type of ['intent', 'spec', 'plan']) {
    test(`the ${type} template headings match the lint table`, () => {
      const headings = templateText(type)
        .split('\n')
        .filter((l) => l.startsWith('## '))
        .map((l) => l.slice(3));
      assert.deepEqual(
        headings,
        TEMPLATES[type].sections.map((s, i) => `${i + 1}. ${s.title}`),
      );
    });
  }

  test('a first plan as the skill writes it has no findings', () => {
    assert.deepEqual(lintText(fillPlan(), { type: 'plan' }), []);
  });

  test('the cli exits with 0 on a first plan as the skill writes it', () => {
    const draft = join(tempDir(), 'plan.md');
    writeFileSync(draft, fillPlan());
    const r = spawnSync(process.execPath, [lintScript, '--type', 'plan', draft], { encoding: 'utf8' });
    assert.equal(r.stdout, '');
    assert.equal(r.status, 0);
  });

  test('the plan template has the five subsections of the lint, in order', () => {
    const titles = templateText('plan')
      .split('\n')
      .filter((l) => l.startsWith('#### '))
      .map((l) => l.replace(/^#### 3\.1\.\d+ /, ''));
    assert.deepEqual(titles, TEMPLATES.plan.sections.find((s) => s.subsections).subsections);
  });

  test('an unfilled plan template fails only on placeholders, empty sections and the work order', () => {
    const found = new Set(rules(templateText('plan'), 'plan'));
    for (const rule of ['structure-placeholder', 'structure-empty-section', 'structure-work-order']) assert.ok(found.has(rule), rule);
    for (const rule of found) {
      assert.ok(['structure-placeholder', 'structure-empty-section', 'structure-work-order'].includes(rule), `unexpected rule ${rule}`);
    }
  });

  for (const type of ['intent', 'spec']) {
    test(`a first ${type} draft as the skill writes it has no findings`, () => {
      assert.deepEqual(lintText(fillTemplate(type), { type }), []);
    });

    test(`the cli exits with 0 on a first ${type} draft as the skill writes it`, () => {
      const draft = join(tempDir(), `${type}.md`);
      writeFileSync(draft, fillTemplate(type));
      const r = spawnSync(process.execPath, [lintScript, '--type', type, draft], { encoding: 'utf8' });
      assert.equal(r.stdout, '');
      assert.equal(r.status, 0);
    });

    test(`an unfilled ${type} template fails only on placeholders, status and empty sections`, () => {
      const found = new Set(rules(templateText(type), type));
      assert.ok(found.has('structure-empty-section'));
      for (const rule of found) {
        assert.ok(
          ['structure-placeholder', 'structure-status', 'structure-empty-section'].includes(rule),
          `unexpected rule ${rule}`,
        );
      }
    });
  }

  test('a plan in the plan template has no findings', () => {
    assert.deepEqual(lintText(PLAN, { type: 'plan' }), []);
  });

  test('the prose type skips the structure checks', () => {
    assert.deepEqual(rules('A short line.', 'prose'), []);
  });
});

describe('structure', () => {
  const intent = fillTemplate('intent');
  const spec = fillTemplate('spec');

  test('a wrong title fails', () => {
    assert.ok(rules(intent.replace('# Intent:', '# Idea:'), 'intent').includes('structure-title'));
  });

  test('a missing status fails', () => {
    assert.ok(rules(intent.replace('Status: in review', 'Phase: one'), 'intent').includes('structure-status'));
  });

  test('a status outside the list fails', () => {
    assert.ok(rules(intent.replace('Status: in review', 'Status: done'), 'intent').includes('structure-status'));
  });

  test('a spec with no Implements field fails', () => {
    assert.ok(rules(spec.replace('Implements:', 'Based on:'), 'spec').includes('structure-implements'));
  });

  test('a plan with no Implements field fails', () => {
    assert.ok(rules(PLAN.replace('Implements:', 'Uses:'), 'plan').includes('structure-implements'));
  });

  test('a placeholder left in the header fails', () => {
    assert.ok(rules(intent.replace('Owner: Ana Nowak', 'Owner: <name>'), 'intent').includes('structure-placeholder'));
  });

  test('a heading with no number fails', () => {
    assert.ok(rules(intent.replace('## 2. Problem', '## Problem'), 'intent').includes('structure-heading-number'));
  });

  test('a heading with the wrong number fails', () => {
    assert.ok(rules(intent.replace('## 2. Problem', '## 3. Problem'), 'intent').includes('structure-heading-number'));
  });

  test('a top-level heading outside the template fails', () => {
    assert.ok(rules(`${intent}\n## 8. Appendix\nMore text.\n`, 'intent').includes('structure-heading-unknown'));
  });

  test('a subsection outside the template passes', () => {
    assert.deepEqual(rules(intent.replace('## 2. Problem\n', '## 2. Problem\n### 2.1 Evidence\nThe logs show it.\n'), 'intent'), []);
  });

  test('a missing heading fails', () => {
    const text = intent.replace(/## 6\. Constraints\n[^\n]*\n/, '');
    assert.ok(rules(text, 'intent').includes('structure-heading-missing'));
  });

  test('headings out of order fail', () => {
    const text = intent
      .replace('## 4. Not in scope now', '## 5. Affected users and systems TMP')
      .replace('## 5. Affected users and systems\n', '## 4. Not in scope now\n')
      .replace(' TMP', '');
    assert.ok(rules(text, 'intent').includes('structure-heading-order'));
  });

  test('an empty required section fails', () => {
    assert.ok(rules(intent.replace(/(## 6\. Constraints\n)[^\n]*\n/, '$1\n'), 'intent').includes('structure-empty-section'));
  });

  test('a section with only a guidance comment is empty', () => {
    const text = intent.replace(/(## 6\. Constraints\n)[^\n]*\n/, '$1<!-- Facts that bound any solution. -->\n');
    assert.ok(rules(text, 'intent').includes('structure-empty-section'));
  });

  test('a plan with no "7. What changed" heading passes', () => {
    assert.ok(!PLAN.includes('What changed'));
    assert.deepEqual(rules(PLAN, 'plan'), []);
  });

  test('open problems with no numbers fail', () => {
    const text = intent.replace('1. The rate after the first term is unknown.', '- The rate after the first term is unknown.');
    assert.ok(rules(text, 'intent').includes('structure-numbered-items'));
  });

  test('open problems that say "None." pass', () => {
    const text = intent.replace('1. The rate after the first term is unknown. Owner: Ana.', 'None.');
    assert.deepEqual(rules(text, 'intent'), []);
  });

  test('requirements with no R numbers fail', () => {
    const text = spec.replace('- R1: A lender', '- A lender').replace('- R2: The page', '- The page');
    assert.ok(rules(text, 'spec').includes('structure-numbered-items'));
  });

  for (const [name, value] of [
    ['a missing sha', 'spec.md · intent.md @ 1a2b3c4'],
    ['a sha of six characters', 'spec.md @ 1a2b3c · intent.md @ 1a2b3c4'],
    ['the files in the other order', 'intent.md @ 1a2b3c4 · spec.md @ 1a2b3c4'],
    ['a sha that is not hex', 'spec.md @ main · intent.md @ 1a2b3c4'],
  ]) {
    test(`a plan Implements field with ${name} fails`, () => {
      assert.deepEqual(rules(PLAN.replace('spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8', value), 'plan'), ['structure-implements']);
    });
  }

  test('a plan Implements field with two full shas passes', () => {
    const sha = 'a'.repeat(40);
    assert.deepEqual(rules(PLAN.replace('spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8', `spec.md @ ${sha} · intent.md @ ${sha}`), 'plan'), []);
  });

  test('a work order with no table fails', () => {
    const text = PLAN.replace(/\| Phase \| Depends on[^\n]*\n[^\n]*\n[^\n]*\n/, 'Phase 1 merges first.\n');
    assert.deepEqual(rules(text, 'plan'), ['structure-work-order']);
  });

  for (const header of ['| Phase | Gate |', '| Phase | PR | Depends on | Merge gate |', '| Depends on | Phase | Merge gate |']) {
    test(`a work order table with the header ${header} fails`, () => {
      assert.deepEqual(rules(PLAN.replace('| Phase | Depends on | Merge gate |', header), 'plan'), ['structure-work-order']);
    });
  }

  test('a work order table with no row fails', () => {
    assert.deepEqual(rules(PLAN.replace('| 1. The deploy script | None | npm test exits with 0 |\n', ''), 'plan'), ['structure-work-order']);
  });

  test('a phase with a missing subsection fails', () => {
    const text = PLAN.replace('#### 3.1.3 Tests\nOne test proves the deploy.\n', '').replace('3.1.4 Commands', '3.1.3 Commands').replace('3.1.5 Definition', '3.1.4 Definition');
    assert.deepEqual(rules(text, 'plan'), ['structure-phase-sections']);
  });

  test('a phase with its subsections out of order fails', () => {
    const text = PLAN.replace('3.1.3 Tests', '3.1.3 Commands').replace('3.1.4 Commands', '3.1.4 Tests');
    assert.deepEqual(rules(text, 'plan'), ['structure-phase-sections']);
  });

  test('a subsection with no number or a wrong number fails', () => {
    assert.deepEqual(rules(PLAN.replace('#### 3.1.3 Tests', '#### Tests'), 'plan'), ['structure-phase-sections']);
    assert.deepEqual(rules(PLAN.replace('#### 3.1.3 Tests', '#### 3.1.4 Tests'), 'plan'), ['structure-phase-sections']);
  });

  test('a phase with an extra numbered subsection passes', () => {
    const text = PLAN.replace('#### 3.1.3 Tests\n', '#### 3.1.3 Tests\n#### 3.1.4 Fixtures\nOne fixture.\n').replace('3.1.4 Commands', '3.1.5 Commands').replace('3.1.5 Definition', '3.1.6 Definition');
    assert.deepEqual(rules(text, 'plan'), []);
  });

  test('a "7. What changed" entry with no number fails', () => {
    const entry = '\n## 7. What changed\n### 2026-10-02 · Phase 1\nThe script reads the address from the environment.\n';
    assert.deepEqual(rules(`${PLAN}${entry}`, 'plan'), ['structure-numbered-items']);
  });

  test('a "7. What changed" entry in the template form passes', () => {
    const entry = '\n## 7. What changed\n### 7.1 2026-10-02 · Phase 1\nThe script reads the address from the environment, because the deploy host has no config file.\n';
    assert.deepEqual(rules(`${PLAN}${entry}`, 'plan'), []);
  });

  test('plan phases with no 3.N subsection fail', () => {
    assert.ok(rules(PLAN.replace('### 3.1 Phase 1', '### Phase one'), 'plan').includes('structure-numbered-items'));
  });

  test('an intent with no Owner field fails', () => {
    assert.ok(rules(intent.replace('Owner: Ana Nowak · ', ''), 'intent').includes('structure-owner'));
  });

  test('a spec with no Owner field fails', () => {
    assert.ok(rules(spec.replace(' · Owner: Ana Nowak', ''), 'spec').includes('structure-owner'));
  });

  test('an intent with no Linear line fails', () => {
    assert.ok(rules(intent.replace('Linear: pending\n', ''), 'intent').includes('structure-linear'));
  });

  test('a Linear line with the document URL passes', () => {
    assert.deepEqual(rules(intent.replace('Linear: pending', `Linear: ${INTENT_URL}`), 'intent'), []);
  });

  test('a Linear line with other text fails', () => {
    assert.deepEqual(rules(intent.replace('Linear: pending', 'Linear: soon'), 'intent'), ['structure-linear']);
  });

  test('the Linear placeholder of the template fails', () => {
    assert.deepEqual(rules(intent.replace('Linear: pending', 'Linear: <url>'), 'intent'), ['structure-placeholder']);
  });

  test('one open problem with no number among numbered ones fails', () => {
    const text = intent.replace(SECTION_TEXT['Open problems'], `${SECTION_TEXT['Open problems']}\n- The fee is unknown. Owner: Bo.`);
    const found = lintText(text, { type: 'intent' });
    assert.deepEqual(found.map((f) => f.rule), ['structure-numbered-items']);
    assert.equal(text.split('\n')[found[0].line - 1], '- The fee is unknown. Owner: Bo.');
  });

  test('a sub-item under a numbered open problem passes', () => {
    const text = intent.replace(SECTION_TEXT['Open problems'], `${SECTION_TEXT['Open problems']}\n   - The market decides it.`);
    assert.deepEqual(rules(text, 'intent'), []);
  });

  test('one requirement with no R number fails', () => {
    assert.deepEqual(rules(spec.replace('- R2: The page', '- The page'), 'spec'), ['structure-numbered-items']);
  });

  test('an open decision with no number fails', () => {
    assert.deepEqual(rules(spec.replace('1. The launch date.', '- The launch date.'), 'spec'), ['structure-numbered-items']);
  });

  test('risks as numbered level-3 headings pass', () => {
    const text = spec.replace(SECTION_TEXT.Risks, '### 1. A large withdrawal\nMonitoring refills the buffer.\n- The alert goes to the curator.');
    assert.deepEqual(rules(text, 'spec'), []);
  });

  test('a risk heading with no number fails', () => {
    const text = spec.replace(SECTION_TEXT.Risks, '### A large withdrawal\nMonitoring refills the buffer.');
    assert.deepEqual(rules(text, 'spec'), ['structure-numbered-items']);
  });

  test('open decisions in a table with numbered rows pass', () => {
    const table = '| # | Decision | Owner | Date |\n| --- | --- | --- | --- |\n| 1 | The launch date | Ana | 2026-10-15 |';
    assert.deepEqual(rules(spec.replace(SECTION_TEXT['Open decisions'], table), 'spec'), []);
  });

  test('a table row with no number fails', () => {
    const table = '| # | Decision | Owner | Date |\n| --- | --- | --- | --- |\n| x | The launch date | Ana | 2026-10-15 |';
    assert.deepEqual(rules(spec.replace(SECTION_TEXT['Open decisions'], table), 'spec'), ['structure-numbered-items']);
  });

  const EXPORTED = `Exported: ${INTENT_URL} · 2026-09-29T00:00:00Z`;

  test('an intent with an Exported line after the Linear line passes', () => {
    assert.deepEqual(rules(intent.replace('Linear: pending', `Linear: ${INTENT_URL}\n${EXPORTED}`), 'intent'), []);
  });

  test('a spec with an Exported line after the Implements line passes', () => {
    assert.deepEqual(rules(spec.replace(/^(Implements: .*)$/m, `$1\n${EXPORTED}`), 'spec'), []);
  });

  for (const line of ['Exported: yesterday', `Exported: ${INTENT_URL}`, 'Exported: 2026-09-29T00:00:00Z', `Exported: ${INTENT_URL} · 29.09.2026`]) {
    test(`an Exported line in another form fails: ${line}`, () => {
      assert.deepEqual(rules(intent.replace('Linear: pending', `Linear: pending\n${line}`), 'intent'), ['structure-exported']);
    });
  }

  test('a plan with an Exported line fails', () => {
    assert.deepEqual(rules(PLAN.replace(/^(Implements: .*)$/m, `$1\n${EXPORTED}`), 'plan'), ['structure-exported']);
  });

  test('an Exported line below the first section is not a header field', () => {
    assert.deepEqual(rules(intent.replace('## 2. Problem\n', '## 2. Problem\nExported: soon.\n'), 'intent'), []);
  });

  test('an executive summary with six bullets fails', () => {
    const six = Array.from({ length: 6 }, (_, i) => `- Point ${i + 1}.`).join('\n');
    const text = intent.replace(SECTION_TEXT['Executive summary'], six);
    assert.ok(rules(text, 'intent').includes('structure-summary-bullets'));
  });
});

describe('em-dash', () => {
  test('an em-dash in prose fails', () => {
    assert.deepEqual(rules('The vault holds the rate \u2014 most of the time.'), ['em-dash']);
  });

  test('an em-dash in a fenced code block passes', () => {
    assert.deepEqual(rules('The output:\n\n```\na \u2014 b\n```\n'), []);
  });

  test('an em-dash in a code span passes', () => {
    assert.deepEqual(rules('Search for `a \u2014 b` in the log.'), []);
  });

  test('an em-dash in an indented code block passes', () => {
    assert.deepEqual(rules('The output:\n\n    a \u2014 b\n'), []);
  });

  test('an indented paragraph inside a list item is prose', () => {
    assert.deepEqual(rules('- The item.\n\n  More \u2014 text.\n'), ['em-dash']);
  });

  test('a list continuation at the content column is prose', () => {
    const found = rules('1. Step one.\n\n    Paragraph inside the step \u2014 with a dash. We leverage it.\n');
    assert.deepEqual(found.sort(), ['banned-word', 'em-dash']);
  });

  test('a code block four columns past the list content is code', () => {
    assert.deepEqual(rules('1. Step one.\n\n       code \u2014 here, we leverage it\n'), []);
  });

  test('a banned word in an indented code block passes', () => {
    assert.deepEqual(rules('The output:\n\n    We leverage it.\n'), []);
  });

  test('a hyphen and an en-dash pass', () => {
    assert.deepEqual(rules('The 2026-09 stage covers pages 3–5.'), []);
  });
});

describe('banned-word', () => {
  test('a banned word fails', () => {
    assert.deepEqual(rules('We leverage the vault.'), ['banned-word']);
  });

  test('an inflected banned word fails', () => {
    assert.deepEqual(rules('The change streamlined the deploy.'), ['banned-word']);
  });

  test('a banned word in capitals fails', () => {
    assert.deepEqual(rules('A Robust vault.'), ['banned-word']);
  });

  test('a banned phrase across a line break fails', () => {
    assert.deepEqual(rules('We did a deep\ndive on the rate.'), ['banned-word']);
  });

  test('a banned word in a code span passes', () => {
    assert.deepEqual(rules('Set `key` in the file.'), []);
  });

  test('a banned word in a fenced code block passes', () => {
    assert.deepEqual(rules('```\nconst key = 1;\n```\n'), []);
  });

  test('a banned word in a URL passes', () => {
    assert.deepEqual(rules('See https://example.com/robust-design for the source.'), []);
  });

  test('a banned word in a link target passes', () => {
    assert.deepEqual(rules('See [the source](https://example.com/key) for the rate.'), []);
  });

  test('a banned word inside a longer word passes', () => {
    assert.deepEqual(rules('The monkey stays in the whitespace of the keyboard.'), []);
  });

  test('a banned word in a hyphenated compound passes', () => {
    assert.deepEqual(rules('The store holds key-value pairs.'), []);
  });

  test('"key" after a technical word passes', () => {
    assert.deepEqual(rules('The deployer holds the private key and the API key.'), []);
  });

  test('"key" as praise fails', () => {
    assert.deepEqual(rules('This is a key step.'), ['banned-word']);
  });

  test('"surface" before a determiner fails', () => {
    assert.deepEqual(rules('The script surfaces the rate.'), ['banned-word']);
  });

  test('"surface" as a noun passes', () => {
    assert.deepEqual(rules('The attack surface is small.'), []);
  });

  for (const text of [
    'The EOA behind that key signs the call.',
    'A leaked allocator key.',
    'Rotate the key every month.',
    'The key is the object form.',
    'Keep the keys in the vault.',
    'The script reads the key, then the address.',
    'The explorer picks the Etherscan key shape.',
    'Generate a key pair for the deployer.',
    'Each key maps to a row.',
    'The signer uses the key to sign.',
    'A key compromise drains the vault.',
    'The key custody plan and the key generation step are ready.',
    'The key signer approves.',
    'What is key rotation?',
    'Key holders sign each transfer.',
    'Key shares are split between the signers.',
    'Key rotations happen every month.',
    'The key results of the quarter are on the page.',
  ]) {
    test(`"key" as a noun passes: ${text}`, () => {
      assert.deepEqual(rules(text), []);
    });
  }

  for (const text of [
    'A key insight.',
    'Speed is key.',
    'The fix is key.',
    'They are key.',
    'Speed is key to the launch.',
    'The key to success is speed.',
    'The key to adoption is trust.',
    'Key differences remain.',
    'Key findings follow.',
    'The key component of the design is the buffer.',
    'A key concern is the rate.',
    'The key part is the rate.',
  ]) {
    test(`"key" as praise fails: ${text}`, () => {
      assert.deepEqual(rules(text), ['banned-word']);
    });
  }

  for (const text of [
    'Leave one space after the colon.',
    'The code runs in user space.',
    'The kernel space is small.',
    'The address space grows.',
    'The disk has little free disk space.',
    'Use a space character.',
    'Put the space character between the words.',
    'The search space is small.',
  ]) {
    test(`"space" as a technical word passes: ${text}`, () => {
      assert.deepEqual(rules(text), []);
    });
  }

  for (const text of [
    'We work in the DeFi space.',
    'We lead in this space.',
    'The lending space is crowded.',
    'The design space is wide.',
    'Much happens in the space.',
    'The space grows every year.',
    'Many teams in the space ship fast.',
  ]) {
    test(`"space" as a vague word fails: ${text}`, () => {
      assert.deepEqual(rules(text), ['banned-word']);
    });
  }
});

describe('sentence-length', () => {
  const words = (n) => `${Array.from({ length: n }, () => 'word').join(' ')}.`;

  test('a sentence of 26 words fails', () => {
    assert.deepEqual(rules(words(26)), ['sentence-length']);
  });

  test('a sentence of 25 words passes', () => {
    assert.deepEqual(rules(words(25)), []);
  });

  test('a long sentence reports the line where it starts', () => {
    const [finding] = lintText(`Short one.\n\nFirst ${words(30)}`, { type: 'prose' });
    assert.equal(finding.line, 3);
  });

  test('a bold lead and the sentence after it are two sentences', () => {
    assert.deepEqual(rules(`- **${words(10).slice(0, -1)}.** ${words(20)}`), []);
  });

  test('a long sentence in a list item fails', () => {
    assert.deepEqual(rules(`- ${words(26)}`), ['sentence-length']);
  });

  test('two list items are two sentences', () => {
    assert.deepEqual(rules(`- ${words(15).slice(0, -1)}\n- ${words(15).slice(0, -1)}`), []);
  });

  test('a link target does not count', () => {
    const target = Array.from({ length: 30 }, () => 'x').join('-');
    assert.deepEqual(rules(`${words(20).slice(0, -1)} [the source](https://example.com/${target}).`), []);
  });

  test('a long heading passes', () => {
    assert.deepEqual(rules(`## ${words(30)}`), []);
  });

  test('a long table row passes', () => {
    assert.deepEqual(rules(`| a | b |\n| --- | --- |\n| ${words(30)} | x |`), []);
  });

  test('"e.g." does not end a sentence', () => {
    assert.deepEqual(rules(`${words(15).slice(0, -1)}, e.g. ${words(15)}`), ['sentence-length']);
  });
});

describe('present-perfect', () => {
  test('"has failed" fails', () => {
    assert.deepEqual(rules('The test has failed.'), ['present-perfect']);
  });

  test('"has been deployed" fails', () => {
    assert.deepEqual(rules('The vault has been deployed.'), ['present-perfect']);
  });

  test('the simple past passes', () => {
    assert.deepEqual(rules('The test failed.'), []);
  });

  test('"have" before a word that is not a participle passes', () => {
    assert.deepEqual(rules('The vaults have open positions.'), []);
  });

  for (const text of [
    'The vault has limited liquidity.',
    'The team has dedicated staff.',
    'We had mixed results.',
    'The vault has fixed terms.',
    'The user has unlimited access.',
    'The product has hidden fees.',
    'The vault has locked funds.',
    'The page has broken links.',
    'The plan has detailed steps for each phase.',
  ]) {
    test(`an adjective after "have" passes: ${text}`, () => {
      assert.deepEqual(rules(text), []);
    });
  }

  for (const text of [
    'The owner has agreed.',
    'The engineer has fixed the bug.',
    'The owner has defined the scope.',
    'The team has agreed with the plan.',
    'The vault has limited it.',
  ]) {
    test(`an adjective participle before a function word or punctuation fails: ${text}`, () => {
      assert.deepEqual(rules(text), ['present-perfect']);
    });
  }

  for (const text of ['It has been open for days.', 'The vault has been limited liquidity.', 'The fee has been fixed.']) {
    test(`"has been" is always a finding: ${text}`, () => {
      assert.deepEqual(rules(text), ['present-perfect']);
    });
  }

  test('"since" between the words does not hide it', () => {
    assert.deepEqual(rules('The team has since shipped it.'), ['present-perfect']);
  });

  for (const text of ['We have not decided.', 'It has already failed.', 'Lenders have often asked for it.', "We've done it.", "It's been a week.", "The test hasn't failed.", 'The team has made a plan.']) {
    test(`an adverb, a contraction or an irregular participle does not hide it: ${text}`, () => {
      assert.deepEqual(rules(text), ['present-perfect']);
    });
  }

  test('"\'s" before a participle other than "been" passes', () => {
    assert.deepEqual(rules("It's closed."), []);
  });

  test('the present perfect in a code span passes', () => {
    assert.deepEqual(rules('The log says `has failed`.'), []);
  });
});

describe('progressive-ing', () => {
  test('"is running" fails', () => {
    assert.deepEqual(rules('The job is running.'), ['progressive-ing']);
  });

  test('a bare -ing word passes', () => {
    assert.deepEqual(rules('The running job stops at noon.'), []);
  });

  test('a noun that ends in -ing passes', () => {
    assert.deepEqual(rules('The result is nothing new.'), []);
  });

  test('an allowed technical name passes', () => {
    assert.deepEqual(rules('The default is logging level debug.'), []);
  });

  for (const text of ['The status is pending.', 'A file is missing.', 'The result is interesting.', 'Two tests were missing.', 'The balance is outstanding.', 'The label is misleading.', 'The name is confusing.']) {
    test(`an adjective that ends in -ing passes: ${text}`, () => {
      assert.deepEqual(rules(text), []);
    });
  }

  for (const text of ['The job is not running.', 'They are still running.', "It's running.", "We're running it.", "The job isn't running."]) {
    test(`an adverb or a contraction does not hide it: ${text}`, () => {
      assert.deepEqual(rules(text), ['progressive-ing']);
    });
  }

  test('a possessive "\'s" before an -ing word passes', () => {
    assert.deepEqual(rules("The vault's lending rate is 4%."), []);
  });
});

describe('cross-references', () => {
  test('a reference with no link fails', () => {
    assert.deepEqual(rules('See spec section 7 (Deliverables).'), ['xref-form']);
  });

  test('a reference in the required form passes', () => {
    assert.deepEqual(rules('See spec section ["7. Deliverables"](spec.md#7-deliverables).'), []);
  });

  test('a reference to a Linear URL passes', () => {
    assert.deepEqual(rules('See intent section ["2. Problem"](https://linear.app/thesis/document/intent-1).'), []);
  });

  test('a reference across a line break passes', () => {
    assert.deepEqual(rules('See spec section\n["7. Deliverables"](spec.md#7-deliverables).'), []);
  });

  test('the plural "sections" is not a reference', () => {
    assert.deepEqual(rules('The plan sections list the phases.'), []);
  });

  for (const text of ['See section 7 of the spec.', 'See section 2.1 of the intent.']) {
    test(`the form "section N of the document" fails: ${text}`, () => {
      assert.deepEqual(rules(text), ['xref-form']);
    });
  }

  test('a reference in a code span passes', () => {
    assert.deepEqual(rules('Write `spec section 7` in the form below.'), []);
  });

  test('a reference that links the wrong document fails', () => {
    assert.deepEqual(rules('See spec section ["2. Problem"](intent.md#2-problem).'), ['xref-doc']);
  });

  describe('with a local sibling file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'spec.md'), fillTemplate('spec'));
    const plan = join(dir, 'plan.md');

    test('a matching heading and anchor pass', () => {
      assert.deepEqual(rules('See spec section ["7. Deliverables"](spec.md#7-deliverables).', 'prose', plan), []);
    });

    test('a title that no heading has fails', () => {
      assert.deepEqual(rules('See spec section ["7. Outputs"](spec.md#7-outputs).', 'prose', plan), ['xref-target']);
    });

    test('a number that no heading has fails', () => {
      assert.deepEqual(rules('See spec section ["6. Deliverables"](spec.md#6-deliverables).', 'prose', plan), ['xref-target']);
    });

    test('a wrong anchor fails', () => {
      assert.deepEqual(rules('See spec section ["7. Deliverables"](spec.md#deliverables).', 'prose', plan), ['xref-anchor']);
    });
  });

  test('the anchor of a heading follows the GitHub form', () => {
    assert.equal(slug('11. Intent open problems, answered'), '11-intent-open-problems-answered');
  });
});

describe('lint-disable markers', () => {
  const text = 'Intro.\n\n<!-- lint-disable -->\nWe leverage it \u2014 always.\n<!-- lint-enable -->\n\nWe leverage it.\n';

  test('the prose type skips the text between the markers', () => {
    const found = lintText(text, { type: 'prose' });
    assert.deepEqual(found.map((f) => [f.line, f.rule]), [[7, 'banned-word']]);
  });

  test('a marker inside a code span does not switch the lint off', () => {
    assert.deepEqual(rules('Use `<!-- lint-disable -->` here.\n\nWe leverage it.\n'), ['banned-word']);
  });

  test('a stage document type ignores the markers', () => {
    const found = rules(`${fillTemplate('intent')}\n${text}`, 'intent');
    assert.ok(found.includes('em-dash'));
  });
});

describe('cli', () => {
  const dir = tempDir();
  const clean = join(dir, 'clean.md');
  const dirty = join(dir, 'dirty.md');
  writeFileSync(clean, 'A short line.\n');
  writeFileSync(dirty, 'A short line.\nWe leverage it.\n');
  const run = (...args) => spawnSync(process.execPath, [lintScript, ...args], { encoding: 'utf8' });

  test('a clean file exits with 0 and prints nothing', () => {
    const r = run('--type', 'prose', clean);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('a finding exits with 1 and prints path:line: rule-id: message', () => {
    const r = run('--type', 'prose', clean, dirty);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^${dirty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2: banned-word: .+\\n$`));
  });

  test('--json prints an array of findings', () => {
    const r = run('--type=prose', '--json', dirty);
    assert.equal(r.status, 1);
    const [finding] = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(finding), ['path', 'line', 'rule', 'message']);
    assert.equal(finding.line, 2);
  });

  test('--json on a clean file prints an empty array', () => {
    const r = run('--type', 'prose', '--json', clean);
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), []);
  });

  test('an unknown type exits with 2', () => {
    assert.equal(run('--type', 'memo', clean).status, 2);
  });

  test('a missing file exits with 2', () => {
    assert.equal(run('--type', 'prose', join(dir, 'none.md')).status, 2);
  });
});
