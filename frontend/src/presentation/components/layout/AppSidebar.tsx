import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  filterNavigationEntries,
  getActiveGroupIds,
  navigationEntries,
  toggleExpandedGroup,
  type NavigationEntry,
} from '../../navigation/navigationConfig';
import { Icon } from './Icon';
import { useAuth } from '../../hooks/auth-context';

type AppSidebarProps = { isOpen: boolean; onNavigate: () => void };

export function AppSidebar({ isOpen, onNavigate }: AppSidebarProps): ReactElement {
  const location = useLocation();
  const { can, user, logout } = useAuth();
  const sidebarId = useId();
  const visibleEntries = useMemo(() => filterNavigationEntries(navigationEntries, can), [can]);
  const activeGroupIds = useMemo(() => getActiveGroupIds(visibleEntries, location.pathname), [location.pathname, visibleEntries]);
  const [openGroupIds, setOpenGroupIds] = useState<string[]>(activeGroupIds);

  useEffect(() => {
    const activeIds = getActiveGroupIds(visibleEntries, location.pathname);
    setOpenGroupIds((current) => Array.from(new Set([...current, ...activeIds])));
  }, [location.pathname, visibleEntries]);

  const toggleGroup = (groupId: string) => {
    setOpenGroupIds((current) => toggleExpandedGroup(current, groupId));
  };

  return (
    <aside id="app-navigation" className={`app-sidebar${isOpen ? ' app-sidebar--open' : ''}`} aria-label="Navegación principal">
      <div className="sidebar-identity">
        <div className="brand-mark" aria-hidden="true">P</div>
        <div><strong>Préstamos</strong><span>Gestión de cartera</span></div>
      </div>
      <nav className="sidebar-nav">
          {visibleEntries.map((entry) => renderEntry(entry, { activeGroupIds, openGroupIds, onNavigate, sidebarId, toggleGroup, depth: 0 }))}
       </nav>
       <footer className="sidebar-footer">
         <div className="sidebar-user" aria-label={`Usuario actual: ${user?.fullName ?? ''}`}>
           <span className="user-avatar" aria-hidden="true">{(user?.fullName ?? 'U').charAt(0)}</span>
           <span className="sidebar-user-details"><strong title={user?.fullName}>{user?.fullName}</strong><small title={user?.role.name}>{user?.role.name}</small></span>
         </div>
         <button className="sidebar-logout" type="button" onClick={() => void logout()}>Cerrar sesión</button>
       </footer>
     </aside>
  );
}

type NavigationRenderContext = {
  activeGroupIds: string[];
  openGroupIds: string[];
  onNavigate: () => void;
  sidebarId: string;
  toggleGroup: (groupId: string) => void;
  depth: number;
};

function renderEntry(entry: NavigationEntry, context: NavigationRenderContext): ReactElement {
  if (entry.type === 'link') {
    return <NavLink key={entry.id} to={entry.path} end={entry.path === '/dashboard' || entry.path === '/loans'} onClick={context.onNavigate} className={({ isActive }) => `nav-link${context.depth > 0 ? ' nav-link--child' : ''}${isActive ? ' nav-link--active' : ''}`}>
      <Icon name={entry.icon} /><span>{entry.label}</span>
    </NavLink>;
  }

  const isOpen = context.openGroupIds.includes(entry.id);
  const groupId = `${context.sidebarId}-${entry.id.replace(/[^a-z0-9_-]+/gi, '-')}`;
  return <div className={`nav-group${context.activeGroupIds.includes(entry.id) ? ' nav-group--active' : ''}`} key={entry.id}>
    <button className="nav-group-button" type="button" aria-expanded={isOpen} aria-controls={groupId} onClick={() => context.toggleGroup(entry.id)}>
      <span className="nav-group-label"><Icon name={entry.icon} /><span>{entry.label}</span></span><span className="nav-group-chevron" aria-hidden="true">⌄</span>
    </button>
    <div className={`nav-group-items${isOpen ? ' nav-group-items--open' : ''}`} id={groupId} hidden={!isOpen}>
      {isOpen && entry.items.map((item) => renderEntry(item, { ...context, depth: context.depth + 1 }))}
    </div>
  </div>;
}

