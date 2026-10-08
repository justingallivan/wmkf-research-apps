/** Proposal Ranking rows are private application data, including system audit links. */
import { DynamicsService } from '../dynamics-service.js';
import * as metadataAdapter from '../../dataverse/adapters/metadata.js';

const PRIVATE_ENTITY_NAMES = new Set([
  'wmkf_proposalrankingcycle', 'wmkf_proposalrankingcycles',
  'wmkf_proposalrankinground', 'wmkf_proposalrankingrounds',
  'wmkf_proposalrankinglist', 'wmkf_proposalrankinglists',
]);
const PRIVATE_REFERENCE = /wmkf_proposalranking(?:cycle|round|list)s?/i;
const ENTITY_NAME = /^[a-z][a-z0-9_]*$/i;
const RELATIONSHIP_CACHE_TTL = 6 * 60 * 60 * 1000;
const relationshipCache = new Map();

export function isProposalRankingPrivateEntity(name) {
  return PRIVATE_ENTITY_NAMES.has(String(name || '').trim().toLowerCase());
}

/**
 * Static backstop in addition to Dataverse table grants. In particular,
 * disallow staff-directory relationship expansion, whose reverse audit
 * navigation can expose app-owned rows through createdby/modifiedby.
 */
export function proposalRankingPrivacyError(input = {}) {
  const table = String(input.table_name || '').trim().toLowerCase();
  if (isProposalRankingPrivateEntity(table)) {
    return 'Proposal Ranking application data is not available through Dynamics Explorer.';
  }
  const searchable = [input.select, input.filter, input.orderby, input.expand, input.field, input.group_by]
    .filter((value) => value != null)
    .map((value) => Array.isArray(value) ? value.join(',') : String(value))
    .join(' ');
  if (PRIVATE_REFERENCE.test(searchable)) {
    return 'Proposal Ranking application data is not available through Dynamics Explorer.';
  }
  if (['systemuser', 'systemusers'].includes(table) && String(input.expand || '').trim()) {
    return 'Staff-directory relationship expansion is unavailable in Dynamics Explorer.';
  }
  return null;
}

/**
 * Resolve navigation paths through Dataverse metadata before allowing a
 * generic read. Navigation names are aliases, so string matching alone cannot
 * tell whether a path reaches one of the private application tables.
 * Unknown roots, paths, and metadata failures fail closed when a navigation
 * path is present.
 */
export async function resolveProposalRankingPrivacyError(input = {}, dependencies = {}) {
  const staticError = proposalRankingPrivacyError(input);
  if (staticError) return staticError;

  const paths = collectNavigationPaths(input);
  if (!paths.length) return null;

  const getEntityDefinitions = dependencies.getEntityDefinitions
    || (() => DynamicsService.getEntityDefinitions());
  const getEntityProperties = dependencies.getEntityProperties || loadEntityProperties;
  try {
    const definitions = await getEntityDefinitions();
    const tableName = String(input.table_name || '').trim().toLowerCase();
    const root = resolveRootEntity(tableName, definitions);
    if (!root) return navigationDenied();

    for (const path of paths) {
      let entity = root;
      for (let index = 0; index < path.segments.length; index += 1) {
        const segment = path.segments[index];
        const properties = await getEntityProperties(entity);
        const key = segment.toLowerCase();
        if (properties.targets.has(key)) {
          const target = properties.targets.get(key);
          if (!target || isProposalRankingPrivateEntity(target)) return navigationDenied();
          entity = target;
        } else if (!path.requireFinalNavigation && index === path.segments.length - 1 && properties.attributes.has(key)) {
          break;
        } else {
          return navigationDenied();
        }
      }
    }
    return null;
  } catch {
    return navigationDenied();
  }
}

function navigationDenied() {
  return 'Proposal Ranking application data is not available through Dynamics Explorer.';
}

function resolveRootEntity(tableName, definitions) {
  if (!ENTITY_NAME.test(tableName) || !Array.isArray(definitions)) return null;
  const found = definitions.find((definition) => (
    String(definition.logicalName || '').toLowerCase() === tableName
    || String(definition.entitySetName || '').toLowerCase() === tableName
  ));
  const logicalName = String(found?.logicalName || '').toLowerCase();
  return ENTITY_NAME.test(logicalName) ? logicalName : null;
}

