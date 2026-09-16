/**
 * Derive the tracked Pre-Research Presentation Brief template from the
 * owner's example file.
 *
 * docs/plans/PRE_RESEARCH_PRESENTATION_BRIEF_PLAN_2026-09-16.md §2, §5 slice 2
 * (B6: no header). The owner's `Staff Briefing Template.docx` is not tracked
 * (delivered this session as
 * outputs/staff-briefing-template-owner-2026-09-16.docx); this script makes
 * the derivation reproducible instead of hand-editing a binary artifact:
 *
 *   node scripts/build-pre-rp-brief-template.mjs <path-to-owner-docx> \
 *     shared/templates/pre-research-presentation-brief/brief-v1.docx
 *
 * What it does to word/document.xml:
 *   - "University of Colorado Boulder" -> [[DV:InstitutionName]]
 *   - "Title" (PI/PD line trio)        -> [[DV:ProjectTitle]]
 *   - "PI"                              -> [[DV:PrincipalInvestigator]]
 *   - "PD"                              -> [[DV:ProgramDirector]]
 *   - Abstract paragraph body (keeps the bold "Abstract:" label) -> [[DV:Abstract]]
 *   - Referee sentence paragraph (keeps the "Referee Comments:" Heading 1
 *     paragraph immediately above it) -> [[STAFF:RefereeSentences]]
 *   - "Issues to be Addressed at the Research Presentation:" bold label is
 *     left untouched, with nothing after it (already true in the owner file).
 *
 * And strips (B6, no header):
 *   - word/header1.xml, header2.xml, header3.xml
 *   - word/footer1.xml, footer2.xml, footer3.xml
 *   - their entries in word/_rels/document.xml.rels
 *   - their Override entries in [Content_Types].xml
 *   - every <w:headerReference>/<w:footerReference> in word/document.xml's
 *     <w:sectPr>
 *
 * And, because this repository is public and every rendered brief inherits
 * whatever ships in the tracked template (Round-1 review finding 1):
 *   - blanks docProps/core.xml's `dc:creator` and `cp:lastModifiedBy` (the
 *     owner file carries a staff member's and the owner's personal names)
 *     and removes `cp:lastPrinted`;
 *   - removes customXml/item{1,2,3}.xml, itemProps{1,2,3}.xml, and
 *     customXml/_rels/item{1,2,3}.xml.rels (SharePoint ContentTypeId and
 *     site-column GUIDs — not referenced by any content control in
 *     word/document.xml), docProps/custom.xml (SharePoint ContentTypeId
 *     custom property), and word/intelligence2.xml, plus their entries in
 *     _rels/.rels / word/_rels/document.xml.rels and their Override entries
 *     in [Content_Types].xml.
 */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function replaceUniqueText(xml, needleOpenTag, plainText, replacement) {
  const marker = `${needleOpenTag}${plainText}</w:t>`;
  const count = xml.split(marker).length - 1;
  if (count !== 1) {
    fail(`Expected exactly one occurrence of ${marker}; found ${count}.`);
  }
  return xml.replace(marker, `${needleOpenTag}${replacement}</w:t>`);
}

function replaceAbstractBody(xml) {
  const marker = /<w:p\b[^>]*>((?:(?!<\/w:p>)[\s\S])*?)<\/w:p>/g;
  let updated = null;
  let match;
  while ((match = marker.exec(xml)) !== null) {
    const paragraph = match[0];
    const inner = match[1];
    if (!/<w:t[^>]*>Abstract<\/w:t>/.test(inner)) continue;
    // Keep the paragraph's opening tag + <w:pPr> (if any) + the two bold
    // "Abstract" / ":" runs; drop every run after them and append one run
    // carrying the token, preceded by a literal space to match the owner
    // file's "Abstract: <body>" spacing.
    const pPrMatch = inner.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
    const afterPPr = pPrMatch ? inner.slice(pPrMatch[0].length) : inner;
    const boldRuns = afterPPr.match(/^(?:<w:r\b[^>]*>[\s\S]*?<\/w:r>){2}/);
    if (!boldRuns) fail('Could not isolate the bold "Abstract:" runs.');
    const openTag = paragraph.slice(0, paragraph.indexOf('>') + 1);
    const tokenRun = '<w:r><w:t xml:space="preserve"> [[DV:Abstract]]</w:t></w:r>';
    const newInner = `${pPrMatch ? pPrMatch[0] : ''}${boldRuns[0]}${tokenRun}`;
    const newParagraph = `${openTag}${newInner}</w:p>`;
    updated = xml.slice(0, match.index) + newParagraph + xml.slice(match.index + paragraph.length);
    break;
  }
  if (!updated) fail('Abstract paragraph not found.');
  return updated;
}

