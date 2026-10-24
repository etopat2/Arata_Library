import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, createApiClient } from '@arata/api-client';

type Mode = 'user-admin' | 'roles-admin';
type User = {
  id: string;
  email: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
};
type Role = { code: string; description: string | null };
const client = createApiClient();

export function AdminScreens({ mode, currentUserId }: { mode: Mode; currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [role, setRole] = useState('AUTHOR');
  const [targetId, setTargetId] = useState('');

  async function load() {
    const [directory, catalogue] = await Promise.all([
      client.request<{ data: User[] }>('/admin/users?limit=100'),
      client.request<{ data: Role[] }>('/admin/roles'),
    ]);
    setUsers(directory.data);
    setRoles(catalogue.data);
  }
  useEffect(() => {
    void load().catch((caught) => setError(describe(caught)));
  }, []);
  function describe(caught: unknown) {
    if (caught instanceof ApiError && caught.status === 403)
      return 'Administrator access or recent MFA verification is required. Open Devices and sessions to verify, then return here.';
    if (caught instanceof ApiError && caught.status === 429)
      return 'Too many attempts. Wait and retry.';
    return 'The administrator request could not be completed.';
  }
  function submit(event: FormEvent<HTMLFormElement>, action: () => Promise<void>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    void action()
      .catch((caught) => setError(describe(caught)))
      .finally(() => setBusy(false));
  }
  const field = 'w-full rounded-lg border border-slate-500 bg-slate-900 p-3 text-white';
  const button =
    'rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50';

  return (
    <section aria-labelledby="admin-heading" className="mt-6 space-y-6">
      <h3 id="admin-heading" className="text-xl font-semibold">
        {mode === 'user-admin' ? 'User administration' : 'Roles and permissions'}
      </h3>
      <p>Changes require a current administrator session, MFA and a recorded reason.</p>
      {error && (
        <p role="alert" className="rounded-lg border border-red-400 p-3 text-red-300">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-lg border border-emerald-400 p-3 text-emerald-300">
          {message}
        </p>
      )}
      {busy && <p role="status">Working…</p>}
      {mode === 'user-admin' && (
        <>
          <form
            className="space-y-3"
            onSubmit={(event) =>
              submit(event, async () => {
                await client.request('/admin/users', 'POST', { email });
                setEmail('');
                setMessage('If the address is available, an invitation has been sent.');
                await load();
              })
            }
          >
            <h4 className="font-semibold">Invite a reader</h4>
            <label className="block">
              Email address
              <input
                className={field}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button className={button} disabled={busy}>
              Send invitation
            </button>
          </form>
          <h4 className="font-semibold">Accounts</h4>
          {users.length === 0 ? (
            <p>No accounts to display.</p>
          ) : (
            <ul className="space-y-3">
              {users.map((user) => (
                <li key={user.id} className="rounded-lg border border-slate-600 p-3">
                  <strong>{user.email}</strong> · {user.status} ·{' '}
                  {user.emailVerified ? 'verified' : 'pending verification'}
                  {user.id !== currentUserId && (
                    <form
                      className="mt-3 flex flex-wrap items-end gap-3"
                      onSubmit={(event) =>
                        submit(event, async () => {
                          const next = user.status === 'suspended' ? 'active' : 'suspended';
                          await client.request(`/admin/users/${user.id}/status`, 'PATCH', {
                            status: next,
                            reason,
                          });
                          setReason('');
                          setMessage(`Account ${next === 'active' ? 'restored' : 'suspended'}.`);
                          await load();
                        })
                      }
                    >
                      <label className="flex-1">
                        Reason
                        <input
                          className={field}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          minLength={5}
                          maxLength={500}
                          required
                        />
                      </label>
                      <button className={button} disabled={busy}>
                        {user.status === 'suspended' ? 'Restore' : 'Suspend'}
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {mode === 'roles-admin' && (
        <>
          <ul className="space-y-2">
            {roles.map((item) => (
              <li key={item.code} className="rounded-lg border border-slate-600 p-3">
                <strong>{item.code}</strong> — {item.description}
              </li>
            ))}
          </ul>
          <form
            className="space-y-3"
            onSubmit={(event) =>
              submit(event, async () => {
                await client.request('/admin/role-assignments', 'POST', {
                  userId: targetId,
                  role,
                  reason,
                });
                setReason('');
                setMessage('Role assigned. Access still depends on resource scope and policy.');
              })
            }
          >
            <h4 className="font-semibold">Assign a nonadministrator role</h4>
            <label className="block">
              Verified user
              <select
                className={field}
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                required
              >
                <option value="">Select a user</option>
                {users
                  .filter(
                    (user) =>
                      user.id !== currentUserId && user.status === 'active' && user.emailVerified,
                  )
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              Role
              <select
                className={field}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {roles
                  .filter((item) => ['READER', 'AUTHOR', 'EDITOR', 'PUBLISHER'].includes(item.code))
                  .map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              Reason
              <input
                className={field}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={5}
                maxLength={500}
                required
              />
            </label>
            <button className={button} disabled={busy}>
              Assign role
            </button>
          </form>
          <p>
            Administrator role changes and permission catalogue changes require independent approval
            and are unavailable in this screen.
          </p>
        </>
      )}
    </section>
  );
}
