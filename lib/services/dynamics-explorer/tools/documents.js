/**
 * list_documents and search_documents tools: SharePoint document discovery
 * for a Dynamics CRM request, and keyword/phrase search over document
 * contents with a per-request throttle circuit breaker.
 *
 * Extracted verbatim from pages/api/dynamics-explorer/chat.js:511-898
 * (pre-S2 line numbers); characterization tests are the safety net.
 *
 * No `sendEvent` parameter or import here: both tools return `_files`, and
 * the executor (tool-executor.js / the route, pre-S8) emits `document_links`
 * and deletes `_files` before returning the tool result to the model.
 */

import { getEntity } from './get-entity';
import { getRequestSharePointBuckets } from '../../../utils/sharepoint-buckets';
import { GraphService } from '../../graph-service';

// ─── list_documents ───

const formatDocSize = (bytes) => {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * List SharePoint documents attached to a Dynamics CRM request.
 *
 * Walks every plausible (library, folder) bucket — Dynamics-tracked locations
 * plus the speculative `RequestArchive1/2/3` libraries — and recurses into
 * subfolders so migrated grants whose files live in `Final Report/`, `Year 1/`,
 * etc. are still surfaced. Each returned file carries its own library, folder
 * path, and (relative) subfolder so download URLs route correctly.
 */
export async function listDocuments({ request_number, request_id }) {
  if (!request_number && !request_id) {
    return { error: 'Either request_number or request_id is required.' };
  }

  // Step 1: Resolve request number to GUID if needed
  let requestId = request_id;
  let requestNum = request_number;
  if (!requestId) {
    const result = await getEntity({ type: 'request', identifier: request_number });
    // Carry _notFound so an unresolvable request logs a zero-result rather
    // than an errored call (see deriveRecordCount).
    if (result.error) return { error: result.error, _notFound: result._notFound };
    requestId = result.akoya_requestid;
    requestNum = result.akoya_requestnum || request_number;
    if (!requestId) {
      return { error: `Could not resolve request "${request_number}" to a GUID.` };
    }
  }

  // Step 2: Discover every plausible bucket (Dynamics-tracked + archive probes)
  const buckets = await getRequestSharePointBuckets(requestId, requestNum);

  // Step 3: List each bucket in parallel, tolerating 404s / permission errors
  const bucketResults = await Promise.all(
    buckets.map(async b => {
      try {
        const files = await GraphService.listFiles(b.library, b.folder, { recursive: true });
        return { ...b, files, error: null };
      } catch (err) {
        return { ...b, files: [], error: err.message };
      }
    }),
  );

  // Step 4: Flatten + de-dupe by (library, full folder path, filename)
  const seen = new Set();
  const allFiles = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const fileFolder = f.folder || bucket.folder;
      const k = `${bucket.library}::${fileFolder}::${f.name}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const subfolder = fileFolder.startsWith(bucket.folder + '/')
        ? fileFolder.slice(bucket.folder.length + 1)
        : '';
      allFiles.push({
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        lastModified: f.lastModified,
        library: bucket.library,
        folder: fileFolder,
        subfolder,
      });
    }
  }

  // Per-bucket summary so Claude can describe the layout to the user.
  // Hide empty archive probes that returned no files and no error — they're
  // expected misses for non-migrated grants and would just be noise.
  const libraries = bucketResults
    .filter(b => b.files.length > 0 || (b.error && b.source !== 'archive'))
    .map(b => ({
      library: b.library,
      folder: b.folder,
      count: b.files.length,
      error: b.error,
    }));

  if (allFiles.length === 0) {
    return {
      requestNumber: requestNum,
      documentCount: 0,
      libraries,
      documents: 'No files found in any document library for this request.',
    };
  }

  const lines = allFiles.map(f => {
    const date = f.lastModified ? new Date(f.lastModified).toLocaleDateString() : '';
    const where = f.subfolder ? `${f.library}/${f.subfolder}` : f.library;
    return `${f.name} | ${formatDocSize(f.size)} | ${date} | ${f.mimeType || ''} | ${where}`;
  });

  return {
    requestNumber: requestNum,
    documentCount: allFiles.length,
    libraries,
    header: 'Filename | Size | Modified | Type | Location',
    documents: lines.join('\n'),
    // Structured file data for frontend download links (not sent to Claude).
    // Each file carries its own library/folder so downloads route correctly
    // even when files come from multiple libraries or nested subfolders.
    _files: allFiles.map(f => ({
      name: f.name,
      size: f.size,
      mimeType: f.mimeType,
      lastModified: f.lastModified,
      library: f.library,
      folder: f.folder,
      subfolder: f.subfolder,
      // requestId bound into the URL so the server can verify the folder's
      // GUID suffix before streaming the file. See download-document.js.
      downloadUrl: `/api/dynamics-explorer/download-document?requestId=${encodeURIComponent(requestId)}&library=${encodeURIComponent(f.library)}&folder=${encodeURIComponent(f.folder)}&filename=${encodeURIComponent(f.name)}`,
    })),
  };
}

// ─── search_documents ───

/**
 * Describe scoped-search failures for the model — factually. The text is
 * delivered inside the untrusted-content boundary, so it must not rely on
 * being obeyed; the per-request circuit breaker (`toolContext.searchThrottle`)
 * is what actually stops a retry loop. Transient (throttle / timeout) and
 * permanent (bad request) failures get distinct wording so the model does not
 * tell the user to "try again in a minute" for a 400.
 */
function buildSearchFailureWarning(failedScopes, totalScopes, retryAfterMs = null) {
  const transient = failedScopes.some(sr => sr.transient);
  const detail = failedScopes
    .map(sr => `${sr.label}: ${String(sr.error || '').substring(0, 120)}`)
    .join('; ');
  const scopes = `${failedScopes.length} of ${totalScopes} search scope(s)`;
  if (transient) {
    return `The SharePoint search service throttled or timed out for ${scopes} (${detail}). `
      + 'Results are incomplete, not a confirmed "no documents". Document search is paused for the '
      + `rest of this request; the user can ask again in ${describeRetryWait(retryAfterMs)}.`;
  }
  return `The SharePoint search service returned an error for ${scopes} (${detail}). `
    + 'Results are incomplete, not a confirmed "no documents". This is not a throttle; '
    + 'the search request itself was rejected.';
}

/** Human wait for retry guidance: never shorter than a minute, rounded up. */
function describeRetryWait(retryAfterMs) {
  const ms = Math.max(Number(retryAfterMs) || 0, 60_000);
  const minutes = Math.ceil(ms / 60_000);
  return minutes <= 1 ? 'about a minute' : `about ${minutes} minutes`;
}

/** Short-circuit result while the per-request search circuit breaker is open. */
function searchPausedResult(query, scopeLabel, throttle) {
  return {
    searchCount: 0,
    query,
    scope: scopeLabel,
    incomplete: true,
    retryAfterMs: throttle.retryAfterMs ?? null,
    error: 'Document search is paused for the rest of this request because the SharePoint '
      + `search service throttled or timed out earlier (${throttle.reason}). No search was run. `
      + `The user can ask again in ${describeRetryWait(throttle.retryAfterMs)}.`,
  };
}

/**
 * Same-round tool calls start concurrently, so two search_documents blocks
 * would both read the breaker as closed before either could trip it. Serialize
 * document searches per request: the second waits for the first and then sees
 * the tripped breaker (Codex adversarial S468, re-review).
 */
function enqueueSearch(toolContext, run) {
  if (!toolContext || typeof toolContext !== 'object') return run();
  const previous = toolContext.searchQueue || Promise.resolve();
  const next = previous.then(run, run);
  toolContext.searchQueue = next.catch(() => {});
  return next;
}

/**
 * Search within SharePoint document contents for keywords or phrases.
 * Optionally scoped to a specific library or request folder.
 */
export function searchDocuments(input, toolContext = {}) {
  if (!input?.query) {
    return Promise.resolve({ error: 'A search query is required.' });
  }
  return enqueueSearch(toolContext, () => searchDocumentsSerialized(input, toolContext));
}

async function searchDocumentsSerialized({ query, library, request_number }, toolContext) {

  // ── Resolve the search scope ─────────────────────────────────────────────
  // When a request_number is supplied, we can't trust a single (library,
  // folder) pair — older grants migrated from the previous grants management
  // system have files in `RequestArchive1/2/3` libraries on top of (or instead
  // of) the active `akoya_request` library. We discover every plausible bucket
  // up front, search the tracked folder wave first, then probe archives
  // serially, and finally merge the results. This keeps archive recall without
  // recreating the former 4× tenant-throttling burst.
  // The simpler alternative — one unscoped search post-filtered by webUrl —
  // loses too much KQL precision when scoring across the whole site.
  let scopes = []; // Array<{ libraryName: string|null, folderPath: string|null, label: string }>
  let scopeLabel;
  let requestId = null; // Hoisted so download-URL construction can use it when a request scope was supplied.

  if (request_number) {
    const reqResult = await getEntity({ type: 'request', identifier: request_number });
    // Same as listDocuments — a not-found source is a zero-result, not an error.
    if (reqResult.error) return { error: reqResult.error, _notFound: reqResult._notFound };
    requestId = reqResult.akoya_requestid;
    const requestNum = reqResult.akoya_requestnum || request_number;
    if (!requestId) {
      return { error: `Could not resolve request "${request_number}" to a GUID.` };
    }

    const buckets = await getRequestSharePointBuckets(requestId, requestNum);
    scopes = buckets.map(b => ({
      libraryName: b.library,
      folderPath: b.folder,
      label: `${b.library}/${b.folder}`,
      source: b.source,
    }));
    scopeLabel = `request ${requestNum} (${buckets.length} folder${buckets.length !== 1 ? 's' : ''})`;
  } else {
    scopes = [{ libraryName: library || null, folderPath: null, label: library || 'all libraries', source: 'dynamics' }];
    scopeLabel = library || 'all libraries';
  }

  if (toolContext.searchThrottle) {
    return searchPausedResult(query, scopeLabel, toolContext.searchThrottle);
  }

  try {
    const runScope = async s => {
      try {
        const found = await GraphService.searchFiles(query, {
          libraryName: s.libraryName,
          folderPath: s.folderPath,
        });
        return { ...s, found, error: null };
      } catch (err) {
        return {
          ...s,
          found: [],
          error: err.message,
          transient: err.isTransient === true || err.noResponse === true,
          retryAfterMs: Number.isFinite(err.retryAfterMs) ? err.retryAfterMs : null,
        };
      }
    };

    // Two waves, not one burst. Graph search is throttled per TENANT, so
    // firing the Dynamics-tracked folder and all three speculative archive
    // probes at once (4 simultaneous calls per question, more with parallel
    // tool calls) is what tripped the 2026-08-27 storm. Wave 1: the tracked
    // folder(s) in parallel (normally one). Wave 2: archive probes one at a
    // time — they are still searched (migrated grants keep files there, so
    // recall is unchanged) but stop at the first transient failure and are
    // skipped entirely if wave 1 already hit one.
    const primaryScopes = scopes.filter(s => s.source !== 'archive');
    const archiveScopes = scopes.filter(s => s.source === 'archive');
    const scopeResults = await Promise.all(primaryScopes.map(runScope));
    let paused = scopeResults.some(sr => sr.transient);
    for (const s of archiveScopes) {
      if (paused) {
        scopeResults.push({ ...s, found: [], error: 'skipped after a transient search failure', transient: true, skipped: true });
        continue;
      }
      const result = await runScope(s);
      scopeResults.push(result);
      if (result.transient) paused = true;
    }

    // De-dupe by file id / webUrl / (library + folder + name)
    const seen = new Set();
    const merged = [];
    for (const sr of scopeResults) {
      for (const f of sr.found) {
        const k = f.id || f.webUrl || `${f.library}::${f.folder}::${f.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(f);
      }
    }

    // A scope that FAILED (Graph throttled us, or the search service errored)
    // is not a scope that returned zero hits. Reporting the two the same way
    // ("No documents found") is a false negative the model then retries,
    // which — with the per-request fan-out — is exactly what produced the
    // 2026-08-27 throttle storm on the Operational Events card. Name the
    // failure instead, and tell the model not to loop on it.
    const failedScopes = scopeResults.filter(sr => sr.error);
    const transientFailure = failedScopes.find(sr => sr.transient);
    // The tenant's requested wait is the LONGEST Retry-After any scope saw;
    // retry guidance is derived from it rather than a fixed "a minute".
    const retryAfterMs = failedScopes.reduce(
      (max, sr) => (sr.retryAfterMs != null && sr.retryAfterMs > max ? sr.retryAfterMs : max),
      0,
    ) || null;
    const searchWarning = failedScopes.length
      ? buildSearchFailureWarning(failedScopes, scopeResults.length, retryAfterMs)
      : null;
    if (transientFailure && toolContext && typeof toolContext === 'object') {
      // Trip the per-request breaker: later search_documents calls in this
      // request return searchPausedResult without touching Graph.
      toolContext.searchThrottle = {
        at: Date.now(),
        reason: String(transientFailure.error || 'transient failure').substring(0, 120),
        retryAfterMs,
      };
    }

    if (!merged.length) {
      if (searchWarning) {
        return { searchCount: 0, query, scope: scopeLabel, incomplete: true, retryAfterMs, error: searchWarning };
      }
      return {
        searchCount: 0,
        query,
        scope: scopeLabel,
        message: 'No documents found matching the search query.',
      };
    }

    // Build text summary for Claude
    const lines = merged.map(f => {
      const size = formatDocSize(f.size);
      const date = f.lastModified ? new Date(f.lastModified).toLocaleDateString() : '';
      const where = f.library && f.folder ? `${f.library}/${f.folder}` : (f.library || '');
      const snippet = f.summary ? `\n  Snippet: ${f.summary}` : '';
      return `${f.name} | ${size} | ${date} | ${where}${snippet}`;
    });

    return {
      searchCount: merged.length,
      query,
      scope: scopeLabel,
      ...(searchWarning ? { incomplete: true, retryAfterMs, warning: searchWarning } : {}),
      header: 'Filename | Size | Modified | Location',
      documents: lines.join('\n'),
      // Structured file data for frontend download links (not sent to Claude)
      // Each file needs a requestId for the download URL. When a request_number
      // was supplied up front we use it for every file; otherwise we recover
      // the GUID from the folder name's `{num}_{GUID32}` suffix. Files whose
      // folder doesn't match the request-folder convention (e.g. templates in
      // a non-request folder) get no downloadUrl — they're not downloadable
      // through this proxy by design.
      _files: merged
        .filter(f => f.folder && f.library)
        .map(f => {
          const topLevel = String(f.folder).split('/')[0];
          const m = /^\d+_([0-9A-F]{32})$/.exec(topLevel);
          const fileGuid = m
            ? `${m[1].slice(0, 8)}-${m[1].slice(8, 12)}-${m[1].slice(12, 16)}-${m[1].slice(16, 20)}-${m[1].slice(20, 32)}`.toLowerCase()
            : null;
          const effectiveRequestId = requestId || fileGuid;
          const downloadUrl = effectiveRequestId
            ? `/api/dynamics-explorer/download-document?requestId=${encodeURIComponent(effectiveRequestId)}&library=${encodeURIComponent(f.library)}&folder=${encodeURIComponent(f.folder)}&filename=${encodeURIComponent(f.name)}`
            : null;
          return {
            name: f.name,
            size: f.size,
            mimeType: f.mimeType || null,
            lastModified: f.lastModified,
            library: f.library,
            folder: f.folder,
            downloadUrl,
          };
        }),
    };
  } catch (err) {
    return {
      searchCount: 0,
      error: `SharePoint search failed: ${err.message}`,
    };
  }
}
