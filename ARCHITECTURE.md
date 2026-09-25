# Architecture

This repository is a minimal Clean Architecture foundation. The dependency direction points inward so future business rules can remain independent of NestJS, TypeORM, React, and Vite.

## Layer responsibilities

| Layer | Responsibility | Forbidden dependencies |
| --- | --- | --- |
| `domain` | Framework-independent business concepts, rules, and ports | NestJS, TypeORM, React, Vite, HTTP, database clients |
| `application` | Use cases, orchestration, and application-facing contracts | Controllers, UI components, TypeORM entities, database clients |
| `infrastructure` | TypeORM, PostgreSQL, configuration, and external adapters implementing inner ports | Owning business rules or bypassing application contracts |
| `presentation` | HTTP/UI transport, input/output mapping, controllers, pages, and components | Direct database or TypeORM access; persistence decisions |
| `shared` | Small reusable technical utilities and styles | Business ownership, framework-specific rules required by inner layers |

Infrastructure and presentation are outer adapters. They may depend on application and domain abstractions, but inner layers must not depend on them. Composition roots are the only place where concrete implementations are wired together.

## Backend

```text
backend/src/
├── domain/          entities, value objects, repositories, services, and errors
├── application/     use cases, DTOs, ports, and services
├── infrastructure/ database/TypeORM adapters, configuration, and persistence
├── presentation/    HTTP transport adapters (health endpoint retained here)
└── shared/          constants, types, and utilities
```

`main.ts` and `app.module.ts` are composition-root concerns. TypeORM and PostgreSQL configuration remain in infrastructure/composition code, with `synchronize` disabled. The backend contains the controlled, read-only Costa Rica DTA 2026 reference catalog under `infrastructure/database/typeorm`, normalized to 7 provinces, 84 cantons, and 494 districts; numeric geographic codes are its primary keys and parent foreign keys. It also contains user-manageable configuration catalogs, `PaymentMethod` and `PaymentFrequency`, with UUID identity and soft activation/deactivation but no physical deletion. Territorial data is loaded only through migration and idempotent seed commands; configuration is exposed through read/write application use cases and APIs. `PaymentFrequency` records define interval units and values; a future monthly loan schedule should anchor its due-day rule explicitly rather than infer it from this catalog. Customer registration is exposed only through `POST /customers`; uploaded images are kept by the local storage adapter under `backend/uploads/clientes/...`, represented in the database by relative keys, and are not served as public static files. This storage is not an authentication or authorization boundary.

Security uses software-registered dynamic permissions, one role per user, and a true superadmin bypass for the system `ADMIN` role. Authentication uses server-side opaque sessions with Argon2id password hashes; only the hash of each session token is persisted and the raw token is delivered through an HttpOnly cookie. The current authenticated actor is resolved by the backend on every request, and frontend visibility is convenience only—not authorization. Future collector features must add resource-scoped permissions and backend ownership checks rather than relying on client-side filtering.

## Frontend

```text
frontend/src/
├── app/             application composition and root component
├── domain/          entities, value objects, and repositories
├── application/     use cases, DTOs, and ports
├── infrastructure/ API, repository, storage, and configuration adapters
├── presentation/    components, pages, layouts, hooks, and routes
└── shared/          components, constants, types, utilities, and styles
```

The frontend currently retains its `app` composition root, `FoundationPage`, and styles while the remaining layer directories are empty future-facing boundaries. When a feature is explicitly requested, its domain and application code must remain independent of React, Vite, browser APIs, and HTTP clients. `app` wires concrete adapters; it does not become a business layer.

## Explicit non-goals

- No lending, payment transaction, collector assignment, or user-deletion domain model exists yet; customer scope includes registration, administration, and address/document storage. `PaymentMethod` and `PaymentFrequency` are configuration only. Monthly anchor-day scheduling remains future domain behavior.
- No frontend API client or authentication flow is speculative at this stage.
