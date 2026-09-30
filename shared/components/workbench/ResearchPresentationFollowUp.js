import { Card } from '../Layout';
import { REQUEST_DOCUMENT_ARTIFACT_TYPE } from '../../config/requestDocument';

const SLOTS = [
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.RECORDING, label: 'Recording', action: 'Watch recording' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT, label: 'Transcript', action: 'Open transcript' },
  { type: REQUEST_DOCUMENT_ARTIFACT_TYPE.TRANSCRIPT_SUMMARY, label: 'Transcript summary', action: 'Open transcript summary' },
];

export default function ResearchPresentationFollowUp({ status, materials = [] }) {
  if (status === 'disabled') return null;
  const byType = new Map(materials.map((material) => [Number(material.artifactType), material]));
  return (
    <Card hover={false}>
      <div data-testid="research-presentation-follow-up">
        <h3 className="text-base font-semibold text-gray-900">Research presentation follow-up</h3>
        {status === 'loading' && <p className="mt-2 text-sm text-gray-600">Loading presentation materials…</p>}
        {status === 'unavailable' && (
          <p className="mt-2 text-sm text-red-800" role="alert">Presentation materials could not be loaded.</p>
        )}
        {status === 'loaded' && (
          <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-200">
            {SLOTS.map((slot) => {
              const material = byType.get(slot.type);
              const href = material?.backing === 'external' ? material.externalUrl : material?.webUrl;
              return (
                <li key={slot.type} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <p className="font-medium text-gray-900">{slot.label}</p>
                    <p className="text-xs text-gray-500">{material?.filename || 'Not added yet'}</p>
                  </div>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-800 underline">
                      {slot.action}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
