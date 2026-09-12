/**
 * Impeccable direction contract — code-first extension of The Clear Workbench.
 * THESIS: one opening view, "Needs my review", with "Reviewed by me" and "All writeups" as the
 *   only alternatives; cycle and Program Director are the only filters, plus one search field.
 *   Counts are navigation, never denominators (Slice 6B, owner-shaped 2026-09-06).
 * OWN-WORLD: white paper surfaces, ink actions, fine gray rules, semantic amber/green.
 * STORY: find open work, review the document, record review, then move to the next item.
 * FIRST VIEWPORT: the Workbench shell's program / cycle row, then Program Director / view
 *   controls and one search field, then the selected view's list at full width. View and filter
 *   state live in the shell URL (`writeups`, `pd`, `q`, `uncycled`) and are never sent to the
 *   API; the cycle always comes from the shell, so the API's default-cycle walk-back is unused here.
 * FORM: an editorial task list; each row names the publication version acknowledgements key to
 *   (Slice 6C) so "Updated since review" is explainable without opening Word.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Layout from '../Layout';
import { cycleCodeToLabel } from '../../../lib/utils/cycle-code.js';
import ToolbarSelect, { TOOLBAR_CONTROL_HEIGHT_CLASS } from '../ToolbarSelect';
import { buildWorkbenchHref } from '../workbench/workbench-location';
import { useUrlMirroredInput } from '../workbench/useUrlMirroredInput';
import ViewFilterInput from '../workbench/ViewFilterInput';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatDate(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? DATE_FORMATTER.format(new Date(timestamp)) : null;
}

function ArrowIcon({ direction = 'right' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={`h-4 w-4 ${direction === 'left' ? 'rotate-180' : ''}`}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6">
      <path d="M7 3.75h7l4 4V20.25H7z" />
      <path d="M14 3.75v4h4M9.5 12h6M9.5 15.5h6" />
    </svg>
  );
}

function StateChip({ state }) {
  const copy = {
    unreviewed: 'Needs review',
    reviewed: 'Reviewed',
    updated: 'Updated since review',
    'not-applicable': 'Your writeup',
  }[state] || 'Review status unavailable';
  const classes = {
    unreviewed: 'bg-blue-50 text-blue-800 border-blue-200',
    reviewed: 'bg-green-50 text-green-800 border-green-200',
    updated: 'bg-amber-50 text-amber-900 border-amber-200',
    'not-applicable': 'bg-gray-100 text-gray-700 border-gray-200',
  }[state] || 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {copy}
    </span>
  );
}

function ReviewerInitials({ reviewers = [] }) {
  if (!reviewers.length) return <span className="text-xs text-gray-500">No reviews recorded</span>;
  const currentCount = reviewers.filter((reviewer) => reviewer.state !== 'updated').length;
  const earlierCount = reviewers.length - currentCount;
  const reviewSummary = [
    currentCount ? `${currentCount} current` : null,
    earlierCount ? `${earlierCount} earlier version${earlierCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={`Review activity: ${reviewSummary}`}>
      <span className="text-xs text-gray-500">{reviewSummary}</span>
      <div className="flex -space-x-1.5">
        {reviewers.map((reviewer) => (
          <span
            key={reviewer.reviewerId}
            title={`${reviewer.name || 'Reviewer'} — ${reviewer.state === 'updated' ? 'document changed since review' : 'reviewed'}`}
            aria-label={`${reviewer.name || 'Reviewer'} — ${reviewer.state === 'updated' ? 'document changed since this review' : 'Reviewed'}`}
            className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold ${
              reviewer.state === 'updated'
                ? 'bg-amber-100 text-amber-900'
                : 'bg-gray-900 text-white'
            }`}
          >
            {reviewer.initials || '•'}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The SharePoint publication version acknowledgements key to (Slice 6C). The
 * version string is rendered verbatim: its format is Graph's, not ours.
 */
function VersionContext({ currentVersion, acknowledgedVersion, personalState }) {
  if (!currentVersion) return null;
  return (
    <span className="text-xs text-gray-500">
      Version {currentVersion}
      {personalState === 'updated' && acknowledgedVersion && (
        <span className="text-amber-900"> · You reviewed version {acknowledgedVersion}</span>
      )}
    </span>
  );
}

