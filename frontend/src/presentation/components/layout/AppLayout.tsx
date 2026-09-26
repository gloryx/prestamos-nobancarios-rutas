import { useEffect, useState, type ReactElement } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';

export function AppLayout(): ReactElement {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setIsMenuOpen(false), [location.pathname]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMenuOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.toggle('drawer-open', isMenuOpen);
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.classList.remove('drawer-open'); };
  }, [isMenuOpen]);

  return <div className="app-shell">
    <AppSidebar isOpen={isMenuOpen} onNavigate={() => setIsMenuOpen(false)} />
    <button className={`drawer-backdrop${isMenuOpen ? ' drawer-backdrop--visible' : ''}`} type="button" aria-label="Cerrar menú" onClick={() => setIsMenuOpen(false)} />
    <button className="menu-button shell-menu-button" type="button" onClick={() => setIsMenuOpen((open) => !open)} aria-label="Abrir menú de navegación" aria-expanded={isMenuOpen} aria-controls="app-navigation">
      <span /><span /><span />
    </button>
    <main className="app-main"><div className="page-content"><Outlet /></div></main>
  </div>;
}
