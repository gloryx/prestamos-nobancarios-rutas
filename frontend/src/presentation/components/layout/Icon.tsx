import type { ReactElement } from 'react';
import type { NavigationIcon } from '../../navigation/navigationConfig';

export type TableActionIcon = NavigationIcon | 'edit' | 'view' | 'lock' | 'unlock' | 'download' | 'key' | 'photo' | 'user-link' | 'reverse';
type IconProps = { name: TableActionIcon };

export function Icon({ name }: IconProps): ReactElement {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

   if (name === 'administration') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
   if (name === 'dashboard') return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
   if (name === 'users') return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
   if (name === 'edit') return <svg {...common}><path d="m4 16 10-10 4 4L8 20H4v-4Z" /><path d="m13 7 4 4M14 20h6" /></svg>;
   if (name === 'view') return <svg {...common}><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
    if (name === 'download') return <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>;
    if (name === 'key') return <svg {...common}><circle cx="8" cy="15" r="3" /><path d="m10.5 12.5 8-8M15 7l2 2M17 5l2 2" /></svg>;
    if (name === 'photo') return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 3 3 2-2 6 5" /></svg>;
    if (name === 'user-link') return <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M2.5 19a5.5 5.5 0 0 1 11 0M15 8h5M17.5 5.5 20 8l-2.5 2.5" /></svg>;
    if (name === 'lock' || name === 'unlock') return <svg {...common}><rect x="5" y="10" width="14" height="10" rx="2" /><path d={name === 'lock' ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 7-2'} /></svg>;
    if (name === 'reverse') return <svg {...common}><path d="M4 7h10a6 6 0 1 1-4.2 10.2M4 7l3-3M4 7l3 3" /></svg>;
  if (name === 'roles') return <svg {...common}><path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === 'location') return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
  if (name === 'payment') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></svg>;
   if (name === 'route') return <svg {...common}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h4a4 4 0 0 0 4-4V8" /></svg>;
   return <svg {...common}><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.41 1.41M16.95 16.95l1.41 1.41M5.64 18.36l1.41-1.41M16.95 7.05l1.41-1.41" /><circle cx="12" cy="12" r="3.5" /></svg>;
}
