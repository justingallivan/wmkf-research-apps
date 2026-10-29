import Layout from '../shared/components/Layout';
import CycleCalendarPanel from '../shared/components/cycle-calendar/CycleCalendarPanel';
import LandingCyclePanel from '../shared/components/landing-cycle/LandingCyclePanel';

// Open to all signed-in staff; /api/cycle-calendar refuses non-staff sessions and decides who may edit.
export default function CycleCalendarPage() {
  return <Layout title="Cycle calendar"><div className="space-y-6 py-6"><header><h1 className="text-2xl font-semibold">Cycle calendar</h1><p className="mt-1 text-gray-600">Milestone dates for each grant cycle, kept in Dynamics.</p></header><LandingCyclePanel /><CycleCalendarPanel /></div></Layout>;
}
