import RequireAppAccess from '../../../shared/components/RequireAppAccess';
import SessionEditor from '../../../shared/components/meeting-tracker/SessionEditor';
import MeetingTrackerUnavailable from '../../../shared/components/meeting-tracker/MeetingTrackerUnavailable';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker';

export async function getServerSideProps() {
  return { props: { schemaReady: isMeetingTrackerSchemaReady() } };
}

export default function MeetingTrackerSessionPage({ schemaReady }) {
  return (
    <RequireAppAccess appKey="meeting-tracker">
      {schemaReady ? <SessionEditor /> : <MeetingTrackerUnavailable />}
    </RequireAppAccess>
  );
}
