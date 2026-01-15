# Vercel Storage Visibility

## ❌ What You CANNOT See Visually

- **No /tmp storage usage graphs** in Vercel dashboard
- **No real-time storage metrics** for serverless functions
- **No storage usage charts** or visual indicators
- **No per-function storage allocation** visibility

## ✅ What You CAN See in Vercel Dashboard

**Functions Tab:**
- Function execution times
- Error rates and counts
- Function invocation counts
- Cold start indicators

**Analytics Tab:**
- Bandwidth usage
- Request counts
- Geographic distribution
- Performance metrics

## 🔍 Monitoring Alternatives

### 1. Error-Based Monitoring (Current)
- Monitor ENOSPC error rates in logs
- Set alerts for >5% error rate on WebContainer endpoints
- Use error spikes as storage pressure indicators

### 2. External Monitoring Solutions
```bash
# Example: Send metrics to external service
# In your function logs, you can extract:
# "Available disk space in /tmp: 2048.0MB"
# "npm install failed for app app_xxx"

# Tools you could integrate:
# - DataDog: Vercel integration available
# - New Relic: Serverless monitoring
# - Sentry: Error tracking with custom metrics
# - Custom webhook to send logs to your own dashboard
```

### 3. Log-Based Dashboards
You can build dashboards using:
- Vercel log exports to external services
- Custom parsing of function logs
- Error rate trends over time

## 📊 Current Monitoring Setup

The code now logs detailed metrics:
```
[WebContainer POST] Available disk space in /tmp: 2048.0MB
[WebContainer POST] Disk space metrics - Available: 2048.0MB, AppId: app_xxx, Mode: dev
[WebContainer POST] npm install failed for app app_xxx: [error details]
```

Use these logs with external monitoring tools to create visual dashboards.
