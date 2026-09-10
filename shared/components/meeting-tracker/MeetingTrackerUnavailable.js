import Link from 'next/link';
import Layout, { Card } from '../Layout';

export default function MeetingTrackerUnavailable() {
  return (
    <Layout title="Meeting Tracker">
      <div className="mx-auto max-w-2xl py-16">
        <Card hover={false} className="text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v3m10-3v3M4.5 9.5h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900">Meeting Tracker is not yet enabled</h1>
          <p className="mx-auto mt-3 max-w-lg text-gray-600">
            The meeting schedule is being prepared for this environment. Return to the home page for the tools that are available now.
          </p>
          <Link href="/" className="mt-6 inline-flex rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2">
            Return home
          </Link>
        </Card>
      </div>
    </Layout>
  );
}
