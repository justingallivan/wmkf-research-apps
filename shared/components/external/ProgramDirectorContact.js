/**
 * Inline " (Name, mailto)" fragment naming the assigned Program Director.
 * Renders nothing unless both name and email are present, so the surrounding
 * sentence must read correctly with or without it.
 */

export default function ProgramDirectorContact({ programDirector = null }) {
  if (!programDirector?.name || !programDirector?.email) return null;
  return (
    <>
      {' '}({programDirector.name},{' '}
      <a
        href={`mailto:${programDirector.email}`}
        className="text-blue-700 underline hover:text-blue-900"
      >
        {programDirector.email}
      </a>)
    </>
  );
}
