import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from '@arata/api-client';
import { Button, StatusBadge } from '@arata/ui';
import { getTheme, setTheme } from './preferences.js';
import { registerSW } from 'virtual:pwa-register';
import { AccountScreens } from './AccountScreens.js';
import { PublicPortal } from './PublicPortal.js';
import { PublishingStudio } from './PublishingStudio.js';
import { Reader } from './Reader.js';
import { ContentPolicyAdmin } from './ContentPolicyAdmin.js';
import { PlatformPolicyAdmin } from './PlatformPolicyAdmin.js';
import { BillingScreens } from './BillingScreens.js';
import { EntitlementScreens } from './EntitlementScreens.js';
import { InstitutionScreens } from './InstitutionScreens.js';
import { migratePendingChanges } from './offline-store.js';
import './style.css';

void migratePendingChanges().catch(() => {
  window.dispatchEvent(new Event('arata-offline-migration-failed'));
});

const accountScreens = new Set([
  'register',
  'login',
  'verify-email',
  'recovery',
  'profile',
  'privacy',
  'my-sessions',
  'user-admin',
  'roles-admin',
]);
const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('arata-update-ready'));
  },
});

function App() {
  const [online, setOnline] = useState(false);
  const [checked, setChecked] = useState(false);
  const [theme, chooseTheme] = useState<'dark' | 'light'>('dark');
  const [updateReady, setUpdateReady] = useState(false);
  const account = accountScreens.has(new URLSearchParams(location.search).get('screen') ?? '');
  const studio = new URLSearchParams(location.search).get('screen') === 'studio';
  const reader = new URLSearchParams(location.search).get('screen') === 'reader';
  const policyAdmin = new URLSearchParams(location.search).get('screen') === 'content-policy';
  const platformSettings =
    new URLSearchParams(location.search).get('screen') === 'platform-settings';
  const billingScreen = new Set([
    'pricing',
    'checkout',
    'payment-result',
    'my-subscription',
    'invoices',
    'finance-dashboard',
    'transactions',
    'refunds',
    'disputes',
    'plans-admin',
  ]).has(new URLSearchParams(location.search).get('screen') ?? '');
  const entitlementScreen = new Set([
    'entitlements',
    'access-grants',
    'trial-admin',
    'institution-access',
  ]).has(new URLSearchParams(location.search).get('screen') ?? '');
  const institutionScreen = new Set([
    'eligibility',
    'eligibility-status',
    'institution-portal',
    'institution-roster',
    'institution-policies',
    'cohort-manager',
  ]).has(new URLSearchParams(location.search).get('screen') ?? '');

  useEffect(() => {
    void getTheme().then(chooseTheme);
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('arata-update-ready', onUpdate);
    const controller = new AbortController();
    void createApiClient()
      .live(controller.signal)
      .then(() => setOnline(true))
      .catch(() => setOnline(false))
      .finally(() => setChecked(true));
    return () => {
      controller.abort();
      window.removeEventListener('arata-update-ready', onUpdate);
    };
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    chooseTheme(next);
    void setTheme(next);
  }
  if (studio) return <PublishingStudio />;
  if (reader) return <Reader updateReady={updateReady} onUpdate={() => void updateSW(true)} />;
  if (policyAdmin) return <ContentPolicyAdmin />;
  if (platformSettings) return <PlatformPolicyAdmin />;
  if (billingScreen) return <BillingScreens />;
  if (entitlementScreen) return <EntitlementScreens />;
  if (institutionScreen) return <InstitutionScreens />;
  if (!account)
    return (
      <PublicPortal
        online={online}
        checked={checked}
        updateReady={updateReady}
        onUpdate={() => void updateSW(true)}
      />
    );

  return (
    <div
      data-theme={theme}
      className="min-h-screen bg-slate-950 text-slate-50 data-[theme=light]:bg-slate-50 data-[theme=light]:text-slate-950"
    >
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-3 focus:text-slate-950"
        href="#main"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-700/50 px-6 py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <a href="/" className="text-lg font-bold tracking-tight">
            Arata <span className="text-cyan-400">TechLibrary</span>
          </a>
          <Button
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            Theme
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-12">
        <p className="mb-4 font-semibold uppercase tracking-[.2em] text-cyan-400">
          Account and access
        </p>
        <h1 className="max-w-3xl text-4xl font-bold leading-tight">Your library account</h1>
        <p className="mt-4 max-w-2xl text-slate-400">
          Manage your sign in, profile and privacy settings.
        </p>
        {updateReady && (
          <div role="status" className="mt-6 rounded-xl border border-cyan-400 p-4">
            An update is ready. <Button onClick={() => void updateSW(true)}>Apply update</Button>
          </div>
        )}
        <section
          aria-labelledby="system-heading"
          className="mt-8 rounded-2xl border border-slate-700 p-6"
        >
          <h2 id="system-heading" className="text-xl font-semibold">
            Local system status
          </h2>
          <p className="mt-3">{checked ? <StatusBadge online={online} /> : 'Checking API…'}</p>
        </section>
        <AccountScreens />
      </main>
      <footer className="mx-auto max-w-5xl px-6 py-8 text-sm text-slate-400">
        <a className="underline" href="/">
          Browse public library
        </a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
