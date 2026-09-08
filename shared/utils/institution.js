/** Prefer the organization unless Dataverse contains its N/A placeholder. */
export function preferApplicantInstitution(organization, applicant) {
  const primary = String(organization || '').trim();
  if (primary && primary.toLowerCase() !== 'n/a') return primary;
  return String(applicant || '').trim() || null;
}
