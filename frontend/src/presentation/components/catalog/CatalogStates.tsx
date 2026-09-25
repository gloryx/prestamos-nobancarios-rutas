import type { ReactElement } from 'react';

export function CatalogStates({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }): ReactElement | null {
  if (loading) return <div className="catalog-message">Cargando información territorial…</div>;
  if (error) return <div className="catalog-message catalog-message--error" role="alert">{error}</div>;
  if (empty) return <div className="catalog-message">No se encontraron registros.</div>;
  return null;
}

export function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }): ReactElement {
  return <label className="catalog-search">Buscar<input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Nombre o código" /></label>;
}
