import Layout from '../../shared/components/Layout';

/** Retained bookmark on both the shared app and the isolated pilot deployment. */
export default function TranscriptionPilotPage() {
  return (
    <Layout title="Transcription Pilot retired">
      <section className="mx-auto max-w-3xl space-y-4 px-6 py-12">
        <h1 className="text-2xl font-semibold">Transcription Pilot has been retired</h1>
        <p>This standalone evaluation tool is no longer available.</p>
        <p>Meeting Tracker transcription remains available in the main application suite.</p>
      </section>
    </Layout>
  );
}
