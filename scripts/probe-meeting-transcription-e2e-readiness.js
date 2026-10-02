#!/usr/bin/env node
/**
 * Bounded, read-only Meeting Tracker transcription prerequisites probe.
 *
 * Pinned to the Dataverse sandbox. Uses the repository Dataverse client with
 * the write interlock forced on and performs GETs only after token acquisition.
 * Prints identifiers and coarse metadata only; never prints names, emails,
 * attendee JSON, SharePoint URLs/paths, or document contents.
 * `--publication-metadata` repeats the bounded app-grant, document-location,
 * and existing-recording site-host reads for the fixed candidate only.
 */
const {
  loadEnvLocal,
  getAccessToken,
  createClient,
} = require('../lib/dataverse/client.js');

const SANDBOX = 'https://orgd9e66399.crm.dynamics.com';
const AZURE_OID = '893369cc-1925-40ec-bbc6-6f12b0684a31';
const TRANSCRIPT = 100000006;
const RECORDING = 100000005;
const PUBLICATION_METADATA_REQUEST = '4236c2b3-b053-f111-bec7-6045bd015cb0';

function savedAttendeeMapAvailable(raw) {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return value?.version === 1 && Array.isArray(value.requiredAttendees)
      && Array.isArray(value.optionalAttendees);
  } catch {
    return false;
  }
}

function selfTest() {
  if (!savedAttendeeMapAvailable('{"version":1,"requiredAttendees":[],"optionalAttendees":[]}')) {
    throw new Error('Version-1 attendee map should be recognized.');
  }
  if (savedAttendeeMapAvailable('{"version":2}')) throw new Error('Unknown attendee-map version must be unavailable.');
  console.log('PASS: bounded probe projection self-test.');
}

