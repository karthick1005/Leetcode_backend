# Quick Start: Container Pool Judge System

## 30-Minute Setup

### Step 1: Build Docker Images (5 min)
```bash
cd Backend

# Build all images
docker-compose build --no-cache

# Expected output:
# Successfully built judge-sandbox
# Successfully built server
# Successfully built workers
```

### Step 2: Start Services (2 min)
```bash
# Start infrastructure
docker-compose up -d

# Expected output:
# Creating network "judge-network"
# Creating rabbitmq ... done
# Creating redis-server ... done
# Creating judge-sandbox ... done
# Creating server ... done
# Creating worker ... done
```

### Step 3: Verify Installation (3 min)
```bash
# Check service health
docker-compose ps

# Expected:
# NAME               STATUS
# rabbitmq           Up (healthy)
# redis-server       Up (healthy)
# server             Up (healthy)
# worker             Up (healthy)

# View worker logs
docker-compose logs -f worker

# You should see:
# 🚀 Starting Judge Worker...
# ✅ Container Pool: 10 containers ready
# ✅ Connected to RabbitMQ
# 👂 Listening on queue: submission_queue
```

### Step 4: Test Submission (5 min)
```bash
# Submit Python code
curl -X POST http://localhost:9000/submit \
  -H "Content-Type: application/json" \
  -d '{
    "problemId": "15",
    "language": "python",
    "userId": "user1",
    "code": "print(1 + 2)",
    "testcases": [
      {"input": "", "expected": "3"}
    ]
  }'

# Response:
# {
#   "success": true,
#   "submissionId": "user1-15-abc-123",
#   "statusUrl": "/submissions/user1-15-abc-123",
#   "websocketUrl": "ws://localhost:9000/ws"
# }
```

### Step 5: Get Result (5 min)
```bash
# Wait a moment, then get result
curl http://localhost:9000/submissions/user1-15-abc-123

# Response (after processing):
# {
#   "success": true,
#   "status": "Accepted",
#   "passed": 1,
#   "total": 1,
#   "testcases": [
#     {
#       "input": "",
#       "output": "3",
#       "expected": "3",
#       "passed": true,
#       "status": "Passed"
#     }
#   ]
# }
```

### Step 6: Monitor Performance (5 min)
```bash
# Watch worker metrics
docker-compose logs -f worker | grep "METRICS"

# Expected output (every 60 seconds):
# === PERFORMANCE METRICS ===
# Total Submissions: 5
# Success Rate: 100%
# Throughput: 0.5 submissions/sec
# Avg Execution Time: 156ms
# P95 Execution Time: 187ms
```

## Common Tasks

### Scale to 5 Workers
```bash
docker-compose up -d --scale worker=5
docker-compose logs worker | grep "METRICS"

# Expected: ~5x throughput
```

### View RabbitMQ Queue Status
```bash
docker-compose exec rabbitmq rabbitmqctl list_queues

# Output:
# submission_queue    2   # 2 pending jobs
```

### Check Redis Cache
```bash
docker-compose exec redis-server redis-cli

# Inside redis-cli:
KEYS "submission:*"
GET "submission:user1-15-abc-123:result"
TTL "submission:user1-15-abc-123:result"  # Remaining TTL
```

### Upgrade Code Without Full Rebuild
```bash
# Single file changes
docker-compose up -d --build

# Fresh rebuild
docker-compose down
docker rmi judge-sandbox server workers
docker-compose build
docker-compose up -d
```

### Stop & Clean Up
```bash
# Stop services
docker-compose down

# Remove images
docker rmi judge-sandbox server workers

# Remove volumes
docker volume rm backend_redis_data

# Full cleanup
docker system prune -a
```

## Next Steps

1. **Connect Frontend**
   - Update Frontend to POST `/submit` to API
   - Open WebSocket for real-time updates
   - Parse results and display

2. **Load Testing**
   ```bash
   # Script to submit 100 jobs concurrently
   for i in {1..100}; do
     curl -s -X POST http://localhost:9000/submit \
       -H "Content-Type: application/json" \
       -d "{
         \"problemId\": \"15\",
         \"language\": \"javascript\",
         \"userId\": \"user$i\",
         \"code\": \"console.log($i)\",
         \"testcases\": []
       }" &
   done
   wait
   ```

3. **Monitor Logs**
   ```bash
   # Watch everything
   docker-compose logs -f

   # Just worker
   docker-compose logs -f worker

   # Search for errors
   docker-compose logs worker | grep ERROR
   ```

4. **Production Deployment**
   - Replace localhost with actual domain
   - Add reverse proxy (Nginx)
   - Enable HTTPS
   - Setup monitoring (Prometheus/Grafana)
   - Add auto-scaling based on queue depth

## Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs

# Rebuild completely
docker-compose down
docker system prune -a
docker-compose build --no-cache
docker-compose up -d
```

### High latency
```bash
# Check worker CPU/memory
docker stats worker

# Scale if needed
docker-compose up -d --scale worker=10

# Check queue depth
docker-compose exec rabbitmq rabbitmqctl list_queues
```

### Out of memory
```bash
# Reduce container pool size
docker-compose down
# Edit docker-compose.yml: CONTAINER_POOL_SIZE: 5
docker-compose up -d
```

### Stuck job in queue
```bash
# Purge queue
docker-compose exec rabbitmq rabbitmqctl purge_queue submission_queue

# Restart workers
docker-compose restart worker
```

## Performance Expectations

After setup, you should see:

```
Metric                    Value
─────────────────────────────────
First submission         200-300ms
Subsequent (cached)      50-100ms
Throughput per worker    8-10 jobs/sec
P95 latency              <250ms
Memory per job           <20MB
CPU per job              ~50% CPU for 100ms
```

## Architecture Summary

```
Frontend ──(WebSocket)──→ API Server
   ↓(POST /submit)        ├──→ Redis (cache)
   └──────────────→ RabbitMQ  └──→ Firestore (persist)
                    ↓
                 Worker(s) ───→ Container Pool
                    ↓
                 Sandbox Executor
```

**Key strengths:**
- ✅ 40-100x faster than per-container approach
- ✅ Real-time WebSocket updates
- ✅ Horizontal scaling (add workers)
- ✅ Persistent history (Firestore)
- ✅ Fast result access (Redis)
- ✅ Secure sandboxing (Docker + limits)

## Support

Check these files for details:
- [CONTAINER_POOL_ARCHITECTURE.md](./CONTAINER_POOL_ARCHITECTURE.md) - Full architecture
- [docker-compose.yml](./docker-compose.yml) - Service configuration
- Worker logs: `docker-compose logs -f worker`
- API logs: `docker-compose logs -f server`
