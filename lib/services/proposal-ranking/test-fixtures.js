/** Authenticated sandbox rehearsal content. All institutions/history/discussion
 * are fictional, never records of actual awards or accepted staff analysis.
 * Actual sandbox Requests and three saved synthetic reviews supply eligibility.
 */
import { getRankingTestPolicy, RANKING_TEST_REQUESTS } from './test-policy.js';

const scenarios = [
  ['Northlake University', 'Mapping immune signals across living tissue', 'West', 1200000, [5,5,4], 3, 2023, 2900000, 'positive', 'high', 'A compelling way to observe immune responses in their native environment.', 'The team should define how it will validate the new imaging method.'],
  ['Cedar Coast Institute', 'Listening for dark matter with quantum sensors', 'West', 950000, [4,5,3], 1, 2018, 800000, 'mixed', 'high', 'The sensitivity improvement could open a new experimental window.', 'The noise floor remains uncertain outside the prototype.'],
  ['Briarwood University', 'Tracing the earliest changes in motor neuron disease', 'East', 1100000, [3,5,2], 0, null, 0, 'mixed', 'moderate', 'The proposed model could reveal events that current models miss.', 'Reviewers disagree about whether the model captures human disease.'],
  ['Redwood Polytechnic', 'Programmable materials that repair microscopic cracks', 'West', 1400000, [5,4,5], 4, 2025, 4200000, 'positive', 'high', 'The mechanism is original and the early experiments are convincing.', 'Scaling beyond small samples will be a substantial challenge.'],
  ['Harborview Research Institute', 'Revealing how the brain clears damaged proteins', 'East', 800000, [2,3,2], 2, 2016, 1750000, 'negative', 'low', 'The experimental platform could produce useful measurements.', 'The central causal claim is not yet supported by the preliminary work.'],
  ['Mesa Verde University', 'Following water through fractured rock in real time', 'West', 650000, [3,4,3], 1, 2021, 650000, 'mixed', 'moderate', 'Direct measurements would address a persistent gap in subsurface science.', 'The field deployment schedule appears optimistic.'],
  ['Lakeshore University', 'Watching cells choose between repair and cancer', 'East', 1250000, [5,4,4], 5, 2024, 5100000, 'positive', 'moderate', 'Single-cell tracking could connect decisions to later outcomes.', 'The proposed perturbations need a clearer prioritization.'],
  ['Summit Institute of Technology', 'A new route to room-temperature quantum memory', 'West', 1500000, [5,2,4], 0, null, 0, 'mixed', 'high', 'Success would change what is feasible in quantum sensing.', 'The most ambitious coherence target has little experimental support.'],
  ['Pine River University', 'Measuring the hidden mechanics of organ development', 'West', 975000, [4,4,4], 2, 2020, 1900000, 'positive', 'moderate', 'The approach joins physical measurements with developmental biology.', 'The biological scope may be too broad for the requested period.'],
  ['Atlantic Ridge University', 'Reconstructing ancient climates from mineral defects', 'East', 725000, [3,3,4], 3, 2019, 2600000, 'mixed', 'moderate', 'A new proxy could fill gaps in the climate record.', 'Independent calibration will determine whether the method is useful.'],
  ['Willow Bay Institute', 'Decoding communication between microbes and nerve cells', 'West', 1050000, [4,2,3], 1, 2025, 1000000, 'mixed', 'low', 'The cross-disciplinary question is intriguing.', 'The proposed evidence may not distinguish signaling from correlation.'],
  ['Granite State University', 'Detecting rare chemical reactions one molecule at a time', 'East', 850000, [2,1,3], 0, null, 0, 'negative', 'low', 'The measurement challenge is important.', 'The design does not yet show how background events will be excluded.'],
];

export const RANKING_REHEARSAL_PROPOSALS = scenarios.map((s, i) => ({
  requestId: RANKING_TEST_REQUESTS[i], organization: s[0], title: s[1],
  institutionGeography: s[2], amount: s[3], ratings: s[4],
  programKey: i % 2 === 0 ? 'mr' : 'se',
  researchFunding: { status: 'available', qualifyingGrantCount: s[5], latestAwardYear: s[6], totalAmountMinorUnits: s[7] * 100, sample: true },
  discussion: { schemaVersion: 1, reception: s[8], enthusiasm: s[9],
    headline: `Fictional rehearsal discussion: ${s[10]} ${s[11]}`,
    supportPoints: [{ quote: s[10], speaker: 'Sample participant A', time: '00:30' }],
    concernPoints: [{ quote: s[11], speaker: 'Sample participant B', time: '01:15' }],
    disagreements: [], uncertainties: [] },
}));

export function rehearsalPresentation(requestId, env = process.env) {
  if (!getRankingTestPolicy(env).enabled) return null;
  return RANKING_REHEARSAL_PROPOSALS.find(p => p.requestId === requestId) || null;
}
