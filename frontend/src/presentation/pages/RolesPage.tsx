import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { security } from '../../app/security';
import type { PermissionRecord, RoleRecord } from '../../application/ports/security.repository';
import { useAuth } from '../hooks/auth-context';
import {
  buildPermissionGroups,
  canSavePermissions,
  filterPermissionGroups,
  permissionSetsEqual,
  setModulePermissions,
  shouldConfirmRoleSwitch,
  toggleModule,
  togglePermission,
} from '../helpers/permission-matrix';

const UNSAVED_ROLE_SWITCH_MESSAGE = 'Hay cambios de permisos sin guardar.\n\n¿Deseas descartarlos?';

export function RolesPage(): ReactElement {
  const { can } = useAuth();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [originalCodes, setOriginalCodes] = useState<string[]>([]);
  const [draftCodes, setDraftCodes] = useState<string[]>([]);
  const [openModules, setOpenModules] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(0);
  const role = roles.find((item) => item.id === selected);
  const authorized = can('roles.permissions.update');
  const dirty = !permissionSetsEqual(originalCodes, draftCodes);
  const superadmin = Boolean(role?.isSuperAdmin || role?.code === 'ADMIN');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([security.roles.list(), security.roles.allPermissions()])
      .then(([loadedRoles, loadedPermissions]) => {
        if (!active) return;
        setRoles(loadedRoles);
        setPermissions(loadedPermissions);
        setSelected(loadedRoles[0]?.id ?? '');
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError('No se pudieron cargar roles y permisos.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const currentRequest = ++requestId.current;
    if (superadmin) {
      setOriginalCodes([]);
      setDraftCodes([]);
      setPermissionLoading(false);
      return;
    }
    setPermissionLoading(true);
    setError('');
    void security.roles
      .permissions(selected)
      .then((result) => {
        if (currentRequest !== requestId.current) return;
        const nextCodes = [...result.permissionCodes];
        setOriginalCodes(nextCodes);
        setDraftCodes(nextCodes);
      })
      .catch((cause) => {
        if (currentRequest === requestId.current) {
          setOriginalCodes([]);
          setDraftCodes([]);
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los permisos.');
        }
      })
      .finally(() => {
        if (currentRequest === requestId.current) setPermissionLoading(false);
      });
  }, [selected, superadmin]);

  const groups = useMemo(() => buildPermissionGroups(permissions), [permissions]);
  const visibleGroups = useMemo(() => filterPermissionGroups(groups, search), [groups, search]);

  const selectRole = (nextRoleId: string) => {
    if (nextRoleId === selected) return;
    if (shouldConfirmRoleSwitch(dirty, selected, nextRoleId) && !window.confirm(UNSAVED_ROLE_SWITCH_MESSAGE)) return;
    setSelected(nextRoleId);
    setOriginalCodes([]);
    setDraftCodes([]);
    setOpenModules([]);
    setSearch('');
    setSaved(false);
  };

  const save = async () => {
    if (!selected || !canSavePermissions({ dirty, isSuperAdmin: superadmin, authorized, loading: loading || permissionLoading, saving })) return;
    setSaving(true);
    setError('');
    try {
      const result = await security.roles.save(selected, draftCodes);
      const nextCodes = [...result.permissionCodes];
      setOriginalCodes(nextCodes);
      setDraftCodes(nextCodes);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar permisos.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="security-page">
      <div className="payment-heading">
        <div>
          <p className="eyebrow">SEGURIDAD</p>
          <h2>Roles y permisos</h2>
          <p>Configura el acceso usando únicamente permisos registrados.</p>
        </div>
      </div>
      {error && <div className="catalog-message catalog-message--error" role="alert">{error}</div>}
      <div className="roles-layout">
        <aside className="role-list" aria-label="Lista de roles">
          <h3>Roles</h3>
          {roles.map((item) => (
            <button type="button" className={item.id === selected ? 'role-selected' : ''} key={item.id} onClick={() => selectRole(item.id)}>
              {item.name}
            </button>
          ))}
        </aside>
        <article className="permission-panel">
          {loading ? (
            <div className="catalog-message">Cargando roles y permisos…</div>
          ) : !role ? (
            <div className="catalog-message">No hay roles disponibles.</div>
          ) : superadmin ? (
            <div className="superadmin-summary">
              <strong>ADMINISTRADOR</strong>
              <span>Superusuario</span>
              <p>Acceso completo al sistema y a futuros permisos.</p>
            </div>
          ) : (
            <div className="permission-workspace">
              <div className="permission-heading">
                <div>
                  <h3>Permisos de {role.name}</h3>
                  <p className="permission-hint">Los cambios se aplican al guardar.</p>
                </div>
              </div>
              <label className="permission-search">
                Buscar permiso
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar permiso..." />
              </label>
              {saved && <div className="success-message" role="status">Permisos guardados.</div>}
              {permissionLoading ? (
                <div className="catalog-message">Cargando permisos…</div>
              ) : visibleGroups.length === 0 ? (
                <div className="catalog-message">No se encontraron permisos.</div>
              ) : (
                <div className="permission-accordion">
                  {visibleGroups.map((group, index) => {
                    const panelId = `permission-panel-${index}`;
                    const expanded = openModules.includes(group.module) || Boolean(search.trim());
                    const selectedCount = group.permissions.filter((permission) => draftCodes.includes(permission.code)).length;
                    return (
                      <section className="permission-group" key={group.module}>
                        <h4>
                          <button type="button" className="permission-group__header" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpenModules((current) => toggleModule(current, group.module))}>
                            <span>{group.label}</span>
                            <span className="permission-counter">{selectedCount}/{group.permissions.length}</span>
                            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
                          </button>
                        </h4>
                        {expanded && <div className="permission-group__body" id={panelId}>
                          <div className="permission-group__actions">
                            <button type="button" className="button button--secondary" disabled={!authorized || permissionLoading} onClick={() => setDraftCodes((current) => setModulePermissions(current, group, true))}>Seleccionar todos</button>
                            <button type="button" className="button button--secondary" disabled={!authorized || permissionLoading} onClick={() => setDraftCodes((current) => setModulePermissions(current, group, false))}>Quitar todos</button>
                          </div>
                          <fieldset className="permission-options">
                            <legend className="sr-only">Permisos de {group.label}</legend>
                            {group.permissions.map((permission) => (
                              <label key={permission.code}>
                                <input type="checkbox" checked={draftCodes.includes(permission.code)} disabled={!authorized || permissionLoading} onChange={() => setDraftCodes((current) => togglePermission(current, permission.code))} />
                                <span>{permission.name || permission.code}<small>{permission.code}</small></span>
                              </label>
                            ))}
                          </fieldset>
                        </div>}
                      </section>
                    );
                  })}
                </div>
              )}
              <div className="permission-save-bar">
                <span>{dirty ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.'}</span>
                <button type="button" className="button button--primary" disabled={!canSavePermissions({ dirty, isSuperAdmin: superadmin, authorized, loading: loading || permissionLoading, saving })} onClick={() => void save()}>
                  {saving ? 'Guardando…' : 'Guardar permisos'}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
