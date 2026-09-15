export function buildRosterSubmitPayload(form, { isEdit = false, contactLinkDirty = false } = {}) {
  const payload = { ...form };
  if (isEdit && !contactLinkDirty) delete payload.dataverse_contact_id;
  return payload;
}
