import RequireAppAccess from '../../shared/components/RequireAppAccess';
import MeetingTrackerList from '../../shared/components/meeting-tracker/MeetingTrackerList';
import MeetingTrackerUnavailable from '../../shared/components/meeting-tracker/MeetingTrackerUnavailable';
import { isMeetingTrackerSchemaReady } from '../../shared/config/meetingTracker';

export async function getServerSideProps() {
  return { props: { schemaReady: isMeetingTrackerSchemaReady() } };
}

export default function MeetingTrackerPage({ schemaReady }) {
  return (
    <RequireAppAccess appKey="meeting-tracker">
      {schemaReady ? <MeetingTrackerList /> : <MeetingTrackerUnavailable />}
    </RequireAppAccess>
  );
}
