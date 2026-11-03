import { assertPreparedPackage, isPreparedCycle } from '../../lib/services/test-requests/prepared-fixture-contract.js';
test('minimum reviewer package does not require intake AI outputs or unrelated documents', () => {
  expect(() => assertPreparedPackage({ abstract: 'Applicant abstract', documents: [{kind:'reviewerProposal'}] })).not.toThrow();
});
test.each([
  { abstract:'Applicant abstract',documents:[{kind:'proposalNarrative'},{kind:'proposalBibliography'}] },
  { abstract:' ',documents:[{kind:'reviewerProposal'}] },
  { abstract:'Applicant abstract',documents:[{kind:'reviewerProposal'},{kind:'reviewerProposal'}] },
])('missing/ambiguous required input refuses', bundle => expect(() => assertPreparedPackage(bundle)).toThrow());
test.each([['D26',false],['J27',true],['D27',true],['J28',true],['j27',false],['J270',false],[null,false]])('prepared cutover %s', (code, expected) => expect(isPreparedCycle(code)).toBe(expected));
