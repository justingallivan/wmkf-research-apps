/**
 * Adapter: wmkf_sitevisits custom Activity and its ActivityParty collection.
 *
 * The schema-ready interlock keeps legacy reads compatible until Wave 21 is
 * exact in the target. Party replacement is one atomic changeset: parent ETag
 * same-ID activity replacement, so a partial attendee rewrite cannot commit.
 */

import { DynamicsService } from '../../services/dynamics-service.js';
import { isSiteVisitLogisticsSchemaReady } from '../../utils/site-visit-logistics-readiness.js';
import { SITE_VISIT_ACTIVE_STATE_CODES } from '../../../shared/config/siteVisit.js';
import { entitySet } from '../core/entity-registry.js';
import * as odata from '../core/odata.js';

const ENTITY_SET = entitySet('wmkf_sitevisits');
const PARTY_NAVIGATION = 'wmkf_SiteVisit_activity_parties';
const PARTY_EXPAND = `${PARTY_NAVIGATION}(`
  + '$select=activitypartyid,participationtypemask,addressused,_partyid_value)';

const BASE_SELECT = [
  'activityid',
  'subject',
  'description',
  'scheduledstart',
  'scheduledend',
  'scheduleddurationminutes',
  'statecode',
  'statuscode',
  '_regardingobjectid_value',
  'createdon',
  'modifiedon',
];

export const SITE_VISIT_LOGISTICS_FIELDS = Object.freeze([
  'wmkf_visitformat',
  'wmkf_ianatimezone',
  'wmkf_locationorlink',
  'wmkf_attendeerefsjson',
]);

export function siteVisitSelect({ includeLogistics } = {}) {
  const include = includeLogistics ?? isSiteVisitLogisticsSchemaReady();
  return [...BASE_SELECT, ...(include ? SITE_VISIT_LOGISTICS_FIELDS : [])].join(',');
}

export async function findActiveByRequest(requestId) {
  const activeFilter = odata.or(
    SITE_VISIT_ACTIVE_STATE_CODES.map((value) => odata.eqRaw('statecode', value)),
  );
  return DynamicsService.queryRecords(ENTITY_SET, {
    select: siteVisitSelect(),
    expand: PARTY_EXPAND,
    filter: odata.and([
      odata.eqGuid('_regardingobjectid_value', requestId),
      `(${activeFilter})`,
    ]),
    top: 3,
  });
}

const MULTI_REQUEST_CHUNK = 25;
// Wave 21 logistics fields (wmkf_visitformat, wmkf_locationorlink) are gated
// behind isSiteVisitLogisticsSchemaReady() everywhere else in this adapter
// (siteVisitSelect()) because a target where that wave isn't exact 400s on
// them. The cycle view only derives stage/visit from the scheduled date
// anyway, so this select never asks for them.
const MULTI_REQUEST_SELECT = [
  'activityid',
  '_regardingobjectid_value',
  'scheduledstart',
  'scheduledend',
].join(',');

/**
 * Cycle-view reader (PC Meeting Tracker slice 3, docs/PC_MEETING_TRACKER_PLAN.md
 * §5.4): the active site visit for many requests at once, no party expand — the
 * cycle view only needs the scheduled date to derive stage/visit, not
 * attendees or the schema-gated logistics fields. Chunks the OR filter at 25
 * ids to stay well under Dataverse URL/filter limits; queryRecords (not
 * queryAllRecords) per chunk matches this file's other multi-row reads and
 * keeps the result's `capped` flag meaningful to a future caller instead of
 * silently discarding it.
 */
export async function findActiveByRequests(requestIds) {
  const ids = [...new Set((requestIds || []).filter(Boolean))];
  if (ids.length === 0) return [];
  const activeFilter = odata.or(
    SITE_VISIT_ACTIVE_STATE_CODES.map((value) => odata.eqRaw('statecode', value)),
  );
  const rows = [];
  for (let index = 0; index < ids.length; index += MULTI_REQUEST_CHUNK) {
    const chunk = ids.slice(index, index + MULTI_REQUEST_CHUNK);
    const regardingFilter = odata.or(chunk.map((id) => odata.eqGuid('_regardingobjectid_value', id)));
    // top: 100 (the queryRecords ceiling) rather than chunk.length: "one
    // active visit per request" is the documented norm, not an enforced
    // uniqueness constraint (findActiveByRequest itself reads top: 3 per
    // request for the same reason), so a 25-request chunk could still return
    // more than 25 rows.
    const result = await DynamicsService.queryRecords(ENTITY_SET, {
      select: MULTI_REQUEST_SELECT,
      filter: odata.and([`(${regardingFilter})`, `(${activeFilter})`]),
      top: 100,
    });
    rows.push(...(result.records || []));
  }
  return rows;
}

export function getById(activityId) {
  return DynamicsService.getRecord(ENTITY_SET, activityId, {
    select: siteVisitSelect(),
    expand: PARTY_EXPAND,
  });
}

function partyFields(party) {
  return {
    participationtypemask: party.participationtypemask,
    addressused: party.addressused,
    ...(party.unresolvedpartyname
      ? { unresolvedpartyname: party.unresolvedpartyname }
      : {}),
    ...(party.systemUserId
      ? { 'partyid_systemuser@odata.bind': `/systemusers(${party.systemUserId})` }
      : {}),
  };
}

export function create(payload, parties, options) {
  return DynamicsService.createRecord(ENTITY_SET, {
    ...payload,
    [PARTY_NAVIGATION]: parties.map(partyFields),
  }, options);
}

export function update(activityId, etag, patch, { actingUserSystemId } = {}) {
  return DynamicsService.updateRecord(ENTITY_SET, activityId, patch, {
    ifMatch: etag,
    actingUserSystemId,
  });
}

/**
 * ActivityParty cannot be created/updated/deleted directly in Dataverse. When
 * party roles change, atomically delete and recreate the same activity GUID
 * with a nested party collection. The ETag on DELETE is the stale-write fence;
 * the changeset makes the replacement all-or-nothing and this is not an upsert.
 */
export async function replaceWithParties({
  activityId,
  etag,
  payload,
  parties,
  actingUserSystemId,
}) {
  return DynamicsService.executeChangeset([
    {
      method: 'DELETE',
      url: `${ENTITY_SET}(${activityId})`,
      ifMatch: etag,
    },
    {
      method: 'POST',
      url: ENTITY_SET,
      body: {
        ...payload,
        activityid: activityId,
        [PARTY_NAVIGATION]: parties.map(partyFields),
      },
    },
  ], { actingUserSystemId });
}

export const ENTITY_SET_NAME = ENTITY_SET;
export const PARTY_NAVIGATION_PROPERTY = PARTY_NAVIGATION;
