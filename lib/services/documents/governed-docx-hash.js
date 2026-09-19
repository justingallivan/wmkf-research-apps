/**
 * Neutral governed DOCX content identity primitive.
 *
 * This module deliberately has no domain, Graph, DAL, Executor, or settings
 * dependencies. It preserves the existing governed package validation and
 * `gdc1:` identity contract used by document lifecycle consumers.
 */

import crypto from 'crypto';
import JSZip from 'jszip';

export const GOVERNED_DOCX_HASH_PREFIX = 'gdc1:';

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const OFFICE_DOCUMENT_RELATIONSHIP = /\/officeDocument$/i;

function parseRelationships(xml, label) {
  const relationships = [];
  const declaredCount = Array.from(xml.matchAll(/<Relationship\b/g)).length;
  const relationshipPattern = /<Relationship\b([^>]*?)(?:\/>|>\s*<\/Relationship>)/g;
  const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  for (const match of xml.matchAll(relationshipPattern)) {
    const attributes = {};
    for (const attribute of match[1].matchAll(attributePattern)) {
      attributes[attribute[1]] = attribute[3];
    }
    if (!attributes.Type || !attributes.Target || !attributes.Id) {
      throw new Error(`Governed DOCX contains an invalid ${label} relationship.`);
    }
    relationships.push(attributes);
  }
  if (relationships.length !== declaredCount) {
    throw new Error(`Governed DOCX contains an unrecognized ${label} relationship.`);
  }
  return relationships;
}

/** Resolve a relationship target against its source part, OPC style. */
function resolvePartName(sourcePartName, target) {
  let raw = String(target).split('#')[0].split('?')[0];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (raw === '') return sourcePartName || null;
  const separator = sourcePartName.lastIndexOf('/');
  const baseDirectory = separator === -1 ? '' : sourcePartName.slice(0, separator + 1);
  const segments = (raw.startsWith('/') ? raw.slice(1) : `${baseDirectory}${raw}`).split('/');
  const resolved = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function relationshipPartName(sourcePartName) {
  const separator = sourcePartName.lastIndexOf('/');
  const directory = separator === -1 ? '' : sourcePartName.slice(0, separator + 1);
  const filename = sourcePartName.slice(separator + 1);
  return `${directory}_rels/${filename}.rels`;
}

function packagePartIndex(archive) {
  const parts = new Map();
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const key = name.toLowerCase();
    if (parts.has(key) && parts.get(key) !== name) {
      throw new Error('Governed DOCX contains ambiguous case-insensitive part names.');
    }
    parts.set(key, name);
  }
  return parts;
}

function parseContentTypeOverrides(xml) {
  const overrides = new Map();
  const declaredCount = Array.from(xml.matchAll(/<Override\b/g)).length;
  const overridePattern = /<Override\b([^>]*?)(?:\/>|>\s*<\/Override>)/g;
  const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let parsedCount = 0;
  for (const match of xml.matchAll(overridePattern)) {
    parsedCount += 1;
    const attributes = {};
    for (const attribute of match[1].matchAll(attributePattern)) {
      attributes[attribute[1]] = attribute[3];
    }
    if (!attributes.PartName || !attributes.ContentType) {
      throw new Error('Governed DOCX contains an invalid content type override.');
    }
    const partName = resolvePartName('', attributes.PartName);
    if (!partName) throw new Error('Governed DOCX contains an invalid content type override.');
    const key = partName.toLowerCase();
    if (overrides.has(key) && overrides.get(key) !== attributes.ContentType) {
      throw new Error('Governed DOCX contains conflicting content type overrides.');
    }
    overrides.set(key, attributes.ContentType);
  }
  if (parsedCount !== declaredCount) {
    throw new Error('Governed DOCX contains an unrecognized content type override.');
  }
  return overrides;
}

