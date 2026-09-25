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
