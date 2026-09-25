import type { ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { navigationEntries } from '../../navigation/navigationConfig';
import { useAuth } from '../../hooks/auth-context';

type AppHeaderProps = { onMenuToggle: () => void; isMenuOpen: boolean };

export function AppHeader({ onMenuToggle, isMenuOpen }: AppHeaderProps): ReactElement {
  const location = useLocation();
  const currentItem = navigationEntries.flatMap((entry) => entry.type === 'group' ? entry.items : [entry]).find((item) => item.path === location.pathname);
  const { user, logout } = useAuth();
  return (
    <header className="app-header">
      <div className="header-title-wrap">
        <button className="menu-button" type="button" onClick={onMenuToggle} aria-label="Abrir menú de navegación" aria-expanded={isMenuOpen} aria-controls="app-navigation">
          <span /><span /><span />
        </button>
        <h1>{currentItem?.label ?? 'Inicio'}</h1>
      </div>
       <div className="header-user" aria-label={`Usuario actual: ${user?.fullName ?? ''}`}><span className="user-avatar">{(user?.fullName ?? 'U').charAt(0)}</span><span>{user?.fullName}<small>{user?.role.name}</small></span><button className="header-logout" type="button" onClick={() => void logout()}>Cerrar sesión</button></div>
    </header>
  );
}