function isGovernedWordContentType(contentType) {
  const normalized = String(contentType).toLowerCase();
  return normalized.startsWith('application/vnd.openxmlformats-officedocument.')
    || normalized === 'application/xml'
    || /^application\/[a-z0-9!#$&^_.+-]+\+xml$/.test(normalized);
}

async function assertPackageOpensGovernedDocument(archive) {
  const parts = packagePartIndex(archive);
  const getPart = (name) => {
    const actualName = parts.get(String(name).toLowerCase());
    return actualName ? { name: actualName, entry: archive.file(actualName) } : null;
  };
  const rootRels = getPart('_rels/.rels')?.entry;
  if (!rootRels) throw new Error('Governed DOCX is missing its package relationships.');
  const officeDocuments = parseRelationships(await rootRels.async('string'), 'package')
    .filter((relationship) => OFFICE_DOCUMENT_RELATIONSHIP.test(relationship.Type));
  const mainPartName = officeDocuments.length === 1
    ? resolvePartName('', officeDocuments[0].Target)
    : null;
  const mainPart = mainPartName ? getPart(mainPartName) : null;
  if (officeDocuments.length !== 1
    || String(officeDocuments[0].TargetMode || '').toLowerCase() === 'external'
    || mainPartName?.toLowerCase() !== 'word/document.xml'
    || !mainPart) {
    throw new Error('Governed DOCX package root does not open word/document.xml.');
  }

  const reachable = new Set();
  const pending = [mainPart.name];
  while (pending.length > 0) {
    const sourcePartName = pending.shift();
    const sourceKey = sourcePartName.toLowerCase();
    if (reachable.has(sourceKey)) continue;
    reachable.add(sourceKey);

    const relationshipsPart = getPart(relationshipPartName(sourcePartName))?.entry;
    if (!relationshipsPart) continue;
    for (const relationship of parseRelationships(
      await relationshipsPart.async('string'),
      sourcePartName.toLowerCase() === 'word/document.xml' ? 'document' : sourcePartName,
    )) {
      if (/\/customXml$/i.test(relationship.Type)) continue;
      if (String(relationship.TargetMode || '').toLowerCase() === 'external') continue;
      const partName = resolvePartName(sourcePartName, relationship.Target);
      const targetPart = partName ? getPart(partName) : null;
      if (!partName || !partName.toLowerCase().startsWith('word/') || !targetPart) {
        throw new Error('Governed DOCX references a document part outside word/ or an unresolved part.');
      }
      if (!reachable.has(targetPart.name.toLowerCase())) pending.push(targetPart.name);
    }
  }

  const contentTypesPart = getPart('[Content_Types].xml')?.entry;
  if (!contentTypesPart) throw new Error('Governed DOCX is missing [Content_Types].xml.');
  const overrides = parseContentTypeOverrides(await contentTypesPart.async('string'));
  // Every reachable part lives under `word/`, so its bytes are already in the
  // digest; a content-type Override cannot change what those bytes are. The
  // only Override worth refusing is one that relabels a reachable XML part
  // as something other than XML. Binary parts (media, fonts, embeddings)
  // are legitimately declared by Override by some producers, so they are
  // identified by their bytes alone.
  for (const partName of reachable) {
    const contentType = overrides.get(partName);
    if (contentType && /\.xml$/i.test(partName) && !isGovernedWordContentType(contentType)) {
      throw new Error('Governed DOCX remaps a reachable word/ part to an unsupported content type.');
    }
  }
}

function canonicalizeDocumentRelationships(xml) {
  const relationships = [];
  const declaredCount = Array.from(xml.matchAll(/<Relationship\b/g)).length;
  const relationshipPattern = /<Relationship\b([^>]*?)(?:\/>|>\s*<\/Relationship>)/g;
  const attributePattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/g;
  let parsedCount = 0;

  for (const match of xml.matchAll(relationshipPattern)) {
    parsedCount += 1;
    const attributes = {};
    for (const attribute of match[1].matchAll(attributePattern)) {
      attributes[attribute[1]] = attribute[3];
    }
    if (!attributes.Type || !attributes.Target || !attributes.Id) {
      throw new Error('Initial Assessment DOCX contains an invalid document relationship.');
    }
    // SharePoint injects customXml relationships when it ingests an Office
    // package. They describe platform metadata, not governed document content.
    if (/\/customXml$/i.test(attributes.Type)) continue;
    relationships.push(
      Object.entries(attributes)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('&'),
    );
  }

  if (parsedCount !== declaredCount) {
    throw new Error('Initial Assessment DOCX contains an unrecognized document relationship.');
  }
  if (relationships.length === 0) {
    throw new Error('Initial Assessment DOCX has no governed document relationships.');
  }
  return relationships.sort(compareText).join('\n');
}

/**
 * Hash the governed Word content rather than ZIP-container bytes.
 *
 * SharePoint legitimately repacks DOCX containers and injects customXml,
 * docProps, and [trash] metadata. Every `word/` part remains covered, and the
 * document relationship part is canonicalized only to ignore injected
 * customXml relationships and XML ordering/whitespace.
 */
export async function hashGovernedDocxContent(value) {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Initial Assessment content hash requires a DOCX Buffer.');
  }
  let archive;
  try {
    archive = await JSZip.loadAsync(value);
  } catch (error) {
    throw new Error('Initial Assessment producer returned an invalid DOCX package.', {
      cause: error,
    });
  }

  const entries = Object.entries(archive.files)
    .filter(([name, entry]) => !entry.dir && name.startsWith('word/'))
    .sort(([left], [right]) => compareText(left, right));
  if (!archive.file('word/document.xml') || entries.length === 0) {
    throw new Error('Initial Assessment DOCX is missing word/document.xml.');
  }
  // The hash covers `word/` only, so the package must be proven to OPEN that
  // subtree: the root officeDocument relationship has to target
  // word/document.xml and every governed document relationship has to stay
  // inside `word/`. Otherwise a substituted package could keep the hashed
  // subtree while Word renders a different main part or a part outside it
  // (Codex adversarial review, Pre-RP Brief plan §12, 2026-09-17).
  await assertPackageOpensGovernedDocument(archive);

  const hash = crypto.createHash('sha256');
  hash.update('wmkf-governed-docx-content-v1\0');
  for (const [name, entry] of entries) {
    let bytes = await entry.async('nodebuffer');
    if (name === 'word/_rels/document.xml.rels') {
      bytes = Buffer.from(canonicalizeDocumentRelationships(bytes.toString('utf8')), 'utf8');
    }
    hash.update(`${name}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `${GOVERNED_DOCX_HASH_PREFIX}${hash.digest('base64url')}`;
}
