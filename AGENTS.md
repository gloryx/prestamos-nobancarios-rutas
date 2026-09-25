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