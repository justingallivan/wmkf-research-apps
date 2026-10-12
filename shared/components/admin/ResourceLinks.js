export default function ResourceLinks({ title, links }) {
  return (
    <section aria-labelledby={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`}>
      <h2 id={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`} className="text-sm font-semibold text-gray-950">{title}</h2>
      <div className="mt-2 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener noreferrer' : undefined}
            className="block px-4 py-3 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-500"
          >
            <span className="text-sm font-semibold text-gray-950">{link.name}</span>
            <span className="mt-0.5 block text-sm text-gray-600">{link.description}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
