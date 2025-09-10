# Troubleshooting Guide

## Common Issues and Solutions

### Document Processing Issues

#### 1. Document Upload Fails

**Symptoms:**
- Upload button doesn't respond
- HTTP 500 error on upload
- "Invalid metadata format" error

**Solutions:**
```bash
# Check if servers are running
ps aux | grep -E "(node|python)" | grep -v grep

# Restart Node.js server
npm run start

# Restart Python sidecar
docker compose -f docker-compose.sidecar.yml restart
```

**Debug Steps:**
1. Check browser console for JavaScript errors
2. Verify admin token is set correctly
3. Check server logs: `tail -f logs/combined.log`
4. Verify file size is under 2MB limit

#### 2. Job Processing Stuck

**Symptoms:**
- Job status remains "queued" or "parsing"
- No progress after 5+ minutes
- Job processor not running

**Solutions:**
```bash
# Check job processor status
ps aux | grep "start-job-processor"

# Restart job processor
npm run start:worker

# Check job queue
curl -H "x-admin-token: YOUR_TOKEN" http://localhost:3000/admin/api/jobs
```

**Debug Steps:**
1. Check job processor logs
2. Verify Python sidecar is accessible: `curl http://localhost:8000/health`
3. Check database connectivity
4. Verify environment variables are set

#### 3. Chunk Persistence Failures

**Symptoms:**
- Document processed but no chunks in database
- "Failed to persist chunks" errors
- Missing text files in storage

**Solutions:**
```bash
# Check Supabase connectivity
curl -H "apikey: YOUR_KEY" -H "Authorization: Bearer YOUR_KEY" \
  "https://your-project.supabase.co/rest/v1/document_chunks?select=count"

# Verify environment variables
grep -E "(SUPABASE|SERVICE_KEY)" .env
```

**Debug Steps:**
1. Check Python sidecar logs: `docker logs reimaginedappv2-sidecar-1`
2. Verify Supabase credentials
3. Check database permissions
4. Test direct API calls to Supabase

#### 4. DIP Generation Failures

**Symptoms:**
- "DIP generation failed: 500 Internal Server Error"
- Unicode decode errors
- Missing DIP files

**Solutions:**
```bash
# Test DIP endpoint directly
curl -X POST -H "Content-Type: application/json" \
  -d '{"doc_id":"your_doc_id"}' \
  http://localhost:8000/v1/dip

# Check if chunks exist
curl -H "apikey: YOUR_KEY" -H "Authorization: Bearer YOUR_KEY" \
  "https://your-project.supabase.co/rest/v1/document_chunks?doc_id=eq.your_doc_id"
```

**Debug Steps:**
1. Verify document chunks exist in database
2. Check Python sidecar logs for specific errors
3. Test with a known working document
4. Verify OpenAI API key is valid

### Infrastructure Issues

#### 1. Python Sidecar Not Starting

**Symptoms:**
- Docker container fails to start
- "Connection refused" to localhost:8000
- Missing dependencies

**Solutions:**
```bash
# Rebuild Python sidecar
docker compose -f docker-compose.sidecar.yml down
docker compose -f docker-compose.sidecar.yml up -d --build

# Check container logs
docker logs reimaginedappv2-sidecar-1

# Verify Python dependencies
docker exec reimaginedappv2-sidecar-1 pip list
```

#### 2. Database Connection Issues

**Symptoms:**
- "Database connection failed"
- Supabase API errors
- Authentication failures

**Solutions:**
```bash
# Test Supabase connection
curl -H "apikey: YOUR_SERVICE_KEY" \
  "https://your-project.supabase.co/rest/v1/documents?select=count"

# Verify environment variables
cat .env | grep SUPABASE
```

#### 3. Pinecone Connection Issues

**Symptoms:**
- "Pinecone connection failed"
- Vector upsert errors
- Search not working

**Solutions:**
```bash
# Test Pinecone connectivity
curl -H "Api-Key: YOUR_PINECONE_KEY" \
  "https://your-index.svc.pinecone.io/describe_index_stats"

# Check Python sidecar Pinecone stats
curl http://localhost:8000/v1/pinecone/stats
```

### Performance Issues

