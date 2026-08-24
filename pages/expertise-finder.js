import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Layout, { PageHeader, Card, Button } from '../shared/components/Layout';
import FileUploaderSimple from '../shared/components/FileUploaderSimple';
import RequireAppAccess from '../shared/components/RequireAppAccess';
import ErrorAlert from '../shared/components/ErrorAlert';

// ─── Tab Component ───

function Tab({ label, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-6 py-3 font-medium text-sm
        border-b-2 transition-all duration-200
        ${active
          ? 'border-gray-900 text-gray-900 bg-gray-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
        }
      `}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Match Results Display ───

function MatchResults({ results, metadata }) {
  if (!results) return null;

  const { proposal_summary, staff_assignment, consultant_overlap, board_interest, expertise_gaps, conflicts } = results;

  return (
    <div className="space-y-6">
      {/* Proposal Summary */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Proposal Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div><span className="font-medium text-gray-600">Title:</span> <span className="text-gray-900">{proposal_summary?.title}</span></div>
          <div><span className="font-medium text-gray-600">Program:</span> <span className="text-gray-900">{proposal_summary?.program}</span></div>
          <div><span className="font-medium text-gray-600">PI:</span> <span className="text-gray-900">{proposal_summary?.pi_name}</span></div>
          <div><span className="font-medium text-gray-600">Institution:</span> <span className="text-gray-900">{proposal_summary?.institution}</span></div>
        </div>
        {proposal_summary?.core_question && (
          <p className="mt-3 text-sm text-gray-700"><span className="font-medium text-gray-600">Core Question:</span> {proposal_summary.core_question}</p>
        )}
        {proposal_summary?.key_methods?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {proposal_summary.key_methods.map((m, i) => (
              <span key={i} className="inline-flex px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">{m}</span>
            ))}
          </div>
        )}
      </Card>

      {/* Staff Assignment */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Staff Assignment</h3>
        <div className="space-y-4">
          {staff_assignment?.primary && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase text-green-700">Primary PD</span>
              </div>
              <p className="font-medium text-gray-900">{staff_assignment.primary.name}</p>
              <p className="text-sm text-gray-700 mt-1">{staff_assignment.primary.rationale}</p>
            </div>
          )}
          {staff_assignment?.secondary && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase text-blue-700">Secondary PD</span>
              </div>
              <p className="font-medium text-gray-900">{staff_assignment.secondary.name}</p>
              <p className="text-sm text-gray-700 mt-1">{staff_assignment.secondary.rationale}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Consultant Overlap */}
      {consultant_overlap?.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Consultant Overlap</h3>
          <div className="space-y-3">
            {consultant_overlap.map((c, i) => (
              <div key={i} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-medium text-gray-900">{c.name}</p>
                  <span className={`inline-flex px-2 py-0.5 text-xs rounded font-medium ${
                    c.relevance === 'strong' ? 'bg-amber-200 text-amber-800' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {c.relevance}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{c.rationale}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {consultant_overlap?.length === 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Consultant Overlap</h3>
          <p className="text-sm text-gray-500">No consultant overlap identified for this proposal.</p>
        </Card>
      )}

      {/* Board Interest */}
      {board_interest?.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Board Interest</h3>
          <div className="space-y-3">
            {board_interest.map((b, i) => (
              <div key={i} className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="font-medium text-gray-900">{b.name}</p>
                <p className="text-sm text-gray-700 mt-1">{b.rationale}</p>
                {b.note && <p className="text-xs text-purple-600 mt-1 italic">{b.note}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Expertise Gaps */}
      {expertise_gaps?.has_gaps && (
        <Card>
          <h3 className="text-lg font-semibold text-red-700 mb-2">Expertise Gaps</h3>
          <p className="text-sm text-gray-700">{expertise_gaps.description}</p>
        </Card>
      )}

      {/* Conflicts */}
      {conflicts?.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-red-700 mb-2">Conflicts</h3>
          <div className="space-y-2">
            {conflicts.map((c, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium text-gray-900">{c.name}</span>
                <span className="text-gray-600"> &mdash; {c.reason}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Metadata */}
      {metadata && (
        <div className="text-xs text-gray-400 flex flex-wrap gap-4">
          <span>Model: {metadata.model}</span>
          <span>Tokens: {metadata.inputTokens?.toLocaleString()} in / {metadata.outputTokens?.toLocaleString()} out</span>
          <span>Cost: ${(metadata.estimatedCostCents / 100).toFixed(4)}</span>
          <span>Latency: {(metadata.latencyMs / 1000).toFixed(1)}s</span>
          <span>Roster: {metadata.rosterSize} members</span>
        </div>
      )}
    </div>
  );
}

// ─── Match Tab ───

function MatchTab() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [metadata, setMetadata] = useState(null);

  const handleFilesUploaded = useCallback((uploadedFiles) => {
    setSelectedFiles(uploadedFiles);
    setError(null);
    setResults(null);
    setMetadata(null);
  }, []);

  const handleMatch = async () => {
    if (selectedFiles.length === 0) {
      setError('Please upload a proposal PDF');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/expertise-finder/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: { url: selectedFiles[0].url, filename: selectedFiles[0].filename },
          additionalNotes: additionalNotes.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      setResults(data.results);
      setMetadata(data.metadata);
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Upload Proposal</h3>
        <p className="text-sm text-gray-500 mb-4">
          Upload a grant proposal PDF to find the best staff assignment, consultant overlap, and board interest.
        </p>
        <FileUploaderSimple
          onFilesUploaded={handleFilesUploaded}
          multiple={false}
          accept=".pdf"
        />
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Additional Notes (optional)</h3>
        <textarea
          value={additionalNotes}
          onChange={(e) => setAdditionalNotes(e.target.value)}
          placeholder="Any context to guide the matching (e.g., known conflicts, specific areas to focus on)..."
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
          rows={3}
        />
      </Card>

      <Button
        onClick={handleMatch}
        disabled={processing || selectedFiles.length === 0}
        className="w-full"
      >
        {processing ? 'Matching...' : 'Find Matches'}
      </Button>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      <MatchResults results={results} metadata={metadata} />
    </div>
  );
}

// ─── Roster Tab ───

function RosterTab() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchRoster = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('roleType', roleFilter);
      params.set('limit', '500');

      const response = await fetch(`/api/expertise-finder/roster?${params}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);
      setMembers(data.members);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter]);

  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  const handleEdit = (member) => {
    setEditingId(member.id);
    setEditForm({ ...member });
    setExpandedId(member.id);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/expertise-finder/roster', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setMembers(prev => prev.map(m => m.id === editForm.id ? data.member : m));
      setEditingId(null);
      setEditForm({});
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Deactivate "${name}"? This can be undone.`)) return;

    try {
      const response = await fetch('/api/expertise-finder/roster', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setMembers(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAdd = async (formData) => {
    setSaving(true);
    try {
      const response = await fetch('/api/expertise-finder/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setMembers(prev => [...prev, data.member]);
      setShowAddForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const roleTypes = ['Consultant', 'Board', 'Research Program Staff'];

  const roleBadgeColor = (roleType) => {
    switch (roleType) {
      case 'Consultant': return 'bg-amber-100 text-amber-800';
      case 'Board': return 'bg-purple-100 text-purple-800';
      case 'Research Program Staff': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, affiliation, or expertise..."
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Roles</option>
          {roleTypes.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Cancel' : '+ Add Member'}
        </Button>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Add Form */}
      {showAddForm && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Add New Roster Member</h3>
          <RosterForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} saving={saving} roleTypes={roleTypes} />
        </Card>
      )}

      {/* Member Count */}
      <p className="text-sm text-gray-500">{members.length} members</p>

      {/* Roster List */}
      {loading ? (
        <p className="text-sm text-gray-400 py-8 text-center">Loading roster...</p>
      ) : (
        <div className="space-y-2">
          {members.map(member => (
            <div key={member.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              {/* Summary Row */}
              <div
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => setExpandedId(expandedId === member.id ? null : member.id)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{member.name}</p>
                    <p className="text-sm text-gray-500 truncate">{member.role}{member.affiliation ? `, ${member.affiliation}` : ''}</p>
                    {member.preferred_email && (
                      <p className="text-xs text-gray-500 truncate">{member.preferred_email}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${roleBadgeColor(member.role_type)}`}>
                    {member.role_type}
                  </span>
                  <span className="text-gray-400 text-sm">{expandedId === member.id ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedId === member.id && (
                <div className="px-4 pb-4 border-t border-gray-100">
                  {editingId === member.id ? (
                    <div className="pt-4">
                      <RosterForm
                        initialData={editForm}
                        onChange={setEditForm}
                        onSubmit={handleSaveEdit}
                        onCancel={() => { setEditingId(null); setEditForm({}); }}
                        saving={saving}
                        roleTypes={roleTypes}
                        isEdit
                      />
                    </div>
                  ) : (
                    <div className="pt-4 space-y-3">
                      {member.primary_fields && (
                        <DetailRow label="Primary Fields" value={member.primary_fields} />
                      )}
                      {member.preferred_email && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 uppercase">Preferred Email</span>
                          <p className="text-sm">
                            <a
                              href={`mailto:${member.preferred_email}`}
                              className="text-blue-600 hover:underline"
                            >
                              {member.preferred_email}
                            </a>
                          </p>
                        </div>
                      )}
                      {member.keywords && (
                        <div>
                          <span className="text-xs font-medium text-gray-500 uppercase">Keywords</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {member.keywords.split(';').map((kw, i) => (
                              <span key={i} className="inline-flex px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded">{kw.trim()}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {member.subfields_specialties && (
                        <DetailRow label="Subfields" value={member.subfields_specialties} />
                      )}
                      {member.methods_techniques && (
                        <DetailRow label="Methods" value={member.methods_techniques} />
                      )}
                      {member.expertise && (
                        <DetailRow label="Expertise" value={member.expertise} />
                      )}
                      {member.distinctions && (
                        <DetailRow label="Distinctions" value={member.distinctions} />
                      )}
                      {member.orcid && member.orcid !== 'N/A' && (
                        <DetailRow label="ORCID" value={member.orcid} isLink />
                      )}
                      {member.keck_affiliation && (
                        <DetailRow label="Keck Affiliation" value={member.keck_affiliation} />
                      )}

                      <div className="flex gap-2 pt-2">
                        <button
                          onClick={() => handleEdit(member)}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(member.id, member.name)}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Deactivate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, isLink }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-500 uppercase">{label}</span>
      {isLink ? (
        <p className="text-sm"><a href={value} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{value}</a></p>
      ) : (
        <p className="text-sm text-gray-700">{value}</p>
      )}
    </div>
  );
}

// ─── Roster Form (shared for Add and Edit) ───

function RosterForm({ initialData, onChange, onSubmit, onCancel, saving, roleTypes, isEdit }) {
  const [form, setForm] = useState(initialData || {
    name: '', preferred_email: '', role_type: 'Consultant', role: '', affiliation: '', orcid: '',
    primary_fields: '', keywords: '', subfields_specialties: '',
    methods_techniques: '', distinctions: '', expertise: '',
    keck_affiliation: '', keck_affiliation_details: '',
  });

  const updateField = (field, value) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (onChange) onChange(updated);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(form);
  };

  const fieldClass = "w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input type="text" required value={form.name} onChange={(e) => updateField('name', e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Email</label>
          <input
            type="email"
            value={form.preferred_email || ''}
            onChange={(e) => updateField('preferred_email', e.target.value)}
            className={fieldClass}
            placeholder="Preferred Site Visit correspondence address"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role Type *</label>
          <select value={form.role_type} onChange={(e) => updateField('role_type', e.target.value)} className={fieldClass}>
            {roleTypes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title/Role</label>
          <input type="text" value={form.role || ''} onChange={(e) => updateField('role', e.target.value)} className={fieldClass} placeholder="e.g., Professor" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Affiliation</label>
          <input type="text" value={form.affiliation || ''} onChange={(e) => updateField('affiliation', e.target.value)} className={fieldClass} placeholder="Institution name" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ORCID</label>
          <input type="text" value={form.orcid || ''} onChange={(e) => updateField('orcid', e.target.value)} className={fieldClass} placeholder="https://orcid.org/..." />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Keck Affiliation</label>
          <input type="text" value={form.keck_affiliation || ''} onChange={(e) => updateField('keck_affiliation', e.target.value)} className={fieldClass} placeholder="e.g., Past Grantee, Board Member" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Primary Fields</label>
        <input type="text" value={form.primary_fields || ''} onChange={(e) => updateField('primary_fields', e.target.value)} className={fieldClass} placeholder="2-4 broad areas; semicolon-delimited" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Keywords (5-6 terms; semicolon-delimited)</label>
        <input type="text" value={form.keywords || ''} onChange={(e) => updateField('keywords', e.target.value)} className={fieldClass} placeholder="term1; term2; term3" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Subfields & Specialties</label>
        <textarea value={form.subfields_specialties || ''} onChange={(e) => updateField('subfields_specialties', e.target.value)} className={fieldClass} rows={2} placeholder="Semicolon-delimited detailed areas" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Methods & Techniques</label>
        <textarea value={form.methods_techniques || ''} onChange={(e) => updateField('methods_techniques', e.target.value)} className={fieldClass} rows={2} placeholder="Semicolon-delimited methods" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Expertise Summary</label>
        <textarea value={form.expertise || ''} onChange={(e) => updateField('expertise', e.target.value)} className={fieldClass} rows={3} placeholder="Domain-level summary paragraph" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Distinctions</label>
        <textarea value={form.distinctions || ''} onChange={(e) => updateField('distinctions', e.target.value)} className={fieldClass} rows={2} placeholder="Fellowships and honors; semicolon-delimited" />
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Member'}
        </Button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Batch Tab ───

function BatchTab() {
  const [fiscalYear, setFiscalYear] = useState('December 2025');
  const [program, setProgram] = useState('SE');
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState({}); // keyed by requestId
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const abortRef = useRef(false);

  // Generate cycle options (current year back to 2020)
  const cycleOptions = useMemo(() => {
    const cycles = [];
    const currentYear = new Date().getFullYear();
    for (let year = currentYear; year >= 2020; year--) {
      cycles.push({ value: `December ${year}`, label: `D${year % 100} - December ${year}` });
      cycles.push({ value: `June ${year}`, label: `J${year % 100} - June ${year}` });
    }
    return cycles;
  }, []);

  const loadProposals = async () => {
    setLoading(true);
    setError(null);
    setProposals([]);
    setResults({});
    setExpandedId(null);

    try {
      const params = new URLSearchParams({ fiscalYear, program });
      const response = await fetch(`/api/expertise-finder/proposals?${params}`);
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setProposals(data.proposals || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const runBatch = async () => {
    const unprocessed = proposals.filter(p => !results[p.requestId]);
    if (unprocessed.length === 0) return;

    setProcessing(true);
    abortRef.current = false;
    setProgress({ current: 0, total: unprocessed.length });

    for (let i = 0; i < unprocessed.length; i++) {
      if (abortRef.current) break;

      const proposal = unprocessed[i];
      setProgress({ current: i + 1, total: unprocessed.length });

      try {
        const response = await fetch('/api/expertise-finder/batch-match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: proposal.requestId,
            requestNumber: proposal.requestNumber,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          setResults(prev => ({
            ...prev,
            [proposal.requestId]: { error: data.error, availableFiles: data.availableFiles },
          }));
        } else {
          setResults(prev => ({
            ...prev,
            [proposal.requestId]: { success: true, ...data },
          }));
        }
      } catch (err) {
        setResults(prev => ({
          ...prev,
          [proposal.requestId]: { error: err.message },
        }));
      }
    }

    setProcessing(false);
  };

  const stopBatch = () => {
    abortRef.current = true;
  };

  const exportCsv = () => {
    const headers = [
      'Request Number', 'Title', 'PI', 'Institution', 'Phase I Status',
      'Actual PD', 'AI Primary PD', 'AI Primary PD Rationale',
      'AI Secondary PD', 'AI Secondary PD Rationale',
      'Consultant Names', 'Consultant Details',
      'Board Member Names', 'Board Member Details',
      'Expertise Gaps', 'Status',
    ];

    const rows = proposals.map(p => {
      const r = results[p.requestId];
      const match = r?.results;
      const staff = match?.staff_assignment;
      const consultants = match?.consultant_overlap || [];
      const board = match?.board_interest || [];
      const gaps = match?.expertise_gaps?.has_gaps ? match.expertise_gaps.description : '';

      return [
        p.requestNumber,
        p.title,
        p.pi,
        p.institution,
        p.phaseIStatus,
        p.actualPd,
        staff?.primary?.name || '',
        staff?.primary?.rationale || '',
        staff?.secondary?.name || '',
        staff?.secondary?.rationale || '',
        consultants.map(c => c.name).join('; '),
        consultants.map(c => `${c.name} (${c.relevance}): ${c.rationale}`).join('; '),
        board.map(b => b.name).join('; '),
        board.map(b => `${b.name}: ${b.rationale}`).join('; '),
        gaps,
        r ? (r.success ? 'Matched' : `Error: ${r.error}`) : 'Pending',
      ];
    });

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expertise_batch_${program}_${fiscalYear.replace(/\s/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const completedCount = Object.values(results).filter(r => r.success).length;
  const errorCount = Object.values(results).filter(r => r.error).length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Query Dynamics Proposals</h3>
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Grant Cycle</label>
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {cycleOptions.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
            <select
              value={program}
              onChange={(e) => setProgram(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="SE">SE - Science & Engineering</option>
              <option value="MR">MR - Medical Research</option>
            </select>
          </div>
          <Button onClick={loadProposals} disabled={loading}>
            {loading ? 'Loading...' : 'Load Proposals'}
          </Button>
        </div>
      </Card>

      {error && <ErrorAlert message={error} onDismiss={() => setError(null)} />}

      {/* Proposal List */}
      {proposals.length > 0 && (
        <>
          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              {proposals.length} proposal{proposals.length !== 1 ? 's' : ''} found
              {completedCount > 0 && (
                <span className="ml-2 text-green-600">&middot; {completedCount} matched</span>
              )}
              {errorCount > 0 && (
                <span className="ml-2 text-red-600">&middot; {errorCount} errors</span>
              )}
            </div>
            <div className="flex gap-2">
              {Object.keys(results).length > 0 && (
                <Button onClick={exportCsv}>Export CSV</Button>
              )}
              {processing ? (
                <button
                  onClick={stopBatch}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
                >
                  Stop
                </button>
              ) : (
                <Button onClick={runBatch} disabled={completedCount === proposals.length}>
                  {completedCount > 0 ? `Resume (${proposals.length - completedCount - errorCount} remaining)` : 'Run All'}
                </Button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {processing && (
            <div className="space-y-1">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                Processing {progress.current} of {progress.total}...
              </p>
            </div>
          )}

          {/* Results Table */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Request</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">PI</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Phase I Status</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Actual PD</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">AI Primary PD</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {proposals.map(p => {
                    const r = results[p.requestId];
                    const primaryPd = r?.results?.staff_assignment?.primary?.name;
                    const isExpanded = expandedId === p.requestId;

                    return (
                      <tr key={p.requestId} className="group">
                        <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{p.requestNumber}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{p.title}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{p.pi}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 text-xs rounded-full font-medium ${
                            p.phaseIStatus === 'Invited' ? 'bg-green-100 text-green-800' :
                            p.phaseIStatus === 'Not Invited' ? 'bg-red-100 text-red-800' :
                            p.phaseIStatus?.includes('Recommended') ? 'bg-blue-100 text-blue-800' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {p.phaseIStatus || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{p.actualPd || '—'}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {r?.success ? (
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : p.requestId)}
                              className="text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {primaryPd || '—'}
                            </button>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {!r && !processing && <span className="text-gray-400">Pending</span>}
                          {!r && processing && progress.current <= proposals.indexOf(p) && (
                            <span className="text-gray-400">Waiting</span>
                          )}
                          {!r && processing && progress.current > proposals.indexOf(p) && (
                            <span className="text-blue-600">Processing...</span>
                          )}
                          {r?.success && <span className="text-green-600">Done</span>}
                          {r?.error && (
                            <span className="text-red-600 cursor-help" title={r.error}>Error</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Expanded Detail */}
          {expandedId && results[expandedId]?.success && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {proposals.find(p => p.requestId === expandedId)?.requestNumber} — Match Details
                </h3>
                <button
                  onClick={() => setExpandedId(null)}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  Close
                </button>
              </div>
              <MatchResults
                results={results[expandedId].results}
                metadata={results[expandedId].metadata}
              />
            </Card>
          )}
        </>
      )}

      {/* Empty state */}
      {!loading && proposals.length === 0 && !error && (
        <Card>
          <p className="text-sm text-gray-500 text-center py-8">
            Select a grant cycle and program, then click Load Proposals to query Dynamics.
          </p>
        </Card>
      )}
    </div>
  );
}

// ─── History Tab ───

function HistoryTab() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const response = await fetch('/api/expertise-finder/history');
        const data = await response.json();
        if (response.ok) {
          setMatches(data.matches || []);
        }
      } catch (err) {
        console.error('Failed to fetch match history:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchHistory();
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">Loading history...</p>;

  if (matches.length === 0) {
    return (
      <Card>
        <p className="text-sm text-gray-500 text-center py-8">No matching history yet. Upload a proposal to get started.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {matches.map(match => (
        <div key={match.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <div
            className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
            onClick={() => setExpandedId(expandedId === match.id ? null : match.id)}
          >
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">{match.proposal_title || 'Untitled'}</p>
              <p className="text-xs text-gray-500">
                {match.proposal_filename} &middot; {new Date(match.created_at).toLocaleDateString()} &middot; {match.model_used}
              </p>
            </div>
            <span className="text-gray-400 text-sm flex-shrink-0">{expandedId === match.id ? '▲' : '▼'}</span>
          </div>

          {expandedId === match.id && match.match_results && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-4">
              <MatchResults
                results={match.match_results}
                metadata={{
                  model: match.model_used,
                  inputTokens: match.input_tokens,
                  outputTokens: match.output_tokens,
                  estimatedCostCents: parseFloat(match.estimated_cost_cents),
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───

function ExpertiseFinderPage() {
  const [activeTab, setActiveTab] = useState('match');

  const tabs = [
    { id: 'match', label: 'Match Proposal', icon: '🎯' },
    { id: 'batch', label: 'Batch', icon: '📊' },
    { id: 'roster', label: 'Roster', icon: '👥' },
    { id: 'history', label: 'History', icon: '📋' },
  ];

  return (
    <Layout
      title="WMKF Expertise"
      description="Match grant proposals to internal staff, consultants, and board members"
    >
      <PageHeader
        title="WMKF Expertise"
        subtitle="AI-powered matching of proposals to staff, consultants, and board members"
        icon="🧠"
      />

      <div className="py-8 space-y-6">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            {tabs.map(tab => (
              <Tab
                key={tab.id}
                label={tab.label}
                icon={tab.icon}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="min-h-[400px]">
          {activeTab === 'match' && <MatchTab />}
          {activeTab === 'batch' && <BatchTab />}
          {activeTab === 'roster' && <RosterTab />}
          {activeTab === 'history' && <HistoryTab />}
        </div>
      </div>
    </Layout>
  );
}

export default function ExpertiseFinderGuard() {
  return <RequireAppAccess appKey="expertise-finder"><ExpertiseFinderPage /></RequireAppAccess>;
}
