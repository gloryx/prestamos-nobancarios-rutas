# Project Instructions

## Scope

The current request defines the active target. Preserve the minimal foundation and do not introduce business-domain modules, entities, workflows, migrations, or speculative integrations without an explicit request.

## Before changing code

1. Inspect the implementation and relevant architecture boundaries.
2. Make the smallest change that satisfies the request.
3. Keep backend and frontend independently runnable.
4. Run the relevant build, lint, and test commands after changes.

## Architecture

- Use Clean Architecture in both applications: domain and application remain inward and framework-independent; infrastructure owns external adapters and persistence; presentation owns transport/UI concerns; shared contains only reusable technical code.
- Backend domain code must not depend on NestJS, TypeORM, PostgreSQL, or HTTP transport.
- Backend infrastructure owns TypeORM and PostgreSQL configuration and implements inner-layer ports.
- Backend presentation owns HTTP transport concerns and must not access persistence directly.
- Frontend domain and application code must not depend on React, Vite, browser APIs, or HTTP clients.
- Frontend application composition is separate from presentation and shared code; concrete adapters are wired at the composition root.
- Inner layers must not import outer layers or framework-specific infrastructure.
- Do not create nested `backend/backend` or `frontend/frontend` directories.

## Git and database safety

- Do not commit or push unless explicitly requested.
- Do not run destructive Git commands.
- Do not create or modify database schema unless explicitly required.

## Non-Regression and Existing Functionality Preservation

Existing implemented functionality is considered intentional and must be
preserved unless the user explicitly requests its removal or replacement.

When modifying an existing module:

- Do NOT remove existing actions, buttons, routes, endpoints, fields,
  reports, filters, dialogs, or workflows unless explicitly requested.
- Do NOT interpret a refactor, security change, RBAC integration, design
  change, or architectural improvement as permission to reduce functionality.
- New functionality must extend or constrain access to existing capabilities,
  not silently replace them.

### Authorization changes

When adding or modifying authentication, roles, permissions, or authorization:

- Existing business actions must remain implemented.
- RBAC must control WHO can see/execute an action, not remove the action itself.
- Frontend permission checks affect presentation only.
- Backend permission guards remain authoritative.
- `isSuperAdmin === true` must always bypass normal explicit permission checks.
- Never work around superadmin behavior by manually assigning every permission
  to the ADMIN role.
- Permission checks must use the centralized authorization helper/guard.
- Do not introduce scattered direct role comparisons such as:
  `role === 'ADMIN'`.

Example:

Before RBAC:

Customer actions:
- View
- Edit
- Download expediente
- Activate/Inactivate

After RBAC, these actions must still exist:

- View -> customers.view
- Edit -> customers.update
- Download expediente -> customers.export
- Activate/Inactivate -> customers.status.change

RBAC may hide or reject an action for an unauthorized user, but must not
delete the underlying capability.

### Feature inventory before changes

Before changing an existing module, inspect and identify its current
user-visible and API capabilities.

For the affected module, compare BEFORE vs AFTER:

- routes
- page actions
- row actions
- filters
- reports/exports
- dialogs
- API endpoints
- permission requirements
- responsive behavior

Any capability missing after the change must be treated as a regression unless
its removal was explicitly requested.

### Definition of Done for existing modules

A change to an existing module is not complete until:

1. Existing functionality has been reviewed.
2. Intended existing functionality still works.
3. New behavior works.
4. Relevant role/permission behavior is verified.
5. Superadmin behavior is verified where authorization is involved.
6. Build and lint pass.
7. Existing tests pass.
8. Regression tests are added for functionality affected by the change.

If preserving an existing capability conflicts with the requested change,
stop and report the conflict rather than silently removing functionality.

## RBAC Invariant

Authorization is an access-control layer, not a feature-definition layer.

Business capabilities exist independently from role assignments.

A permission determines whether a user may access an existing capability.
Removing a permission from a role must never remove the capability from the
application itself.

Superadmin invariant:

`isSuperAdmin === true` -> every registered application capability is allowed.

This rule must be implemented centrally in backend and frontend authorization
helpers and covered by regression tests.

## Standard table action pattern

All current and future administrative tables that contain an `Acciones`
column must use the same compact action pattern established by the Customers
table.

This applies to current modules and all future modules, including but not
limited to:

- Clientes
- Usuarios
- Cobradores
- Préstamos
- Cobros
- Pagos
- Liquidaciones
- Rutas
- Asignaciones
- Garantías
- Reportes
- any future administrative listing

### Visual standard

Row actions must use:

- compact icons/links;
- consistent icon size;
- consistent spacing;
- consistent hover/focus treatment;
- consistent disabled state;
- tooltips;
- accessible `aria-label`s;
- the project's existing icon system.

Do not use large text buttons inside table rows.

Do not introduce a different action style per module.

### Semantic behavior

Use a navigation Link when the action navigates.

Use a Button when the action performs a mutation or opens a dialog.

Do not use clickable divs.

### Ordering

Use a consistent action order when applicable:

1. View
2. Edit
3. Domain-specific operation
4. Download/export/document
5. Status action

Not every table needs every category, but applicable actions should follow this
order.

### Status

Activate/Inactivate actions must use the same icon and interaction pattern
across the entire application.

Do not replace status actions with switches in isolated modules unless the
global design system is deliberately changed.

### Permissions

RBAC controls whether an action is available.

Unauthorized actions should not be rendered.

Superadmin behavior must use the centralized authorization helper.

Do not hardcode role names in table components.

### Future modules

When creating a new table with row actions:

1. Inspect the existing shared table-action component/style.
2. Reuse it.
3. Do not invent a new action design.
4. Add domain-specific actions through the existing pattern.
5. Preserve keyboard and mobile accessibility.

Creating a new independent table-action visual pattern is prohibited unless
the user explicitly requests a global redesign.

### Responsive behavior

All action columns must follow the same responsive strategy.

If the established design switches to an overflow menu at a narrow breakpoint,
all future tables should use that same behavior.

Do not create module-specific mobile action behavior without explicit reason.

### Non-regression

A visual refactor must never remove existing actions.

Existing capabilities remain unless explicitly removed by the user.