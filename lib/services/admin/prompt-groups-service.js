/**
 * Admin prompt groups — read and save the editable group list (owner decision
 * 2026-11-02, docs/plans/ADMIN_PROMPT_GROUPS_PLAN_2026-11-02.md).
 *
 * Storage: one `wmkf_appsystemsettings` row keyed `promptLibrary.groups`,
 * value `{ version: 1, groups: [{ id, label }] }` in display order. Pinned
 * groups (uncataloged, reference) are never stored. No row → the code default
 * list. Saves replace the whole list under the row's revision (If-Match via
 * setSettingIfUnchanged); a stale revision is 409 groups_conflict.
 *
 * Rules: no deletion (every saved id must stay), ids never change, labels are
 * non-blank, unique (case-insensitive) and at most 80 characters, and a new id
 * must be a lowercase slug not already used by a pinned group. No sections for
 * new groups. The settings row's updated-by/modified-on is the only history
 * (owner decision 2026-11-02).
 *
 * LOAD-BEARING: "no deletion" keeps every code-default group id in the list.
 * resolveAdminPromptDescription falls back to a prompt's code-catalog group
 * without re-checking it against the stored list, so allowing deletion would
 * need that fallback to land on "uncataloged" instead.
 */

import { getSettingStrict, setSettingIfUnchanged } from '../settings-service';
import { ServiceHttpError } from '../service-http-error';
import {
  PROMPT_GROUPS_SETTING_KEY,
  PINNED_PROMPT_GROUP_IDS,
  PROMPT_GROUP_LABEL_MAX,
  buildEffectivePromptGroups,
  defaultEditablePromptGroups,
} from '../../../shared/config/adminPromptCatalog';

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseStored(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.groups)
        && parsed.groups.every((g) => g && typeof g.id === 'string' && typeof g.label === 'string')) {
      return parsed.groups.map(({ id, label }) => ({ id, label }));
    }
  } catch { /* fall through */ }
  return null;
}

/**
 * Strict read of the group list.
 * @returns {Promise<{ groups: Array, editable: Array, revision: string|null, stored: boolean, storageWarning: string|null }>}
 * @throws when the settings read fails
 */
export async function getPromptGroupsStrict() {
  const { found, value, revision } = await getSettingStrict(PROMPT_GROUPS_SETTING_KEY);
  const stored = found ? parseStored(value) : null;
  const editable = stored || defaultEditablePromptGroups();
  return {
    groups: buildEffectivePromptGroups(editable),
    editable,
    revision: found ? revision : null,
    stored: !!stored,
    storageWarning: found && !stored ? 'Stored group list is unreadable; showing the default list.' : null,
  };
}

/**
 * Best-effort read for display and prompt-write validation: a settings outage
 * falls back to the code list (a group added in Admin is then refused, never
 * silently accepted).
 */
export async function getPromptGroups() {
  try {
    return await getPromptGroupsStrict();
  } catch (err) {
    console.error('[admin/prompt-groups] read failed; using default list:', err.message);
    const editable = defaultEditablePromptGroups();
    return { groups: buildEffectivePromptGroups(editable), editable, revision: null, stored: false, storageWarning: 'Groups could not be loaded; showing the default list.' };
  }
}

function invalid(error) {
  return new ServiceHttpError(error, { httpStatus: 400, body: { status: 'invalid_groups', error } });
}

/** Validate a submitted editable list against the current one. Pure. */
export function validateGroupList(submitted, current) {
  if (!Array.isArray(submitted) || submitted.length === 0) throw invalid('groups must be a non-empty list.');
  const out = [];
  const ids = new Set();
  const labels = new Set();
  for (const item of submitted) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.label !== 'string') {
      throw invalid('Each group needs an id and a label.');
    }
    const id = item.id.trim();
    const label = item.label.trim();
    if (PINNED_PROMPT_GROUP_IDS.includes(id)) throw invalid(`"${id}" is a fixed group and can't be edited.`);
    if (!ID_RE.test(id) || id.length > 60) throw invalid(`Group id "${id}" is not valid.`);
    if (!label) throw invalid('Group labels can\'t be blank.');
    if (label.length > PROMPT_GROUP_LABEL_MAX) throw invalid(`Group labels must be at most ${PROMPT_GROUP_LABEL_MAX} characters.`);
    if (ids.has(id)) throw invalid(`Group id "${id}" appears twice.`);
    if (labels.has(label.toLowerCase())) throw invalid(`Two groups are named "${label}".`);
    ids.add(id);
    labels.add(label.toLowerCase());
    out.push({ id, label });
  }
  const missing = current.filter((group) => !ids.has(group.id));
  if (missing.length) throw invalid(`Groups can't be removed: ${missing.map((g) => g.label).join(', ')}.`);
  return out;
}

/**
 * Replace the editable group list.
 * @param {{ groups: Array, expectedRevision: string|null, profileId: * }} args
 */
export async function savePromptGroups({ groups, expectedRevision, profileId }) {
  if (expectedRevision !== null && typeof expectedRevision !== 'string') throw invalid('expectedRevision must be a string or null.');
  const current = await getPromptGroupsStrict();
  if ((current.revision || null) !== (expectedRevision || null)) {
    throw new ServiceHttpError('Groups changed since you opened them.', {
      httpStatus: 409,
      body: { status: 'groups_conflict', error: 'Groups changed since you opened them. Reload and re-apply your changes.' },
    });
  }
  const next = validateGroupList(groups, current.editable);
  try {
    await setSettingIfUnchanged(
      PROMPT_GROUPS_SETTING_KEY,
      JSON.stringify({ version: 1, groups: next }),
      expectedRevision || null,
      profileId ?? null,
    );
  } catch (err) {
    if (err.code === 'setting_conflict') {
      throw new ServiceHttpError('Groups changed since you opened them.', {
        httpStatus: 409,
        body: { status: 'groups_conflict', error: 'Groups changed since you opened them. Reload and re-apply your changes.' },
      });
    }
    if (err.code === 'setting_revision_unavailable') {
      throw new ServiceHttpError('Groups could not be saved right now.', {
        httpStatus: 503,
        body: { status: 'groups_unavailable', error: 'Groups could not be saved right now. Try again in a minute.' },
      });
    }
    throw err;
  }
  const saved = await getPromptGroupsStrict();
  return { status: 'groups_saved', groups: saved.groups, editable: saved.editable, revision: saved.revision };
}
