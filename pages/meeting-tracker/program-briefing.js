import RequireAppAccess from '../../shared/components/RequireAppAccess';
import ProgramBriefingView from '../../shared/components/meeting-tracker/ProgramBriefingView';
import MeetingTrackerUnavailable from '../../shared/components/meeting-tracker/MeetingTrackerUnavailable';
import { isMeetingTrackerSchemaReady } from '../../shared/config/meetingTracker';

export async function getServerSideProps() {
  return { props: { schemaReady: isMeetingTrackerSchemaReady() } };
}

export default function ProgramBriefingPage({ schemaReady }) {
  return <RequireAppAccess appKey="meeting-tracker">{schemaReady ? <ProgramBriefingView /> : <MeetingTrackerUnavailable />}</RequireAppAccess>;
}
