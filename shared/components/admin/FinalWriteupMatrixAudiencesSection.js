/**
 * THESIS: configure one explicit reviewer audience per Dataverse Grant Program;
 * never make administrators mentally merge a global roster with exceptions.
 * OWN-WORLD: Clear Workbench paper surfaces, fine gray rules, ink actions, and
 * amber only for unpublished or incomplete state.
 * STORY: add Research or Southern California, choose its reviewers, then publish
 * one complete replacement configuration with immediate matrix effect.
 * FIRST VIEWPORT: operating explanation, configuration state, program picker,
 * then the first audience editor; Save remains anchored at the section foot.
 * FORM: narrow Admin-surface extension in the incumbent operational grammar.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useAdminUnsavedChangesGuard from './useAdminUnsavedChangesGuard';

const VERSION = 1;
const UNSAVED_WARNING = 'You have unsaved Final Writeup audience changes. Leave without saving?';

function normalizedConfig(programs) {
  return {
    version: VERSION,
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
  const [draftPrograms, setDraftPrograms] = useState([]);
  const [configured, setConfigured] = useState(false);
  const [revision, setRevision] = useState(null);
  const [staleReferences, setStaleReferences] = useState({ grantProgramIds: [], reviewerIds: [] });
  const [baseline, setBaseline] = useState('');
  const [programToAdd, setProgramToAdd] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const applyState = (data) => {
    const config = data.config || { version: VERSION, programs: [] };
    setPrograms(data.programs || []);
    setReviewers(data.reviewers || []);
    setDraftPrograms(config.programs || []);
    setConfigured(data.configured === true);
    setRevision(data.revision ?? null);
    setStaleReferences(data.staleReferences || { grantProgramIds: [], reviewerIds: [] });
    setBaseline(JSON.stringify(normalizedConfig(config.programs || [])));
  };

  const load = async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/final-writeup-matrix-audiences');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Matrix audiences could not be loaded.');
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

  const changed = baseline !== ''
    && baseline !== JSON.stringify(normalizedConfig(draftPrograms));
  const selectedProgramIds = useMemo(
    () => new Set(draftPrograms.map((program) => program.grantProgramId)),
    [draftPrograms],
  );
  const availablePrograms = programs.filter((program) => !selectedProgramIds.has(program.grantProgramId));
  const reviewerById = useMemo(
    () => new Map(reviewers.map((reviewer) => [reviewer.reviewerId, reviewer])),
    [reviewers],
  );
  const programById = useMemo(
    () => new Map(programs.map((program) => [program.grantProgramId, program])),
    [programs],
  );
  const hasEmptyAudience = draftPrograms.some((program) => program.reviewerIds.length === 0);

  useAdminUnsavedChangesGuard(changed, UNSAVED_WARNING);

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
        body: JSON.stringify({
          config: normalizedConfig(draftPrograms),
          expectedRevision: revision,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Matrix audiences could not be saved.');
      applyState(data);
      setNotice('Program audiences published. The coordinator matrix now uses this configuration.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading matrix audiences…</p>;
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
    <div className="space-y-6">
      <div className="max-w-3xl space-y-2 text-sm leading-6 text-gray-600">
        <p>
          Choose the expected Final Writeup reviewers separately for each Dataverse Grant Program.
          The request’s Grant Program selects the matching matrix; names resolve live while the saved
          configuration keeps stable Dataverse IDs.
        </p>
        <p>
          Adding a program starts with every current reviewer-role member selected. Uncheck staff who
          do not review that program, then publish the complete configuration.
        </p>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <p className="font-semibold">The matrix is still using the reviewer-role default.</p>
          <p className="mt-1">Add Research and Southern California here, adjust each audience, and save to turn on program-specific matrices.</p>
        </div>
      )}
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="text-sm font-medium text-green-700" role="status">{notice}</p>}

      {(staleReferences.grantProgramIds?.length > 0 || staleReferences.reviewerIds?.length > 0) && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
          <p className="font-semibold">Saved references need reconciliation.</p>
          <p className="mt-1">A saved program is inactive or a saved reviewer is no longer an enabled member of the Final Writeup reviewer role. The matrix fails closed until these references are removed.</p>
          <button type="button" onClick={removeStaleReferences} className="mt-3 rounded-lg border border-amber-400 bg-white px-3 py-2 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-700">
            Remove unavailable references from draft
          </button>
        </div>
      )}

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
                  <h3 className="font-semibold text-gray-900">{definition?.name || 'Unavailable Grant Program'}</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {program.reviewerIds.length} expected reviewer{program.reviewerIds.length === 1 ? '' : 's'}
                  </p>
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
          <p className="rounded-xl border border-dashed border-gray-300 px-5 py-8 text-center text-sm text-gray-500">
            No program-specific audiences are in this draft.
          </p>
        )}
      </div>

      <div className="sticky bottom-3 flex flex-col gap-3 rounded-xl border border-gray-300 bg-white/95 p-4 shadow-lg backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">{draftPrograms.length} Grant Program audience{draftPrograms.length === 1 ? '' : 's'}</p>
          <p className={`mt-0.5 text-xs font-medium ${changed ? 'text-amber-700' : 'text-green-700'}`} role="status">
            {changed ? 'Unsaved changes' : 'All changes saved'}
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving || !changed || hasEmptyAudience || draftPrograms.length === 0}
          className="min-h-11 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Publishing…' : 'Publish audiences'}
        </button>
      </div>
    </div>
  );
}
