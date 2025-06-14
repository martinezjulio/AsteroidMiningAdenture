# Timeline Generation Concurrency Management

## Overview

The timeline generation system has been designed to handle multiple simultaneous users safely and efficiently. This guide explains how the concurrency management works and how to test it.

## Concurrency Features

### 1. **Process Queue System**
- Maximum 3 concurrent Python timeline generations (configurable)
- Additional requests are queued automatically
- First-in-first-out (FIFO) queue processing
- Real-time monitoring and logging

### 2. **Unique Request Handling**
- Each request gets a unique ID: `timeline_{timestamp}_{random}`
- Separate backup files prevent conflicts: `timeline_{requestId}.json`
- Request tracking for debugging and monitoring

### 3. **Resource Protection**
- Prevents server overload from too many Python processes
- Automatic cleanup of old backup files (hourly)
- Graceful error handling and fallbacks

### 4. **Monitoring & Health Checks**
- Real-time queue status monitoring
- Server health endpoint
- Performance metrics and logging

## How It Works

### Request Flow
```
User Request → Queue Check → Process or Queue → Python Generation → Response
                     ↓                               ↓
            If capacity available              Unique backup file
                     ↓                               ↓
               Start generation                 JSON to stdout
                     ↓                               ↓
            Track active count                Return to user
```

### Concurrency Limits
- **MAX_CONCURRENT_GENERATIONS**: 3 (default)
- **TIMEOUT**: 30 seconds per generation
- **CLEANUP_INTERVAL**: 1 hour for old backup files

## API Endpoints

### Timeline Generation
```
GET /api/timeline
```
- Generates fresh timeline for each user
- Returns JSON timeline data
- Automatically queued if server at capacity

### Status Monitoring
```
GET /api/timeline-status
```
Returns:
```json
{
  "active_generations": 2,
  "max_concurrent": 3,
  "queue_length": 1,
  "capacity_available": 1,
  "server_time": "2024-01-15T10:30:00.000Z",
  "uptime_seconds": 3600
}
```

### Health Check
```
GET /api/health
```
Returns comprehensive server health including:
- Timeline system status
- MongoDB connection status
- Memory usage
- Server uptime

## Testing Concurrency

### Install Dependencies
```bash
npm install  # Installs axios for testing
```

### Run Concurrency Test
```bash
npm run test-concurrency
```

This simulates 10 concurrent users requesting timelines simultaneously.

### Custom Test Configuration
Edit `test_concurrency.js` to adjust:
- `CONCURRENT_USERS`: Number of simultaneous users
- `SERVER_URL`: Target server URL
- `TEST_TIMEOUT`: Request timeout duration

### Sample Test Output
```
🧪 Starting concurrency test with 10 users...
📡 Testing server: http://localhost:8080
📊 Server Status: { active_generations: 0, queue_length: 0, ... }

🚀 User 1: Requesting timeline...
🚀 User 2: Requesting timeline...
🚀 User 3: Requesting timeline...
...

✅ User 1: Timeline received in 2341ms (9 sessions)
✅ User 2: Timeline received in 2456ms (9 sessions)
✅ User 3: Timeline received in 2234ms (9 sessions)

📋 Test Results:
Total Users: 10
Successful: 10
Failed: 0
Total Duration: 8234ms
Average Time per User: 823ms
Success Rate: 100.0%
✅ Excellent performance!
```

## Configuration Options

### Server Configuration (`server.js`)
```javascript
const MAX_CONCURRENT_GENERATIONS = 3; // Adjust based on server capacity
const TIMEOUT = 30000; // 30 second timeout
```

### Python Script Configuration (`models.py`)
```python
# Timeline parameters
rounds=2
num_play_arm_pulls=6  
num_watch_arm_pulls=6
```

## File Management

### Backup Files
- Unique files: `configs/timeline_{requestId}.json`
- Main file: `configs/timeline.json` (for backward compatibility)
- Automatic cleanup after 1 hour

### Cleanup Process
- Runs on server startup
- Runs every hour automatically
- Only removes files older than 1 hour
- Preserves main `timeline.json` file

## Performance Recommendations

### Server Specifications
- **CPU**: Multi-core recommended for Python processes
- **Memory**: 2GB+ RAM for multiple concurrent generations
- **Storage**: SSD recommended for file I/O performance

### Scaling Options
1. **Increase Concurrency**: Raise `MAX_CONCURRENT_GENERATIONS`
2. **Pre-generation**: Generate timeline pool in advance
3. **Caching**: Cache recently generated timelines
4. **Load Balancing**: Distribute across multiple servers

## Error Handling

### Common Scenarios
- **Python Not Found**: Fallback to static timeline
- **Timeout**: Clear request and process queue
- **File Conflicts**: Unique filenames prevent overwrites
- **Memory Issues**: Limited concurrent processes

### Fallback Strategy
If dynamic generation fails:
1. Log detailed error information
2. Return error response with `requestId`
3. Client falls back to static `timeline.json`
4. Queue continues processing other requests

## Monitoring in Production

### Key Metrics to Watch
- Active generations count
- Queue length trends
- Average response times
- Error rates
- Memory usage patterns

### Alerting Thresholds
- Queue length > 10 users
- Average response time > 10 seconds
- Error rate > 5%
- Memory usage > 80%

## Troubleshooting

### High Queue Length
1. Check Python installation and performance
2. Consider increasing `MAX_CONCURRENT_GENERATIONS`
3. Monitor system resources (CPU, memory)
4. Check for hanging Python processes

### Slow Response Times
1. Verify Python script performance
2. Check disk I/O for backup file writes
3. Monitor network latency
4. Consider pre-generation strategy

### File Permission Errors
1. Ensure `configs/` directory is writable
2. Check Node.js process permissions
3. Verify disk space availability

## Future Enhancements

### Possible Improvements
1. **Redis Queue**: For distributed deployments
2. **Timeline Caching**: Store common configurations
3. **Pre-generation Pool**: Background timeline creation
4. **User Preferences**: Custom timeline parameters
5. **Analytics**: Detailed usage metrics

---

For questions or issues, check the server logs or monitoring endpoints for detailed information. 