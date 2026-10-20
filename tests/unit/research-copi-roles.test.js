/**
 * @jest-environment node
 */
import { normalizeForQuote, quoteVerified, isBudgetFile, decideRole, matchPeople, quoteNamesPerson, lastName } from '../../scripts/lib/research-copi-roles.mjs';

const docs = new Map([
  ['Bio_Roe.pdf', normalizeForQuote('Role: Co-Investigator on the proposed Keck project; responsible for imaging.')],
  ['budget.pdf', normalizeForQuote('Dr. Jane Roe, Associate Professor, 1.0 summer month (8% effort), salary requested $22,000.')],
  ['narr.pdf', normalizeForQuote('Dr. Roe will serve as Senior Personnel and advise on statistics.')],
]);

describe('quoteVerified', () => {
  test('accepts a quote found in the cited document, despite case and punctuation noise', () => {
    expect(quoteVerified('ROLE: Co–Investigator on the proposed Keck project', 'Bio_Roe.pdf', docs)).toBe(true);
  });
  test('rejects a quote that is not in the cited document', () => {
    expect(quoteVerified('Role: Co-PI on the proposed Keck project', 'Bio_Roe.pdf', docs)).toBe(false);
  });
  test('rejects a real quote attributed to the wrong document', () => {
    expect(quoteVerified('Role: Co-Investigator on the proposed Keck project', 'budget.pdf', docs)).toBe(false);
  });
  test('rejects quotes shorter than four words', () => {
    expect(quoteVerified('Co-Investigator', 'Bio_Roe.pdf', docs)).toBe(false);
  });
});

describe('isBudgetFile', () => {
  test.each([
    ['Budget Justification.pdf', true], ['BUDGET.xlsx', true], ['Key Personnel.docx', true],
    ['Narrative.pdf', false], ['budget-notes.txt', false],
    ['Budget Reallocation Supplement 1 (5-19-2020).pdf', false],
    ['NCE 2020 - Keck2017 NCE Justification and Itemized Spending Plan.pdf', false],
    ['No-Cost Extension Budget.pdf', false], ['Final Report Budget.xlsx', false],
    ['2018_DEC_UCLA_992037_Revised Budget Approval.pdf', false],
    ['WMKF_NCE Request_Budget Justif_SCRI Kaushansky.pdf', false], ['Finance Budget.pdf', true], ['UCLA BUDGET PAGE - Edited.xlsx', true],
  ])('%s → %s', (name, expected) => expect(isBudgetFile(name)).toBe(expected));
});

