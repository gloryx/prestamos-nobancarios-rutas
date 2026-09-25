import { useEffect, useId, useState, type ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { navigationEntries, type NavigationGroup, type NavigationLink } from '../../navigation/navigationConfig';
import { Icon } from './Icon';
import { useAuth } from '../../hooks/auth-context';

type AppSidebarProps = { isOpen: boolean; onNavigate: () => void };

export function AppSidebar({ isOpen, onNavigate }: AppSidebarProps): ReactElement {
  const location = useLocation();
  const { can } = useAuth();
  const sidebarId = useId();
  const visibleEntries = navigationEntries.map((entry) => entry.type === 'group' ? { ...entry, items: entry.items.filter((item) => !item.requiredPermission || can(item.requiredPermission)) } : entry).filter((entry) => entry.type === 'link' ? (!entry.requiredPermission || can(entry.requiredPermission)) : entry.items.length);
  const groups = visibleEntries.filter((entry): entry is NavigationGroup => entry.type === 'group');
  const activeGroupLabels = groups.filter((group) => group.items.some((item) => isPathActive(item, location.pathname))).map((group) => group.label);
  const [openGroups, setOpenGroups] = useState<string[]>(activeGroupLabels);

  useEffect(() => {
    const activeLabels = groups.filter((group) => group.items.some((item) => isPathActive(item, location.pathname))).map((group) => group.label);
    setOpenGroups((current) => Array.from(new Set([...current, ...activeLabels])));
  }, [location.pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups((current) => current.includes(label) ? current.filter((item) => item !== label) : [...current, label]);
  };

  return (
    <aside id="app-navigation" className={`app-sidebar${isOpen ? ' app-sidebar--open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-identity">
        <div className="brand-mark" aria-hidden="true">P</div>
        <div><strong>Préstamos</strong><span>Gestión de cartera</span></div>
      </div>
      <nav className="sidebar-nav">
         {visibleEntries.map((entry) => entry.type === 'link' ? (
          <NavLink key={entry.path} to={entry.path} end={entry.path === '/dashboard'} onClick={onNavigate} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
            <Icon name={entry.icon} /><span>{entry.label}</span>
          </NavLink>
        ) : (
          <div className={`nav-group${activeGroupLabels.includes(entry.label) ? ' nav-group--active' : ''}`} key={entry.label}>
            <button className="nav-group-button" type="button" aria-expanded={openGroups.includes(entry.label)} aria-controls={`${sidebarId}-${slugify(entry.label)}`} onClick={() => toggleGroup(entry.label)}>
               <span className="nav-group-label"><Icon name={entry.icon} /><span>{entry.label}</span></span><span className="nav-group-chevron" aria-hidden="true">⌄</span>
            </button>
             <div className={`nav-group-items${openGroups.includes(entry.label) ? ' nav-group-items--open' : ''}`} id={`${sidebarId}-${slugify(entry.label)}`} hidden={!openGroups.includes(entry.label)}>
               {openGroups.includes(entry.label) && entry.items.map((item) => (
                <NavLink key={item.path} to={item.path} onClick={onNavigate} className={({ isActive }) => `nav-link nav-link--child${isActive ? ' nav-link--active' : ''}`}>
                  <Icon name={item.icon} /><span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function isPathActive(item: NavigationLink, pathname: string): boolean {
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

function slugify(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
