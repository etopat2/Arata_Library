import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from '@arata/api-client';
import { Button, StatusBadge } from '@arata/ui';
import { getTheme, setTheme } from './preferences.js';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new Event('arata-update-ready'));
  },
});
const applyUpdate = async () => {
  await updateSW(true);
};

function App() {
  const [online, setOnline] = useState(false);
  const [checked, setChecked] = useState(false);
  const [theme, chooseTheme] = useState<'dark' | 'light'>('dark');
  const [updateReady, setUpdateReady] = useState(false);

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
          <strong className="text-lg tracking-tight">
            Arata <span className="text-cyan-400">TechLibrary</span>
          </strong>
          <Button
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            Theme
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-20">
        <p className="mb-4 font-semibold uppercase tracking-[.2em] text-cyan-400">
          Development foundation
        </p>
        <h1 className="max-w-3xl text-5xl font-bold leading-tight">
          A home for technology books and learning.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-400">
          The application shell is ready. Catalogue, accounts, reading, and learning features will
          appear here as they are implemented and verified.
        </p>
        {updateReady && (
          <div role="status" className="mt-6 rounded-xl border border-cyan-400 p-4">
            An update is ready. <Button onClick={() => void applyUpdate()}>Apply update</Button>
          </div>
        )}
        <section
          aria-labelledby="system-heading"
          className="mt-12 rounded-2xl border border-slate-700 p-6"
        >
          <h2 id="system-heading" className="text-xl font-semibold">
            Local system status
          </h2>
          <p className="mt-3">{checked ? <StatusBadge online={online} /> : 'Checking API…'}</p>
          <p className="mt-3 text-sm text-slate-400">
            Status is based on the public API liveness endpoint. Database readiness is checked
            separately by service credentials.
          </p>
        </section>
      </main>
      <footer className="mx-auto max-w-5xl px-6 py-8 text-sm text-slate-400">
        Arata TechLibrary development build
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
