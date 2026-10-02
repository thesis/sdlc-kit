import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lintText, TEMPLATES, slug } from './lint.mjs';
import { exportDocument } from './linear.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = join(here, '..');
const lintScript = join(here, 'lint.mjs');

function rules(text, type = 'prose', options = {}) {
  return lintText(text, { type, ...options }).map((f) => f.rule);
}

const GIT = { form: 'git' };

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

// The Linear form of a draft in the template: the intent and spec skills
// remove the title line before the lint and the save, because the name goes
// to the title of the Linear document.
function linearDraft(text) {
  return text.replace(/^# (?:Intent|Spec): .*\n\n/m, '');
}

// Builds a first draft the way the intent and spec skills do: the Linear
// form, with the frontmatter fields that the skill sets before the save.
// Text replaces each guidance comment, and the draft drops the closing
// "Not here" comment.
function fillTemplate(type) {
  const lines = linearDraft(templateText(type))
    .replace(/\n<!--\n[\s\S]*?-->\n/, '\n')
    .split('\n')
    .map((line) => {
      if (line.startsWith('owner:')) return 'owner: Ana Nowak';
      if (line.startsWith('status:')) return 'status: review';
      if (line.startsWith('relates:')) return `relates: ${INTENT_URL}`;
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

const EXPORTED_AT = '2026-09-29T00:00:00Z';

// The git file that the plan skill writes from a draft with linear.mjs export.
function exportTemplate(type) {
  return exportDocument(fillTemplate(type), { url: INTENT_URL, title: `${TEMPLATES[type].prefix}: Vault on Robinhood`, at: EXPORTED_AT });
}

const PLAN_TEXT = {
  Summary: 'The deploy script lands in phase 1.',
  'Risks before the work starts': 'None.',
  Blockers: 'None.',
};

// Builds a first plan the way the plan skill does: no guidance comments,
// one row per phase in the work order, and text under each heading.
// "7. What changed" stays empty.
function fillPlan() {
  const text = templateText('plan')
    .replace(/\n?<!--[\s\S]*?-->\n?/g, '\n')
    .replace('<name>', 'Vault on Robinhood')
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

const PLAN = `---
type: plan
relates: spec.md, intent.md
---

# Plan: Vault on Robinhood

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

// A stage directory with the git files of the intent and the spec.
function stageDir() {
  const dir = tempDir();
  writeFileSync(join(dir, 'intent.md'), exportTemplate('intent'));
  writeFileSync(join(dir, 'spec.md'), exportTemplate('spec'));
  return dir;
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

    test(`the ${type} template starts with the frontmatter fields of the lint, then the title line`, () => {
      const lines = templateText(type).split('\n');
      const end = lines.indexOf('---', 1);
      assert.equal(lines[0], '---');
      assert.deepEqual(lines.slice(1, end).map((l) => l.split(':')[0]), TEMPLATES[type].fields);
      assert.deepEqual(lines.slice(end + 1, end + 3), ['', `# ${TEMPLATES[type].prefix}: <name>`]);
    });
  }

  test('a first plan as the skill writes it has no findings', () => {
    assert.deepEqual(lintText(fillPlan(), { type: 'plan' }), []);
  });

  test('the cli exits with 0 on a first plan as the skill writes it, next to the intent and the spec', () => {
    const draft = join(stageDir(), 'plan.md');
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

    test(`an unfilled ${type} template in the Linear form fails only on placeholders, status and empty sections`, () => {
      const found = new Set(rules(linearDraft(templateText(type)), type));
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

  test('the comment anchors of Linear do not count', () => {
    const anchored = intent
      .replace('## 2. Problem', '## 2. <linear-comment id="a1" resolved="true">Problem</linear-comment>')
      .replace('Ana Nowak', '<linear-comment id="a2" resolved="false">Ana Nowak</linear-comment>');
    assert.notEqual(anchored, intent);
    assert.deepEqual(rules(anchored, 'intent'), rules(intent, 'intent'));
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

  test('an executive summary with six bullets fails', () => {
    const six = Array.from({ length: 6 }, (_, i) => `- Point ${i + 1}.`).join('\n');
    const text = intent.replace(SECTION_TEXT['Executive summary'], six);
    assert.ok(rules(text, 'intent').includes('structure-summary-bullets'));
  });
});

describe('frontmatter', () => {
  const intent = fillTemplate('intent');
  const spec = fillTemplate('spec');
  const body = (text) => text.slice(text.indexOf('\n## 1.'));
  const fence = (fields) => `\`\`\`yaml\n${fields.join('\n')}\n\`\`\`\n`;
  const INTENT_FIELDS = ['type: intent', 'owner: Ana Nowak', 'status: review'];
  const withFields = (fields) => `${fence(fields)}${body(intent)}`;
  const gitIntent = exportTemplate('intent');
  const gitSpec = exportTemplate('spec');

  describe('in the Linear form', () => {
    test('the form that Linear stores for a saved "---" block passes', () => {
      const stored =
        '```yaml\ntype: spec\nowner: Łukasz Zimnoch\nstatus: review\n' +
        'relates: https://linear.app/thesis-co/document/example-1234abcd\n```\n';
      assert.deepEqual(rules(`${stored}${body(spec)}`, 'spec'), []);
    });

    test('a ```yaml block passes', () => {
      assert.deepEqual(rules(withFields(INTENT_FIELDS), 'intent'), []);
    });

    test('a frontmatter after blank lines passes', () => {
      assert.deepEqual(rules(`\n\n${intent}`, 'intent'), []);
    });

    test('a title line fails, because Linear shows the title of the document', () => {
      const found = lintText(intent.replace('---\n\n', '---\n\n# Intent: Vault on Robinhood\n\n'), { type: 'intent' });
      assert.deepEqual(found.map((f) => [f.line, f.rule]), [[7, 'structure-title']]);
    });

    test('an exported field fails', () => {
      const text = withFields([...INTENT_FIELDS, `exported: ${INTENT_URL} · ${EXPORTED_AT}`]);
      assert.deepEqual(rules(text, 'intent'), ['structure-exported']);
    });

    test('a document of the old form fails with the steps to convert it', () => {
      const old = `# Intent: Vault on Robinhood\nOwner: Ana Nowak · Status: review\nLinear: ${INTENT_URL}\n${body(intent)}`;
      const found = lintText(old, { type: 'intent' });
      assert.deepEqual(found.map((f) => [f.line, f.rule]), [[1, 'structure-frontmatter'], [1, 'structure-title']]);
      assert.match(found[0].message, /^the document has no frontmatter; start it with a "---" block of the fields type, owner and status\./);
      assert.match(found[0].message, /move the values of its "Owner:", "Status:", "Linear:" and "Exported:" lines into these fields, and remove the "# Intent:" line$/);
    });
  });

  describe('in the git form', () => {
    for (const [type, text] of [['intent', gitIntent], ['spec', gitSpec]]) {
      test(`the exported ${type} passes`, () => {
        assert.deepEqual(rules(text, type, GIT), []);
      });
    }

    test('a file with no exported field fails', () => {
      assert.deepEqual(rules(gitIntent.replace(/^exported: .*\n/m, ''), 'intent', GIT), ['structure-exported']);
    });

    for (const value of ['yesterday', INTENT_URL, EXPORTED_AT, `${INTENT_URL} · 29.09.2026`]) {
      test(`an exported field in another form fails: ${value}`, () => {
        assert.deepEqual(rules(gitIntent.replace(/^exported: .*$/m, `exported: ${value}`), 'intent', GIT), ['structure-exported']);
      });
    }

    test('a plan with an exported field fails', () => {
      assert.deepEqual(rules(PLAN.replace('---\n\n', `exported: ${INTENT_URL} · ${EXPORTED_AT}\n---\n\n`), 'plan'), ['structure-exported']);
    });

    test('a ```yaml fence fails', () => {
      const text = gitIntent.replace(/^---\n/, '```yaml\n').replace(/\n---\n/, '\n```\n');
      assert.deepEqual(rules(text, 'intent', GIT), ['structure-frontmatter']);
    });

    test('a blank line above the frontmatter fails', () => {
      assert.deepEqual(rules(`\n${gitIntent}`, 'intent', GIT), ['structure-frontmatter']);
    });

    test('a file with no title line fails', () => {
      assert.deepEqual(rules(gitIntent.replace('# Intent: Vault on Robinhood\n', ''), 'intent', GIT), ['structure-title']);
    });

    test('a wrong title fails', () => {
      assert.deepEqual(rules(gitIntent.replace('# Intent:', '# Idea:'), 'intent', GIT), ['structure-title']);
    });

    test('a plan of the old form fails with the steps to convert it', () => {
      const old = PLAN.replace(/^---\n[\s\S]*?\n---\n\n(# Plan: .*\n)/, '$1Implements: spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8\n');
      const found = lintText(old, { type: 'plan' });
      assert.deepEqual(found.map((f) => f.rule), ['structure-frontmatter']);
      assert.match(found[0].message, /^the file has no frontmatter; start it with a "---" block of the fields type and relates, above the "# Plan: <name>" line\. .*the values of its "Implements:" lines into these fields$/);
    });

    test('the plan has no Linear form', () => {
      assert.throws(() => lintText(PLAN, { type: 'plan', form: 'linear' }), /the plan has no Linear form/);
    });
  });

  describe('fields', () => {
    for (const [name, fields, rule] of [
      ['no type field', INTENT_FIELDS.slice(1), 'structure-frontmatter'],
      ['the type of another document', ['type: spec', ...INTENT_FIELDS.slice(1)], 'structure-frontmatter'],
      ['a field that the type does not take', [...INTENT_FIELDS, `linear: ${INTENT_URL}`], 'structure-frontmatter'],
      ['no owner field', ['type: intent', 'status: review'], 'structure-owner'],
      ['an empty owner field', ['type: intent', 'owner:', 'status: review'], 'structure-owner'],
      ['no status field', INTENT_FIELDS.slice(0, 2), 'structure-status'],
      ['a status outside the list', ['type: intent', 'owner: Ana Nowak', 'status: done'], 'structure-status'],
      ['a placeholder', ['type: intent', 'owner: <name>', 'status: review'], 'structure-placeholder'],
      ['an em-dash', ['type: intent', 'owner: Ana — Nowak', 'status: review'], 'em-dash'],
    ]) {
      test(`an intent with ${name} fails`, () => {
        assert.deepEqual(rules(withFields(fields), 'intent'), [rule]);
      });
    }

    test('a status in upper case passes', () => {
      assert.deepEqual(rules(withFields(['type: intent', 'owner: Ana Nowak', 'status: Review']), 'intent'), []);
    });

    test('a spec with no relates field fails', () => {
      assert.deepEqual(rules(spec.replace(/^relates: .*\n/m, ''), 'spec'), ['structure-relates']);
    });

    for (const value of [`Intent ${INTENT_URL}`, 'the intent', 'intent.md']) {
      test(`a spec relates field that is not a bare URL fails: ${value}`, () => {
        const found = lintText(spec.replace(`relates: ${INTENT_URL}`, `relates: ${value}`), { type: 'spec' });
        assert.deepEqual(found.map((f) => [f.line, f.rule, f.message]), [[5, 'structure-relates', 'write the field as "relates: <intent URL>"']]);
      });
    }

    test('a plan with no relates field fails', () => {
      assert.deepEqual(rules(PLAN.replace(/^relates: .*\n/m, ''), 'plan'), ['structure-relates']);
    });

    for (const [name, value] of [
      ['the sha pin of the old form', 'spec.md @ 1a2b3c4 · intent.md @ 5d6e7f8'],
      ['the files in the other order', 'intent.md, spec.md'],
      ['a path outside the stage directory', '../spec.md, intent.md'],
      ['only the spec', 'spec.md'],
    ]) {
      test(`a plan relates field with ${name} fails`, () => {
        const found = lintText(PLAN.replace('relates: spec.md, intent.md', `relates: ${value}`), { type: 'plan' });
        assert.deepEqual(found.map((f) => [f.line, f.rule, f.message]), [[3, 'structure-relates', 'write the field as "relates: spec.md, intent.md"']]);
      });
    }

    test('a plan next to its intent and spec passes', () => {
      assert.deepEqual(rules(PLAN, 'plan', { path: join(stageDir(), 'plan.md') }), []);
    });

    test('a plan with no intent next to it fails on the relates line', () => {
      const dir = tempDir();
      writeFileSync(join(dir, 'spec.md'), exportTemplate('spec'));
      const found = lintText(PLAN, { type: 'plan', path: join(dir, 'plan.md') });
      assert.deepEqual(found.map((f) => [f.line, f.rule, f.message]), [[3, 'structure-relates', 'the plan relates to intent.md, but no intent.md is next to it']]);
    });

    test('the exists option replaces the look in the directory of the path', () => {
      const found = lintText(PLAN, { type: 'plan', path: join(stageDir(), 'plan.md'), exists: (name) => name === 'intent.md' });
      assert.deepEqual(found.map((f) => f.message), ['the plan relates to spec.md, but no spec.md is next to it']);
    });

    test('a plan with no path skips the look for the related files', () => {
      assert.deepEqual(rules(PLAN, 'plan'), []);
    });

    test('a value in double quotes passes', () => {
      assert.deepEqual(rules(withFields(['type: intent', 'owner: "Ana: Nowak"', 'status: review']), 'intent'), []);
    });

    for (const [name, line] of [
      ['an indented line', '  team: core'],
      ['a key in upper case', 'Team: core'],
      ['a list value', 'team: [core, ops]'],
      ['a value with ": "', 'team: core: ops'],
      ['a value with " #"', 'team: core #ops'],
      ['no colon', 'core team'],
    ]) {
      test(`a frontmatter line with ${name} fails on its line`, () => {
        const found = lintText(withFields(['type: intent', line, 'owner: Ana Nowak', 'status: review']), { type: 'intent' });
        assert.deepEqual(found.map((f) => [f.line, f.rule]), [[3, 'structure-frontmatter']]);
      });
    }

    test('a field that appears twice fails on the second line', () => {
      const found = lintText(withFields([...INTENT_FIELDS, 'owner: Bo']), { type: 'intent' });
      assert.deepEqual(found.map((f) => [f.line, f.rule, f.message]), [[5, 'structure-frontmatter', 'the field "owner" appears twice']]);
    });

    test('a frontmatter with no closing line fails', () => {
      assert.ok(rules(intent.replace('status: review\n---\n', 'status: review\n'), 'intent').includes('structure-frontmatter'));
    });
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
    const found = rules('1. Step one.\n\n    Paragraph inside the step \u2014 with a dash. It has failed.\n');
    assert.deepEqual(found.sort(), ['em-dash', 'present-perfect']);
  });

  test('a code block four columns past the list content is code', () => {
    assert.deepEqual(rules('1. Step one.\n\n       code \u2014 here, it has failed\n'), []);
  });

  test('a perfect tense in an indented code block passes', () => {
    assert.deepEqual(rules('The output:\n\n    It has failed.\n'), []);
  });

  test('a hyphen and an en-dash pass', () => {
    assert.deepEqual(rules('The 2026-09 stage covers pages 3–5.'), []);
  });
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
      assert.deepEqual(rules('See spec section ["7. Deliverables"](spec.md#7-deliverables).', 'prose', { path: plan }), []);
    });

    test('a title that no heading has fails', () => {
      assert.deepEqual(rules('See spec section ["7. Outputs"](spec.md#7-outputs).', 'prose', { path: plan }), ['xref-target']);
    });

    test('a number that no heading has fails', () => {
      assert.deepEqual(rules('See spec section ["6. Deliverables"](spec.md#6-deliverables).', 'prose', { path: plan }), ['xref-target']);
    });

    test('a wrong anchor fails', () => {
      assert.deepEqual(rules('See spec section ["7. Deliverables"](spec.md#deliverables).', 'prose', { path: plan }), ['xref-anchor']);
    });
  });

  test('the anchor of a heading follows the GitHub form', () => {
    assert.equal(slug('11. Intent open problems, answered'), '11-intent-open-problems-answered');
  });
});

describe('lint-disable markers', () => {
  const text = 'Intro.\n\n<!-- lint-disable -->\nIt has failed \u2014 always.\n<!-- lint-enable -->\n\nIt has failed.\n';

  test('the prose type skips the text between the markers', () => {
    const found = lintText(text, { type: 'prose' });
    assert.deepEqual(found.map((f) => [f.line, f.rule]), [[7, 'present-perfect']]);
  });

  test('a marker inside a code span does not switch the lint off', () => {
    assert.deepEqual(rules('Use `<!-- lint-disable -->` here.\n\nIt has failed.\n'), ['present-perfect']);
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
  writeFileSync(dirty, 'A short line.\nIt has failed.\n');
  const run = (...args) => spawnSync(process.execPath, [lintScript, ...args], { encoding: 'utf8' });

  test('a clean file exits with 0 and prints nothing', () => {
    const r = run('--type', 'prose', clean);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('a finding exits with 1 and prints path:line: rule-id: message', () => {
    const r = run('--type', 'prose', clean, dirty);
    assert.equal(r.status, 1);
    assert.match(r.stdout, new RegExp(`^${dirty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:2: present-perfect: .+\\n$`));
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

  describe('--form', () => {
    const exported = join(dir, 'intent.md');
    writeFileSync(exported, exportTemplate('intent'));

    test('--form git passes the git file of an intent', () => {
      const r = run('--type', 'intent', '--form', 'git', exported);
      assert.equal(r.stdout, '');
      assert.equal(r.status, 0);
    });

    test('with no --form, an intent is linted in the Linear form', () => {
      const r = run('--type', 'intent', exported);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /:8: structure-title: a Linear document has no "# " title line/);
    });

    test('an unknown form exits with 2', () => {
      assert.equal(run('--type', 'intent', '--form=github', exported).status, 2);
    });

    test('the Linear form of a plan exits with 2', () => {
      const r = run('--type', 'plan', '--form', 'linear', exported);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /^the plan has no Linear form\n/);
    });
  });
});