function replaceRefereeParagraph(xml) {
  const marker = /<w:p\b[^>]*>((?:(?!<\/w:p>)[\s\S])*?)<\/w:p>/g;
  let updated = null;
  let match;
  while ((match = marker.exec(xml)) !== null) {
    const paragraph = match[0];
    const inner = match[1];
    if (!/We received (?:one|two|three|four|five|six|seven|eight|nine|ten) review/.test(inner)) continue;
    const pPrMatch = inner.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
    const openTag = paragraph.slice(0, paragraph.indexOf('>') + 1);
    // lib/services/pre-rp-brief/docx-renderer.js's replaceTokenRunWithSegments
    // (unlike its DV-placeholder path) requires this token to be the ENTIRE
    // text of one standalone <w:r> run — it locates the run by exact text
    // match and throws otherwise, because it must splice in multiple runs
    // (plain + underlined) at that exact position. Do not let a future
    // template edit split this token across runs or share a run with other
    // text (Round-1 review finding 10).
    const tokenRun = '<w:r><w:t>[[STAFF:RefereeSentences]]</w:t></w:r>';
    const newParagraph = `${openTag}${pPrMatch ? pPrMatch[0] : ''}${tokenRun}</w:p>`;
    updated = xml.slice(0, match.index) + newParagraph + xml.slice(match.index + paragraph.length);
    break;
  }
  if (!updated) fail('Referee sentence paragraph not found.');
  return updated;
}

function stripSectPrReferences(xml) {
  const before = xml;
  const after = xml.replace(/<w:(?:header|footer)Reference\b[^/]*\/>/g, '');
  if (after === before) fail('No headerReference/footerReference elements found to strip.');
  return after;
}

/**
 * Blank the two personal names in docProps/core.xml and remove
 * `cp:lastPrinted` (Round-1 review finding 1). Fails if any of the three
 * elements is missing, the same "fail if absent" posture as the header
 * strip above.
 */
function scrubCoreProperties(xml) {
  let updated = xml;
  const creatorMatch = updated.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/);
  if (!creatorMatch) fail('docProps/core.xml has no <dc:creator> element to scrub.');
  updated = updated.replace(creatorMatch[0], '<dc:creator></dc:creator>');

  const modifiedByMatch = updated.match(/<cp:lastModifiedBy>([\s\S]*?)<\/cp:lastModifiedBy>/);
  if (!modifiedByMatch) fail('docProps/core.xml has no <cp:lastModifiedBy> element to scrub.');
  updated = updated.replace(modifiedByMatch[0], '<cp:lastModifiedBy></cp:lastModifiedBy>');

  const lastPrintedMatch = updated.match(/<cp:lastPrinted>[\s\S]*?<\/cp:lastPrinted>/);
  if (!lastPrintedMatch) fail('docProps/core.xml has no <cp:lastPrinted> element to remove.');
  updated = updated.replace(lastPrintedMatch[0], '');

  return updated;
}

// Parts carrying SharePoint/Office metadata that has nothing to do with the
// brief's content and should never ship in a public repository (Round-1
// review finding 1): the three customXml items + their itemProps + their
// rels, docProps/custom.xml, and word/intelligence2.xml. None is referenced
// by a content control in word/document.xml (verified: no `customXml` or
// `w:sdt`/`dataBinding` token appears there).
const METADATA_PARTS = Object.freeze([
  'customXml/item1.xml',
  'customXml/item2.xml',
  'customXml/item3.xml',
  'customXml/itemProps1.xml',
  'customXml/itemProps2.xml',
  'customXml/itemProps3.xml',
  'customXml/_rels/item1.xml.rels',
  'customXml/_rels/item2.xml.rels',
  'customXml/_rels/item3.xml.rels',
  'docProps/custom.xml',
  'word/intelligence2.xml',
]);

function removeMetadataParts(zip) {
  for (const partName of METADATA_PARTS) {
    if (!zip.file(partName)) fail(`Expected metadata part to strip was not found: ${partName}`);
    zip.remove(partName);
  }
}

function stripPackageRelsCustomProperties(xml) {
  const before = xml;
  const after = xml.replace(/<Relationship\b[^>]*Type="[^"]*\/custom-properties"[^>]*\/>/g, '');
  if (after === before) fail('No custom-properties relationship entry found in _rels/.rels to strip.');
  return after;
}

function stripDocumentRelsMetadataEntries(xml) {
  const before = xml;
  const after = xml
    .replace(/<Relationship\b[^>]*Type="[^"]*\/customXml"[^>]*\/>/g, '')
    .replace(/<Relationship\b[^>]*Type="[^"]*intelligence[^"]*"[^>]*\/>/g, '');
  if (after === before) fail('No customXml/intelligence relationship entries found in word/_rels/document.xml.rels to strip.');
  return after;
}

function stripContentTypesMetadataOverrides(xml) {
  const before = xml;
  const after = xml.replace(
    /<Override PartName="\/(?:customXml\/itemProps\d+\.xml|docProps\/custom\.xml|word\/intelligence2\.xml)"[^>]*\/>/g,
    '',
  );
  if (after === before) fail('No metadata Content_Types overrides found to strip.');
  return after;
}

