/**
 * Characterization of the existing governed DOCX hash using the approved
 * individual-review renderer. The hash implementation remains in the Initial
 * Assessment artifact service for this release.
 *
 * @jest-environment node
 */

const JSZip = require('jszip');

const { hashGovernedDocxContent } = require('../../lib/services/initial-assessment/artifact-service');
const { renderIndividualReviewDocx } = require('../../lib/services/review-documents/docx-renderer');

function copyFixture() {
  return {
    header: {
      reviewerName: 'Dr. Reviewer',
      reviewerTitleAndOrganization: 'Professor, University One',
      requestNumber: '1002903',
      requestTitle: 'A Proposal',
      institution: 'University Two',
      submittedAt: '2026-09-02T17:30:00.000Z',
      generatedAtIso: '2026-09-03T18:00:00.000Z',
    },
    sections: [{
      questionKey: 'approach',
      questionOrder: 1,
      questionText: 'Comment on the approach.',
      questionType: 'richtext',
      state: 'answered',
      answerLabel: null,
      blocks: [{ type: 'paragraph', runs: [{ text: 'Strong work.' }] }],
    }],
  };
}

async function repackWithContainerDate(buffer, date) {
  const zip = await JSZip.loadAsync(buffer);
  const appProperties = zip.file('docProps/app.xml');
  zip.file('docProps/app.xml', await appProperties.async('nodebuffer'), { date });
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('two raw-distinct renders of the same governed Word content have the same semantic hash', async () => {
  const rendered = await Promise.all([
    renderIndividualReviewDocx(copyFixture()),
    renderIndividualReviewDocx(copyFixture()),
  ]);
  const [first, second] = await Promise.all([
    repackWithContainerDate(rendered[0], new Date('2026-09-03T18:00:00.000Z')),
    repackWithContainerDate(rendered[1], new Date('2026-09-03T18:02:00.000Z')),
  ]);

  expect(first.equals(second)).toBe(false);
  await expect(hashGovernedDocxContent(first))
    .resolves.toBe(await hashGovernedDocxContent(second));
});
