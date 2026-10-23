import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      className="rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ online }: { online: boolean }) {
  return (
    <span
      role="status"
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${online ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}
    >
      {online ? 'API available' : 'API unavailable'}
    </span>
  );
}