function RowAction({ row }) {
  const classes = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2';
  if (row.relationship === 'responsible-pd') {
    return (
      <a
        href={row.document.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${classes} bg-gray-900 text-white hover:bg-gray-800`}
      >
        {row.primaryAction.label}
        <ArrowIcon />
      </a>
    );
  }
  return (
    <Link
      href={`/workbench/final-writeups/${encodeURIComponent(row.requestId)}`}
      className={`${classes} border border-gray-300 bg-white text-gray-900 hover:border-gray-400 hover:bg-gray-50`}
    >
      {row.primaryAction.label}
      <ArrowIcon />
    </Link>
  );
}

function WriteupRow({ row }) {
  return (
    <article className="group px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums text-gray-900">#{row.requestNumber || '—'}</span>
            <StateChip state={row.personalState} />
            <span className="text-xs font-medium text-gray-500">{row.stage.label}</span>
          </div>
          <h3 className="text-base font-semibold leading-6 text-gray-900 sm:text-lg">
            {row.title || 'Untitled request'}
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            {[row.institution, row.responsibleProgramDirector?.name && `PD: ${row.responsibleProgramDirector.name}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <ReviewerInitials reviewers={row.reviewers} />
            {formatDate(row.document.lastModified) && (
              <span className="text-xs text-gray-500">
                Updated {formatDate(row.document.lastModified)}
              </span>
            )}
            <VersionContext
              currentVersion={row.document.publicationVersionId}
              acknowledgedVersion={row.acknowledgedPublicationVersionId}
              personalState={row.personalState}
            />
          </div>
        </div>
        <div className="shrink-0 self-start lg:self-center">
          <RowAction row={row} />
        </div>
      </div>
    </article>
  );
}

function QueueSection({ title, description, rows, emptyCopy, secondary = false }) {
  if (secondary && rows.length === 0) return null;
  const contents = rows.length ? (
    <div className="divide-y divide-gray-200">
      {rows.map((row) => <WriteupRow key={row.requestId} row={row} />)}
    </div>
  ) : (
    <div className="px-6 py-10 text-center text-sm text-gray-500">{emptyCopy}</div>
  );

  if (secondary) {
    return (
      <details className="group overflow-hidden rounded-xl border border-gray-200 bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 sm:px-6">
          <span>{title} <span className="font-normal text-gray-500">({rows.length})</span></span>
          <span className="text-sm font-normal text-gray-500 group-open:hidden">Show</span>
          <span className="hidden text-sm font-normal text-gray-500 group-open:inline">Hide</span>
        </summary>
        {description && <p className="border-t border-gray-100 px-4 pt-4 text-sm text-gray-600 sm:px-6">{description}</p>}
        {contents}
      </details>
    );
  }

  return (
    <section aria-labelledby="open-writeups-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="open-writeups-heading" className="text-xl font-semibold tracking-[-0.02em] text-gray-900">{title}</h2>
          {description && <p className="mt-1 max-w-2xl text-sm text-gray-600">{description}</p>}
        </div>
        <span className="text-sm tabular-nums text-gray-500">{rows.length}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {contents}
      </div>
    </section>
  );
}

function MatrixState({ state, reviewerName, requestNumber }) {
  const copy = {
    reviewed: 'Reviewed',
    updated: 'Updated',
    unreviewed: 'Not reviewed',
    'not-applicable': 'Responsible PD',
  }[state] || 'Unavailable';
  const classes = {
    reviewed: 'border-green-200 bg-green-50 text-green-800',
    updated: 'border-amber-200 bg-amber-50 text-amber-900',
    unreviewed: 'border-gray-200 bg-white text-gray-600',
    'not-applicable': 'border-gray-200 bg-gray-100 text-gray-600',
  }[state] || 'border-red-200 bg-red-50 text-red-800';
  return (
    <span
      aria-label={`${reviewerName}: ${copy} for request ${requestNumber || 'without a number'}`}
      className={`inline-flex min-h-9 w-full min-w-28 items-center justify-center rounded-lg border px-2 py-1.5 text-center text-xs font-semibold leading-4 ${classes}`}
    >
      {copy}
    </span>
  );
}

function MatrixTable({ group, search, pd }) {
  const rows = (group.rows || [])
    .filter((row) => matchesProgramDirector(row, pd) && matchesSearch(row, search));
  return (
    <section aria-labelledby={`coordinator-matrix-${group.grantProgramId || 'default'}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h3 id={`coordinator-matrix-${group.grantProgramId || 'default'}`} className="text-base font-semibold text-gray-900">
          {group.grantProgramName || 'Grant Program'}
        </h3>
        <span className="text-xs tabular-nums text-gray-500">
          {group.reviewers?.length || 0} reviewer{group.reviewers?.length === 1 ? '' : 's'} · {group.rows?.length || 0} writeup{group.rows?.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th scope="col" className="sticky left-0 z-20 w-56 min-w-56 max-w-56 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600 sm:w-72 sm:min-w-72 sm:max-w-72 sm:px-5">
                Final Writeup
              </th>
              {(group.reviewers || []).map((reviewer) => (
                <th key={reviewer.reviewerId} scope="col" className="min-w-36 px-3 py-3 text-sm font-semibold text-gray-900">
                  <span className="block">{reviewer.name}</span>
                  {reviewer.initials && <span className="mt-0.5 block text-xs font-normal text-gray-500">{reviewer.initials}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((row) => (
              <tr key={row.requestId} className="align-top hover:bg-gray-50/70">
                <th scope="row" className="sticky left-0 z-10 w-56 min-w-56 max-w-56 bg-white px-4 py-4 shadow-[1px_0_0_0_rgb(229_231_235)] sm:w-72 sm:min-w-72 sm:max-w-72 sm:px-5">
                  <Link
                    href={`/workbench/final-writeups/${encodeURIComponent(row.requestId)}`}
                    className="block whitespace-normal font-semibold text-gray-900 underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    <span className="tabular-nums">#{row.requestNumber || '—'}</span> {row.title || 'Untitled request'}
                  </Link>
                  <span className="mt-1 block text-xs font-normal leading-5 text-gray-500">
                    {[row.responsibleProgramDirector?.name && `PD: ${row.responsibleProgramDirector.name}`, row.stage?.label]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <a
                    href={row.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  >
                    Open in Word
                  </a>
                </th>
                {(row.cells || []).map((cell, index) => (
                  <td key={cell.reviewerId} className="px-3 py-4">
                    <MatrixState
                      state={cell.state}
                      reviewerName={group.reviewers?.[index]?.name || 'Reviewer'}
                      requestNumber={row.requestNumber}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={(group.reviewers?.length || 0) + 1} className="px-6 py-10 text-center text-sm text-gray-500">
                  No matrix rows match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CoordinatorMatrix({ matrix, search, pd }) {
  if (!matrix) return null;
  const unconfiguredRows = (matrix.unconfiguredRows || [])
    .filter((row) => matchesProgramDirector(row, pd) && matchesSearch(row, search));
  return (
    <section aria-labelledby="coordinator-matrix-heading" className="space-y-5">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="coordinator-matrix-heading" className="text-xl font-semibold tracking-[-0.02em] text-gray-900">
              Coordinator matrix
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
              Each Grant Program uses its configured reviewer audience. This records review activity only; it is not approval or compliance tracking.
            </p>
          </div>
          <Link
            href="/admin#final-writeup-matrix-audiences"
            className="text-sm font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500"
          >
            Edit audiences
          </Link>
        </div>
        {matrix.mode === 'role-default' && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            Program-specific audiences have not been published yet. This matrix is temporarily using every enabled member of the Final Writeup reviewer role.
          </p>
        )}
      </div>

      {(matrix.groups || []).map((group) => (
        <MatrixTable key={group.grantProgramId || 'role-default'} group={group} search={search} pd={pd} />
      ))}

      {unconfiguredRows.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4" role="status">
          <h3 className="font-semibold text-amber-950">Audience configuration needed</h3>
          <p className="mt-1 text-sm text-amber-900">
            These Final Writeups are not placed in a matrix because their Grant Program has no saved audience.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-amber-950">
            {unconfiguredRows.map((row) => (
              <li key={row.requestId} className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/workbench/final-writeups/${encodeURIComponent(row.requestId)}`}
                  className="font-semibold underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-amber-700"
                >
                  #{row.requestNumber || '—'} {row.title || 'Untitled request'}
                </Link>
                <span className="text-amber-800">{row.grantProgramName || 'No Grant Program'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function LoadingSurface({ message = 'Loading Final Writeups…' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm" aria-live="polite">
      <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-2 border-gray-200 border-t-gray-800" />
      <p className="text-sm text-gray-600">{message}</p>
    </div>
  );
}

function ErrorSurface({ message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-red-900" role="alert">
      <h2 className="font-semibold">Final Writeups could not be loaded</h2>
      <p className="mt-1 max-w-2xl text-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 min-h-11 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
      >
        Try again
      </button>
    </div>
  );
}

function matchesSearch(row, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.requestNumber,
    row.title,
    row.institution,
    row.projectLeader,
    row.responsibleProgramDirector?.name,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

const NO_CYCLE = 'none';
const DEFAULT_VIEW = 'needs-review';

/**
 * The three dashboard views. Keys are the `view` URL values; `select` picks
 * the rows from the server queues. Allowlist and labels live in one map so an
 * unknown value cannot be labeled and a labeled value cannot be unselectable.
 */
const VIEWS = Object.freeze({
  'needs-review': {
    label: 'Needs my review',
    select: (queues) => queues.open,
    description: 'Open a writeup, read it in Word, then record that you reviewed the current version.',
    emptyCopy: 'Nothing needs your review',
  },
  reviewed: {
    label: 'Reviewed by me',
    select: (queues) => queues.history,
    description: 'Writeups you have acknowledged. A later edit is shown as an update, not a new requirement.',
    emptyCopy: 'You have not reviewed any writeups',
  },
  all: {
    label: 'All writeups',
    select: (queues) => [...queues.open, ...queues.history, ...queues.stewardship],
    description: 'Every current writeup you can see in this cycle, including your own.',
    emptyCopy: 'No current writeups',
  },
});
const VIEW_KEYS = Object.keys(VIEWS);

function isViewKey(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VIEWS, value);
}

function cycleLabelFor(cycles, code) {
  if (!code) return null;
  if (code === NO_CYCLE) return 'No cycle';
  const match = (cycles?.available || []).find((cycle) => cycle.code === code);
  return match?.label || cycleCodeToLabel(code) || code;
}

const PD_ABSENT_LABEL = 'Program director not in this cycle';

/**
 * Program Director filter. Options are the distinct responsible PDs of the
 * rows already loaded (existence-only; every listed PD has a visible row). A
 * bookmarked PD absent from the cycle keeps an option so the control never
 * shows a value other than the one the list is filtered by.
 */
function ProgramDirectorSelector({ options, value, disabled, onChange }) {
  const rendered = [...options];
  if (value && !rendered.some((option) => option.id === value)) {
    rendered.push({ id: value, name: PD_ABSENT_LABEL });
  }
  return (
    <ToolbarSelect
      id="final-writeup-pd"
      label="Responsible program director"
      value={value || ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">All program directors</option>
      {rendered.map((option) => (
        <option key={option.id} value={option.id}>{option.name}</option>
      ))}
    </ToolbarSelect>
  );
}

/** Segmented view control; counts are navigation counts over the filtered rows. */
/**
 * Segmented view control. Its outer box is the same 48px as the selects beside
 * it (border-box), so the three toolbar labels and controls share one baseline.
 */
function ViewSelector({ view, counts, disabled, onChange }) {
  return (
    <div role="group" aria-labelledby="final-writeup-view-label" className={`inline-flex ${TOOLBAR_CONTROL_HEIGHT_CLASS} items-stretch gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1`}>
      {VIEW_KEYS.map((key) => {
        const active = key === view;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-60 ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {VIEWS[key].label}
            <span className="tabular-nums text-xs font-medium text-gray-500">{counts[key]}</span>
          </button>
        );
      })}
    </div>
  );
}

function matchesProgramDirector(row, pd) {
  if (!pd) return true;
  return String(row?.responsibleProgramDirector?.id || '').toLowerCase() === pd;
}

function byRequestNumber(left, right) {
  return String(left.requestNumber || '').localeCompare(String(right.requestNumber || ''));
}

function programDirectorOptions(queues) {
  const seen = new Map();
  for (const row of Object.values(queues).flat()) {
    const id = String(row?.responsibleProgramDirector?.id || '').toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, name: row.responsibleProgramDirector.name || 'Program Director' });
  }
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The cycle the shell chose holds nothing the viewer can see. Name it and
 * offer the newest other cycle that has current writeups (`available` is
 * existence-only and not persona-filtered, so say "with writeups", not
 * "visible to you"), plus the uncycled rows when any exist.
 */
function EmptyCycleNotice({ cycles, cycleLabel, uncycled, onCycleChange, onUncycledChange }) {
  const alternative = (cycles?.available || []).find((cycle) => cycle.code !== cycles?.selected) || null;
  const linkClass = 'font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500';
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-6 text-sm text-gray-600" role="status">
      <p>
        {uncycled
          ? 'No current writeups visible to you without a cycle.'
          : `No current writeups visible to you in ${cycleLabel || 'this cycle'}.`}
      </p>
      {(alternative || (cycles?.hasUncycled && !uncycled)) && (
        <p className="mt-2">
          {alternative && (
            <>
              Newest cycle with writeups:{' '}
              <button type="button" className={linkClass} onClick={() => onCycleChange(alternative.code)}>{alternative.label}</button>
            </>
          )}
          {alternative && cycles?.hasUncycled && !uncycled && ' · '}
          {cycles?.hasUncycled && !uncycled && (
            <button type="button" className={linkClass} onClick={() => onUncycledChange(true)}>Writeups without a cycle</button>
          )}
        </p>
      )}
    </div>
  );
}

function personaViewLabel(viewer) {
  if (!viewer?.personaLensesEnabled) return null;
  const labels = {
    'program-director': 'Program Director',
    'program-coordinator': 'Program Coordinator',
    leadership: 'Leadership',
  };
  const resolved = (viewer.personas || []).map((persona) => labels[persona]).filter(Boolean);
  return resolved.length ? `${resolved.join(' + ')} view` : 'No Final Writeup view assigned';
}

function NeedsReviewEmptyState({ cycleLabel, pdName, counts, search, onChangeView }) {
  if (search) return <>No writeups match this filter. Clear the filter or try another term.</>;
  if (pdName === PD_ABSENT_LABEL) {
    return <>No writeups for the selected Program Director{cycleLabel ? ` in ${cycleLabel}` : ''}. Choose All program directors to clear the filter.</>;
  }
  const switcher = (key) => (
    <button
      type="button"
      onClick={() => onChangeView(key)}
      className="font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
    >
      {counts[key]} {key === 'reviewed' ? `reviewed by you` : `writeup${counts[key] === 1 ? '' : 's'} in all`}
    </button>
  );
  return (
    <>
      Nothing needs your review{cycleLabel ? ` in ${cycleLabel}` : ''}{pdName ? ` for ${pdName}` : ''}.{' '}
      {switcher('reviewed')} · {switcher('all')}
    </>
  );
}

/**
 * Final writeups panel, mounted inside the Request Workbench shell. The shell
 * owns the cycle; this panel owns the view, Program Director filter, search,
 * and the "no cycle" lens, all mirrored into the shell URL through the
 * callbacks. The fetch is built from the cycle alone.
 *
 * @param {object} props
 * @param {string|null} props.cycleCode        null while the shell resolves it
 * @param {boolean} props.loadingCycles
 * @param {'needs-review'|'reviewed'|'all'} props.writeupsView
 * @param {string} props.pd                    canonical lowercase GUID or ''
 * @param {string} props.search
 * @param {boolean} props.uncycled             show rows with no meeting date (`cycleCode=none`)
 * @param {Function} props.onWriteupsViewChange
 * @param {Function} props.onPdChange          (guid or '')
 * @param {Function} props.onSearchChange      debounced
 * @param {Function} props.onUncycledChange
 * @param {Function} props.onCycleChange       (code) — the empty-cycle link
 */
export function FinalWriteupsPanel({
  cycleCode,
  loadingCycles = false,
  writeupsView = DEFAULT_VIEW,
  pd = '',
  search = '',
  uncycled = false,
  onWriteupsViewChange,
  onPdChange,
  onSearchChange,
  onUncycledChange,
  onCycleChange,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchInput, setSearchInput] = useUrlMirroredInput(search, onSearchChange);
  const requestIdRef = useRef(0);
  const view = isViewKey(writeupsView) ? writeupsView : DEFAULT_VIEW;
  const pdValue = pd || null;
  const selector = uncycled ? NO_CYCLE : cycleCode;

  const load = useCallback(async () => {
    if (!selector) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workbench/final-writeups?cycleCode=${encodeURIComponent(selector)}`);
      const body = await response.json().catch(() => ({}));
      if (requestIdRef.current !== requestId) return;
      if (!response.ok) throw new Error(body.error || `Failed to load Final Writeups (${response.status})`);
      setData(body);
    } catch (loadError) {
      if (requestIdRef.current === requestId) {
        setError(loadError.message);
        setData(null);
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [selector]);

  useEffect(() => {
    if (!selector) {
      // The shell is resolving a cycle: drop any response still in flight.
      requestIdRef.current += 1;
      return undefined;
    }
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => {
      window.clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [load, selector]);

  const changeView = useCallback((key) => {
    onWriteupsViewChange(isViewKey(key) ? key : DEFAULT_VIEW);
  }, [onWriteupsViewChange]);

  const serverQueues = useMemo(
    () => data?.queues || { open: [], history: [], stewardship: [] },
    [data],
  );
  const pdOptions = useMemo(() => programDirectorOptions(serverQueues), [serverQueues]);
  // Program Director-filtered, but not text-filtered: queue counts and the
  // lead sentence are computed from this so they hold still while typing.
  const pdFilteredQueues = useMemo(() => Object.fromEntries(
    Object.entries(serverQueues).map(([key, value]) => [
      key,
      (value || []).filter((row) => matchesProgramDirector(row, pdValue)),
    ]),
  ), [serverQueues, pdValue]);
  const filteredQueues = useMemo(() => Object.fromEntries(
    Object.entries(pdFilteredQueues).map(([key, value]) => [
      key,
      value.filter((row) => matchesSearch(row, searchInput)),
    ]),
  ), [pdFilteredQueues, searchInput]);
  const viewCounts = useMemo(() => Object.fromEntries(
    VIEW_KEYS.map((key) => [key, VIEWS[key].select(pdFilteredQueues).length]),
  ), [pdFilteredQueues]);
  const mainRows = useMemo(
    () => [...VIEWS[view].select(filteredQueues)].sort(byRequestNumber),
    [filteredQueues, view],
  );
  const stewardshipRows = useMemo(
    () => [...(filteredQueues.stewardship || [])].sort(byRequestNumber),
    [filteredQueues],
  );
  // "Your writeups" (stewardship) can surface rows the main queue doesn't
  // (or the reverse); when it's shown (every view but "all"), the filter's
  // "Showing X of Y" counts the union of both sections, deduped by
  // requestId — the row's true identity (used for React keys and links
  // throughout this file) rather than requestNumber, which is a display
  // field. "all" has no stewardship section, so it keeps the simple count.
  const filterShown = view === 'all'
    ? mainRows.length
    : new Set([...mainRows, ...stewardshipRows].map((row) => row.requestId)).size;
  const filterTotal = view === 'all'
    ? (viewCounts[view] ?? 0)
    : new Set([
      ...VIEWS[view].select(pdFilteredQueues),
      ...(pdFilteredQueues.stewardship || []),
    ].map((row) => row.requestId)).size;
  const pdName = pdValue
    ? (pdOptions.find((option) => option.id === pdValue)?.name || PD_ABSENT_LABEL)
    : null;
  const cycleLabel = data ? cycleLabelFor(data.cycles, data.cycles?.selected) : null;
  const current = VIEWS[view];
  const cycleEmpty = data && (data.counts?.total ?? 0) === 0;
  const activeCount = viewCounts[view] ?? 0;
  const activeCountVerb = view === 'reviewed' ? 'reviewed by you' : view === 'all' ? '' : 'awaiting your review';
  // No cycle and not loading one: the shell's alert carries the retry; render nothing here.
  if (!selector && !loadingCycles) return null;
  const busy = loadingCycles || !selector || loading;

  return (
    <div className="pb-16">
      {data && (
        <div className="mb-6 text-sm text-gray-500">
          {personaViewLabel(data.viewer) && (
            <p className="mb-1 font-medium text-gray-700">{personaViewLabel(data.viewer)}</p>
          )}
          <p>
            <span className="font-semibold tabular-nums text-gray-900">{activeCount}</span> writeup{activeCount === 1 ? '' : 's'}
            {activeCountVerb && ` ${activeCountVerb}`}
            {cycleLabel && ` in ${cycleLabel}`}
            {pdName && pdName !== PD_ABSENT_LABEL && ` for ${pdName}`}
          </p>
          {uncycled && (
            <p className="mt-1">
              Showing writeups without a cycle.{' '}
              <button
                type="button"
                className="font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                onClick={() => onUncycledChange(false)}
              >
                Back to {cycleCodeToLabel(cycleCode) || cycleCode || 'the cycle'}
              </button>
            </p>
          )}
        </div>
      )}

      <div className="my-6 space-y-4">
        {data && (
          <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
            <ProgramDirectorSelector options={pdOptions} value={pdValue} disabled={busy} onChange={(id) => onPdChange(id ? String(id).toLowerCase() : '')} />
            <div className="flex flex-col gap-1.5">
              <span id="final-writeup-view-label" className="text-sm font-medium text-gray-700">Review queue</span>
              <ViewSelector view={view} counts={viewCounts} disabled={busy} onChange={changeView} />
            </div>
          </div>
        )}
        <ViewFilterInput
          id="final-writeup-search"
          label="Filter final writeups"
          placeholder="Request #, title, institution, PI, or program director"
          value={searchInput}
          onChange={setSearchInput}
          shown={filterShown}
          total={filterTotal}
          unitSingular="writeup"
          unitPlural="writeups"
        />
      </div>

      {busy ? <LoadingSurface /> : error ? (
        <ErrorSurface message={error} onRetry={load} />
      ) : cycleEmpty ? (
        <EmptyCycleNotice
          cycles={data.cycles}
          cycleLabel={cycleLabel}
          uncycled={uncycled}
          onCycleChange={onCycleChange}
          onUncycledChange={onUncycledChange}
        />
      ) : (
        <div className="space-y-6">
          <CoordinatorMatrix matrix={data.coordinatorMatrix} search={searchInput} pd={pdValue} />
          <QueueSection
            title={current.label}
            description={current.description}
            rows={mainRows}
            emptyCopy={view === DEFAULT_VIEW ? (
              <NeedsReviewEmptyState
                cycleLabel={cycleLabel}
                pdName={pdName}
                counts={viewCounts}
                search={searchInput}
                onChangeView={changeView}
              />
            ) : (
              searchInput
                ? 'No writeups match this filter. Clear the filter or try another term.'
                : pdName === PD_ABSENT_LABEL
                  ? `No writeups for the selected Program Director${cycleLabel ? ` in ${cycleLabel}` : ''}. Choose All program directors to clear the filter.`
                  : `${current.emptyCopy}${cycleLabel ? ` in ${cycleLabel}` : ''}${pdName ? ` for ${pdName}` : ''}.`
            )}
          />
          {view !== 'all' && (
            <QueueSection
              secondary
              title="Your writeups"
              description="These are the writeups for which you are the responsible Program Director."
              rows={stewardshipRows}
              emptyCopy="No current writeups are assigned to you."
            />
          )}
          {data.cycles?.hasUncycled && !uncycled && (
            <p className="text-sm text-gray-500">
              Some current writeups have no cycle.{' '}
              <button
                type="button"
                className="font-semibold text-gray-900 underline underline-offset-4 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                onClick={() => onUncycledChange(true)}
              >
                Writeups without a cycle
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FocusedHeader({ writeup, cycles }) {
  // Focused responses carry no cycle list, so prefer the row's own label and
  // fall back to the selector label (which covers the `none` sentinel).
  const cycleLabel = writeup.cycleLabel || cycleLabelFor(cycles, cycles?.selected);
  return (
    <header className="border-b border-gray-200 pb-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold tabular-nums text-gray-700">Request #{writeup.requestNumber || '—'}</span>
        {cycleLabel && <span className="text-xs font-medium text-gray-500">{cycleLabel}</span>}
        <StateChip state={writeup.personalState} />
        <span className="text-xs font-medium text-gray-500">{writeup.stage.label}</span>
      </div>
      <h1 className="max-w-4xl text-2xl font-bold tracking-[-0.025em] text-gray-900 sm:text-3xl">
        {writeup.title || 'Untitled request'}
      </h1>
      <p className="mt-2 text-sm leading-6 text-gray-600">
        {[writeup.institution, writeup.responsibleProgramDirector?.name && `PD: ${writeup.responsibleProgramDirector.name}`]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </header>
  );
}

function FocusedDocument({ writeup }) {
  return (
    <section aria-labelledby="document-heading" className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700"><DocumentIcon /></span>
          <div>
            <h2 id="document-heading" className="text-lg font-semibold text-gray-900">Current Final Writeup</h2>
            <p className="mt-1 text-sm text-gray-600">
              Opens in a separate Word window or browser tab.
            </p>
            {formatDate(writeup.document.lastModified) && (
              <p className="mt-2 text-xs text-gray-500">Last updated {formatDate(writeup.document.lastModified)}</p>
            )}
            {writeup.document.publicationVersionId && (
              <p className="mt-1 text-xs text-gray-500">Version {writeup.document.publicationVersionId}</p>
            )}
          </div>
        </div>
        <a
          href={writeup.document.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
        >
          {writeup.relationship === 'responsible-pd' ? 'Edit in Word' : 'Open in Word'}
          <ArrowIcon />
        </a>
      </div>
    </section>
  );
}

/**
 * A Program Director may still record a review after a writeup moves to
 * leadership review (owner decision 2026-09-06: warn, do not lock). Leadership
 * viewers are not warned; leadership-stage rows are their ordinary work.
 */
function stageMovedOnWarning(writeup, viewer) {
  if (writeup.stage?.key !== 'leadership-review' || !viewer?.personaLensesEnabled) return null;
  const personas = viewer.personas || [];
  if (!personas.includes('program-director') || personas.includes('leadership')) return null;
  return 'This writeup has moved on to leadership review. You can still record your review, but group review has closed.';
}

function acknowledgementVersionCopy(writeup) {
  const marked = formatDate(writeup.acknowledgedAt);
  const acknowledged = writeup.acknowledgedPublicationVersionId;
  const current = writeup.document?.publicationVersionId;
  if (writeup.personalState === 'updated' && acknowledged && current) {
    return `You reviewed version ${acknowledged} on ${marked}. The current version is ${current}.`;
  }
  if (writeup.personalState === 'reviewed' && current) {
    return `You reviewed version ${current} on ${marked}.`;
  }
  return `Last marked ${marked}`;
}

function AcknowledgementPanel({ writeup, viewer, saving, error, onAcknowledge }) {
  if (!writeup.mayAcknowledge) return null;
  const reviewed = writeup.personalState === 'reviewed';
  const updated = writeup.personalState === 'updated';
  const warning = stageMovedOnWarning(writeup, viewer);
  return (
    <section aria-labelledby="review-state-heading" className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 id="review-state-heading" className="text-lg font-semibold text-gray-900">
            {reviewed ? 'You reviewed this version' : updated ? 'The writeup changed after your review' : 'Record your review'}
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">
            {reviewed
              ? 'Your acknowledgement is recorded. It does not approve the writeup or prevent later edits.'
              : updated
                ? 'Your earlier acknowledgement remains in history. Record the latest version after you have reviewed the changes.'
                : 'After reading the current version, mark it reviewed. This is personal tracking, not an approval.'}
          </p>
          {writeup.acknowledgedAt && (
            <p className="mt-2 text-xs text-gray-500">
              {acknowledgementVersionCopy(writeup)}
            </p>
          )}
          {warning && !reviewed && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
              {warning}
            </p>
          )}
          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
        </div>
        {!reviewed && (
          <button
            type="button"
            onClick={onAcknowledge}
            disabled={saving}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-900 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Recording…' : updated ? 'Mark latest version reviewed' : 'Mark reviewed'}
          </button>
        )}
      </div>
    </section>
  );
}

function SupportingMaterials({ writeup }) {
  return (
    <details className="group overflow-hidden rounded-xl border border-gray-200 bg-white">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500 sm:px-6">
        <span>Supporting materials</span>
        <span className="text-sm font-normal text-gray-500 group-open:hidden">Show</span>
        <span className="hidden text-sm font-normal text-gray-500 group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-gray-100 px-5 py-5 sm:px-6">
        <p className="max-w-2xl text-sm leading-6 text-gray-600">
          Open the existing read surfaces for background. They stay outside this focused review page.
        </p>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Supporting materials">
          {writeup.supportingMaterials.map((material) => (
            <Link
              key={material.key}
              href={material.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 hover:border-gray-400 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {material.label}
              <ArrowIcon />
            </Link>
          ))}
        </nav>
        <Link href={writeup.fullRequestHref} className="mt-5 inline-block text-sm font-medium text-gray-600 underline underline-offset-4 hover:text-gray-900">
          View full request
        </Link>
      </div>
    </details>
  );
}

function FocusedNavigation({ navigation }) {
  if (!navigation?.previous && !navigation?.next) return null;
  const item = (label, row, direction) => row ? (
    <Link
      href={`/workbench/final-writeups/${encodeURIComponent(row.requestId)}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500"
    >
      {direction === 'left' && <ArrowIcon direction="left" />}
      <span>{label} <span className="tabular-nums">#{row.requestNumber || '—'}</span></span>
      {direction === 'right' && <ArrowIcon />}
    </Link>
  ) : <span />;
  return (
    <nav className="flex items-center justify-between gap-4 border-t border-gray-200 pt-5" aria-label="Final Writeup queue navigation">
      {item('Previous', navigation.previous, 'left')}
      {item('Next', navigation.next, 'right')}
    </nav>
  );
}

export function FinalWriteupFocusedView({ requestId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!requestId) return;
    const loadId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/workbench/final-writeups?requestId=${encodeURIComponent(requestId)}`);
      const body = await response.json().catch(() => ({}));
      if (requestIdRef.current !== loadId) return;
      if (!response.ok) throw new Error(body.error || `Failed to load Final Writeup (${response.status})`);
      setData(body);
    } catch (loadError) {
      if (requestIdRef.current === loadId) {
        setError(loadError.message);
        setData(null);
      }
    } finally {
      if (requestIdRef.current === loadId) setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => {
      window.clearTimeout(timer);
      requestIdRef.current += 1;
    };
  }, [load]);

  const acknowledge = useCallback(async () => {
    const writeup = data?.selected;
    if (!writeup?.mayAcknowledge || saving) return;
    const generation = requestIdRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch('/api/workbench/final-writeup/acknowledgement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: writeup.requestId,
          expectedFinalArtifactId: writeup.finalArtifactId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (requestIdRef.current !== generation) return;
      if (!response.ok) throw new Error(body.error || `Failed to record review (${response.status})`);
      setSaving(false);
      await load();
    } catch (saveFailure) {
      if (requestIdRef.current === generation) setSaveError(saveFailure.message);
    } finally {
      if (requestIdRef.current === generation) setSaving(false);
    }
  }, [data, load, saving]);

  const writeup = data?.selected || null;
  return (
    <Layout title={writeup?.requestNumber ? `Final Writeup #${writeup.requestNumber}` : 'Final Writeup'} description="Focused Final Writeup review.">
      <div className="pb-16 pt-6 sm:pt-8">
        <Link
          href={buildWorkbenchHref({
            view: 'final-writeups',
            cycleCode: data?.cycles?.selected && data.cycles.selected !== NO_CYCLE ? data.cycles.selected : '',
            uncycled: data?.cycles?.selected === NO_CYCLE,
          })}
          className="text-sm font-medium text-gray-500 underline-offset-4 hover:text-gray-900 hover:underline"
        >
          ← Final Writeups
        </Link>
        <div className="mt-6">
          {loading ? <LoadingSurface message="Loading writeup…" /> : error ? (
            <ErrorSurface message={error} onRetry={load} />
          ) : writeup ? (
            <div className="space-y-6">
              <FocusedHeader writeup={writeup} cycles={data.cycles} />
              <FocusedDocument writeup={writeup} />
              <AcknowledgementPanel
                writeup={writeup}
                viewer={data.viewer}
                saving={saving}
                error={saveError}
                onAcknowledge={acknowledge}
              />
              <FocusedNavigation navigation={data.navigation} />
              <section aria-labelledby="reviewers-heading">
                <h2 id="reviewers-heading" className="mb-3 text-sm font-semibold text-gray-900">Review activity</h2>
                <ReviewerInitials reviewers={writeup.reviewers} />
              </section>
              <SupportingMaterials writeup={writeup} />
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
