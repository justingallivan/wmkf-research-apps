import { useState, useMemo } from 'react';
import Link from 'next/link';
import Layout, { PageHeader } from '../shared/components/Layout';
import { APP_REGISTRY } from '../shared/config/appRegistry';
import { useAppAccess } from '../shared/context/AppAccessContext';

export async function getServerSideProps() {
  return {
    props: {
      runtimeAppStatus: {
        'meeting-tracker': process.env.MEETING_TRACKER_SCHEMA_READY === 'on'
          ? 'active'
          : 'not-ready',
      },
    },
  };
}

export default function LandingPage({ runtimeAppStatus = {} }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { hasAccess } = useAppAccess();

  // Map registry entries to the format AppCard expects, filtered by access
  const apps = useMemo(() =>
    APP_REGISTRY
      .filter(app => hasAccess(app.key))
      .map(app => ({
        id: app.key,
        title: app.name,
        description: app.description,
        icon: app.icon,
        status: runtimeAppStatus[app.key] || 'active',
        categories: app.categories,
        features: app.features,
        path: app.href,
      })),
    [hasAccess, runtimeAppStatus]
  );

  const filteredApps = apps.filter(app => {
    if (selectedCategory === 'all') return true;
    return app.categories.includes(selectedCategory);
  });

  return (
    <Layout>
      <PageHeader
        title="Document Processing Suite"
        subtitle="AI-powered applications for research analysis, document processing, and workflow automation"
      />

      {/* Filter Section */}
      <div className="flex justify-center">
        <div className="flex flex-col sm:flex-row gap-2 bg-gray-100 p-2 rounded-lg">
          <button
            className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
              selectedCategory === 'all'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setSelectedCategory('all')}
          >
            All Apps ({apps.length})
          </button>
          <button
            className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
              selectedCategory === 'concepts'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setSelectedCategory('concepts')}
          >
            Concepts ({apps.filter(a => a.categories.includes('concepts')).length})
          </button>
          <button
            className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
              selectedCategory === 'phase-i'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setSelectedCategory('phase-i')}
          >
            Phase I ({apps.filter(a => a.categories.includes('phase-i')).length})
          </button>
          <button
            className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
              selectedCategory === 'phase-ii'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setSelectedCategory('phase-ii')}
          >
            Phase II ({apps.filter(a => a.categories.includes('phase-ii')).length})
          </button>
          <button
            className={`px-6 py-3 font-semibold rounded-lg transition-all duration-200 ${
              selectedCategory === 'other'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
            onClick={() => setSelectedCategory('other')}
          >
            Other Tools ({apps.filter(a => a.categories.includes('other')).length})
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </div>
      </div>
    </Layout>
  );
}

export function AppCard({ app }) {
  const isActive = app.status === 'active';
  
  const CardContent = (
    <div className={`
      bg-white border border-gray-200 rounded-xl p-6 shadow-sm
      transition-all duration-200 hover:shadow-md hover:border-gray-300
      ${isActive ? 'cursor-pointer hover:scale-[1.02]' : 'opacity-75'}
      group h-full flex flex-col
    `}>
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="text-3xl flex-shrink-0">{app.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-gray-800">
            {app.title}
          </h3>
          <span className={`
            inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold
            ${app.status === 'active' 
              ? 'bg-green-50 text-green-700 border border-green-200' 
              : 'bg-amber-50 text-amber-700 border border-amber-200'
            }
          `}>
            {app.status === 'active' ? '✓ Available' : 'Not yet enabled'}
          </span>
        </div>
      </div>
      
      {/* Description */}
      <p className="text-gray-600 text-sm leading-relaxed mb-6 flex-grow group-hover:text-gray-700">
        {app.description}
      </p>

      {/* Action Button */}
      <div className="mt-auto">
        {isActive ? (
          <div className="flex items-center justify-center py-3 px-6 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-lg transition-all duration-200">
            <span>Launch App</span>
            <span className="ml-2 group-hover:translate-x-1 transition-transform duration-200">→</span>
          </div>
        ) : (
          <div className="flex items-center justify-center py-3 px-6 bg-gray-100 text-gray-500 font-semibold rounded-lg cursor-not-allowed">
            Not yet enabled
          </div>
        )}
      </div>
    </div>
  );

  if (isActive) {
    return (
      <Link href={app.path} className="block h-full">
        {CardContent}
      </Link>
    );
  }

  return CardContent;
}
