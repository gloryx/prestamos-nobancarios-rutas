import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { territorialUseCases } from '../../app/territorial';
import type { Canton, Province } from '../../domain/entities/territorial';
import { CatalogStates, SearchField } from '../components/catalog/CatalogStates';

export function ProvincesPage(): ReactElement {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [cantons, setCantons] = useState<Canton[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Province | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let ignore = false; Promise.all([territorialUseCases.listProvinces.execute(), territorialUseCases.listCantons.execute()]).then(([items, related]) => { if (!ignore) { setProvinces(items); setCantons(related); setLoading(false); } }).catch((reason: unknown) => { if (!ignore) { setError(reason instanceof Error ? reason.message : 'No se pudo cargar la información.'); setLoading(false); } }); return () => { ignore = true; }; }, []);
  const filtered = useMemo(() => provinces.filter((item) => `${item.code} ${item.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [provinces, search]);
  const selectedCantons = selected ? cantons.filter((item) => item.province.code === selected.code) : [];
   return <section className="catalog-page" aria-labelledby="page-title"><div className="catalog-heading"><div><h2 id="page-title">Provincias</h2><p>División territorial de Costa Rica</p></div><span className="catalog-count">{filtered.length} de {provinces.length}</span></div><div className="catalog-toolbar"><SearchField value={search} onChange={setSearch} /></div><CatalogStates loading={loading} error={error} empty={!loading && !error && filtered.length === 0} />{!loading && !error && filtered.length > 0 && <div className="catalog-layout"><div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Código</th><th>Provincia</th><th>Cantones</th></tr></thead><tbody>{filtered.map((province) => <tr key={province.code} className={selected?.code === province.code ? 'catalog-row--selected' : ''} onClick={() => setSelected(province)}><td>{province.code}</td><td>{province.name}</td><td>{cantons.filter((canton) => canton.province.code === province.code).length}</td></tr>)}</tbody></table></div>{selected && <aside className="catalog-detail"><h3>{selected.name}</h3><p>{selectedCantons.length} cantones asociados</p><ul>{selectedCantons.map((canton) => <li key={canton.code}><strong>{canton.code}</strong> {canton.name}</li>)}</ul></aside>}</div>}</section>;
}