async function main() {
  const [, , sourceArg, destArg] = process.argv;
  if (!sourceArg || !destArg) {
    fail('Usage: node scripts/build-pre-rp-brief-template.mjs <owner-docx-path> <dest-docx-path>');
  }
  const sourcePath = path.resolve(sourceArg);
  const destPath = path.resolve(destArg);
  const sourceBuffer = fs.readFileSync(sourcePath);
  const zip = await JSZip.loadAsync(sourceBuffer);

  let documentXml = await zip.file('word/document.xml').async('string');
  documentXml = replaceUniqueText(documentXml, '<w:t>', 'University of Colorado Boulder', '[[DV:InstitutionName]]');
  documentXml = replaceUniqueText(documentXml, '<w:t>', 'Title', '[[DV:ProjectTitle]]');
  documentXml = replaceUniqueText(documentXml, '<w:t>', 'PI', '[[DV:PrincipalInvestigator]]');
  documentXml = replaceUniqueText(documentXml, '<w:t>', 'PD', '[[DV:ProgramDirector]]');
  documentXml = replaceAbstractBody(documentXml);
  documentXml = replaceRefereeParagraph(documentXml);
  documentXml = stripSectPrReferences(documentXml);
  zip.file('word/document.xml', documentXml);

  const headerFooterParts = ['header1', 'header2', 'header3', 'footer1', 'footer2', 'footer3']
    .map((name) => `word/${name}.xml`);
  for (const partName of headerFooterParts) {
    if (zip.file(partName)) zip.remove(partName);
  }

  let rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const relsBefore = rels;
  rels = rels.replace(/<Relationship\b[^>]*Type="[^"]*\/(?:header|footer)"[^>]*\/>/g, '');
  if (rels === relsBefore) fail('No header/footer relationship entries found to strip.');
  rels = stripDocumentRelsMetadataEntries(rels);
  zip.file('word/_rels/document.xml.rels', rels);

  let packageRels = await zip.file('_rels/.rels').async('string');
  packageRels = stripPackageRelsCustomProperties(packageRels);
  zip.file('_rels/.rels', packageRels);

  let contentTypes = await zip.file('[Content_Types].xml').async('string');
  const contentTypesBefore = contentTypes;
  contentTypes = contentTypes.replace(
    /<Override PartName="\/word\/(?:header|footer)\d+\.xml"[^>]*\/>/g,
    '',
  );
  if (contentTypes === contentTypesBefore) fail('No header/footer Content_Types overrides found to strip.');
  contentTypes = stripContentTypesMetadataOverrides(contentTypes);
  zip.file('[Content_Types].xml', contentTypes);

  removeMetadataParts(zip);

  let coreXml = await zip.file('docProps/core.xml').async('string');
  coreXml = scrubCoreProperties(coreXml);
  zip.file('docProps/core.xml', coreXml);

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, output);

  // Verify: no header/footer parts remain and every token is present exactly once.
  const check = await JSZip.loadAsync(output);
  const remainingHeaderFooter = Object.keys(check.files).filter((name) => /^word\/(?:header|footer)\d+\.xml$/.test(name));
  if (remainingHeaderFooter.length) fail(`Header/footer parts remain: ${remainingHeaderFooter.join(', ')}`);
  const finalDocXml = await check.file('word/document.xml').async('string');
  if (/<w:(?:header|footer)Reference\b/.test(finalDocXml)) fail('sectPr still references a header/footer part.');
  const tokens = [
    '[[DV:InstitutionName]]',
    '[[DV:ProjectTitle]]',
    '[[DV:PrincipalInvestigator]]',
    '[[DV:ProgramDirector]]',
    '[[DV:Abstract]]',
    '[[STAFF:RefereeSentences]]',
  ];
  for (const token of tokens) {
    const count = finalDocXml.split(token).length - 1;
    if (count !== 1) fail(`Expected exactly one occurrence of ${token} in the built template; found ${count}.`);
  }

  const remainingMetadataParts = Object.keys(check.files).filter((name) => (
    METADATA_PARTS.includes(name) || name === 'docProps/custom.xml'
  ));
  if (remainingMetadataParts.length) fail(`Metadata parts remain: ${remainingMetadataParts.join(', ')}`);
  const finalCoreXml = await check.file('docProps/core.xml').async('string');
  if (!/<dc:creator><\/dc:creator>/.test(finalCoreXml)) fail('dc:creator was not blanked.');
  if (!/<cp:lastModifiedBy><\/cp:lastModifiedBy>/.test(finalCoreXml)) fail('cp:lastModifiedBy was not blanked.');
  if (/<cp:lastPrinted>/.test(finalCoreXml)) fail('cp:lastPrinted was not removed.');

  console.log(`Wrote ${destPath}`);
  console.log('Verified: no header/footer parts, no SharePoint/Office metadata parts, personal names blanked, all six tokens present exactly once.');
}

main().catch((err) => fail(err.stack || String(err)));
