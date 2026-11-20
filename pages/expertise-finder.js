import Link from 'next/link';
import Layout from '../shared/components/Layout';

export default function ExpertiseFinderRetiredPage() {
  return (
    <Layout title="Expertise Finder retired">
      <main className="mx-auto max-w-3xl px-6 py-12 space-y-4">
        <h1 className="text-2xl font-semibold">Expertise Finder has been retired</h1>
        <p>Standalone proposal matching is no longer available. Administrators maintain the shared expertise roster in Admin.</p>
        <Link className="text-blue-700 underline" href="/admin?workspace=people&view=expertise-roster">Open Admin roster</Link>
      </main>
    </Layout>
  );
}
