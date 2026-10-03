#!/usr/bin/env node
/**
 * Bounded, read-only Meeting Tracker transcription prerequisites probe.
 *
 * Pinned to the Dataverse sandbox. Uses the repository Dataverse client with
 * the write interlock forced on and performs GETs only after token acquisition.
 * Prints identifiers and coarse metadata only; never prints people names,
 * emails, attendee JSON, SharePoint URLs/paths, or document contents.
 * Automation metadata names are intentionally included in safety mode.
 * `--publication-metadata` repeats the bounded app-grant, document-location,
 * and existing-recording site-host reads for the fixed candidate only.
 * `--safety-metadata` performs bounded sandbox GETs for RequestDocument
 * automation metadata and resolves only the registered SharePoint site/drive.
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
const TEST_FOLDER_LABEL = 'TEST - Transcription Pilot';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_READ_TIMEOUT_MS = 15_000;

async function readGraphJson(url, headers) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://graph.microsoft.com' || !parsed.pathname.startsWith('/v1.0/')) {
    throw new Error('Graph metadata lookup must use the registered Microsoft Graph v1.0 origin.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAPH_READ_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, {
      method: 'GET', headers, signal: controller.signal, redirect: 'error',
    });
    if (response.status === 404) return { found: false, status: 404 };
    if (!response.ok) return { found: false, status: response.status };
    return { found: true, status: response.status, body: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

function safeGraphMetadataFailure(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `Registered SharePoint metadata lookup failed (HTTP ${status}).`
    : 'Registered SharePoint metadata lookup failed.';
}

function summarizePermissionMetadata(data) {
  const permissions = Array.isArray(data?.value) ? data.value : [];
  const roleCounts = {};
  const linkScopes = {};
  const linkTypes = {};
  for (const permission of permissions) {
    for (const role of Array.isArray(permission?.roles) ? permission.roles : []) {
      const category = ['read', 'write', 'owner', 'readwrite'].includes(String(role).toLowerCase())
        ? String(role).toLowerCase() : 'other';
      roleCounts[category] = (roleCounts[category] || 0) + 1;
    }
    if (permission?.link) {
      const scope = ['anonymous', 'organization', 'users'].includes(permission.link.scope)
        ? permission.link.scope : 'other';
      const type = ['view', 'edit', 'embed'].includes(permission.link.type)
        ? permission.link.type : 'other';
      linkScopes[scope] = (linkScopes[scope] || 0) + 1;
      linkTypes[type] = (linkTypes[type] || 0) + 1;
    }
  }
  return {
    rowCount: permissions.length,
    capped: Boolean(data?.['@odata.nextLink']),
    inheritedCount: permissions.filter((permission) => permission?.inheritedFrom != null).length,
    directOrUnmarkedCount: permissions.filter((permission) => permission?.inheritedFrom == null).length,
    roleCounts,
    linkScopes,
    linkTypes,
  };
}

function summarizeFolderMetadata(data) {
  if (!data?.folder) return { exists: false, childCount: null };
  const childCount = Number(data.folder.childCount);
  return { exists: true, childCount: Number.isSafeInteger(childCount) ? childCount : null };
}

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

function globalMetadataIsCapped(body) {
  return (body?.value?.length || 0) >= 1000 || Boolean(body?.['@odata.nextLink']);
}

function selfTest() {
  if (!globalMetadataIsCapped({ value: Array(1000) })
    || !globalMetadataIsCapped({ value: [], '@odata.nextLink': 'next' })
    || globalMetadataIsCapped({ value: Array(999) })) {
    throw new Error('Global metadata at the requested row limit must remain incomplete.');
  }
  if (!savedAttendeeMapAvailable('{"version":1,"requiredAttendees":[],"optionalAttendees":[]}')) {
    throw new Error('Version-1 attendee map should be recognized.');
  }
  if (savedAttendeeMapAvailable('{"version":2}')) throw new Error('Unknown attendee-map version must be unavailable.');
  const safeFailure = safeGraphMetadataFailure({ status: 403, message: 'response body contains a secret' });
  if (safeFailure !== 'Registered SharePoint metadata lookup failed (HTTP 403).' || safeFailure.includes('secret')) {
    throw new Error('Graph metadata failure summary must omit response details.');
  }
  const safePermissions = JSON.stringify(summarizePermissionMetadata({ value: [{
    roles: ['write'], link: { scope: 'organization', type: 'edit', webUrl: 'https://secret.example/token' },
    inheritedFrom: null, grantedToV2: { user: { email: 'private@example.test' } },
  }] }));
  if (safePermissions.includes('secret') || safePermissions.includes('private@example.test') || safePermissions.includes('webUrl')) {
    throw new Error('Permission summary must omit sharing URLs and member identities.');
  }
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

async function safetyMetadata(client) {
  const stepFilter = "sdkmessagefilterid/primaryobjecttypecode eq 'wmkf_requestdocument'";
  const stepResponse = await client.get(
    `/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,rank,ishidden&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)&$filter=${encodeURIComponent(stepFilter)}&$top=100`,
  );
  if (!stepResponse.ok) throw new Error(`Pinned sandbox RequestDocument step metadata returned HTTP ${stepResponse.status}.`);
  const steps = stepResponse.body?.value || [];

  // This intentionally excludes workflow.clientdata: cloud-flow trigger
  // entities may exist only inside that definition, which is not read here.
  const workflowFilter = "type eq 1 and primaryentity eq 'wmkf_requestdocument'";
  const workflowResponse = await client.get(
    `/workflows?$select=name,category,statecode,type,primaryentity,triggeroncreate,triggerondelete,triggeronupdateattributelist&$filter=${encodeURIComponent(workflowFilter)}&$top=100`,
  );
  if (!workflowResponse.ok) throw new Error(`Pinned sandbox RequestDocument workflow metadata returned HTTP ${workflowResponse.status}.`);
  const workflows = workflowResponse.body?.value || [];

  const globalStepFilter = "statecode eq 0 and (sdkmessageid/name eq 'Create' or sdkmessageid/name eq 'Update')";
  const globalStepResponse = await client.get(
    `/sdkmessageprocessingsteps?$select=name,stage,mode,statecode,ishidden&$expand=sdkmessageid($select=name),sdkmessagefilterid($select=primaryobjecttypecode),plugintypeid($select=typename)&$filter=${encodeURIComponent(globalStepFilter)}&$top=1000`,
  );
  const globalStepQueryAvailable = globalStepResponse.ok;
  const globalSteps = globalStepQueryAvailable ? (globalStepResponse.body?.value || []) : [];
  const globalStepCapped = globalStepQueryAvailable && globalMetadataIsCapped(globalStepResponse.body);
  const unfilteredGlobalSteps = globalSteps.filter((step) => {
    const hasFilter = Boolean(step.sdkmessagefilterid);
    const entity = step.sdkmessagefilterid?.primaryobjecttypecode;
    return !hasFilter || entity == null || String(entity).trim() === '' || String(entity).toLowerCase() === 'none';
  });
  const globalStepSummary = {
    queryFilter: globalStepFilter,
    queryAvailable: globalStepQueryAvailable,
    httpStatus: globalStepQueryAvailable ? 200 : globalStepResponse.status,
    rawCreateUpdateRowCount: globalSteps.length,
    unfilteredRowCount: globalStepQueryAvailable && !globalStepCapped ? unfilteredGlobalSteps.length : null,
    capped: globalStepCapped,
    messageCounts: {},
    pluginTypeCounts: {},
    stageModeCounts: {},
  };
  if (!globalStepQueryAvailable || globalStepCapped) {
    globalStepSummary.classification = globalStepQueryAvailable ? 'unknown_result_capped' : 'unknown_query_failed';
    console.log(JSON.stringify({
      mode: 'READ_ONLY_PINNED_SANDBOX_GLOBAL_STEP_METADATA',
      target: new URL(SANDBOX).hostname,
      method: 'GET only after OAuth token acquisition',
      globalCreateUpdateSteps: globalStepSummary,
      note: 'No response body or plugin implementation is read. A failed or capped global-registration result is incomplete; the probe stops without paging or issuing further metadata reads.',
    }, null, 2));
    return;
  }
  for (const step of unfilteredGlobalSteps) {
    const message = step.sdkmessageid?.name || 'unknown';
    const pluginType = step.plugintypeid?.typename || 'unknown';
    const stageMode = `stage${step.stage ?? 'unknown'}-mode${step.mode ?? 'unknown'}`;
    globalStepSummary.messageCounts[message] = (globalStepSummary.messageCounts[message] || 0) + 1;
    globalStepSummary.pluginTypeCounts[pluginType] = (globalStepSummary.pluginTypeCounts[pluginType] || 0) + 1;
    globalStepSummary.stageModeCounts[stageMode] = (globalStepSummary.stageModeCounts[stageMode] || 0) + 1;
  }
  const nonMicrosoftPluginTypes = Object.keys(globalStepSummary.pluginTypeCounts)
    .filter((type) => !type.startsWith('Microsoft.'));
  globalStepSummary.nonMicrosoftPluginTypes = nonMicrosoftPluginTypes;
  globalStepSummary.classification = nonMicrosoftPluginTypes.length
    ? 'unknown_non_microsoft_types_require_owner_review'
    : unfilteredGlobalSteps.length
      ? 'microsoft_types_only_observed'
      : 'no_unfiltered_steps_observed';

  // Narrow active cloud-flow server filter. The selected clientdata is kept
  // in-process only to project trigger/action categories; it is never output.
  const cloudFlowFilter = "category eq 5 and statecode eq 1 and contains(clientdata,'wmkf_requestdocument')";
  const cloudFlowResponse = await client.get(
    `/workflows?$select=name,category,statecode,clientdata&$filter=${encodeURIComponent(cloudFlowFilter)}&$top=100`,
  );
  const cloudFlowQueryAvailable = cloudFlowResponse.ok;
  const cloudFlows = cloudFlowQueryAvailable ? (cloudFlowResponse.body?.value || []) : [];

  const [{ GraphService }, { configuredSharePointTargetInfo }] = await Promise.all([
    import('../lib/services/graph-service.js'),
    import('../lib/services/sharepoint-target-registry.js'),
  ]);
  const sharePointTarget = configuredSharePointTargetInfo();
  if (!sharePointTarget.registered) throw new Error('Configured SharePoint target is not in the tracked registry.');
  let siteId;
  let driveId;
  let sharePointFolderSummary = { resolved: false, reason: 'request_location_unresolved' };
  let appGrantSummary = { actorResolved: false, meetingTracker: null, reviewers: null };
  try {
    siteId = await GraphService.getSiteId();
    driveId = await GraphService.getDriveId('akoya_request', { siteId });

    const actorResponse = await client.get(
      `/systemusers?$select=systemuserid,isdisabled&$filter=${encodeURIComponent(`azureactivedirectoryobjectid eq ${AZURE_OID}`)}&$top=3`,
    );
    if (!actorResponse.ok) throw new Error(`Pinned sandbox actor metadata returned HTTP ${actorResponse.status}.`);
    const actors = actorResponse.body?.value || [];
    const actorId = actors.length === 1 && actors[0].isdisabled === false ? actors[0].systemuserid : null;
    const readGrant = async (appKey) => {
      if (!actorId) return { rowCount: null, capped: false, actorUnavailable: true };
      const filter = `_wmkf_user_value eq ${actorId} and wmkf_appkey eq '${appKey}'`;
      const response = await client.get(
        `/wmkf_appuserappaccesses?$select=wmkf_appuserappaccessid&$filter=${encodeURIComponent(filter)}&$top=1`,
      );
      if (!response.ok) throw new Error(`Pinned sandbox ${appKey} grant metadata returned HTTP ${response.status}.`);
      return {
        rowCount: (response.body?.value || []).length,
        capped: Boolean(response.body?.['@odata.nextLink']),
        actorUnavailable: false,
      };
    };
    appGrantSummary = {
      actorResolved: Boolean(actorId),
      actorMatchCount: actors.length,
      actorEnabled: Boolean(actorId),
      meetingTracker: await readGrant('meeting-tracker'),
      reviewers: await readGrant('reviewers'),
    };

    const locationFilter = `_regardingobjectid_value eq ${PUBLICATION_METADATA_REQUEST}`;
    const locationResponse = await client.get(
      `/sharepointdocumentlocations?$select=relativeurl,_parentsiteorlocation_value&$filter=${encodeURIComponent(locationFilter)}&$top=10`,
    );
    if (!locationResponse.ok) throw new Error(`Dataverse request-folder lookup returned HTTP ${locationResponse.status}.`);
    const locations = locationResponse.body?.value || [];
    const parentIds = [...new Set(locations.map((row) => row._parentsiteorlocation_value).filter(Boolean))];
    const parents = [];
    if (parentIds.length) {
      const parentFilter = parentIds.map((id) => `sharepointdocumentlocationid eq ${id}`).join(' or ');
      const parentResponse = await client.get(
        `/sharepointdocumentlocations?$select=sharepointdocumentlocationid,relativeurl&$filter=${encodeURIComponent(parentFilter)}&$top=10`,
      );
      if (!parentResponse.ok) throw new Error(`Dataverse request-folder parent lookup returned HTTP ${parentResponse.status}.`);
      parents.push(...(parentResponse.body?.value || []));
    }
    const parentLibraries = new Map(parents.map((row) => [row.sharepointdocumentlocationid, row.relativeurl]));
    const active = locations.filter((row) => row.relativeurl
      && parentLibraries.get(row._parentsiteorlocation_value)?.toLowerCase() === 'akoya_request');
    if (active.length === 1 && !locationResponse.body?.['@odata.nextLink']) {
      const requestFolderPath = active[0].relativeurl;
      const encodedRequestFolder = requestFolderPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      const graphToken = await GraphService.getAccessToken();
      const readJson = (url) => readGraphJson(url, GraphService.buildHeaders(graphToken));
      const select = '?$select=id,folder,parentReference';
      const requestFolder = await readJson(`${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root:/${encodedRequestFolder}${select}`);
      const testPath = `${encodedRequestFolder}/${encodeURIComponent(TEST_FOLDER_LABEL)}`;
      const testFolder = requestFolder.body?.folder
        ? await readJson(`${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root:/${testPath}${select}`)
        : { found: false, status: requestFolder.status };
      const permissionSummary = async (folder) => {
        if (!folder?.body?.id) return { queried: false, status: folder?.status || null };
        const permissionUrl = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folder.body.id)}/permissions?$select=id,roles,link,inheritedFrom&$top=100`;
        const result = await readJson(permissionUrl);
        return result.found
          ? { queried: true, status: result.status, ...summarizePermissionMetadata(result.body) }
          : { queried: true, status: result.status, rowCount: null, capped: null };
      };
      const [requestPermissions, testPermissions] = await Promise.all([
        permissionSummary(requestFolder),
        permissionSummary(testFolder),
      ]);
      sharePointFolderSummary = {
        resolved: true,
        requestFolder: summarizeFolderMetadata(requestFolder.body),
        requestFolderPermissions: requestPermissions,
        testFolder: summarizeFolderMetadata(testFolder.body),
        testFolderPermissions: testPermissions,
        locationCount: locations.length,
        locationCapped: Boolean(locationResponse.body?.['@odata.nextLink']),
      };
    } else {
      sharePointFolderSummary = {
        resolved: false,
        reason: 'request_location_not_unique_or_parent_not_resolved',
        locationCount: locations.length,
        locationCapped: Boolean(locationResponse.body?.['@odata.nextLink']),
      };
    }
  } catch (error) {
    throw new Error(safeGraphMetadataFailure(error));
  }

  const summarizeCloudFlow = (flow) => {
    let definition = null;
    try { definition = JSON.parse(flow.clientdata); } catch { return { statecode: flow.statecode, parseable: false }; }
    const triggers = Object.values(definition?.properties?.definition?.triggers || {});
    const actions = Object.values(definition?.properties?.definition?.actions || {});
    const referencesRequestDocument = (item) => {
      const encoded = JSON.stringify(item);
      return encoded.includes('wmkf_requestdocument') || encoded.includes('wmkf_requestdocuments');
    };
    const matchingTriggers = triggers.filter(referencesRequestDocument);
    const matchingActions = actions.filter(referencesRequestDocument);
    const actionTypes = {};
    for (const action of matchingActions) {
      const type = ['OpenApiConnection', 'OpenApiConnectionWebhook', 'If', 'Scope', 'Foreach', 'Compose'].includes(action?.type)
        ? action.type : 'other';
      actionTypes[type] = (actionTypes[type] || 0) + 1;
    }
    return {
      statecode: flow.statecode,
      parseable: true,
      triggerCount: matchingTriggers.length,
      triggerEvents: matchingTriggers.map((trigger) => {
        const encoded = JSON.stringify(trigger);
        const match = encoded.match(/"message"\s*:\s*"?(\d+)"?/);
        return match ? ({ 1: 'create', 2: 'delete', 3: 'update', 4: 'create-update', 5: 'create-delete', 6: 'update-delete', 7: 'create-update-delete' }[Number(match[1])] || 'other') : 'unclassified';
      }),
      actionReferenceCount: matchingActions.length,
      actionTypes,
    };
  };
  console.log(JSON.stringify({
    mode: 'READ_ONLY_PINNED_SANDBOX_SAFETY_METADATA',
    checkedAt: new Date().toISOString(),
    dynamicsTarget: new URL(SANDBOX).hostname,
    method: 'GET only after OAuth token acquisition',
    sharePoint: {
      configuredHost: sharePointTarget.hostname,
      registeredTarget: sharePointTarget.registered,
      siteMetadataResolved: Boolean(siteId),
      requestLibraryDriveResolved: Boolean(driveId),
    },
    sharePointRequestFolder: sharePointFolderSummary,
    appGrants: appGrantSummary,
    requestDocumentSteps: {
      queryFilter: stepFilter,
      rowCount: steps.length,
      capped: Boolean(stepResponse.body?.['@odata.nextLink']),
      createUpdate: steps.filter((step) => ['Create', 'Update'].includes(step.sdkmessageid?.name))
        .map((step) => ({
          name: step.name || null,
          message: step.sdkmessageid.name,
          statecode: step.statecode,
          stage: step.stage,
          mode: step.mode,
          hidden: step.ishidden === true,
          pluginType: step.plugintypeid?.typename || null,
        })),
    },
    globalCreateUpdateSteps: globalStepSummary,
    activeCloudFlowMetadata: {
      queryFilter: cloudFlowFilter,
      queryAvailable: cloudFlowQueryAvailable,
      httpStatus: cloudFlowQueryAvailable ? 200 : cloudFlowResponse.status,
      rowCount: cloudFlows.length,
      capped: cloudFlowQueryAvailable && Boolean(cloudFlowResponse.body?.['@odata.nextLink']),
      flows: cloudFlows.map(summarizeCloudFlow),
      rawDefinitionsPrinted: false,
    },
    requestDocumentWorkflows: {
      queryFilter: workflowFilter,
      rowCount: workflows.length,
      capped: Boolean(workflowResponse.body?.['@odata.nextLink']),
      matchingRows: workflows.map((workflow) => ({
        name: workflow.name || null,
        category: workflow.category,
        statecode: workflow.statecode,
        triggeroncreate: workflow.triggeroncreate === true,
        hasUpdateTrigger: Boolean(workflow.triggeronupdateattributelist),
      })),
      clientdataSelected: false,
    },
    note: 'No SharePoint file contents, folder names, member identities, or sharing URLs are emitted. The classic-workflow query omits clientdata; only active cloud-flow rows returned by its narrow filter are parsed in memory for trigger/action-category counts, and raw definitions are never printed.',
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
  if (process.argv.includes('--safety-metadata')) return safetyMetadata(client);
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
