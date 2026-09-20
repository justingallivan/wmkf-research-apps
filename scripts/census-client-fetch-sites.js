#!/usr/bin/env node
/**
 * scripts/census-client-fetch-sites.js
 *
 * Read-only census of raw `fetch(` call sites in client code, for
 * docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md Stage 0 (§6).
 *
 * Scope: `shared/components/**\/*.js` and `pages/**\/*.js`, excluding
 * `pages/api/**`. Never touches production code or the repo tree by
 * default — `--out <dir>` is REQUIRED and everything is written under it.
 *
 * Usage:
 *   node scripts/census-client-fetch-sites.js --out <dir>
 * Writes, under <dir>:
 *   sites.csv     one row per fetch( call site
 *   by-file.csv   one row per file (aggregate)
 *   summary.json  totals by method / body_kind / ok_check / error_surface / etc.
 *
 * Classification rules (plan §6 Stage 0, verbatim):
 * - The "window" for a call site is its own lines, starting at the line
 *   containing `fetch(`, and TRUNCATES at the next `fetch(` call site in the
 *   same file so fields from an unrelated subsequent call never bleed into
 *   this one's classification. If that leaves fewer than 3 lines (two
 *   `fetch(` calls only a line or two apart, e.g. `Promise.all`), the window
 *   widens to a fixed 5 lines instead, so nearby siblings still get context.
 * - `body_kind` is read from the FIRST of `.json()` / `.blob()` /
 *   `getReader()` / no-read found within the call's own window, in that
 *   priority order (stream signals — getReader/.pipe/EventSource/
 *   text/event-stream — outrank blob, which outranks json, which outranks a
 *   fire-and-forget "none" heuristic); "unknown" when none of those appear.
 * - `ok_check` is a boolean: whether `.ok` is referenced anywhere in the
 *   window (i.e. whether the site checks `response.ok` at all).
 * - `error_surface` is read from the nearest `catch` block in the window
 *   (state setter, toast/alert, rethrow, console-only, or swallowed-empty);
 *   when no `catch` is in the window, a bare `throw` still counts as
 *   `throw` (propagates to the caller); otherwise "unknown".
 * - `campaign_critical` (added for this plan's release-tier rule, §1): true
 *   when the site's literal endpoint string matches `/api/review-manager/*`,
 *   `/api/external/*`, `/api/scheduled-emails*`, `/api/upload*`, or contains
 *   any of `send`, `invite`, `reminder`, `release`, `close`. Endpoints built
 *   entirely from a dynamic expression (no string literal in the call or the
 *   following line) are recorded as `dynamic` and cannot be classified by
 *   this heuristic; they are resolved by hand during the file's stage.
 * - `wrapper` names a file-local helper the fetch is piped through, either
 *   because the call sits inside a function whose name looks like a request
 *   helper (e.g. `sendJson`), or because the call's result is passed directly
 *   into another call, e.g. `readResponse(await fetch(...))`.
 *
 * Spot-check provenance: the prototype this script was cleaned up from was
 * spot-checked 8/8 against source after two rounds of fixes (truncate-at-next-
 * fetch, optional-chaining normalization, catch-scoped error_surface). See
 * docs/plans/CLIENT_REQUEST_LAYER_EXECUTION_2026-09-19.md for this run's
 * totals vs. the plan's §2.1 baseline.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO = path.join(__dirname, '..');

const CAMPAIGN_CRITICAL_PATH_RE = /\/api\/(review-manager|external|scheduled-emails|upload)/i;
const CAMPAIGN_CRITICAL_WORD_RE = /(send|invite|reminder|release|close)/i;

function parseArgs(argv) {
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[i + 1];
      i++;
    } else if (argv[i].startsWith('--out=')) {
      out = argv[i].slice('--out='.length);
    }
  }
  return { out };
}

function csvEsc(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function listFiles() {
  const out = execSync(
    `cd "${REPO}" && find shared/components -name "*.js" 2>/dev/null; find pages -name "*.js" 2>/dev/null | grep -v "^pages/api"`,
    { maxBuffer: 1024 * 1024 * 50 }
  )
    .toString()
    .split('\n')
    .filter(Boolean);
  return out;
}

function isCampaignCritical(endpoint) {
  if (!endpoint || endpoint === 'dynamic') return false;
  return CAMPAIGN_CRITICAL_PATH_RE.test(endpoint) || CAMPAIGN_CRITICAL_WORD_RE.test(endpoint);
}

function census(files) {
  // gather test files once for RTL detection
  let testFiles = [];
  try {
    testFiles = execSync(
      `cd "${REPO}" && find tests -type f \\( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" \\) 2>/dev/null`
    )
      .toString()
      .split('\n')
      .filter(Boolean);
  } catch (e) {
    testFiles = [];
  }
  const testFileContents = {};
  for (const tf of testFiles) {
    try {
      testFileContents[tf] = fs.readFileSync(path.join(REPO, tf), 'utf8');
    } catch (e) {
      // unreadable test file; skip
    }
  }

  function hasRtlTest(componentPath) {
    const base = path.basename(componentPath, path.extname(componentPath));
    for (const tf of testFiles) {
      const content = testFileContents[tf];
      if (!content) continue;
      if (!content.includes('render(')) continue;
      const importRe = new RegExp(`from ['"][^'"]*${base}['"]`);
      if (importRe.test(content)) return true;
    }
    return false;
  }

  const rows = [];

  for (const relFile of files) {
    const abs = path.join(REPO, relFile);
    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      continue;
    }
    const lines = content.split('\n');
    const isPage = relFile.startsWith('pages/');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fetchMatch = line.match(/(?:^|[^A-Za-z0-9_.$])fetch\s*\(/);
      if (!fetchMatch) continue;
      const lineNo = i + 1;

      // Window: this call's own lines, truncated at the next fetch( site.
      let windowLines = lines.slice(i, Math.min(lines.length, i + 40));
      for (let k = 1; k < windowLines.length; k++) {
        if (/(?:^|[^A-Za-z0-9_.$])fetch\s*\(/.test(windowLines[k])) {
          windowLines = windowLines.slice(0, k);
          break;
        }
      }
      if (windowLines.length < 3) {
        windowLines = lines.slice(i, Math.min(lines.length, i + 5));
      }
      const windowTextRaw = windowLines.join('\n');
      // Normalize optional chaining (?. -> .) so `data?.error` matches the
      // same patterns as `data.error`.
      const windowText = windowTextRaw.replace(/\?\./g, '.');
      const beforeLines = lines.slice(Math.max(0, i - 60), i);
      const beforeText = beforeLines.join('\n');

      // --- endpoint ---
      let endpoint = 'dynamic';
      const urlMatch = line.match(/fetch\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/);
      if (urlMatch) {
        endpoint = urlMatch[1].slice(0, 62);
      } else {
        const nextLine = lines[i + 1] || '';
        const nm = nextLine.match(/^\s*(`[^`]*`|'[^']*'|"[^"]*")/);
        if (nm) endpoint = nm[1].slice(0, 62);
      }

      // --- method ---
      let method = 'GET';
      const methodMatch = windowText.match(/method\s*:\s*['"`](GET|POST|PUT|PATCH|DELETE)['"`]/i);
      if (methodMatch) {
        method = methodMatch[1].toUpperCase();
      } else if (/method\s*:/.test(windowText.slice(0, 400))) {
        method = 'unknown';
      }

      // --- body_kind (priority: stream > blob > arrayBuffer > json > text > none > unknown) ---
      let body_kind = 'unknown';
      if (
        /getReader\s*\(/.test(windowText) ||
        /\.pipe\s*\(/.test(windowText) ||
        /EventSource/.test(windowText) ||
        /text\/event-stream/.test(windowText)
      ) {
        body_kind = 'stream';
      } else if (/\.arrayBuffer\s*\(/.test(windowText)) {
        body_kind = 'arrayBuffer';
      } else if (/\.blob\s*\(/.test(windowText)) {
        body_kind = 'blob';
      } else if (/\.json\s*\(\s*\)/.test(windowText)) {
        body_kind = 'json';
      } else if (/\.text\s*\(\s*\)/.test(windowText)) {
        body_kind = 'text';
      } else if (
        /void\s+fetch|fetch\([^)]*\)\s*;?\s*$/.test(line) &&
        !/await|\.then/.test(windowText.slice(0, 200))
      ) {
        if (!/response\.|res\.|\.json\(|\.text\(|\.blob\(|\.ok\b|\.status\b/.test(windowText)) {
          body_kind = 'none';
        }
      }

      // --- ok_check ---
      const ok_check = /\.ok\b/.test(windowText);

      // --- error_extract ---
      const errorExtractPatterns = [];
      const eeGeneral = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.(error|message|details)\b/g;
      let eem;
      while ((eem = eeGeneral.exec(windowText))) {
        const varName = eem[1];
        if (/^(console|window|document|process|Math|JSON)$/.test(varName)) continue;
        errorExtractPatterns.push(eem[0]);
      }
      const eeDrill = /\b[A-Za-z_$][A-Za-z0-9_$]*\.error\.\w+\b/g;
      const drillMatches = windowText.match(eeDrill);
      if (drillMatches) errorExtractPatterns.push(...drillMatches);
      const error_extract = errorExtractPatterns.length
        ? [...new Set(errorExtractPatterns)].join('|')
        : 'none';

      // --- status_branch ---
      const statusCodes = new Set();
      const statusRe2 = /\.status\s*===?\s*(\d{3})/g;
      let sm;
      while ((sm = statusRe2.exec(windowText))) statusCodes.add(sm[1]);
      const statusRe3 = /(\d{3})\s*===?\s*\w*\.?status/g;
      while ((sm = statusRe3.exec(windowText))) statusCodes.add(sm[1]);
      const status_branch = statusCodes.size ? [...statusCodes].sort().join(',') : 'none';

      // --- abort ---
      const abort = /AbortController|signal\s*:/.test(windowText);

      // --- headers ---
      const headerNames = new Set();
      const headerBlockMatch = windowText.match(/headers\s*:\s*\{([^}]*)\}/s);
      if (headerBlockMatch) {
        const hb = headerBlockMatch[1];
        const hnRe = /['"`]?([A-Za-z0-9-]+)['"`]?\s*:/g;
        let hm;
        while ((hm = hnRe.exec(hb))) {
          const name = hm[1];
          if (!/^(Content-Type|content-type)$/i.test(name)) headerNames.add(name);
          else headerNames.add('Content-Type');
        }
      }
      const headers = headerNames.size ? [...headerNames].join(';') : 'none';

      // --- error_surface: from the nearest catch block in the window ---
      let error_surface = 'unknown';
      const catchIdx = windowText.search(/\bcatch\s*(\([^)]*\))?\s*\{/);
      const catchText = catchIdx >= 0 ? windowText.slice(catchIdx) : '';
      const scopeForSurface = catchText || windowText;
      if (
        /\bcatch\s*\([^)]*\)\s*\{\s*\}/.test(windowText) &&
        catchText &&
        !/\S/.test(catchText.replace(/catch\s*\([^)]*\)\s*\{/, '').split('}')[0])
      ) {
        error_surface = 'swallowed';
      } else if (/set\w*(Error|Note|Message|Alert|Failure|Status)\w*\s*\(/i.test(scopeForSurface)) {
        error_surface = 'setError-state';
      } else if (/toast\.|showToast|alert\s*\(/.test(scopeForSurface)) {
        error_surface = 'toast/alert';
      } else if (catchText && /throw\s+/.test(catchText)) {
        error_surface = 'throw';
      } else if (catchText && /console\.(error|warn)\s*\(/.test(catchText)) {
        error_surface = 'console-only';
      } else if (!catchText && /throw\s+/.test(windowText)) {
        error_surface = 'throw';
      } else if (catchText) {
        error_surface = 'swallowed';
      }

      // --- in_server_side ---
      let in_server_side = false;
      if (
        /export\s+(async\s+)?function\s+getServerSideProps/.test(beforeText) ||
        /export\s+(async\s+)?function\s+getStaticProps/.test(beforeText)
      ) {
        const nearestExportFn = beforeText.match(/export\s+(async\s+)?function\s+(\w+)/g);
        if (nearestExportFn && nearestExportFn.length) {
          const last = nearestExportFn[nearestExportFn.length - 1];
          if (/getServerSideProps|getStaticProps/.test(last)) in_server_side = true;
        }
      }

      // --- retry ---
      const retry = /retry|retries|for\s*\([^)]*attempt|while\s*\(.*attempt|setInterval|setTimeout\s*\(.*fetch/i.test(
        windowText.slice(0, 800)
      );

      // --- wrapper ---
      let wrapper = '';
      const wrapperMatch = beforeText.match(
        /(async\s+)?function\s+(api|postJson|getJson|apiFetch|fetchJson|request|http\w*|sendJson)\s*\(/i
      );
      if (wrapperMatch) {
        wrapper = wrapperMatch[2];
      }
      const pipedWrapperMatch = line.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*await\s+fetch\s*\(/);
      if (pipedWrapperMatch) {
        wrapper = wrapper ? `${wrapper}+${pipedWrapperMatch[1]}` : pipedWrapperMatch[1];
      }

      // --- campaign_critical (plan §1 release-tier rule) ---
      const campaign_critical = isCampaignCritical(endpoint);

      rows.push({
        file: relFile,
        line: lineNo,
        endpoint,
        method,
        body_kind,
        ok_check,
        error_extract,
        status_branch,
        abort,
        headers,
        error_surface,
        in_server_side,
        retry,
        wrapper,
        campaign_critical,
        is_page: isPage,
      });
    }
  }

  return { rows, hasRtlTest };
}

function writeSitesCsv(outDir, rows) {
  const headerCols = [
    'file', 'line', 'endpoint', 'method', 'body_kind', 'ok_check', 'error_extract',
    'status_branch', 'abort', 'headers', 'error_surface', 'in_server_side', 'retry',
    'wrapper', 'campaign_critical', 'is_page',
  ];
  const csvLines = [headerCols.join(',')];
  for (const r of rows) {
    csvLines.push(headerCols.map((c) => csvEsc(r[c])).join(','));
  }
  fs.writeFileSync(path.join(outDir, 'sites.csv'), csvLines.join('\n') + '\n');
}

function writeByFileCsv(outDir, rows, hasRtlTest) {
  const byFile = {};
  for (const r of rows) {
    if (!byFile[r.file]) {
      byFile[r.file] = { count: 0, error_surfaces: {}, is_page: r.is_page, campaign_critical: false };
    }
    byFile[r.file].count++;
    byFile[r.file].error_surfaces[r.error_surface] = (byFile[r.file].error_surfaces[r.error_surface] || 0) + 1;
    if (r.campaign_critical) byFile[r.file].campaign_critical = true;
  }
  const byFileRows = Object.keys(byFile).map((f) => {
    const info = byFile[f];
    const dominant = Object.entries(info.error_surfaces).sort((a, b) => b[1] - a[1])[0][0];
    const rtl = hasRtlTest(f);
    return {
      file: f,
      count: info.count,
      dominant_error_surface: dominant,
      kind: info.is_page ? 'page' : 'component',
      rtl_test: rtl ? 'yes' : 'no',
      campaign_critical: info.campaign_critical,
    };
  });
  byFileRows.sort((a, b) => b.count - a.count);
  const byFileHeader = ['file', 'count', 'dominant_error_surface', 'kind', 'rtl_test', 'campaign_critical'];
  const byFileCsv = [byFileHeader.join(',')];
  for (const r of byFileRows) {
    byFileCsv.push(byFileHeader.map((c) => csvEsc(r[c])).join(','));
  }
  fs.writeFileSync(path.join(outDir, 'by-file.csv'), byFileCsv.join('\n') + '\n');
  return byFileRows;
}

function writeSummaryJson(outDir, rows, files, byFileRows) {
  function countBy(key) {
    const m = {};
    for (const r of rows) {
      const v = String(r[key]);
      m[v] = (m[v] || 0) + 1;
    }
    return m;
  }
  function countByStatusBranch() {
    const m = {};
    for (const r of rows) {
      if (r.status_branch === 'none') continue;
      for (const code of r.status_branch.split(',')) {
        m[code] = (m[code] || 0) + 1;
      }
    }
    return m;
  }
  function countByHeaders() {
    const m = {};
    for (const r of rows) {
      if (r.headers === 'none') continue;
      for (const h of r.headers.split(';')) {
        m[h] = (m[h] || 0) + 1;
      }
    }
    return m;
  }

  const sharedRows = rows.filter((r) => r.file.startsWith('shared/components/'));
  const pageRows = rows.filter((r) => r.file.startsWith('pages/'));
  const sharedFiles = new Set(sharedRows.map((r) => r.file)).size;
  const pageFiles = new Set(pageRows.map((r) => r.file)).size;

  const summary = {
    total_files_scanned: files.length,
    total_call_sites: rows.length,
    shared_components: { sites: sharedRows.length, files: sharedFiles },
    pages: { sites: pageRows.length, files: pageFiles },
    campaign_critical_sites: rows.filter((r) => r.campaign_critical).length,
    campaign_critical_files: byFileRows.filter((r) => r.campaign_critical).length,
    by_method: countBy('method'),
    by_body_kind: countBy('body_kind'),
    by_ok_check: countBy('ok_check'),
    by_error_surface: countBy('error_surface'),
    by_abort: countBy('abort'),
    by_in_server_side: countBy('in_server_side'),
    by_retry: countBy('retry'),
    status_branch_codes: countByStatusBranch(),
    header_names: countByHeaders(),
    wrapper_usages: rows.filter((r) => r.wrapper).reduce((acc, r) => {
      const key = `${r.file}::${r.wrapper}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  if (!out) {
    console.error('Usage: node scripts/census-client-fetch-sites.js --out <dir>');
    console.error('  --out is required; this script never writes into the repo tree by default.');
    process.exit(1);
  }
  const outDir = path.resolve(out);
  fs.mkdirSync(outDir, { recursive: true });

  const files = listFiles();
  const { rows, hasRtlTest } = census(files);

  writeSitesCsv(outDir, rows);
  const byFileRows = writeByFileCsv(outDir, rows, hasRtlTest);
  const summary = writeSummaryJson(outDir, rows, files, byFileRows);

  console.log(`Scanned ${files.length} files, found ${rows.length} fetch call sites.`);
  console.log(`shared/components: ${summary.shared_components.sites} sites / ${summary.shared_components.files} files`);
  console.log(`pages (non-api): ${summary.pages.sites} sites / ${summary.pages.files} files`);
  console.log(`Wrote: ${path.join(outDir, 'sites.csv')}`);
  console.log(`Wrote: ${path.join(outDir, 'by-file.csv')}`);
  console.log(`Wrote: ${path.join(outDir, 'summary.json')}`);
}

main();
