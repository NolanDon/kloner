# Vercel Function Error Monitoring

## Storage Usage Tracking

The WebContainer uses `/tmp` space in Vercel serverless functions. Each function invocation gets its own ephemeral storage allocation.

### Key Metrics to Monitor:
- **ENOSPC errors**: `npm install` failures due to disk space
- **Disk space logs**: `Available disk space in /tmp: X.XMB`
- **Emergency cleanup**: When space drops below 1500MB

### Log Patterns to Search:
- `'ENOSPC'`
- `'Insufficient disk space'`
- `'npm install failed'`
- `'Available disk space in /tmp'`
- `'Emergency cleanup'`

### Alert Setup in Vercel:
1. Go to Vercel Dashboard → Your Project → Functions
2. Set up alerts for:
   - Function errors > 5% rate
   - Specific error patterns in logs
   - Function timeouts

### Storage Characteristics:
- **Per invocation**: Each WebContainer start gets fresh `/tmp` space
- **Not shared**: Different users get separate function instances
- **Ephemeral**: Space is cleaned up after function execution
- **Limited**: Typically 512MB - 2GB depending on plan

### Mitigation Strategies:
- Aggressive cleanup of old containers
- Reduced npm install scope (`--omit=optional`)
- Circuit breaker prevents infinite retries
- Space checks before starting installations
