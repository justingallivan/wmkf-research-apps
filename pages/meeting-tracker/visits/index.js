/**
 * `/meeting-tracker/visits` has no index of its own: the dashboard at
 * `/meeting-tracker` lists visits and links to each `/visits/<id>`. A trimmed
 * URL used to 404; redirect to the dashboard, keeping its two filter keys.
 */
const first = (value) => (Array.isArray(value) ? value[0] : value);

export async function getServerSideProps({ query }) {
  const params = new URLSearchParams();
  for (const key of ['cycleCode', 'programId']) {
    const value = String(first(query[key]) || '').trim();
    if (value) params.set(key, value);
  }
  return { redirect: { destination: `/meeting-tracker${params.size ? `?${params}` : ''}`, permanent: false } };
}

export default function MeetingTrackerVisitsIndexRedirect() {
  return null;
}
