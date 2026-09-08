const FIELD = 'akoya_programid';

function requireXml(xml, label) {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new Error(`${label} is missing or empty`);
  }
  return xml;
}

function openTags(xml, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return [...xml.matchAll(re)].map((match) => ({ index: match.index, text: match[0] }));
}

function closeTags(xml, tagName) {
  const re = new RegExp(`</${tagName}\\s*>`, 'gi');
  return [...xml.matchAll(re)].map((match) => ({ index: match.index, text: match[0] }));
}

function namedTagCount(xml, tagName, name, attributeName = 'name') {
  return openTags(xml, tagName).filter(({ text }) => {
    const match = text.match(new RegExp(`\\b${attributeName}\\s*=\\s*(["'])([^"']+)\\1`, 'i'));
    return match?.[2]?.toLowerCase() === name.toLowerCase();
  }).length;
}

function validateFetchShape(xml) {
  requireXml(xml, 'fetchxml');
  const fetchOpen = openTags(xml, 'fetch');
  const fetchClose = closeTags(xml, 'fetch');
  const entityOpen = openTags(xml, 'entity');
  const entityClose = closeTags(xml, 'entity');

  if (fetchOpen.length !== 1 || fetchClose.length !== 1) {
    throw new Error('fetchxml has an unexpected fetch root shape');
  }
  if (entityOpen.length !== 1 || entityClose.length !== 1) {
    throw new Error('fetchxml must contain exactly one entity element');
  }
  const entityName = entityOpen[0].text.match(/\bname\s*=\s*(["'])([^"']+)\1/i)?.[2];
  if (entityName !== 'akoya_request') {
    throw new Error(`fetchxml entity must be akoya_request, got ${entityName || 'missing'}`);
  }
  if (
    entityOpen[0].index > entityClose[0].index
    || entityClose[0].index > fetchClose[0].index
    || fetchOpen[0].index > entityOpen[0].index
  ) {
    throw new Error('fetchxml element order is divergent');
  }
  if (/<all-attributes\b/i.test(xml)) {
    throw new Error('fetchxml uses all-attributes; refusing to change its projection implicitly');
  }
}

function validateLayoutShape(xml) {
  requireXml(xml, 'layoutxml');
  const gridOpen = openTags(xml, 'grid');
  const gridClose = closeTags(xml, 'grid');
  const rowOpen = openTags(xml, 'row');
  const rowClose = closeTags(xml, 'row');

  if (gridOpen.length !== 1 || gridClose.length !== 1) {
    throw new Error('layoutxml has an unexpected grid root shape');
  }
  if (rowOpen.length !== 1 || rowClose.length !== 1) {
    throw new Error('layoutxml must contain exactly one row element');
  }
  if (
    gridOpen[0].index > rowOpen[0].index
    || rowOpen[0].index > rowClose[0].index
    || rowClose[0].index > gridClose[0].index
  ) {
    throw new Error('layoutxml element order is divergent');
  }
}

function insertBeforeClosing(xml, tagName, fragment) {
  const closes = closeTags(xml, tagName);
  return `${xml.slice(0, closes[0].index)}${fragment}${xml.slice(closes[0].index)}`;
}

/**
 * Plan a projection/layout-only Quick Find update.
 *
 * The helper deliberately does not edit conditions. Both XML documents must
 * be missing the field, or both must already contain it exactly once for the
 * idempotent no-op. A one-sided or duplicate state is treated as drift.
 */
export function planQuickFindViewUpdate({ fetchxml, layoutxml }) {
  validateFetchShape(fetchxml);
  validateLayoutShape(layoutxml);

  const fetchFieldCount = namedTagCount(fetchxml, 'attribute', FIELD);
  const layoutFieldCount = namedTagCount(layoutxml, 'cell', FIELD);
  const conditionCount = namedTagCount(fetchxml, 'condition', FIELD, 'attribute');

  if (conditionCount > 0) {
    throw new Error(`fetchxml already contains ${FIELD} as a search condition; refusing to modify Quick Find criteria`);
  }
  if (fetchFieldCount > 1 || layoutFieldCount > 1) {
    throw new Error(`duplicate ${FIELD} attribute/cell in Quick Find XML`);
  }
  if (fetchFieldCount !== layoutFieldCount) {
    throw new Error(`Quick Find XML is divergent: fetchxml field count=${fetchFieldCount}, layoutxml cell count=${layoutFieldCount}`);
  }
  if (fetchFieldCount === 1) {
    return {
      changed: false,
      reason: 'already-present',
      fetchxml,
      layoutxml,
    };
  }

  return {
    changed: true,
    reason: 'add-projection-and-layout-column',
    fetchxml: insertBeforeClosing(fetchxml, 'entity', `<attribute name="${FIELD}"/>`),
    layoutxml: insertBeforeClosing(layoutxml, 'row', `<cell name="${FIELD}" width="100"/>`),
  };
}

export function quickFindFieldPresent({ fetchxml, layoutxml }) {
  return namedTagCount(fetchxml, 'attribute', FIELD) === 1
    && namedTagCount(layoutxml, 'cell', FIELD) === 1
    && namedTagCount(fetchxml, 'condition', FIELD) === 0;
}

export { FIELD };
