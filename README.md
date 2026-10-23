# Arata TechLibrary

This repository contains the validated PostgreSQL schema, the versioned REST design contract, and a runnable development foundation. The implemented application currently serves public liveness and service-authenticated database readiness. Catalogue, reader, account, payment, publishing and research operations in the API design contract are future service work.

## Start locally

Use Node 22 and npm 10. Follow [local setup](infrastructure/README.md) for database credentials, migrations, Redis and Docker. With the development database ready:

```powershell
npm ci
npm run foundation:init-env
npm run dev
```

Open `http://127.0.0.1:5173`. Run `npm run foundation:check` with PostgreSQL and Redis available, then `npm run test:e2e`. The browser suite uses the built PWA preview and checks offline shell loading.

## Source references

- [Database setup and recovery](database/README.md)
- [OpenAPI contract and authorization design](api/README.md)
- [Implementation progress and test evidence](Documentation/Implementation/PROGRESS.md)
- [Project operating rules](AGENTS.md)

The SRS and engineering source packages under `Documentation/` are local internal inputs and are excluded from the public Git repository. The SRS remains the requirements baseline; tracking records do not replace its pending stakeholder sign-off.