async function publicationMetadata(client) {
  const actorFilter = `azureactivedirectoryobjectid eq ${AZURE_OID}`;
  const actorResponse = await client.get(
    `/systemusers?$select=systemuserid,isdisabled&$filter=${encodeURIComponent(actorFilter)}&$top=3`,
  );
  if (!actorResponse.ok) throw new Error(`Pinned sandbox actor lookup returned HTTP ${actorResponse.status}.`);
  const actors = actorResponse.body?.value || [];
  const actorId = actors.length === 1 ? actors[0].systemuserid : null;
  let grantRows = [];
  if (actorId) {
    const grantFilter = `_wmkf_user_value eq ${actorId} and wmkf_appkey eq 'meeting-tracker'`;
    const grantResponse = await client.get(
      `/wmkf_appuserappaccesses?$filter=${encodeURIComponent(grantFilter)}&$select=wmkf_appuserappaccessid&$top=1`,
    );
    if (!grantResponse.ok) throw new Error(`Pinned sandbox app-grant lookup returned HTTP ${grantResponse.status}.`);
    grantRows = grantResponse.body?.value || [];
  }

  const locationFilter = `_regardingobjectid_value eq ${PUBLICATION_METADATA_REQUEST}`;
  const locationResponse = await client.get(
    `/sharepointdocumentlocations?$select=relativeurl,_parentsiteorlocation_value&$filter=${encodeURIComponent(locationFilter)}&$top=10`,
  );
  if (!locationResponse.ok) throw new Error(`Pinned sandbox SharePoint-location lookup returned HTTP ${locationResponse.status}.`);
  const locations = locationResponse.body?.value || [];
  const parentIds = [...new Set(locations.map((row) => row._parentsiteorlocation_value).filter(Boolean))];
  let parentRows = [];
  let parentCapped = false;
  if (parentIds.length) {
    const parentFilter = parentIds.map((id) => `sharepointdocumentlocationid eq ${id}`).join(' or ');
    const parentResponse = await client.get(
      `/sharepointdocumentlocations?$select=sharepointdocumentlocationid,relativeurl&$filter=${encodeURIComponent(parentFilter)}&$top=10`,
    );
    if (!parentResponse.ok) throw new Error(`Pinned sandbox parent-location lookup returned HTTP ${parentResponse.status}.`);
    parentRows = parentResponse.body?.value || [];
    parentCapped = Boolean(parentResponse.body?.['@odata.nextLink']);
  }
  const parentLibraries = new Map(parentRows.map((row) => [row.sharepointdocumentlocationid, row.relativeurl || null]));
  const libraryNames = [...new Set(locations.filter((row) => row.relativeurl).map((row) =>
    parentLibraries.get(row._parentsiteorlocation_value) || 'akoya_request (helper fallback)'))];

  const recordingFilter = `_wmkf_request_value eq ${PUBLICATION_METADATA_REQUEST} and wmkf_artifacttype eq ${RECORDING}`;
  const recordingResponse = await client.get(
    `/wmkf_requestdocuments?$select=wmkf_sharepointsiteid,wmkf_sharepointdriveid&$filter=${encodeURIComponent(recordingFilter)}&$top=100`,
  );
  if (!recordingResponse.ok) throw new Error(`Pinned sandbox recording-metadata lookup returned HTTP ${recordingResponse.status}.`);
  const recordings = recordingResponse.body?.value || [];
  const siteHosts = [...new Set(recordings.map((row) => {
    const first = String(row.wmkf_sharepointsiteid || '').split(',')[0];
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(first) ? first.toLowerCase() : null;
  }).filter(Boolean))];

  console.log(JSON.stringify({
    mode: 'READ_ONLY_PINNED_SANDBOX_PUBLICATION_METADATA',
    checkedAt: new Date().toISOString(),
    target: new URL(SANDBOX).hostname,
    method: 'GET only after OAuth token acquisition',
    actorMapping: {
      azureObjectMatchCount: actors.length,
      exactlyOneEnabledDataverseUser: actors.length === 1 && actors[0].isdisabled === false,
    },
    meetingTrackerGrant: { rowCount: grantRows.length, found: grantRows.length === 1 },
    requestSharePointLocations: {
      rowCount: locations.length,
      capped: Boolean(locationResponse.body?.['@odata.nextLink']),
      parentRowCount: parentRows.length,
      parentCapped,
      libraryNames,
    },
    existingRecordingMetadata: {
      rowCount: recordings.length,
      capped: Boolean(recordingResponse.body?.['@odata.nextLink']),
      siteHosts,
    },
    note: 'Location folders, SharePoint IDs, file URLs, and file contents are not emitted or read through Graph.',
  }, null, 2));
}

