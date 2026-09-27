**🇧🇷 [Ler em Português](README.pt-BR.md)**

# Storj Board

Application for monitoring [Storj](https://www.storj.io/) storage nodes, periodically collecting bandwidth, storage, satellite, and estimated payout data straight from the configured node(s) dashboard API, and displaying it all on a web dashboard.

## Architecture

| Service    | Stack                        | Port (host) | Purpose                                                              |
|------------|-------------------------------|:---:|-----------------------------------------------------------------------|
| `frontend` | Angular 19 + Nginx            | `29000` | Web dashboard (SPA), served by Nginx, which also proxies `/api/` to the backend |
| `backend`  | Java 21 + Spring Boot 3 + Quartz | `8081`  | REST API + scheduled jobs that query the Storj node(s) API and persist the data |
| `database` | PostgreSQL 16                 | `28999` | Stores the collected history (nodes, satellites, bandwidth, payout, etc.) |

The `backend` runs a Quartz job every 5 seconds that queries each configured node's dashboard API (`/api/sno/`, `/api/sno/satellites`, `/api/sno/estimated-payout`) and cascades aggregations for the 5m/15m/30m/1h/1d/1w/1mo intervals. The `frontend` consumes the backend API (`/api/job/...`) through the Nginx proxy.

## Prerequisites

- **Docker** and **Docker Compose** (recommended way to run the project).
- One or more **Storj Storage Nodes already running**, with the dashboard API reachable (default port `14002`, no authentication). This is the address the backend will query — the project **does not run the node itself**, it only collects data from it.
- To run without Docker (local development): **Java 21**, **Maven** (or use the included `mvnw` wrapper), **Node.js 22**, and **npm**.

## Running with Docker Compose (recommended)

1. Clone the repository and enter the folder:
   ```bash
   git clone git@github.com:JoaoBoll/storj-board.git
   cd storj-board
   ```

2. Configure the `.env` file at the project root (an example one already exists — adjust the values, especially `database_password` and `urls`):
   ```env
   database_name=storj
   database_url=jdbc:postgresql://database:5432/storj
   database_user=admin
   database_password=admin@123
   urls=http://host.docker.internal:14002
   log_level=INFO
   ```

   - `urls`: **comma-separated** list of the base URL(s) of each Storj node's dashboard API to monitor (e.g. `http://host.docker.internal:14002,http://192.168.0.10:14002` for one local node plus a remote one). Use `host.docker.internal` when the node runs on the same machine as Docker Desktop (Windows/Mac). On Docker on Linux, use the machine's real network IP instead of `host.docker.internal`.
   - `database_url` must point to the `database` service (the compose service name), not `localhost`.
   - > ⚠️ **Important**: replace `database_password` with a strong value before exposing the service outside your local network — the default value in `.env` is just an example.

3. Start the containers:
   ```bash
   docker compose up -d --build
   ```

   Compose caps runtime memory at 4 GB total: 3 GB for the backend, 768 MB for PostgreSQL, and 256 MB for the frontend. The JVM heap is capped at 2 GB, leaving room for other Java memory. Docker may terminate the backend if it exceeds its container limit.

4. Access:
   - **Dashboard (frontend)**: http://localhost:29000
   - **API (backend)**: http://localhost:8081
   - **Postgres**: `localhost:28999` (user/password as set in `.env`)

5. To stop:
   ```bash
   docker compose down
   ```
   (Postgres data persists in the `postgres_data` volume; use `docker compose down -v` to discard it too).

## Running in development mode (without Docker)

### Backend

```bash
cd backend
# set the environment variables (or rely on the application.properties defaults, which point to localhost)
export database_url=jdbc:postgresql://localhost:5432/storj
export database_user=admin
export database_password=admin@123
export urls=http://localhost:14002

./mvnw spring-boot:run       # Linux/Mac
./mvnw.cmd spring-boot:run   # Windows
```

The backend starts on `http://localhost:8080` and needs a reachable Postgres on `localhost:5432` (you can start just the database service with `docker compose up -d database`, which exposes port `28999` — adjust `database_url` to that port, or run a local Postgres).

The database schema is managed automatically by Hibernate (`ddl-auto=update`), there are no separate migrations.

### Frontend

```bash
cd frontend
npm install
npm start   # ng serve, port 4200
```

> ⚠️ `ng serve` has **no proxy configured** to the backend (no `proxy.conf.json`/`environment.ts`) — calls use relative paths like `/api/job/nodes`, which only work behind the `frontend` container's Nginx in production. To develop the frontend in isolation against an already-running backend, set up an Angular CLI proxy (`ng serve --proxy-config proxy.conf.json`) pointing `/api` to `http://localhost:8081`.

## Environment variables (root `.env`)

| Variable             | Description                                                                | Example |
|-----------------------|----------------------------------------------------------------------------|---------|
| `database_name`      | Postgres database name                                                     | `storj` |
| `database_url`        | JDBC URL used by the backend (inside the compose network, use `database` as the host) | `jdbc:postgresql://database:5432/storj` |
| `database_user`       | Postgres user                                                              | `admin` |
| `database_password`   | Postgres password                                                          | — |
| `urls`                | Base URL(s) of the Storj node(s) dashboard API, comma-separated            | `http://host.docker.internal:14002` |
| `log_level`           | Backend (Spring) log level                                                 | `INFO` |

## Project structure

```
storj-board/
├── docker-compose.yml
├── .env
├── backend/     # Spring Boot (Java 21) — collects and exposes data via REST API
└── frontend/    # Angular 19 — web dashboard
```
