import RequireAppAccess from '../../shared/components/RequireAppAccess';
import DiscussionSentimentView from '../../shared/components/meeting-tracker/DiscussionSentimentView';
import MeetingTrackerUnavailable from '../../shared/components/meeting-tracker/MeetingTrackerUnavailable';
import { isMeetingTrackerSchemaReady } from '../../shared/config/meetingTracker';

export async function getServerSideProps() {
  return { props: { schemaReady: isMeetingTrackerSchemaReady() } };
}

export default function DiscussionSentimentPage({ schemaReady }) {
  return (
    <RequireAppAccess appKey="meeting-tracker">
      {schemaReady ? <DiscussionSentimentView /> : <MeetingTrackerUnavailable />}
    </RequireAppAccess>
  );
}