async function loadEntityProperties(logicalName) {
  const cached = relationshipCache.get(logicalName);
  if (cached && Date.now() - cached.loadedAt < RELATIONSHIP_CACHE_TTL && cached.properties) return cached.properties;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const base = `/EntityDefinitions(LogicalName='${logicalName}')`;
    const [attributes, manyToOne, oneToMany, manyToMany] = await metadataAdapter.getMetadataBatch([
      `${base}/Attributes?$select=LogicalName`,
      `${base}/ManyToOneRelationships?$select=ReferencingEntity,ReferencedEntity,ReferencingEntityNavigationPropertyName`,
      `${base}/OneToManyRelationships?$select=ReferencingEntity,ReferencedEntity,ReferencedEntityNavigationPropertyName`,
      `${base}/ManyToManyRelationships?$select=Entity1LogicalName,Entity2LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName`,
    ]);
    const targets = new Map();
    const attributeNames = new Set((attributes.value || []).map((attribute) => String(attribute.LogicalName || '').toLowerCase()).filter(Boolean));
    for (const relationship of manyToOne.value || []) {
      if (relationship.ReferencingEntity?.toLowerCase() === logicalName) {
        addTarget(targets, relationship.ReferencingEntityNavigationPropertyName, relationship.ReferencedEntity);
      }
    }
    for (const relationship of oneToMany.value || []) {
      if (relationship.ReferencedEntity?.toLowerCase() === logicalName) {
        addTarget(targets, relationship.ReferencedEntityNavigationPropertyName, relationship.ReferencingEntity);
      }
    }
    for (const relationship of manyToMany.value || []) {
      if (relationship.Entity1LogicalName?.toLowerCase() === logicalName) {
        addTarget(targets, relationship.Entity1NavigationPropertyName, relationship.Entity2LogicalName);
      }
      if (relationship.Entity2LogicalName?.toLowerCase() === logicalName) {
        addTarget(targets, relationship.Entity2NavigationPropertyName, relationship.Entity1LogicalName);
      }
    }
    const properties = { targets, attributes: attributeNames };
    relationshipCache.set(logicalName, { properties, loadedAt: Date.now() });
    return properties;
  })();
  relationshipCache.set(logicalName, { promise, loadedAt: Date.now() });
  try {
    return await promise;
  } catch (error) {
    if (relationshipCache.get(logicalName)?.promise === promise) relationshipCache.delete(logicalName);
    throw error;
  }
}

function addTarget(targets, navigationProperty, targetEntity) {
  if (!navigationProperty || !ENTITY_NAME.test(String(targetEntity || ''))) return;
  const key = String(navigationProperty).toLowerCase();
  const target = String(targetEntity).toLowerCase();
  // Ambiguous metadata is not safe to resolve by picking one relationship.
  if (targets.has(key) && targets.get(key) !== target) targets.set(key, null);
  else if (!targets.has(key)) targets.set(key, target);
}

function collectNavigationPaths(input) {
  const paths = [];
  for (const value of [input.select, input.filter, input.orderby, input.field, input.group_by]) {
    if (value == null) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    for (const match of text.matchAll(/\b([a-z_][a-z0-9_]*(?:\/[a-z_][a-z0-9_]*)+)\b/gi)) {
      paths.push({ segments: match[1].split('/'), requireFinalNavigation: false });
    }
  }
  for (const expand of toValues(input.expand)) collectExpandPaths(expand, paths);
  return paths;
}

function toValues(value) {
  return value == null ? [] : Array.isArray(value) ? value.map(String) : [String(value)];
}

function collectExpandPaths(expand, paths, parent = []) {
  for (const entry of splitTopLevel(expand, ',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const paren = trimmed.indexOf('(');
    if ((paren < 0 && trimmed.includes(')')) || (paren >= 0 && !trimmed.endsWith(')'))) {
      throw new Error('Unparsed $expand expression.');
    }
    const navigationPath = (paren < 0 ? trimmed : trimmed.slice(0, paren)).trim();
    if (!navigationPath) continue;
    const segments = navigationPath.split('/').map((segment) => segment.trim());
    if (segments.some((segment) => !ENTITY_NAME.test(segment))) throw new Error('Unsupported $expand navigation path.');
    const fullPath = [...parent, ...segments];
    paths.push({ segments: fullPath, requireFinalNavigation: true });
    if (paren >= 0) {
      const options = trimmed.slice(paren + 1, trimmed.lastIndexOf(')'));
      for (const option of splitTopLevel(options, ';')) {
        const equals = findTopLevelEquals(option);
        if (equals < 1) throw new Error('Unparsed $expand option.');
        const name = option.slice(0, equals).trim().toLowerCase();
        const value = option.slice(equals + 1).trim();
        if (!value && name !== '$select') throw new Error('Empty $expand option.');
        if (name === '$expand') {
          collectExpandPaths(value, paths, fullPath);
        } else if (name === '$select' || name === '$filter' || name === '$orderby') {
          collectNavigationPathsFromText(value, paths, fullPath);
        } else if (name === '$count') {
          if (!/^(true|false)$/i.test(value)) throw new Error('Unsupported $count option.');
        } else if (name === '$top' || name === '$skip') {
          if (!/^\d+$/.test(value)) throw new Error('Unsupported paging option.');
        } else if (name === '$levels') {
          if (!/^(\d+|max)$/i.test(value)) throw new Error('Unsupported $levels option.');
        } else {
          throw new Error('Unsupported nested $expand option.');
        }
      }
    }
  }
}

function collectNavigationPathsFromText(value, paths, parent = []) {
  for (const match of String(value).matchAll(/\b([a-z_][a-z0-9_]*(?:\/[a-z_][a-z0-9_]*)+)\b/gi)) {
    paths.push({ segments: [...parent, ...match[1].split('/')], requireFinalNavigation: false });
  }
}

function findTopLevelEquals(value) {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && character === '(') depth += 1;
    else if (!quoted && character === ')') depth -= 1;
    else if (!quoted && depth === 0 && character === '=') return index;
  }
  return -1;
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'") {
      if (quoted && value[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted && character === '(') depth += 1;
    else if (!quoted && character === ')') depth -= 1;
    else if (!quoted && character === delimiter && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
    if (depth < 0) throw new Error('Unbalanced nested OData option.');
  }
  if (depth !== 0 || quoted) throw new Error('Unbalanced nested OData option.');
  parts.push(value.slice(start));
  return parts;
}

export function filterProposalRankingSearchEntities(entities) {
  return Array.isArray(entities) ? entities.filter((entity) => !isProposalRankingPrivateEntity(entity)) : entities;
}
