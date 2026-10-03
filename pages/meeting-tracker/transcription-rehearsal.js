import MeetingTranscriptionPanel from '../../shared/components/meeting-tracker/MeetingTranscriptionPanel';
import { isMeetingTranscriptionRehearsalReady } from '../../lib/services/meeting-tracker-transcription/test-deployment-policy';
import { REHEARSAL_REQUEST_ID } from '../../lib/services/meeting-tracker-transcription/rehearsal-fixture';

const API_BASE_PATH = '/api/meeting-transcription-rehearsal';

export async function getServerSideProps() {
  if (!isMeetingTranscriptionRehearsalReady()) return { notFound: true };
  return { props: { rehearsalEnabled: true } };
}

export default function TranscriptionRehearsalPage({ rehearsalEnabled }) {
  if (rehearsalEnabled !== true) return null;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Synthetic speaker review</h1>
          <p className="mt-2 text-sm leading-6 text-gray-700">
            Review a fictional transcript and save display names for its speakers. The sample request, transcript, and suggested names are synthetic; this page does not read CRM records or meeting attendees.
          </p>
          <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm leading-5 text-blue-950">
            Isolated rehearsal: only speaker-name edits are saved. Upload, transcription, publication, and recovery actions are unavailable.
          </p>
        </header>
        <MeetingTranscriptionPanel
          requestId={REHEARSAL_REQUEST_ID}
          apiBasePath={API_BASE_PATH}
          reviewOnly
        />
      </div>
    </main>
  );
}
