/**
 * THESIS: Final Writeup staffing is one atomic operational configuration, not
 * another Admin panel. Responsibilities and program audiences share one draft,
 * one ETag, and one Publish action while remaining visibly distinct sections.
 * OWN-WORLD: Clear Workbench paper surfaces, fine gray rules, ink actions, and
 * amber only for unpublished, stale, or incomplete state.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FINAL_WRITEUP_PERSONA,
  FINAL_WRITEUP_PERSONA_ORDER,
} from '../../config/finalWriteupPersonas';
import useAdminUnsavedChangesGuard from './useAdminUnsavedChangesGuard';

const VERSION = 2;
const UNSAVED_WARNING = 'You have unsaved Final Writeup staffing changes. Leave without publishing?';
const RESPONSIBILITY_LABELS = Object.freeze({
  [FINAL_WRITEUP_PERSONA.PROGRAM_DIRECTOR]: 'Program Director',
  [FINAL_WRITEUP_PERSONA.PROGRAM_COORDINATOR]: 'Program Coordinator',
  [FINAL_WRITEUP_PERSONA.LEADERSHIP]: 'Leadership',
});

function normalizedConfig(personas, programs) {
  return {
    version: VERSION,
    personas: personas
      .map((assignment) => ({
        reviewerId: assignment.reviewerId,
        roles: FINAL_WRITEUP_PERSONA_ORDER.filter((role) => assignment.roles.includes(role)),
      }))
      .sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
    programs: programs
      .map((program) => ({
        grantProgramId: program.grantProgramId,
        reviewerIds: [...program.reviewerIds].sort(),
      }))
      .sort((left, right) => left.grantProgramId.localeCompare(right.grantProgramId)),
  };
}

export default function FinalWriteupMatrixAudiencesSection() {
  const loadSequence = useRef(0);
  const [programs, setPrograms] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [draftPersonas, setDraftPersonas] = useState([]);
  const [draftPrograms, setDraftPrograms] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [revision, setRevision] = useState(null);
  const [staleReferences, setStaleReferences] = useState({ grantProgramIds: [], reviewerIds: [] });
  const [baseline, setBaseline] = useState('');
  const [programToAdd, setProgramToAdd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const applyState = (data) => {
    const config = data.config || { version: VERSION, personas: [], programs: [] };
    const nextPersonas = config.personas || [];
    const nextPrograms = config.programs || [];
    setPrograms(data.programs || []);
    setReviewers(data.reviewers || []);
    setDraftPersonas(nextPersonas);
    setDraftPrograms(nextPrograms);
    setConfigured(data.configured === true);
    setMigrationRequired(data.migrationRequired === true);
    setRevision(data.revision ?? null);
    setStaleReferences(data.staleReferences || { grantProgramIds: [], reviewerIds: [] });
    setBaseline(data.migrationRequired === true
      ? '__stored_version_1__'
      : JSON.stringify(normalizedConfig(nextPersonas, nextPrograms)));
  };

  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/final-writeup-matrix-audiences');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Final Writeup staffing could not be loaded.');
      if (loadSequence.current === sequence) applyState(data);
    } catch (loadError) {
      if (loadSequence.current === sequence) setError(loadError.message);
    } finally {
      if (loadSequence.current === sequence) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => { loadSequence.current += 1; };
  }, []);

  const normalizedDraft = useMemo(
    () => normalizedConfig(draftPersonas, draftPrograms),
    [draftPersonas, draftPrograms],
  );
  const changed = baseline !== '' && baseline !== JSON.stringify(normalizedDraft);
  const selectedProgramIds = useMemo(
    () => new Set(draftPrograms.map((program) => program.grantProgramId)),
    [draftPrograms],
  );
  const availablePrograms = programs.filter((program) => !selectedProgramIds.has(program.grantProgramId));
  const assignmentById = useMemo(
    () => new Map(draftPersonas.map((assignment) => [assignment.reviewerId, assignment])),
    [draftPersonas],
  );
  const reviewerById = useMemo(
    () => new Map(reviewers.map((reviewer) => [reviewer.reviewerId, reviewer])),
    [reviewers],
  );
  const programById = useMemo(
    () => new Map(programs.map((program) => [program.grantProgramId, program])),
    [programs],
  );
  const unassignedReviewerIds = reviewers
    .map((reviewer) => reviewer.reviewerId)
    .filter((id) => !assignmentById.has(id));
  const hasEmptyAudience = draftPrograms.some((program) => program.reviewerIds.length === 0);
  const assignedCount = draftPersonas.filter((assignment) => assignment.roles.length > 0).length;
  const noLensCount = draftPersonas.filter((assignment) => assignment.roles.length === 0).length;
  const overlapCount = draftPersonas.filter((assignment) => assignment.roles.length > 1).length;

  useAdminUnsavedChangesGuard(changed, UNSAVED_WARNING);

  const toggleRole = (reviewerId, role) => {
    setDraftPersonas((current) => {
      const assignment = current.find((item) => item.reviewerId === reviewerId);
      if (!assignment) return [...current, { reviewerId, roles: [role] }];
      const selected = assignment.roles.includes(role);
      const roles = selected
        ? assignment.roles.filter((value) => value !== role)
        : [...assignment.roles, role];
      if (roles.length === 0) return current.filter((item) => item.reviewerId !== reviewerId);
      return current.map((item) => (item.reviewerId === reviewerId ? { ...item, roles } : item));
    });
    setNotice(null);
  };

  const toggleNoLens = (reviewerId) => {
    setDraftPersonas((current) => {
      const assignment = current.find((item) => item.reviewerId === reviewerId);
      if (assignment?.roles.length === 0) {
        return current.filter((item) => item.reviewerId !== reviewerId);
      }
      if (assignment) {
        return current.map((item) => (
          item.reviewerId === reviewerId ? { ...item, roles: [] } : item
        ));
      }
      return [...current, { reviewerId, roles: [] }];
    });
    setNotice(null);
  };

  const addProgram = () => {
    if (!programToAdd || selectedProgramIds.has(programToAdd)) return;
    setDraftPrograms((current) => [...current, {
      grantProgramId: programToAdd,
      reviewerIds: reviewers.map((reviewer) => reviewer.reviewerId),
    }]);
    setProgramToAdd('');
    setNotice(null);
  };

  const removeProgram = (grantProgramId) => {
    setDraftPrograms((current) => current.filter((program) => program.grantProgramId !== grantProgramId));
    setNotice(null);
  };

  const toggleReviewer = (grantProgramId, reviewerId) => {
    setDraftPrograms((current) => current.map((program) => {
      if (program.grantProgramId !== grantProgramId) return program;
      const selected = program.reviewerIds.includes(reviewerId);
      return {
        ...program,
        reviewerIds: selected
          ? program.reviewerIds.filter((id) => id !== reviewerId)
          : [...program.reviewerIds, reviewerId],
      };
    }));
    setNotice(null);
  };

  const removeStaleReferences = () => {
    const stalePrograms = new Set(staleReferences.grantProgramIds || []);
    const staleReviewers = new Set(staleReferences.reviewerIds || []);
    setDraftPersonas((current) => current.filter((assignment) => !staleReviewers.has(assignment.reviewerId)));
    setDraftPrograms((current) => current
      .filter((program) => !stalePrograms.has(program.grantProgramId))
      .map((program) => ({
        ...program,
        reviewerIds: program.reviewerIds.filter((id) => !staleReviewers.has(id)),
      })));
    setStaleReferences({ grantProgramIds: [], reviewerIds: [] });
    setNotice(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/final-writeup-matrix-audiences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: normalizedDraft, expectedRevision: revision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Final Writeup staffing could not be published.');
      applyState(data);
      setNotice('Final Writeup staffing published. Responsibilities and program audiences now share this revision.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading Final Writeup staffing…</p>;
  if (error && !baseline) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-700" role="alert">{error}</p>
        <button type="button" onClick={load} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-2 text-sm leading-6 text-gray-600">
        <p>
          Assign each current Final Writeup reviewer-role member an operational responsibility,
          then choose the expected reviewers for each Dataverse Grant Program.
        </p>
        <p>
          Names resolve live; the published setting stores only stable Dataverse IDs and exact
          responsibility values. Both sections publish together under one revision.
        </p>
      </div>

      {migrationRequired && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <p className="font-semibold">The live Research matrix is still stored as version 1.</p>
          <p className="mt-1">This draft preserves its program membership and adds the confirmed staffing assignments. The first publication upgrades both under the current ETag; persona lenses require the published version 2 staffing configuration.</p>
        </div>
      )}
      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <p className="font-semibold">Final Writeup staffing has not been published.</p>
          <p className="mt-1">Complete every staff row and add at least one Grant Program audience before publishing.</p>
        </div>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="text-sm font-medium text-green-700" role="status">{notice}</p>}

      {(staleReferences.grantProgramIds?.length > 0 || staleReferences.reviewerIds?.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
          <p className="font-semibold">Saved references need reconciliation.</p>
          <p className="mt-1">Unavailable staff and inactive programs are safely omitted at runtime. Remove them from this draft before the next publication.</p>
          <button type="button" onClick={removeStaleReferences} className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-700">
            Remove unavailable references from draft
          </button>
        </div>
      )}

      <section aria-labelledby="final-writeup-staff-responsibilities">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="final-writeup-staff-responsibilities" className="text-base font-semibold text-gray-950">Staff responsibilities</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">Responsibilities control dashboard lenses. They do not change Dataverse security or SharePoint file permissions.</p>
          </div>
          <p className="text-xs font-medium text-gray-500">
            {assignedCount} assigned · {overlapCount} overlapping · {noLensCount} no lens · {unassignedReviewerIds.length} incomplete
          </p>
        </div>
        <div className="mt-4 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {reviewers.map((reviewer) => {
            const assignment = assignmentById.get(reviewer.reviewerId);
            const roles = new Set(assignment?.roles || []);
            const noLens = assignment != null && assignment.roles.length === 0;
            return (
              <fieldset key={reviewer.reviewerId} className="grid gap-3 p-4 sm:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] sm:items-center">
                <legend className="sr-only">Responsibilities for {reviewer.name}</legend>
                <div>
                  <p className="text-sm font-semibold text-gray-950">{reviewer.name}</p>
                  {reviewer.initials && <p className="mt-0.5 text-xs text-gray-500">{reviewer.initials}</p>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {FINAL_WRITEUP_PERSONA_ORDER.map((role) => (
                    <label key={role} className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:border-gray-300">
                      <input
                        type="checkbox"
                        checked={roles.has(role)}
                        onChange={() => toggleRole(reviewer.reviewerId, role)}
                        className="h-4 w-4"
                      />
                      <span>{RESPONSIBILITY_LABELS[role]}</span>
                    </label>
                  ))}
                  <label className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 hover:border-gray-300">
                    <input
                      type="checkbox"
                      checked={noLens}
                      onChange={() => toggleNoLens(reviewer.reviewerId)}
                      className="h-4 w-4"
                    />
                    <span>No persona lens</span>
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
        {unassignedReviewerIds.length > 0 && (
          <p className="mt-3 text-sm font-medium text-red-700" role="alert">Choose at least one responsibility or No persona lens for every staff member.</p>
        )}
      </section>

      <section aria-labelledby="final-writeup-program-audiences" className="space-y-4">
        <div>
          <h3 id="final-writeup-program-audiences" className="text-base font-semibold text-gray-950">Program review audiences</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">The request’s broad Grant Program selects the reviewer columns shown in the neutral coordinator matrix.</p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label htmlFor="final-writeup-program-to-add" className="block text-sm font-semibold text-gray-900">Add a Grant Program audience</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <select
              id="final-writeup-program-to-add"
              value={programToAdd}
              onChange={(event) => setProgramToAdd(event.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              <option value="">Select a Dataverse Grant Program</option>
              {availablePrograms.map((program) => (
                <option key={program.grantProgramId} value={program.grantProgramId}>{program.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={addProgram}
              disabled={!programToAdd}
              className="min-h-11 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add program
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {draftPrograms.map((program) => {
            const definition = programById.get(program.grantProgramId);
            const selected = new Set(program.reviewerIds);
            return (
              <section key={program.grantProgramId} className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
                  <div>
                    <h4 className="font-semibold text-gray-900">{definition?.name || 'Unavailable Grant Program'}</h4>
                    <p className="mt-1 text-xs text-gray-500">{program.reviewerIds.length} expected reviewer{program.reviewerIds.length === 1 ? '' : 's'}</p>
                  </div>
                  <button type="button" onClick={() => removeProgram(program.grantProgramId)} className="text-sm font-semibold text-red-700 underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-red-600">
                    Remove program
                  </button>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-sm font-semibold text-gray-800">Expected reviewers</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {reviewers.map((reviewer) => (
                      <label key={reviewer.reviewerId} className="flex min-h-14 items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm hover:border-gray-300">
                        <input
                          type="checkbox"
                          checked={selected.has(reviewer.reviewerId)}
                          onChange={() => toggleReviewer(program.grantProgramId, reviewer.reviewerId)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          <span className="block font-medium text-gray-900">{reviewer.name}</span>
                          {reviewer.initials && <span className="block text-xs text-gray-500">{reviewer.initials}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  {program.reviewerIds.length === 0 && (
                    <p className="mt-3 text-sm font-medium text-red-700" role="alert">Select at least one reviewer or remove this Grant Program.</p>
                  )}
                  {program.reviewerIds.some((id) => !reviewerById.has(id)) && (
                    <p className="mt-3 text-sm font-medium text-amber-800">This draft still contains an unavailable reviewer reference.</p>
                  )}
                </fieldset>
              </section>
            );
          })}
          {draftPrograms.length === 0 && (
            <p className="rounded-xl border border-dashed border-gray-300 px-5 py-8 text-center text-sm text-gray-500">No program-specific audiences are in this draft.</p>
          )}
        </div>
      </section>

      <div className="sticky bottom-3 flex flex-col gap-3 rounded-xl border border-gray-300 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{reviewers.length} staff · {draftPrograms.length} Grant Program audience{draftPrograms.length === 1 ? '' : 's'}</p>
          <p className={`mt-0.5 text-xs font-medium ${changed ? 'text-amber-700' : 'text-green-700'}`} role="status">{changed ? 'Unpublished changes' : 'Published revision loaded'}</p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed || hasEmptyAudience || unassignedReviewerIds.length > 0 || draftPrograms.length === 0}
          className="min-h-11 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Publishing…' : 'Publish Final Writeup staffing'}
        </button>
      </div>
    </div>
  );
}