async function main() {
  const { buildVisibilityFilter } = await import('../shared/config/workbenchVisibility.js');
  if (process.argv.includes('--self-test')) return selfTest();
  loadEnvLocal();
  process.env.DATAVERSE_TARGET_INTERLOCK = 'on';
  const configuredSandbox = process.env.DYNAMICS_SANDBOX_URL;
  if (configuredSandbox && new URL(configuredSandbox).hostname !== new URL(SANDBOX).hostname) {
    throw new Error('Configured DYNAMICS_SANDBOX_URL conflicts with the pinned sandbox host.');
  }
  const token = await getAccessToken(SANDBOX);
  const client = createClient({ resourceUrl: SANDBOX, token });
  if (process.argv.includes('--publication-metadata')) return publicationMetadata(client);

  const actorResponse = await client.get(
    `/systemusers?$select=systemuserid,isdisabled,azureactivedirectoryobjectid&$filter=azureactivedirectoryobjectid eq ${AZURE_OID}&$top=3`,
  );
  if (!actorResponse.ok) throw new Error(`Pinned sandbox actor lookup returned HTTP ${actorResponse.status}.`);
  const actors = actorResponse.body?.value || [];

  const requestFilter = `wmkf_meetingdate ne null and wmkf_istestrequest ne true and ${buildVisibilityFilter(false)}`;
  const requestResponse = await client.get(
    `/akoya_requests?$select=akoya_requestid,akoya_requestnum,akoya_requeststatus,wmkf_triagestatus,wmkf_meetingdate,_wmkf_projectleader_value,_wmkf_researchleader_value,wmkf_istestrequest&$filter=${encodeURIComponent(requestFilter)}&$orderby=wmkf_meetingdate desc&$top=5`,
  );
  if (!requestResponse.ok) throw new Error(`Pinned sandbox request scan returned HTTP ${requestResponse.status}.`);
  const requests = requestResponse.body?.value || [];
  const candidates = [];

  for (const request of requests) {
    const requestId = request.akoya_requestid;
    const visitResponse = await client.get(
      `/wmkf_sitevisits?$select=activityid,statecode,statuscode,scheduledstart,scheduledend,_regardingobjectid_value,wmkf_attendeerefsjson&$filter=_regardingobjectid_value eq ${requestId} and (statecode eq 0 or statecode eq 3)&$top=3`,
    );
    if (!visitResponse.ok) throw new Error(`Pinned sandbox Site Visit lookup returned HTTP ${visitResponse.status}.`);
    const visits = visitResponse.body?.value || [];
    const visit = visits.length === 1 ? visits[0] : null;
    let documentRows = [];
    let artifactRowsComplete = false;
    if (visit) {
      const docResponse = await client.get(
        `/wmkf_requestdocuments?$select=wmkf_artifacttype&$filter=_wmkf_request_value eq ${requestId} and (wmkf_artifacttype eq ${TRANSCRIPT} or wmkf_artifacttype eq ${RECORDING})&$top=100`,
      );
      if (!docResponse.ok) throw new Error(`Pinned sandbox material metadata lookup returned HTTP ${docResponse.status}.`);
      documentRows = docResponse.body?.value || [];
      artifactRowsComplete = !docResponse.body?.['@odata.nextLink'];
    }
    candidates.push({
      requestId,
      requestNumber: request.akoya_requestnum || null,
      meetingDate: request.wmkf_meetingdate || null,
      visibleByWorkbenchPredicate: true,
      leaderContactPresent: Boolean(request._wmkf_projectleader_value || request._wmkf_researchleader_value),
      activeVisitCount: visits.length,
      visitId: visit?.activityid || null,
      visitStart: visit?.scheduledstart || null,
      meetingDateMatchesVisitDate: visit?.scheduledstart
        ? String(request.wmkf_meetingdate).slice(0, 10) === String(visit.scheduledstart).slice(0, 10)
        : null,
      savedAttendeeMapAvailable: visit ? savedAttendeeMapAvailable(visit.wmkf_attendeerefsjson) : false,
      transcriptRowCount: visit && artifactRowsComplete ? documentRows.filter((row) => Number(row.wmkf_artifacttype) === TRANSCRIPT).length : null,
      recordingRowCount: visit && artifactRowsComplete ? documentRows.filter((row) => Number(row.wmkf_artifacttype) === RECORDING).length : null,
      requestDocumentMetadataCapped: visit ? !artifactRowsComplete : null,
    });
  }

  console.log(JSON.stringify({
    mode: 'READ_ONLY_PINNED_SANDBOX_METADATA',
    checkedAt: new Date().toISOString(),
    target: new URL(SANDBOX).hostname,
    method: 'GET only after OAuth token acquisition',
    actorMapping: {
      azureObjectMatchCount: actors.length,
      exactlyOneEnabledDataverseUser: actors.length === 1 && actors[0].isdisabled === false,
      disabledStates: actors.map((row) => row.isdisabled),
    },
    requestRowsScanned: requestResponse.body?.value?.length || 0,
    visibleMeetingCandidatesInspected: candidates.length,
    candidates,
  }, null, 2));
}

main().catch((error) => {
  console.error(`Probe failed; credentials and response bodies omitted: ${error.message}`);
  process.exitCode = 1;
});
