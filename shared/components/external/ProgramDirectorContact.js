/**
 * Inline " (Name, mailto)" fragment naming the assigned Program Director.
 * `linkName` uses the name as the email link instead of showing the address.
 * Renders nothing unless both name and email are present, so the surrounding
 * sentence must read correctly with or without it.
 */

export default function ProgramDirectorContact({ programDirector = null, linkName = false }) {
  if (!programDirector?.name || !programDirector?.email) return null;
  return (
    <>
      {' '}({!linkName && <>{programDirector.name},{' '}</>}
      <a
        href={`mailto:${programDirector.email}`}
        className="text-blue-700 underline hover:text-blue-900"
      >
        {linkName ? programDirector.name : programDirector.email}
      </a>)
    </>
  );
}
