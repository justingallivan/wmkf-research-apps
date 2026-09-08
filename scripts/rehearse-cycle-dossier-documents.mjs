#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { renderDossierDocuments } from '../lib/services/cycle-dossier-documents.js';

const OUTPUT_DIR = '/tmp/cycle-dossier-documents';

const REFERENCE_SEEDS = [
  ['A bounded study of α signaling', 'https://doi.org/10.1000/alpha-study', '2026-09-01T12:00:00Z'],
  ['β pathway methods and uncertainty', 'https://pubmed.ncbi.nlm.nih.gov/12345678/', '2026-09-01T12:01:00Z'],
  ['Field methods for Δ response', 'https://openalex.org/W123456789', '2026-09-01T12:02:00Z'],
];

function words(seed, count) {
  const tokens = seed.trim().split(/\s+/);
  return Array.from({ length: count }, (_, index) => tokens[index % tokens.length]).join(' ');
}

function section(label, count) {
  return `${label}. ${words(
    'The proposal describes a measurable mechanism and places its claim beside established work while preserving uncertainty. '
      + 'The retained evidence supports a careful comparison of methods, populations, and outcomes. '
      + 'For a scientist outside this field, the key idea is that a change in α or β can alter the observed response without proving causation. '
      + 'The investigators use a defined protocol, record controls, and explain where the sample may fail to represent the wider field. '
      + 'The working model includes Δ response and the compact relation ∫ x² dx = x³/3, which is a notation example rather than a result. '
      + 'Results should therefore be read with the stated confidence limits, missing observations, and replication plan in view. '
      + 'This briefing keeps proposal claims, external evidence, interpretation, and open questions separate so that the reader can inspect each step. '
      + 'The evidence does not establish funding priority or a ranking. It identifies the scientific context, the testable contribution, and the gaps that a later review should resolve.',
    count,
  )}`;
}

function makeEntry(index) {
  const references = REFERENCE_SEEDS.map(([title, url, retrievedAt], refIndex) => ({
    sourceId: `synthetic-${index}-${refIndex + 1}`,
    title,
    url,
    retrievedAt,
  }));
  return {
    requestId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    requestNumber: `D26-REHEARSAL-${index}`,
    title: `A deliberately long synthetic proposal title for α and β response mapping in the Δ boundary condition study ${index}`,
    institution: `Synthetic Institute for Translational Measurement ${index}`,
    pi: `Dr. PI ${index} with a long display name for pagination review`,
    programDirector: index === 1 ? 'Dr. Ada Lovelace' : 'Dr. Grace Hopper',
    revision: index,
    provenance: { generatedAt: '2026-09-07T12:00:00.000Z' },
    research: {
      partial: true,
      coverage: '3 sources with abstracts retained; 1 adapter failure; coverage is partial by design.',
    },
    entry: {
      projectAtAGlance: section('Project at a glance', 270),
      whyItMatters: section('Why it matters', 270),
      fieldAroundIt: section('The field around it', 270),
      backgroundForOutsideField: section('Background for an outside-field scientist', 270),
      references,
    },
  };
}

const manifest = {
  title: 'D26 Cycle Dossier Synthetic Rendering Rehearsal with Long Scientific Titles α β Δ',
  partial: true,
  gaps: [{ source: 'PubMed', query: 'synthetic α β mechanism', reason: 'bounded timeout during rehearsal' }],
  entries: [makeEntry(1), makeEntry(2)],
  groups: [
    { programDirector: 'Dr. Ada Lovelace', requestIds: ['00000000-0000-4000-8000-000000000001'] },
    { programDirector: 'Dr. Grace Hopper', requestIds: ['00000000-0000-4000-8000-000000000002'] },
  ],
};

await mkdir(OUTPUT_DIR, { recursive: true });
const result = await renderDossierDocuments(manifest);
await writeFile(`${OUTPUT_DIR}/combined.docx`, result.combined.docx);
await writeFile(`${OUTPUT_DIR}/combined.pdf`, result.combined.pdf);
for (const [index, item] of result.individual.entries()) {
  await writeFile(`${OUTPUT_DIR}/entry-${index + 1}.docx`, item.docx);
  await writeFile(`${OUTPUT_DIR}/entry-${index + 1}.pdf`, item.pdf);
}
console.log(JSON.stringify({
  outputDir: OUTPUT_DIR,
  entries: result.individual.length,
  files: ['combined.docx', 'combined.pdf', 'entry-1.docx', 'entry-1.pdf', 'entry-2.docx', 'entry-2.pdf'],
  hashes: { combinedDocx: result.combined.docxSha256, combinedPdf: result.combined.pdfSha256 },
}, null, 2));