describe('decideRole', () => {
  test('stated co-investigator role with a verified quote is a co-PI', () => {
    const out = decideRole({ role_stated: 'Co-Investigator', role_quote: 'Role: Co-Investigator on the proposed Keck project', role_source: 'Bio_Roe.pdf' }, true, docs, 'Jane Roe');
    expect(out.decision).toBe('co-PI');
  });
  test('a non-lead PI on a multi-PI proposal counts as a co-PI', () => {
    const multi = new Map([['p.pdf', normalizeForQuote('PI Alec Davidson would fill this knowledge gap by identifying the SCN neurons')]]);
    const out = decideRole({ role_stated: 'pi', role_quote: 'PI Alec Davidson would fill this knowledge gap', role_source: 'p.pdf' }, true, multi, 'Alec Davidson, Ph.D.');
    expect(out.decision).toBe('co-PI');
  });
  test('a stated co-PI role whose quote is not in the documents is rejected', () => {
    const out = decideRole({ role_stated: 'co-PI', role_quote: 'Dr. Roe is a co-PI of this project', role_source: 'narr.pdf' }, true, docs, 'Jane Roe');
    expect(out.decision).toBe('not co-PI');
    expect(out.basis).toMatch(/quote not found/);
  });
  test('a verified non-co-PI role wins over budget presence', () => {
    const out = decideRole({
      role_stated: 'senior/key personnel', role_quote: 'Dr. Roe will serve as Senior Personnel', role_source: 'narr.pdf',
      in_budget: true, budget_effort: '8%', budget_quote: '1.0 summer month (8% effort), salary requested', budget_source: 'budget.pdf',
    }, true, docs, 'Jane Roe');
    expect(out.decision).toBe('not co-PI');
  });
  test('faculty with verified budgeted effort and no stated role is budget-only', () => {
    const out = decideRole({ role_stated: 'none', in_budget: true, budget_effort: '8%', budget_quote: 'Dr. Jane Roe, Associate Professor, 1.0 summer month (8% effort)', budget_source: 'budget.pdf' }, true, docs, 'Jane Roe');
    expect(out.decision).toBe('budget-only');
  });
  test('budgeted effort for someone not faculty-level is not a co-PI', () => {
    const out = decideRole({ role_stated: 'none', in_budget: true, budget_effort: '8%', budget_quote: 'Dr. Jane Roe, Associate Professor, 1.0 summer month (8% effort)', budget_source: 'budget.pdf' }, false, docs, 'Jane Roe');
    expect(out.decision).toBe('not co-PI');
  });
  test('budget claim without a verified quote is not evidence', () => {
    const out = decideRole({ role_stated: 'none', in_budget: true, budget_effort: '10%', budget_quote: 'Dr. Roe 10% effort year one', budget_source: 'budget.pdf' }, true, docs, 'Jane Roe');
    expect(out.decision).toBe('not co-PI');
  });
  test('no evidence at all is not a co-PI', () => {
    expect(decideRole({}, true, docs, 'Jane Roe').decision).toBe('not co-PI');
  });
  test('a generic sentence about the PIs does not make a named person a co-PI', () => {
    const g = new Map([['narr.pdf', normalizeForQuote('This will be made feasible by the leadership roles of the principal investigators within each of the projects.')]]);
    const out = decideRole({ role_stated: 'pi', role_quote: 'leadership roles of the principal investigators within each of the projects', role_source: 'narr.pdf' }, true, g, 'Thomas Graeber, Ph.D.');
    expect(out.decision).toBe('not co-PI');
    expect(out.basis).toMatch(/does not name/);
  });
  test('a budget line naming someone else is not this person\'s budget evidence', () => {
    const out = decideRole({ role_stated: 'none', in_budget: true, budget_effort: '8%', budget_quote: 'Dr. Jane Roe, Associate Professor, 1.0 summer month (8% effort)', budget_source: 'budget.pdf' }, true, docs, 'Sam Poe');
    expect(out.decision).toBe('not co-PI');
  });
});

describe('name handling', () => {
  test('lastName drops honorifics and degrees', () => {
    expect(lastName('Dr. Thomas Graeber, Ph.D.')).toBe('graeber');
    expect(lastName('Brigitte Gomperts, M.D.')).toBe('gomperts');
  });
  test('quoteNamesPerson matches whole words in the quote or the file name', () => {
    expect(quoteNamesPerson('PI: Jason DeBruyne, Ph.D.', 'p.pdf', 'Jason DeBruyne')).toBe(true);
    expect(quoteNamesPerson('Role: Co-Investigator', 'Bio_Peyda.pdf', 'Parham Peyda')).toBe(true);
    expect(quoteNamesPerson('Dr. Lee and Dr. Leeds', 'x.pdf', 'Ann Lee')).toBe(true);
    expect(quoteNamesPerson('Dr. Leeds will advise', 'x.pdf', 'Ann Lee')).toBe(false);
  });
  test('matchPeople tolerates titles, degrees and middle names', () => {
    const m = matchPeople(['Jane Roe', 'Thomas Graeber', 'Ann Lee'], [
      { name: 'Dr. Jane Q. Roe' }, { name: 'Thomas Graeber, Ph.D.' }, { name: 'A. Lee' }, { name: 'Alan Lee' },
    ]);
    expect(m.get('Thomas Graeber').name).toBe('Thomas Graeber, Ph.D.');
    expect(m.get('Jane Roe').name).toBe('Dr. Jane Q. Roe');
    expect(m.has('Ann Lee')).toBe(false); // two entries fit last name + initial: ambiguous
  });
});
