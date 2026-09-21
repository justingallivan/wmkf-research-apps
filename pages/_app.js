import Head from 'next/head'
import { Analytics } from '@vercel/analytics/next'
import { useRouter } from 'next/router'
import '../styles/globals.css'
import { SessionProvider } from 'next-auth/react'
import { ProfileProvider } from '../shared/context/ProfileContext'
import { AppAccessProvider } from '../shared/context/AppAccessContext'
import RequireAuth from '../shared/components/RequireAuth'
import WelcomeModal from '../shared/components/WelcomeModal'

export default function App({ Component, pageProps: { session, ...pageProps } }) {
  const router = useRouter();
  // Auth pages render before any session/profile exists. Skip the
  // profile/app-access providers there so they don't fire authenticated
  // API calls that get redirected to HTML and break JSON.parse.
  // External pages (magic-link reviewer portal) are public — same exclusion
  // applies, plus they intentionally render no app chrome.
  // Apply pages (applicant intake portal) authenticate via Entra External ID,
  // not the staff providers — same skip.
  const isPublicPage =
    router.pathname.startsWith('/auth/') ||
    router.pathname.startsWith('/external/') ||
    router.pathname.startsWith('/apply');

  // The rehearsal page has a server-side Preview/development guard and its own
  // inert ProfileContext. Keep the normal auth/session providers out of it so
  // opening the page cannot initialize live profile or session requests.
  if (router.pathname === '/meeting-tracker/materials-email-rehearsal' && pageProps.rehearsalEnabled === true) {
    return (
      <>
        <Head>
          <meta name="robots" content="noindex, nofollow" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        </Head>
        <Component {...pageProps} />
      </>
    );
  }

  const inner = isPublicPage ? (
    <Component {...pageProps} />
  ) : (
    <RequireAuth>
      <ProfileProvider>
        <AppAccessProvider>
          <WelcomeModal />
          <Component {...pageProps} />
          <Analytics />
        </AppAccessProvider>
      </ProfileProvider>
    </RequireAuth>
  );

  return (
    <SessionProvider session={session} refetchOnWindowFocus={true}>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      {inner}
    </SessionProvider>
  )
}
