# Arata TechLibrary

This repository contains the PostgreSQL schema, a versioned REST design contract, and a runnable React/NestJS development application. The live API serves health, a partial identity/account service, and a PostgreSQL-backed public catalogue. The public portal has book and series navigation, current editions and tables of contents, approved samples, search, filters, a Free Library, and text-resource detail pages. Payment, entitlement, full publishing, reader and research services remain future work; the design OpenAPI is not yet fully aligned with live routes.

## Start locally

Use Node 22 and npm 10. Follow [local setup](infrastructure/README.md) for database credentials, migrations, Redis and Docker. With the development database ready:

```powershell
npm ci
npm run foundation:init-env
npm run dev
```

Open `http://127.0.0.1:5173`. The catalogue needs approved publication records in the local development database. To load **fictional development samples only**, follow [catalogue setup](apps/api/CATALOGUE.md); the seed refuses non-development databases. Run `npm run foundation:check` with PostgreSQL and Redis available, then `npm run test:e2e`. The browser suite uses the built PWA preview and checks real catalogue flows, responsive layouts, accessibility rules and offline shell loading.

## Source references

- [Database setup and recovery](database/README.md)
- [OpenAPI contract and authorization design](api/README.md)
- [Public catalogue behavior and boundaries](apps/api/CATALOGUE.md)
- [Identity and account behavior](apps/api/IDENTITY.md)
- [Implementation progress and test evidence](Documentation/Implementation/PROGRESS.md)
- [Project operating rules](AGENTS.md)

The SRS and engineering source packages under `Documentation/` are local internal inputs and are excluded from the public Git repository. The SRS remains the requirements baseline; tracking records do not replace its pending stakeholder sign-off.
