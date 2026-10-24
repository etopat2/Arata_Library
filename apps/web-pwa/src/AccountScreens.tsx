import { useEffect, useState, type FormEvent } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { createApiClient, ApiError } from '@arata/api-client';
import { AdminScreens } from './AdminScreens.js';

type Screen =
  | 'register'
  | 'login'
  | 'verify-email'
  | 'recovery'
  | 'profile'
  | 'privacy'
  | 'my-sessions'
  | 'user-admin'
  | 'roles-admin';
type Profile = {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
  timezone: string;
  status: string;
};
type Session = {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
  deviceLabel: string | null;
  lastSeenAt: string | null;
};
type Privacy = {
  analyticsConsent: boolean;
  researchConsent: boolean;
  personalizationConsent: boolean;
  aiAssistanceConsent: boolean;
};
const client = createApiClient();
const initialScreen = (): Screen => {
  const value = new URLSearchParams(location.search).get('screen');
  return value &&
    [
      'register',
      'login',
      'verify-email',
      'recovery',
      'profile',
      'privacy',
      'my-sessions',
      'user-admin',
      'roles-admin',
    ].includes(value)
    ? (value as Screen)
    : 'login';
};

export function AccountScreens() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [admin, setAdmin] = useState(false);
  const [policy, setPolicy] = useState<{
    termsVersion: string;
    privacyVersion: string;
    termsUrl: string;
    privacyUrl: string;
  } | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [privacy, setPrivacy] = useState<Privacy>({
    analyticsConsent: false,
    researchConsent: false,
    personalizationConsent: false,
    aiAssistanceConsent: false,
  });
  const [notifications, setNotifications] = useState({ email: true, inApp: true });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletionPassword, setDeletionPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [totp, setTotp] = useState<{ id: string; secret: string; otpauthUrl: string } | null>(null);
  const token = new URLSearchParams(location.search).get('token');

  function navigate(next: Screen) {
    setScreen(next);
    setError('');
    setMessage('');
    history.replaceState({}, '', `?screen=${next}`);
  }
  function describe(error: unknown) {
    if (error instanceof ApiError) {
      if (error.status === 429) return 'Too many attempts. Please wait and try again.';
      if (error.status === 401) return 'Credentials or verification could not be accepted.';
      if (error.status === 403)
        return 'Access denied or a security check expired. Sign in again if needed.';
      if (error.status === 400) return 'The link or information is invalid or expired.';
      if (error.status === 503) return 'Account service is temporarily unavailable.';
    }
    return 'The request could not be completed. Please try again.';
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  }
  async function loadProfile() {
    const result = await client.request<{ data: Profile }>('/me/profile');
    setProfile(result.data);
    setAdmin(
      await client
        .request('/admin/users?limit=1')
        .then(() => true)
        .catch(() => false),
    );
  }
  useEffect(() => {
    void loadProfile().catch(() => setProfile(null));
    void client
      .request<{ data: NonNullable<typeof policy> }>('/auth/policy-versions')
      .then((result) => setPolicy(result.data))
      .catch(() => setPolicy(null));
  }, []);
  useEffect(() => {
    if (screen === 'my-sessions' && profile)
      void client
        .request<{ data: Session[] }>('/auth/sessions')
        .then((result) => setSessions(result.data))
        .catch((caught) => setError(describe(caught)));
    if (screen === 'privacy' && profile)
      void client
        .request<{ data: Privacy }>('/me/privacy-preferences')
        .then((result) => setPrivacy(result.data))
        .catch((caught) => setError(describe(caught)));
    if (screen === 'profile' && profile)
      void client
        .request<{ data: { email: boolean; inApp: boolean } }>('/me/notification-preferences')
        .then((result) => setNotifications({ email: result.data.email, inApp: result.data.inApp }))
        .catch((caught) => setError(describe(caught)));
  }, [screen, profile?.id]);

  const submit = (event: FormEvent<HTMLFormElement>, action: () => Promise<void>) => {
    event.preventDefault();
    void run(action);
  };
  const field =
    'w-full rounded-lg border border-slate-500 bg-slate-900 p-3 text-white placeholder:text-slate-400 data-[theme=light]:bg-white';
  const button =
    'rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 disabled:cursor-wait disabled:opacity-50';

  return (
    <section
      aria-labelledby="account-heading"
      className="mx-auto mt-10 max-w-3xl rounded-2xl border border-slate-700 p-6"
    >
      <h2 id="account-heading" className="text-2xl font-bold">
        Account and security
      </h2>
      <nav aria-label="Account screens" className="mt-4 flex flex-wrap gap-3">
        {(profile
          ? ['profile', 'privacy', 'my-sessions', ...(admin ? ['user-admin', 'roles-admin'] : [])]
          : ['login', 'register', 'recovery']
        ).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => navigate(item as Screen)}
            aria-current={screen === item ? 'page' : undefined}
            className="rounded-lg border border-slate-500 px-3 py-2 capitalize hover:border-cyan-400"
          >
            {item === 'my-sessions' ? 'Devices and sessions' : item}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-400 p-3 text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="mt-4 rounded-lg border border-emerald-400 p-3 text-emerald-300">
          {message}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-4">
          Working…
        </p>
      )}

      {screen === 'register' && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) =>
            submit(event, async () => {
              if (token)
                await client.request('/auth/invitations/accept', 'POST', {
                  token,
                  password,
                  termsVersion: policy?.termsVersion,
                  privacyVersion: policy?.privacyVersion,
                });
              else
                await client.request('/auth/register', 'POST', {
                  email,
                  password,
                  termsVersion: policy?.termsVersion,
                  privacyVersion: policy?.privacyVersion,
                });
              setPassword('');
              navigate(token ? 'login' : 'verify-email');
              setMessage(
                token
                  ? 'Invitation accepted. Sign in now.'
                  : 'Check your email for a verification link if the address is eligible.',
              );
            })
          }
        >
          <h3 className="text-xl font-semibold">
            {token ? 'Accept your invitation' : 'Create your account'}
          </h3>
          {!token && (
            <label className="block">
              Email address
              <input
                className={field}
                type="email"
                autoComplete="email"
                required
                maxLength={320}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          )}
          <label className="block">
            Password
            <input
              className={field}
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {policy ? (
            <label className="flex gap-2">
              <input type="checkbox" required />{' '}
              <span>
                I agree to the{' '}
                <a
                  className="underline"
                  href={policy.termsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Terms of Service
                </a>{' '}
                and acknowledge the{' '}
                <a
                  className="underline"
                  href={policy.privacyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Notice
                </a>
                .
              </span>
            </label>
          ) : (
            <p role="status">Registration awaits approved terms and privacy notices.</p>
          )}
          <button className={button} disabled={busy || !policy}>
            {token ? 'Accept invitation' : 'Create account'}
          </button>
        </form>
      )}

      {screen === 'verify-email' && (
        <div className="mt-6 space-y-4">
          <h3 className="text-xl font-semibold">Verify your email address</h3>
          <p>
            Open the link sent to your inbox. Expired or used links can be requested again through
            account support.
          </p>
          {token && (
            <button
              className={button}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.request('/auth/verify-email', 'POST', { token });
                  setMessage('Email verified. You can now sign in.');
                  history.replaceState({}, '', '?screen=verify-email');
                })
              }
            >
              Verify email
            </button>
          )}
          <form
            className="space-y-3"
            onSubmit={(event) =>
              submit(event, async () => {
                await client.request('/auth/verify-email/resend', 'POST', { email });
                setMessage('If the address needs verification, a new link will arrive shortly.');
              })
            }
          >
            <label className="block">
              Account email
              <input
                className={field}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button className="rounded-lg border border-cyan-400 px-4 py-2" disabled={busy}>
              Resend verification link
            </button>
          </form>
        </div>
      )}

      {screen === 'login' && (
        <div className="mt-6 space-y-4">
          <form
            className="space-y-4"
            onSubmit={(event) =>
              submit(event, async () => {
                await client.request('/auth/login', 'POST', { email, password });
                setPassword('');
                await loadProfile();
                navigate('profile');
              })
            }
          >
            <h3 className="text-xl font-semibold">Sign in to your library</h3>
            <label className="block">
              Verified email
              <input
                className={field}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="block">
              Password
              <input
                className={field}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button className={button} disabled={busy}>
              Sign in
            </button>
          </form>
          {'PublicKeyCredential' in window && (
            <button
              type="button"
              className="rounded-lg border border-cyan-400 px-5 py-3"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const options = (
                    await client.request<{
                      data: Parameters<typeof startAuthentication>[0]['optionsJSON'];
                    }>('/auth/passkeys/login/options', 'POST', { email })
                  ).data;
                  const assertion = await startAuthentication({ optionsJSON: options });
                  await client.request('/auth/passkeys/login/verify', 'POST', assertion);
                  await loadProfile();
                  navigate('profile');
                })
              }
            >
              Sign in with passkey
            </button>
          )}
        </div>
      )}

      {screen === 'recovery' && (
        <div className="mt-6 space-y-4">
          <h3 className="text-xl font-semibold">Recover account access</h3>
          {!token ? (
            <form
              className="space-y-4"
              onSubmit={(event) =>
                submit(event, async () => {
                  await client.request('/auth/password/reset-request', 'POST', { email });
                  setMessage('If the address is eligible, a recovery link will arrive shortly.');
                })
              }
            >
              <label className="block">
                Account email
                <input
                  className={field}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <button className={button} disabled={busy}>
                Request recovery link
              </button>
            </form>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) =>
                submit(event, async () => {
                  await client.request('/auth/password/reset', 'POST', { token, newPassword });
                  setNewPassword('');
                  history.replaceState({}, '', '?screen=recovery');
                  setMessage('Password changed. Sign in with the new password.');
                })
              }
            >
              <label className="block">
                New password
                <input
                  className={field}
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <button className={button} disabled={busy}>
                Set new password
              </button>
            </form>
          )}
        </div>
      )}

      {screen === 'profile' && profile && (
        <div className="mt-6 space-y-5">
          <h3 className="text-xl font-semibold">Profile and preferences</h3>
          <p>
            {profile.email} · {profile.status}
          </p>
          <form
            className="space-y-4"
            onSubmit={(event) =>
              submit(event, async () => {
                const updated = await client.request<{ data: Profile }>('/me/profile', 'PATCH', {
                  displayName: profile.displayName,
                  locale: profile.locale,
                  timezone: profile.timezone,
                });
                setProfile(updated.data);
                setMessage('Profile saved.');
              })
            }
          >
            <label className="block">
              Display name
              <input
                className={field}
                value={profile.displayName ?? ''}
                onChange={(event) => setProfile({ ...profile, displayName: event.target.value })}
                maxLength={200}
              />
            </label>
            <label className="block">
              Language code
              <input
                className={field}
                value={profile.locale}
                onChange={(event) => setProfile({ ...profile, locale: event.target.value })}
              />
            </label>
            <label className="block">
              Timezone
              <input
                className={field}
                value={profile.timezone}
                onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}
              />
            </label>
            <button className={button} disabled={busy}>
              Save profile
            </button>
          </form>
          <form
            className="space-y-3"
            onSubmit={(event) =>
              submit(event, async () => {
                await client.request('/me/notification-preferences', 'PUT', notifications);
                setMessage('Notification choices saved. Security notices remain active.');
              })
            }
          >
            <h4 className="text-lg font-semibold">Notification choices</h4>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={notifications.email}
                onChange={(event) =>
                  setNotifications({ ...notifications, email: event.target.checked })
                }
              />
              Optional email
            </label>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={notifications.inApp}
                onChange={(event) =>
                  setNotifications({ ...notifications, inApp: event.target.checked })
                }
              />
              In-app notices
            </label>
            <button className={button} disabled={busy}>
              Save notification choices
            </button>
          </form>
          <button
            className="rounded-lg border border-slate-500 px-4 py-2"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.request('/auth/logout', 'POST');
                setProfile(null);
                navigate('login');
              })
            }
          >
            Sign out
          </button>
          <details className="rounded-lg border border-red-400 p-4">
            <summary className="cursor-pointer font-semibold">Request account deletion</summary>
            <p className="mt-2">
              Account access closes immediately. A privacy review determines records that must be
              retained by law.
            </p>
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) =>
                submit(event, async () => {
                  await client.request('/me/account/deletion', 'POST', {
                    password: deletionPassword,
                  });
                  setDeletionPassword('');
                  setProfile(null);
                  navigate('login');
                  setMessage('Deletion request recorded. Account access has been closed.');
                })
              }
            >
              <label className="block">
                Confirm password
                <input
                  className={field}
                  type="password"
                  autoComplete="current-password"
                  value={deletionPassword}
                  onChange={(event) => setDeletionPassword(event.target.value)}
                  required
                />
              </label>
              <button className="rounded-lg border border-red-400 px-4 py-2" disabled={busy}>
                Submit deletion request
              </button>
            </form>
          </details>
        </div>
      )}

      {screen === 'privacy' && profile && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) =>
            submit(event, async () => {
              const result = await client.request<{ data: Privacy }>(
                '/me/privacy-preferences',
                'PUT',
                { ...privacy, policyVersion: policy?.privacyVersion },
              );
              setPrivacy(result.data);
              setMessage('Privacy choices saved.');
            })
          }
        >
          <h3 className="text-xl font-semibold">Privacy and research choices</h3>
          <p>
            Required account and security processing remains active. Optional choices can be changed
            here.
          </p>
          {(
            [
              ['analyticsConsent', 'Optional usage analytics'],
              ['researchConsent', 'Educational research'],
              ['personalizationConsent', 'Personalization'],
              ['aiAssistanceConsent', 'AI assistance'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex gap-3">
              <input
                type="checkbox"
                checked={privacy[key]}
                onChange={(event) => setPrivacy({ ...privacy, [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
          <button className={button} disabled={busy || !policy}>
            Save privacy choices
          </button>
        </form>
      )}

      {screen === 'my-sessions' && profile && (
        <div className="mt-6 space-y-5">
          <h3 className="text-xl font-semibold">Devices and active sessions</h3>
          {sessions.length === 0 ? (
            <p>No active sessions were found.</p>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <li key={session.id} className="rounded-lg border border-slate-600 p-3">
                  <strong>{session.deviceLabel ?? 'Unknown device'}</strong>
                  {session.current ? ' · This session' : ''}
                  <p>Started {new Date(session.createdAt).toLocaleString()}</p>
                  <button
                    className="mt-2 rounded-lg border border-red-400 px-3 py-2"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await client.request(`/auth/sessions/${session.id}`, 'DELETE');
                        setSessions((old) => old.filter((item) => item.id !== session.id));
                        if (session.current) {
                          setProfile(null);
                          navigate('login');
                        }
                      })
                    }
                  >
                    Revoke session
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4 className="text-lg font-semibold">Multi-factor authentication</h4>
          {!totp ? (
            <form
              className="space-y-3"
              onSubmit={(event) =>
                submit(event, async () => {
                  const result = await client.request<{
                    data: { id: string; secret: string; otpauthUrl: string };
                  }>('/auth/mfa/enroll', 'POST', { password });
                  setTotp(result.data);
                  setPassword('');
                })
              }
            >
              <label className="block">
                Confirm password to enroll
                <input
                  className={field}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              <button className={button} disabled={busy}>
                Set up authenticator
              </button>
            </form>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(event) =>
                submit(event, async () => {
                  await client.request('/auth/mfa/confirm', 'POST', { id: totp.id, code });
                  await loadProfile();
                  setTotp(null);
                  setCode('');
                  setMessage('Authenticator enrolled.');
                })
              }
            >
              <p>
                Enter this secret into your authenticator app. It is shown only during setup:{' '}
                <code className="break-all">{totp.secret}</code>
              </p>
              <label className="block">
                Six-digit code
                <input
                  className={field}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  required
                />
              </label>
              <button className={button} disabled={busy}>
                Confirm authenticator
              </button>
            </form>
          )}
          {'PublicKeyCredential' in window && (
            <button
              className="rounded-lg border border-cyan-400 px-4 py-2"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const options = (
                    await client.request<{
                      data: Parameters<typeof startRegistration>[0]['optionsJSON'];
                    }>('/auth/passkeys/register/options', 'POST')
                  ).data;
                  const credential = await startRegistration({ optionsJSON: options });
                  await client.request('/auth/passkeys/register/verify', 'POST', credential);
                  setMessage('Passkey added.');
                })
              }
            >
              Add a passkey
            </button>
          )}
          <details className="rounded-lg border border-slate-600 p-4">
            <summary className="cursor-pointer font-semibold">Verify a sensitive action</summary>
            <p className="mt-2">
              Use your authenticator code before an administrator action. Verification is valid for
              five minutes.
            </p>
            {!challengeId ? (
              <button
                type="button"
                className="mt-3 rounded-lg border border-cyan-400 px-4 py-2"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await client.request<{ data: { challengeId: string } }>(
                      '/auth/mfa/challenge',
                      'POST',
                      { method: 'totp', action: 'account.step-up' },
                    );
                    setChallengeId(result.data.challengeId);
                    setMessage('Enter the current code from your authenticator.');
                  })
                }
              >
                Start verification
              </button>
            ) : (
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) =>
                  submit(event, async () => {
                    await client.request('/auth/mfa/verify', 'POST', { challengeId, code });
                    await loadProfile();
                    setChallengeId('');
                    setCode('');
                    setMessage('Security verification complete.');
                  })
                }
              >
                <label className="block">
                  Six-digit code
                  <input
                    className={field}
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                  />
                </label>
                <button className={button} disabled={busy}>
                  Verify code
                </button>
              </form>
            )}
          </details>
        </div>
      )}
      {profile && admin && (screen === 'user-admin' || screen === 'roles-admin') && (
        <AdminScreens mode={screen} currentUserId={profile.id} />
      )}
    </section>
  );
}
