/**
 * Read-only display of the J27 intake fields carried on the request context as
 * `context.intake` (resolve-request-service.js `loadIntakeFields`): the
 * applicant's portal summary answers and keywords on the Overview, Claude's
 * intake findings on Initial Assessment. `status: 'unavailable'` means the read
 * failed; an empty field means nothing has been written yet.
 */
import { Card } from '../Layout';
import { parseFieldKeywords, parseMethodsKeywords } from '../../utils/intake-keywords';
import PrimaryDiscipline from './PrimaryDiscipline';

const UNAVAILABLE = 'Couldn’t load the intake fields for this request.';

function Text({ value, empty = 'Not provided.' }) {
  return value
    ? <p className="text-sm text-gray-700 whitespace-pre-wrap">{value}</p>
    : <p className="text-sm text-gray-500">{empty}</p>;
}

function Item({ label, children }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</h3>
      {children}
    </div>
  );
}

const ANSWERS = [
  ['scientificQuestion', 'Scientific question'],
  ['potentialImpact', 'Potential impact'],
  ['risks', 'Risks'],
  ['enablingAdvances', 'Enabling advances'],
  ['newArea', 'New area'],
  ['peerGroups', 'Peer groups'],
  ['priorSupport', 'Prior support'],
  ['aiUse', 'AI use'],
  ['publications', 'Publications'],
  ['animalModels', 'Animal models'],
];

/** Folded applicant summary answers (Overview, under the abstract). */
export function ApplicantAnswers({ intake }) {
  if (!intake) return null;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">Applicant’s summary answers</summary>
      {intake.status === 'unavailable' ? (
        <p className="mt-3 text-sm text-amber-600">{UNAVAILABLE}</p>
      ) : (
        <div className="mt-3 space-y-4">
          {ANSWERS.map(([key, label]) => (
            <Item key={key} label={label}><Text value={intake[key]} /></Item>
          ))}
        </div>
      )}
    </details>
  );
}

function Chips({ items }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <li key={`${index}:${item}`} className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{item}</li>
      ))}
    </ul>
  );
}

/** Primary discipline, then Field and Methods keywords (Overview). */
export function KeywordsCard({ intake, requestId = null }) {
  if (!intake) return null;
  const field = intake.status === 'present' ? parseFieldKeywords(intake.fieldKeywords) : undefined;
  const methods = intake.status === 'present' ? parseMethodsKeywords(intake.methodsKeywords) : undefined;
  return (
    <Card hover={false}>
      <h2 className="text-base font-semibold text-gray-900 mb-3">Keywords</h2>
      <div className="mb-4">
        <PrimaryDiscipline requestId={requestId} claudePrimary={field?.primary || null} claudeRunnerUp={field?.runnerUp || null} />
      </div>
      {intake.status === 'unavailable' ? (
        <p className="text-sm text-amber-600">{UNAVAILABLE}</p>
      ) : (
        <div className="space-y-4">
          <Item label="Field keywords">
            {field === undefined ? <p className="text-sm text-gray-500">Not yet generated.</p>
              : field === null ? <p className="text-sm text-amber-600">Couldn’t read the field keywords.</p>
                : (
                  <div className="space-y-2 text-sm text-gray-700">
                    {field.primary && (
                      <p>
                        <span className="font-medium text-gray-900">{field.primary}</span>
                        {field.runnerUp && <span className="text-gray-500"> · runner-up {field.runnerUp}</span>}
                      </p>
                    )}
                    {field.secondary.length > 0 && <div><span className="text-xs text-gray-500">Secondary</span><Chips items={field.secondary} /></div>}
                    {field.objects.length > 0 && <div><span className="text-xs text-gray-500">Objects of study</span><Chips items={field.objects} /></div>}
                    {field.other.length > 0 && <div><span className="text-xs text-gray-500">Other terms</span><Chips items={field.other} /></div>}
                  </div>
                )}
          </Item>
          <Item label="Methods keywords">
            {methods === undefined ? <p className="text-sm text-gray-500">Not yet generated.</p>
              : methods === null ? <p className="text-sm text-amber-600">Couldn’t read the methods keywords.</p>
                : methods.length ? <Chips items={methods} /> : <p className="text-sm text-gray-500">None listed.</p>}
          </Item>
        </div>
      )}
    </Card>
  );
}

function Flags({ raw }) {
  if (!raw) return <p className="text-sm text-gray-500">None generated yet.</p>;
  let list = null;
  try { list = JSON.parse(raw); } catch { list = null; }
  const items = Array.isArray(list) ? list.filter((value) => typeof value === 'string' && value.trim()) : [];
  return items.length
    ? <Chips items={items} />
    : <p className="text-sm text-gray-500">Flags are recorded in a format this page can’t show yet.</p>;
}

/** Claude's intake findings (Initial Assessment). */
export function IntakeFindings({ intake }) {
  if (!intake) return null;
  return (
    <Card hover={false}>
      <h2 className="text-base font-semibold text-gray-900 mb-1">Intake findings</h2>
      <p className="text-sm text-gray-600 mb-4">Written by Claude when the application came in.</p>
      {intake.status === 'unavailable' ? (
        <p className="text-sm text-amber-600">{UNAVAILABLE}</p>
      ) : (
        <div className="space-y-4">
          <Item label="Methodology"><Text value={intake.methodology} empty="Not yet generated." /></Item>
          <Item label="Personnel"><Text value={intake.personnel} empty="Not yet generated." /></Item>
          <Item label="Intake rationale (Claude)"><Text value={intake.rationale} empty="Not yet generated." /></Item>
          <Item label="Fit check">
            {intake.fitAssessment
              ? <p className="text-sm font-medium text-gray-900">{intake.fitAssessment}</p>
              : <p className="text-sm text-gray-500">Not yet generated.</p>}
            {intake.fitRationale && <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{intake.fitRationale}</p>}
          </Item>
          <Item label="Flags"><Flags raw={intake.riskFlags} /></Item>
        </div>
      )}
    </Card>
  );
}
