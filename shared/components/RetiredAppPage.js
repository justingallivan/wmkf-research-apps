import Link from 'next/link';
import Layout from './Layout';

/** Notice for retained bookmarks; retired application code is never imported. */
export default function RetiredAppPage({ name }) {
  return (
    <Layout title={`${name} retired`}>
      <section className="mx-auto max-w-3xl space-y-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">{name} has been retired</h1>
        <p>This standalone tool is no longer available.</p>
        <Link className="text-blue-700 underline" href="/">Return Home</Link>
      </section>
    </Layout>
  );
}