#### 1. Slow Document Processing

**Symptoms:**
- Documents take >5 minutes to process
- High CPU/memory usage
- Timeout errors

**Solutions:**
```bash
# Monitor system resources
top -p $(pgrep -f "node\|python")

# Check processing logs
tail -f logs/combined.log | grep -E "(processing|chunk|embedding)"
```

**Optimization Tips:**
1. Reduce PDF file size before upload
2. Increase server memory allocation
3. Use faster OpenAI embedding models
4. Optimize chunk size settings

#### 2. Memory Issues

**Symptoms:**
- "Out of memory" errors
- Server crashes
- Slow response times

**Solutions:**
```bash
# Monitor memory usage
free -h
ps aux --sort=-%mem | head -10

# Restart services
npm run start
docker compose -f docker-compose.sidecar.yml restart
```

### Environment Issues

#### 1. Missing Environment Variables

**Symptoms:**
- "Configuration missing" errors
- Service startup failures
- API authentication errors

**Solutions:**
```bash
# Check all required variables
cat .env | grep -E "(SUPABASE|PINECONE|OPENAI|ADMIN_TOKEN)"

# Verify .env file format
cat .env | grep -v "^#" | grep -v "^$"
```

#### 2. Port Conflicts

**Symptoms:**
- "Port already in use" errors
- Services can't start
- Connection refused errors

**Solutions:**
```bash
# Check port usage
lsof -i :3000  # Node.js
lsof -i :8000  # Python sidecar

# Kill conflicting processes
sudo kill -9 $(lsof -t -i:3000)
sudo kill -9 $(lsof -t -i:8000)
```

## Log Analysis

### Key Log Patterns

#### Success Patterns
```bash
# Successful document processing
grep "Job processing completed successfully" logs/combined.log

# Successful chunk persistence
grep "chunks_written_db\|chunks_written_storage" logs/combined.log

# Successful DIP generation
grep "DIP generation completed" logs/combined.log
```

#### Error Patterns
```bash
# Common error patterns
grep -E "(ERROR|FAILED|Exception)" logs/combined.log

# Specific error types
grep "UnicodeDecodeError" logs/combined.log
grep "Connection refused" logs/combined.log
grep "Authentication failed" logs/combined.log
```

### Log Locations
- **Node.js**: `logs/combined.log`, `logs/error.log`
- **Python Sidecar**: `docker logs reimaginedappv2-sidecar-1`
- **Job Processor**: `logs/combined.log` (filtered by job ID)

## Recovery Procedures

### Complete System Reset
```bash
# Stop all services
npm run stop
docker compose -f docker-compose.sidecar.yml down

# Clear logs
rm -f logs/*.log

# Restart services
npm run start
docker compose -f docker-compose.sidecar.yml up -d
```

### Database Reset
```bash
# Clear document data (CAUTION: This deletes all documents)
# Only run if you need to start fresh

# Clear Supabase tables
curl -X DELETE -H "apikey: YOUR_KEY" -H "Authorization: Bearer YOUR_KEY" \
  "https://your-project.supabase.co/rest/v1/document_chunks"

# Clear Pinecone vectors
curl -X POST -H "Api-Key: YOUR_KEY" \
  "https://your-index.svc.pinecone.io/vectors/delete" \
  -d '{"deleteAll": true}'
```

## Getting Help

### Debug Information to Collect
1. **Environment**: OS, Node.js version, Docker version
2. **Logs**: Last 100 lines of relevant log files
3. **Configuration**: Sanitized .env file (remove secrets)
4. **Error Messages**: Exact error text and stack traces
5. **Steps to Reproduce**: Detailed steps that led to the issue

### Support Channels
1. **Check logs first**: Most issues are logged with details
2. **Review this guide**: Common solutions are documented above
3. **Check GitHub issues**: Search for similar problems
4. **Create detailed issue**: Include all debug information

## Prevention

### Best Practices
1. **Monitor logs regularly**: Set up log monitoring
2. **Keep services updated**: Regular dependency updates
3. **Test after changes**: Verify functionality after updates
4. **Backup configuration**: Keep .env files in version control (sanitized)
5. **Resource monitoring**: Monitor CPU, memory, and disk usage
