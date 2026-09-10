import RequireAppAccess from '../../../shared/components/RequireAppAccess';
import SiteVisitEditor from '../../../shared/components/meeting-tracker/SiteVisitEditor';
import MeetingTrackerUnavailable from '../../../shared/components/meeting-tracker/MeetingTrackerUnavailable';
import { isMeetingTrackerSchemaReady } from '../../../shared/config/meetingTracker';

export async function getServerSideProps() {
  return { props: { schemaReady: isMeetingTrackerSchemaReady() } };
}

export default function MeetingTrackerVisitPage({ schemaReady }) {
  return (
    <RequireAppAccess appKey="meeting-tracker">
      {schemaReady ? <SiteVisitEditor /> : <MeetingTrackerUnavailable />}
    </RequireAppAccess>
  );
}
