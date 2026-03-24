# 🔥 LeetCode-Style Online Judge Backend

> A production-ready, horizontally scalable online judge system built with Node.js, Docker container pools, RabbitMQ, Redis, and Firebase Firestore. Supports real-time result delivery via WebSocket and executes code in isolated sandbox containers.

[![Node.js](https://img.shields.io/badge/Node.js-18--alpine-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![RabbitMQ](https://img.shields.io/badge/RabbitMQ-3.12-FF6600?logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Firebase](https://img.shields.io/badge/Firestore-Firebase-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com/docs/firestore)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Throughput](https://img.shields.io/badge/Throughput-40%2B%20submissions%2Fsec-brightgreen)]()
[![Latency](https://img.shields.io/badge/P95%20Latency-%3C250ms-blue)]()
[![Languages](https://img.shields.io/badge/Languages-Python%20%7C%20JS%20%7C%20C%2B%2B%20%7C%20Java-informational)]()

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Configuration](#-configuration)
- [API Reference](#-api-reference)
- [WebSocket API](#-websocket-api)
- [Data Models](#-data-models)
- [Scaling](#-scaling)
- [Monitoring](#-monitoring)
- [Security](#-security)
- [Performance Benchmarks](#-performance-benchmarks)
- [Use Cases](#-use-cases)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Documentation](#-documentation)
- [License](#-license)

---

## 🔍 Overview

This backend powers a LeetCode-style competitive programming platform. Users submit code through the API, which is queued in RabbitMQ and processed by one or more worker nodes. Each worker maintains a **pre-warmed container pool** of isolated Docker sandbox containers, enabling sub-250ms execution with zero cold-start penalty. Results are stored in Redis for fast polling and Firestore for persistence, and delivered in real-time via WebSocket.

### Performance at a Glance

| Metric | Value |
|--------|-------|
| Throughput (1 worker) | 8–10 submissions/sec |
| Throughput (5 workers) | 40+ submissions/sec |
| P95 Latency | < 250 ms |
| Memory per submission | < 20 MB (pooled) |
| Binary cache speedup | 10–100× for compiled languages |

---

## ⚡ Key Features

- **Container Pool** — 10 pre-warmed reusable Docker containers per worker (no cold-start)
- **Async Job Queue** — RabbitMQ with configurable prefetch for back-pressure management
- **Real-Time Updates** — WebSocket push for live submission status changes
- **Fast Result Caching** — Redis cache with 1-hour TTL (< 1 ms read latency)
- **Persistent History** — Firebase Firestore stores all submissions indefinitely
- **Horizontal Scaling** — Stateless workers; add instances for linear throughput growth
- **Binary Cache** — Compiled artifacts (C++, Java) cached in Redis for repeat submissions
- **Multi-Language** — Python 3, JavaScript (Node.js), C++, Java supported out of the box
- **Sandbox Security** — Network-isolated containers with memory/CPU limits and non-root execution
- **Admin API** — Problem management, template storage, and expected-output generation

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client / Frontend                     │
│              REST (HTTP) + WebSocket (ws://)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Server  (Express.js)                   │
│  POST /submit   ──────────────────────────► RabbitMQ Queue  │
│  GET  /submissions/:id ◄── Redis / Firestore                │
│  WebSocket /ws  ◄──────────────────────────► Redis Pub/Sub  │
│  Admin /api/*   ──────────────────────────► RabbitMQ Queue  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │      RabbitMQ           │
              │  (submission_queue)     │
              └────────────┬────────────┘
                           │  (fan-out to N workers)
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌────────────┐   ┌────────────┐   ┌────────────┐
   │  Worker 1  │   │  Worker 2  │   │  Worker N  │
   │ Pool: 10   │   │ Pool: 10   │   │ Pool: 10   │
   │ containers │   │ containers │   │ containers │
   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
         │                │                │
         └────────────────┼────────────────┘
                          │
              ┌───────────▼──────────────┐
              │   Results Storage         │
              │  ├── Redis  (TTL 1h)      │
              │  └── Firestore (forever)  │
              └──────────────────────────┘
```

**See [CONTAINER_POOL_ARCHITECTURE.md](./CONTAINER_POOL_ARCHITECTURE.md) for the full deep-dive.**

### Request Lifecycle

1. **Submit** — Client `POST /submit`; API validates and stores the job in Firestore, pushes to RabbitMQ, returns `202 Accepted` with a `submissionId`.
2. **Queue** — RabbitMQ delivers the job to an available worker (prefetch = 2 per worker).
3. **Execute** — Worker acquires a pre-warmed container from its pool, writes the code file, optionally uses a binary cache, runs all test cases, and releases the container.
4. **Persist** — Worker `POST`s results back to the API; the API writes to Redis and Firestore, then broadcasts via WebSocket.
5. **Retrieve** — Client polls `GET /submissions/:id` or receives a WebSocket push.

---

## 📁 Project Structure

```
Leetcode_backend/
├── server/                        # API server (Express.js + WebSocket)
│   ├── app.js                     # Main application – routes, WebSocket, health
│   ├── package.json
│   ├── Dockerfile
│   ├── config/
│   │   ├── rabbitmq.js            # RabbitMQ connection factory
│   │   └── redis.js               # Redis client setup
│   ├── routes/
│   │   └── core.js                # Deprecated route file (superseded by routes in app.js)
│   └── utils/
│       ├── Firebase.js            # Firestore initialisation
│       └── utils.js               # Shared helpers (Redis ops, response shapes)
│
├── workers/                       # Judge worker (container pool + executor)
│   ├── Dockerfile
│   └── app/
│       ├── app.js                 # RabbitMQ consumer + submission orchestrator
│       ├── containerPool.js       # Pre-warmed Docker container pool manager
│       ├── sandboxExecutor.js     # Code execution engine (compile + run)
│       ├── monitor.js             # In-process performance metrics
│       ├── pool.js                # Redis / RabbitMQ connection pooling
│       ├── package.json
│       └── config/
│           ├── rabbitmq.js
│           └── redis.js
│
├── CodeExecution/                 # Sandbox Docker image definition
│   ├── Dockerfile.sandbox         # Ubuntu 22.04 + Python3, Node.js, g++, Java
│   ├── Dockerfile
│   ├── package.json
│   └── app/
│       ├── node.js                # In-container Node.js execution harness
│       └── utils.js
│
├── docker-compose.yml             # Full-stack orchestration
├── README.md                      # This file
├── QUICKSTART.md                  # 30-minute guided setup
├── CONTAINER_POOL_ARCHITECTURE.md # Deep-dive architecture document
├── SETUP_GUIDE.md                 # Upgrade guide (Judger v1 → v2)
└── JUDGER_UPGRADE.md              # Old vs new architecture comparison
```

---

## ✅ Prerequisites

Ensure the following are installed before proceeding:

| Dependency | Minimum Version | Purpose |
|---|---|---|
| [Docker](https://docs.docker.com/get-docker/) | 24.x | Container runtime |
| [Docker Compose](https://docs.docker.com/compose/install/) | 2.x (`docker compose`) | Service orchestration |
| [Node.js](https://nodejs.org/) *(optional)* | 18.x LTS | Local development without Docker |
| [npm](https://www.npmjs.com/) *(optional)* | 9.x | Dependency management |
| [curl](https://curl.se/) *(optional)* | any | API smoke-testing |

> **Note:** The entire system runs inside Docker. Node.js and npm are only required if you intend to run services locally outside of containers.

**System resources (recommended for development):**

- CPU: 4 cores
- RAM: 8 GB (6 GB minimum for a pool of 10 sandbox containers)
- Disk: 10 GB free (Docker images + compilation artifacts)

---

## 🚀 Quick Start

### 30 Seconds — Start Everything

```bash
git clone https://github.com/karthick1005/Leetcode_backend.git
cd Leetcode_backend

# Build all images and start all services
docker-compose up -d --build
```

### Verify Services Are Healthy

```bash
docker-compose ps
# Expected output:
# NAME             STATUS
# rabbitmq         Up (healthy)
# redis-server     Up (healthy)
# server           Up (healthy)
# worker           Up (healthy)
```

### Submit a Test Job

```bash
curl -s -X POST http://localhost:9000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "15",
    "language": "python",
    "userId": "user1",
    "code": "print(1 + 2)",
    "testcases": [{"input": "", "expected": "3"}],
    "quesId": "test-problem"
  }' | jq .
```

**Expected response (`202 Accepted`):**

```json
{
  "status": "ok",
  "data": {
    "submissionId": "user1-15-<uuid>",
    "statusUrl": "/submissions/user1-15-<uuid>",
    "websocketUrl": "ws://localhost:9000/ws"
  }
}
```

### Poll for the Result

```bash
# Replace <submissionId> with the value returned above
curl -s http://localhost:9000/submissions/<submissionId> | jq .
```

**Expected response (`200 OK`):**

```json
{
  "status": "ok",
  "data": {
    "status": "Accepted",
    "passed": 1,
    "total": 1,
    "testcases": [
      {
        "input": "",
        "output": "3",
        "expected": "3",
        "passed": true,
        "status": "Passed"
      }
    ]
  }
}
```

### Monitor Worker Output

```bash
docker-compose logs -f worker | grep -E "METRICS|Result|Processing"
```

**See [QUICKSTART.md](./QUICKSTART.md) for the full step-by-step guide.**

---

## ⚙️ Configuration

### Environment Variables

All variables are passed through `docker-compose.yml`. For local development outside Docker, copy the table below into `.env` files in each service directory.

#### API Server (`server/`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment (`development` / `production`) |
| `PORT` | `7000` | Internal HTTP port (mapped to `9000` externally) |
| `REDIS_HOST` | `redis-server` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `RABBITMQ_URL` | `amqp://rabbitmq:5672` | RabbitMQ connection URL |
| `API_SERVER` | `http://server:7000` | Internal API base URL (used by workers to post results) |

#### Worker (`workers/app/`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment |
| `CONTAINER_POOL_SIZE` | `2` (dev) · `10` (recommended) | Number of pre-warmed sandbox containers per worker instance |
| `REDIS_HOST` | `redis-server` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `RABBITMQ_URL` | `amqp://rabbitmq:5672` | RabbitMQ connection URL |
| `API_SERVER` | `http://server:7000` | API base URL for posting results |

#### Infrastructure (set in `docker-compose.yml`)

| Variable | Default | Description |
|---|---|---|
| `RABBITMQ_DEFAULT_USER` | `guest` | RabbitMQ admin username |
| `RABBITMQ_DEFAULT_PASS` | `guest` | RabbitMQ admin password |

> **Production note:** Always override `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`, and any Firebase credentials before deploying to a public environment.

### `.env` Template (local development)

Create `server/.env` and `workers/app/.env` from this template:

```dotenv
NODE_ENV=development
PORT=7000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672

# Worker only
CONTAINER_POOL_SIZE=5

# Internal service URL
API_SERVER=http://localhost:7000
```

### Firebase / Firestore

Firebase credentials are currently initialised in `server/utils/Firebase.js`. For production deployments, move the configuration to environment variables or a secrets manager and never commit credentials to source control. Example variables to externalise:

```dotenv
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_APP_ID=your-app-id
```

---

## 📡 API Reference

Base URL (Docker default): `http://localhost:9000`

All successful responses use the envelope `{ "status": "ok", "data": { ... } }`.  
All error responses use `{ "status": "error", "message": "...", "code": <number> }`.

---

### Health Check

```
GET /
```

**Response `200 OK`:**

```json
{ "status": "ok", "service": "judge-api" }
```

---

### Submit Code

```
POST /submit
Content-Type: application/json
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `problemId` | `string` | ✅ | Unique problem identifier |
| `language` | `string` | ✅ | `python` · `javascript` · `cpp` · `java` |
| `userId` | `string` | ✅ | Submitting user's ID |
| `code` | `string` | ✅ | Source code to execute |
| `testcases` | `array` | ✅ | Array of `{ input, expected }` objects |
| `quesId` | `string` | ✅ | Firestore problem document ID |

**Example:**

```bash
curl -X POST http://localhost:9000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "two-sum",
    "language": "python",
    "userId": "u_abc123",
    "code": "def solution(a, b):\n    return a + b\nprint(solution(1, 2))",
    "testcases": [
      { "input": "1\n2", "expected": "3" },
      { "input": "10\n20", "expected": "30" }
    ],
    "quesId": "two-sum"
  }'
```

**Response `202 Accepted`:**

```json
{
  "status": "ok",
  "data": {
    "submissionId": "u_abc123-two-sum-<uuid>",
    "statusUrl": "/submissions/u_abc123-two-sum-<uuid>",
    "websocketUrl": "ws://localhost:9000/ws"
  }
}
```

---

### Get Submission Result

```
GET /submissions/:submissionId
```

Returns `202 Accepted` while the job is still processing, and `200 OK` when complete.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "data": {
    "status": "Accepted",
    "passed": 2,
    "total": 2,
    "totalTime": 185,
    "testcases": [
      {
        "input": "1\n2",
        "output": "3",
        "expected": "3",
        "passed": true,
        "status": "Passed"
      }
    ]
  }
}
```

**Possible `status` values:**

| Value | Description |
|---|---|
| `queued` | Job is waiting in the RabbitMQ queue |
| `Processing` | Worker is actively executing the code |
| `Accepted` | All test cases passed |
| `Wrong Answer` | One or more test cases produced incorrect output |
| `Runtime Error` | Code threw an exception during execution |
| `Compilation Error` | Code failed to compile (C++ / Java) |
| `Time Limit Exceeded` | Execution exceeded the configured timeout |
| `System Error` | Internal infrastructure failure |

---

### Interpret Solution (Admin)

```
POST /interpret_solution
Content-Type: application/json
```

Executes the admin reference solution to generate expected outputs. Accepts the same body as `POST /submit`.

**Response `202 Accepted`:** same shape as `/submit`.

---

### Get User Submission History

```
GET /users/:userId/submissions
```

Returns the 50 most recent submissions for a user, ordered by creation time (descending).

**Response `200 OK`:**

```json
[
  {
    "submissionId": "u_abc123-two-sum-<uuid>",
    "problemId": "two-sum",
    "userId": "u_abc123",
    "status": "Accepted",
    "language": "python",
    "code": "...",
    "createdAt": "2024-06-01T10:00:00.000Z",
    "completedAt": "2024-06-01T10:00:00.245Z"
  }
]
```

---

### Get Problem Statistics

```
GET /problems/:problemId/stats
```

**Response `200 OK`:**

```json
{
  "total": 247,
  "accepted": 189,
  "acceptanceRate": "76.52%",
  "wrongAnswer": 45,
  "runtimeError": 10,
  "compilationError": 3
}
```

---

### Admin — Load Problem Template

```
GET /api/problems/:problemId
```

Retrieves the stored problem template, test cases, and reference solution.

**Response `200 OK`:**

```json
{
  "Adminsrc": "<base64-encoded reference solution>",
  "Inputname": ["a", "b"],
  "Remaining": {
    "python": "<base64 template with // INSERT_CODE_HERE>",
    "javascript": "<base64 template>",
    "cpp": "<base64 template>",
    "java": "<base64 template>"
  },
  "Testcases": ["1\n2", "10\n20"],
  "Timeout": 5
}
```

---

### Admin — Save Problem Template

```
PUT /api/problems/:problemId
Content-Type: application/json
```

| Field | Type | Description |
|---|---|---|
| `Adminsrc` | `string` | Base64-encoded reference solution |
| `Inputname` | `string[]` | Function parameter names |
| `Remaining` | `object` | Map of `language → base64 template` |
| `Testcases` | `string[]` | Raw test inputs (newline-separated per case) |
| `Timeout` | `number` | Execution timeout in seconds |

**Response `200 OK`:** `{ "status": "ok" }`

---

### Admin — Queue Admin Execution

```
POST /api/execute-admin
Content-Type: application/json
```

Queues the admin reference code for execution to generate expected outputs.

**Request body:** `{ "adminCode": "string", "testcases": ["..."], "language": "python" }`

**Response `202 Accepted`:**

```json
{ "jobId": "<uuid>", "message": "Admin execution queued" }
```

---

### Admin — Poll Admin Execution Result

```
GET /api/execute-admin/:jobId
```

Returns `202 Accepted` while processing, `200 OK` when complete.

---

### Metrics

```
GET /metrics
```

**Response `200 OK`:**

```json
{
  "activeWebSocketConnections": 12,
  "timestamp": "2024-06-01T10:00:00.000Z"
}
```

---

## 🔌 WebSocket API

Connect to `ws://localhost:9000/ws` to receive real-time submission updates.

### Subscribe to a Submission

```javascript
const ws = new WebSocket('ws://localhost:9000/ws')

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    submissionId: 'u_abc123-two-sum-<uuid>'
  }))
}

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  switch (msg.type) {
    case 'subscribed':
      // msg.currentStatus → "queued"
      break
    case 'status':
      // msg.status    → "Processing"
      // msg.timestamp → ISO 8601
      break
    case 'result':
      // msg.data → full result object (same as GET /submissions/:id)
      break
  }
}
```

### Message Types

| `type` | Direction | Payload |
|---|---|---|
| `subscribe` | Client → Server | `{ submissionId }` |
| `subscribed` | Server → Client | `{ currentStatus }` |
| `status` | Server → Client | `{ status, timestamp }` |
| `result` | Server → Client | `{ data: <result object> }` |

---

## 💾 Data Models

### Firestore — `submissions/{submissionId}`

```
submissionId   string   "userId-problemId-<uuid>"
problemId      string
userId         string
language       string   "python" | "javascript" | "cpp" | "java"
code           string   Merged code (user code + template wrapper)
testcases      array
status         string   See status values table above
result         object   { status, passed, total, testcases[], totalTime }
createdAt      Timestamp
completedAt    Timestamp
submittedAt    string   ISO 8601
```

### Firestore — `problem/{problemId}`

```
Adminsrc       string   Base64-encoded reference solution
Inputname      string[] Function parameter names
Remaining      object   { python, javascript, cpp, java } — base64 templates
Testcases      string[] Raw test inputs
Timeout        number   Seconds
updatedAt      Timestamp
```

### Redis Keys

| Key pattern | Value | TTL |
|---|---|---|
| `submission:{id}:status` | Status string | 3600 s |
| `submission:{id}:result` | JSON result object | 3600 s |
| `admin-execute:{jobId}` | JSON execution result | 3600 s |

---

## 📈 Scaling

### Horizontal Worker Scaling

Each worker instance is **stateless** and maintains its own isolated container pool. Adding workers provides near-linear throughput growth.

```bash
# Default: 1 worker (~8–10 submissions/sec)
docker-compose up -d

# Scale to 5 workers (~40 submissions/sec)
docker-compose up -d --scale worker=5

# Scale to 10 workers (~80+ submissions/sec)
docker-compose up -d --scale worker=10
```

### Tuning Container Pool Size

Larger pools reduce queuing time but consume more memory (≈ 150–200 MB per container):

```bash
# 5 containers per worker (low memory, moderate throughput)
CONTAINER_POOL_SIZE=5 docker-compose up -d

# 20 containers per worker (high memory, high throughput)
CONTAINER_POOL_SIZE=20 docker-compose up -d
```

### Why It Scales Linearly

| Factor | Reason |
|---|---|
| Stateless workers | No session affinity required |
| Shared RabbitMQ queue | Fair work distribution with prefetch |
| Shared Redis cache | Compiled binary cache benefits all workers |
| Independent container pools | No inter-worker resource contention |
| Firestore | Managed, horizontally scaled database |

### Capacity Planning

| Platform Type | Submissions/sec | Workers | Pool Size | RAM |
|---|---|---|---|---|
| Personal / demo | 1–5 | 1 | 5 | 4 GB |
| Interview platform | 5–15 | 2 | 10 | 8 GB |
| Learning platform | 20–50 | 5 | 10 | 16 GB |
| Contest platform | 100+ | 15+ | 10 | 64 GB+ |

---

## 🔍 Monitoring

### Worker Logs

```bash
docker-compose logs -f worker
```

Sample output:

```
🚀 Starting Judge Worker...
✅ Container Pool: 10 containers ready
✅ Connected to RabbitMQ
👂 Listening on queue: submission_queue

⏱️  Processing: user1-15-abc   Language: python   Test cases: 3
✨ Result: Accepted (145ms)   Passed: 3/3

📦 Container Pool: { totalContainers: 10, availableContainers: 9, busyContainers: 1 }
💾 Cache Stats:    { cachedBinaries: 12, cacheSize: 245000 }

=== PERFORMANCE METRICS ===
Total Submissions : 47
Success Rate      : 97.87%
Throughput        : 9.4 submissions/sec
Avg Execution Time: 187ms
P95 Execution Time: 325ms
```

### RabbitMQ Management UI

Navigate to `http://localhost:15672` (default credentials: `guest` / `guest`) to view queue depths, message rates, and consumer counts.

```bash
# CLI alternative
docker-compose exec rabbitmq rabbitmqctl list_queues name messages consumers
```

### Redis Inspection

```bash
docker-compose exec redis-server redis-cli

# List cached submission keys
KEYS "submission:*"

# Read a specific result
GET "submission:user1-15-abc:result"

# Check memory usage
INFO memory
```

### API Metrics Endpoint

```bash
curl http://localhost:9000/metrics
# { "activeWebSocketConnections": 4, "timestamp": "..." }
```

### Service Health Checks

All services expose Docker health checks. Use `docker-compose ps` to verify the `(healthy)` status.

| Service | Health check |
|---|---|
| `server` | `curl -f http://localhost:7000/` |
| `rabbitmq` | `rabbitmq-diagnostics -q ping` |
| `redis-server` | `redis-cli ping` |
| `worker` | `ps aux` (process presence) |

---

## 🔒 Security

### Sandbox Isolation

Each code execution runs inside an isolated Docker container with:

| Control | Configuration |
|---|---|
| Network access | **Disabled** — containers have no network interface |
| Memory limit | 512 MB per container |
| CPU shares | Enforced via Docker resource constraints |
| Process limit | Max 100 processes (prevents fork bombs) |
| Filesystem | Only `/tmp/execution` is writable |
| User | Non-root `judge` user |
| Execution timeout | Configurable via `Timeout` field in Firestore; process killed on expiry |
| Output size | Capped to prevent memory exhaustion |

### Current Authentication Status

> ⚠️ The API currently has **no authentication or rate limiting** implemented. `userId` is accepted from the request body without verification. This is suitable for internal/trusted deployments only.

**Recommended additions before public exposure:**

1. **JWT middleware** — verify tokens on all mutation endpoints.
2. **Rate limiting** — use `express-rate-limit` per IP and per user.
3. **Firestore security rules** — restrict reads/writes to the owning `userId`.
4. **Secrets management** — move Firebase credentials to environment variables or a vault (e.g., HashiCorp Vault, AWS Secrets Manager).
5. **HTTPS / TLS** — terminate TLS at a reverse proxy (nginx / Caddy) in front of the API.

### Responsible Disclosure

If you discover a security vulnerability, please open a private issue or contact the maintainer directly rather than disclosing it publicly.

---

## 📊 Performance Benchmarks

```
┌─────────────────────────────────────────────────┐
│              Single Worker (pool = 10)           │
├─────────────────┬───────────────────────────────┤
│ Throughput      │ 8–10 submissions/sec           │
│ Avg latency     │ 150–200 ms                     │
│ P95 latency     │ < 250 ms                       │
│ P99 latency     │ < 350 ms                       │
├─────────────────┴───────────────────────────────┤
│                  Memory Usage                    │
├─────────────────┬───────────────────────────────┤
│ Base worker     │ ~200 MB                        │
│ Per sandbox     │ 150–200 MB                     │
│ 10 containers   │ ~2 GB total                    │
├─────────────────┴───────────────────────────────┤
│                   CPU Usage                      │
├─────────────────┬───────────────────────────────┤
│ Idle            │ < 1%                           │
│ Per submission  │ 50–100% for ~100 ms            │
│ Full load       │ 70–80%                         │
└─────────────────┴───────────────────────────────┘
```

Binary cache (C++ / Java):

- **First submission** — full compile + run: ~800 ms
- **Repeat submission** — cache hit: ~50 ms (10–100× speedup)

---

## 🎯 Use Cases

| Platform | Target Throughput | P95 Latency | Workers | Pool Size |
|---|---|---|---|---|
| Personal / demo | < 5/sec | < 1 s | 1 | 5 |
| Interview platform | < 15/sec | < 200 ms | 2 | 10 |
| Learning platform | < 50/sec | < 1 s | 5 | 10 |
| Contest platform | 100+/sec | < 500 ms | 15+ | 10 |

---

## 🔧 Troubleshooting

### Services fail to start

```bash
# Check logs for the failing service
docker-compose logs rabbitmq
docker-compose logs server
docker-compose logs worker
```

### High Latency / Long Queue Depth

```bash
# Check queue depth
docker-compose exec rabbitmq rabbitmqctl list_queues

# Scale up workers
docker-compose up -d --scale worker=5
```

### Worker Out-of-Memory Crashes

```bash
# Reduce container pool size
CONTAINER_POOL_SIZE=5 docker-compose up -d worker
```

### Stuck / Stale Jobs

```bash
# Purge the queue (drops all pending jobs)
docker-compose exec rabbitmq rabbitmqctl purge_queue submission_queue

# Restart workers
docker-compose restart worker
```

### Firestore / Firebase Connection Errors

```bash
# Inspect API server logs for Firebase errors
docker-compose logs server | grep -i "firebase\|firestore"
```

Verify that the Firebase project ID and credentials in `server/utils/Firebase.js` are correct and that the Firestore database has been created in the Firebase console.

### RabbitMQ Connection Refused

```bash
# Confirm RabbitMQ is healthy
docker-compose exec rabbitmq rabbitmq-diagnostics ping

# Restart infrastructure and dependent services
docker-compose restart rabbitmq
docker-compose restart server worker
```

### Sandbox Container Fails to Start

```bash
# Ensure the sandbox image is built
docker images | grep judge-sandbox

# Rebuild if missing
docker-compose build judge-sandbox
```

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. **Make your changes** and ensure existing behaviour is preserved.
3. **Test locally** using Docker Compose before opening a PR:
   ```bash
   docker-compose up -d --build
   # Submit a test job and verify the result
   ```
4. **Open a Pull Request** against the `main` branch with a clear description of the change and the problem it solves.

### Code Style

- JavaScript (ES Modules) — follow the existing `import`/`export` conventions.
- Prefer async/await over callbacks.
- Keep functions small and single-purpose.
- Add comments for non-obvious logic.

### Reporting Bugs

Open an issue with:
- Steps to reproduce
- Expected vs. actual behaviour
- Docker / Node.js / OS versions (`docker --version`, `node --version`)
- Relevant log output (`docker-compose logs`)

---

## 📚 Documentation

| Document | Description |
|---|---|
| [QUICKSTART.md](./QUICKSTART.md) | Step-by-step 30-minute setup guide |
| [CONTAINER_POOL_ARCHITECTURE.md](./CONTAINER_POOL_ARCHITECTURE.md) | Deep-dive into the container pool design |
| [SETUP_GUIDE.md](./SETUP_GUIDE.md) | Upgrade guide from Judger v1 to v2 |
| [JUDGER_UPGRADE.md](./JUDGER_UPGRADE.md) | Old vs. new architecture comparison |

---

## 🚀 Deployment Checklist

Before going to production, verify the following:

- [ ] Firebase / Firestore project created and credentials secured (not hardcoded)
- [ ] `RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS` changed from defaults
- [ ] TLS terminated at a reverse proxy (nginx / Caddy) in front of port 9000
- [ ] Authentication middleware added to all mutation endpoints
- [ ] Rate limiting configured (`express-rate-limit`)
- [ ] Firestore security rules reviewed and locked down
- [ ] Docker socket access restricted to trusted services only
- [ ] Port 15672 (RabbitMQ management UI) firewalled from public access
- [ ] Port 6379 (Redis) firewalled from public access
- [ ] `CONTAINER_POOL_SIZE` tuned for available memory
- [ ] Sufficient disk space (10 GB+) for Docker images and build cache
- [ ] Monitoring / alerting configured (e.g., Prometheus + Grafana, Datadog)
- [ ] Log aggregation in place (e.g., ELK stack, Loki)

```bash
# Final health verification
docker-compose ps
docker-compose logs worker | head -20
curl http://localhost:9000/
```

---

## 📝 License

This project is licensed under the **MIT License**. See [LICENSE](./LICENSE) for details.

---

## 🙏 References

- [Docker Engine API](https://docs.docker.com/engine/api/)
- [RabbitMQ Best Practices](https://www.rabbitmq.com/guidelines.html)
- [Firebase Firestore Data Model](https://firebase.google.com/docs/firestore)
- [WebSocket Protocol — RFC 6455](https://tools.ietf.org/html/rfc6455)
- [Express.js Documentation](https://expressjs.com/)
- [Dockerode — Node.js Docker SDK](https://github.com/apocas/dockerode)

---

<div align="center">

**Ready to scale your judge system?**  
See [QUICKSTART.md](./QUICKSTART.md) to be up and running in 30 minutes. 🚀

</div>


