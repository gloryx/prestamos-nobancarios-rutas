import { useEffect, useMemo, useState, type ReactElement } from "react";
import { security } from "../../app/security";
import type {
  PermissionRecord,
  RoleRecord,
} from "../../application/ports/security.repository";
import { useAuth } from "../hooks/auth-context";
export function RolesPage(): ReactElement {
  const { can } = useAuth();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [selected, setSelected] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const role = roles.find((item) => item.id === selected);
  useEffect(() => {
    void Promise.all([security.roles.list(), security.roles.allPermissions()])
      .then(([r, p]) => {
        setRoles(r);
        setPermissions(p);
        setSelected(r[0]?.id ?? "");
      })
      .catch(() => setError("No se pudieron cargar roles y permisos."));
  }, []);
  useEffect(() => {
    if (selected)
      void security.roles
        .permissions(selected)
        .then((result) => setCodes(result.permissionCodes));
  }, [selected]);
  const groups = useMemo(
    () =>
      permissions.reduce<Record<string, PermissionRecord[]>>(
        (result, permission) => {
          (result[permission.module] ??= []).push(permission);
          return result;
        },
        {},
      ),
    [permissions],
  );
  const save = async () => {
    try {
      await security.roles.save(selected, codes);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudieron guardar permisos.",
      );
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
      {error && (
        <div className="catalog-message catalog-message--error">{error}</div>
      )}
      <div className="roles-layout">
        <aside className="role-list">
          <h3>Roles</h3>
          {roles.map((item) => (
            <button
              className={item.id === selected ? "role-selected" : ""}
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              {item.name}
            </button>
          ))}
        </aside>
        <article className="permission-panel">
          {role?.isSuperAdmin || role?.code === "ADMIN" ? (
            <>
              <h3>{role.name}</h3>
              <p className="success-message">
                Este rol tiene acceso total como superadministrador. La matriz
                no es editable.
              </p>
            </>
          ) : (
            <>
              <div className="permission-heading">
                <h3>Permisos de {role?.name}</h3>
                {can("roles.permissions.update") && (
                  <button
                    className="button button--primary"
                    onClick={() => void save()}
                  >
                    Guardar cambios
                  </button>
                )}
              </div>
              {saved && (
                <div className="success-message">Permisos guardados.</div>
              )}
              {Object.entries(groups).map(([module, values]) => (
                <fieldset className="permission-group" key={module}>
                  <legend>{module}</legend>
                  {values.map((permission) => (
                    <label key={permission.code}>
                      <input
                        type="checkbox"
                        checked={codes.includes(permission.code)}
                        disabled={!can("roles.permissions.update")}
                        onChange={() =>
                          setCodes((current) =>
                            current.includes(permission.code)
                              ? current.filter(
                                  (code) => code !== permission.code,
                                )
                              : [...current, permission.code],
                          )
                        }
                      />
                      {permission.name || permission.code}
                      <small>{permission.code}</small>
                    </label>
                  ))}
                </fieldset>
              ))}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
