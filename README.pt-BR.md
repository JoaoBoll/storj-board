**🇺🇸 [Read in English](README.md)**

# Storj Board

Aplicação para monitorar nós (storage nodes) do [Storj](https://www.storj.io/), coletando periodicamente dados de bandwidth, storage, satélites e payout estimado direto da API de dashboard do(s) nó(s) configurado(s), e exibindo tudo em um painel web.

## Arquitetura

| Serviço    | Stack                        | Porta (host) | Função                                                              |
|------------|-------------------------------|:---:|-----------------------------------------------------------------------|
| `frontend` | Angular 19 + Nginx            | `29000` | Painel web (SPA), servido por Nginx, que também faz proxy de `/api/` para o backend |
| `backend`  | Java 21 + Spring Boot 3 + Quartz | `8081`  | API REST + jobs agendados que consultam a API do(s) nó(s) Storj e persistem os dados |
| `database` | PostgreSQL 16                 | `28999` | Armazena histórico coletado (nós, satélites, bandwidth, payout, etc.) |

O `backend` roda um job (Quartz) a cada 5 segundos que consulta a API de dashboard de cada nó configurado (`/api/sno/`, `/api/sno/satellites`, `/api/sno/estimated-payout`) e cascateia agregações para os intervalos 5m/15m/30m/1h/1d/1w/1mo. O `frontend` consome a API do backend (`/api/job/...`) através do proxy do Nginx.

## Pré-requisitos

- **Docker** e **Docker Compose** (forma recomendada de rodar o projeto).
- Um ou mais **Storage Nodes do Storj já rodando**, com a API de dashboard acessível (porta padrão `14002`, sem autenticação). É esse endereço que o backend vai consultar — o projeto **não roda o node em si**, só coleta os dados dele.
- Para rodar sem Docker (desenvolvimento local): **Java 21**, **Maven** (ou usar o wrapper `mvnw` incluso), **Node.js 22** e **npm**.

## Subindo com Docker Compose (recomendado)

1. Clone o repositório e entre na pasta:
   ```bash
   git clone git@github.com:JoaoBoll/storj-board.git
   cd storj-board
   ```

2. Configure o arquivo `.env` na raiz do projeto (já existe um de exemplo — ajuste os valores, principalmente `database_password` e `urls`):
   ```env
   database_name=storj
   database_url=jdbc:postgresql://database:5432/storj
   database_user=admin
   database_password=admin@123
   urls=http://host.docker.internal:14002
   log_level=INFO
   ```

   - `urls`: lista **separada por vírgula** com a(s) URL(s) base da API de dashboard de cada node Storj a ser monitorado (ex.: `http://host.docker.internal:14002,http://192.168.0.10:14002` para um node local + um remoto). Use `host.docker.internal` quando o node roda na mesma máquina que o Docker Desktop (Windows/Mac). Em Docker no Linux, use o IP real da máquina na rede ao invés de `host.docker.internal`.
   - `database_url` deve apontar para o serviço `database` (nome do serviço no compose), não para `localhost`.
   - > ⚠️ **Importante**: troque `database_password` por um valor forte antes de expor o serviço fora da sua rede local — o valor padrão do `.env` é só um exemplo.

3. Suba os containers:
   ```bash
   docker compose up -d --build
   ```

   O Compose limita o uso em runtime a 4 GB no total: 3 GB para o backend, 768 MB para o PostgreSQL e 256 MB para o frontend. O heap da JVM fica limitado a 2 GB, com memória adicional reservada para outras estruturas do Java. Se o backend ultrapassar seu limite, o Docker pode encerrá-lo por falta de memória.

4. Acesse:
   - **Painel (frontend)**: http://localhost:29000
   - **API (backend)**: http://localhost:8081
   - **Postgres**: `localhost:28999` (usuário/senha conforme `.env`)

5. Para parar:
   ```bash
   docker compose down
   ```
   (os dados do Postgres persistem no volume `postgres_data`; use `docker compose down -v` para descartá-los também).

## Rodando em modo desenvolvimento (sem Docker)

### Backend

```bash
cd backend
# defina as variáveis de ambiente (ou use os defaults do application.properties, que apontam para localhost)
export database_url=jdbc:postgresql://localhost:5432/storj
export database_user=admin
export database_password=admin@123
export urls=http://localhost:14002

./mvnw spring-boot:run       # Linux/Mac
./mvnw.cmd spring-boot:run   # Windows
```

O backend sobe em `http://localhost:8080` e precisa de um Postgres acessível em `localhost:5432` (pode subir só o serviço de banco via `docker compose up -d database`, que expõe a porta `28999` — ajuste `database_url` para essa porta, ou rode um Postgres local).

O schema do banco é gerenciado automaticamente pelo Hibernate (`ddl-auto=update`), não há migrations separadas.

### Frontend

```bash
cd frontend
npm install
npm start   # ng serve, porta 4200
```

> ⚠️ O `ng serve` **não tem proxy configurado** para o backend (sem `proxy.conf.json`/`environment.ts`) — as chamadas usam caminhos relativos como `/api/job/nodes`, que só funcionam por trás do Nginx do container `frontend` em produção. Para desenvolver o frontend isoladamente contra um backend já rodando, configure um proxy do Angular CLI (`ng serve --proxy-config proxy.conf.json`) apontando `/api` para `http://localhost:8081`.

## Variáveis de ambiente (`.env` na raiz)

| Variável             | Descrição                                                                 | Exemplo |
|-----------------------|----------------------------------------------------------------------------|---------|
| `database_name`      | Nome do banco Postgres                                                    | `storj` |
| `database_url`        | URL JDBC usada pelo backend (dentro da rede do compose, use `database` como host) | `jdbc:postgresql://database:5432/storj` |
| `database_user`       | Usuário do Postgres                                                       | `admin` |
| `database_password`   | Senha do Postgres                                                         | — |
| `urls`                | URL(s) base da API de dashboard do(s) node(s) Storj, separadas por vírgula | `http://host.docker.internal:14002` |
| `log_level`           | Nível de log do backend (Spring)                                          | `INFO` |

## Estrutura do projeto

```
storj-board/
├── docker-compose.yml
├── .env
├── backend/     # Spring Boot (Java 21) — coleta e expõe os dados via API REST
└── frontend/    # Angular 19 — painel web
```
