# Troubleshooting Guide

## Table of Contents
1. [Common Issues](#common-issues)
2. [Installation Problems](#installation-problems)
3. [Configuration Issues](#configuration-issues)
4. [Runtime Errors](#runtime-errors)
5. [Performance Issues](#performance-issues)
6. [Network Problems](#network-problems)
7. [Debugging Tools](#debugging-tools)
8. [Getting Help](#getting-help)

## Common Issues

### Bot Won't Start

**Symptoms:**
- Bot exits immediately after starting
- Error messages about missing files
- Configuration validation failures

**Solutions:**

1. **Check Configuration File**
   ```bash
   npm run cli config --validate config/bot.json
   ```
   
   Common configuration issues:
   - Missing required fields
   - Invalid JSON syntax
   - Incorrect file paths
   - Invalid DEX names

2. **Verify Wallet File**
   ```bash
   # Check if wallet file exists and is readable
   ls -la config/wallet.json
   
   # Validate wallet format
   node -e "console.log(JSON.parse(require('fs').readFileSync('config/wallet.json')))"
   ```

3. **Check Dependencies**
   ```bash
   npm install
   npm run build
   ```

4. **Verify RPC Endpoints**
   ```bash
   npm run cli test --connection
   ```

### No Opportunities Detected

**Symptoms:**
- Bot runs but shows zero opportunities
- Monitoring shows no activity
- No transactions being processed

**Solutions:**

1. **Check DEX Monitoring**
   ```bash
   npm run cli status
   ```
   
   Verify that:
   - Monitored DEXs are active
   - RPC connections are healthy
   - WebSocket connections are established

2. **Lower Profit Threshold**
   ```json
   {
     "minProfitThreshold": "0.001"
   }
   ```

3. **Increase Slippage Tolerance**
   ```json
   {
     "maxSlippageTolerance": 0.2
   }
   ```

4. **Check Market Activity**
   - Verify there's sufficient trading volume
   - Check if markets are open
   - Monitor for network congestion

### Execution Failures

**Symptoms:**
- Opportunities detected but not executed
- High failure rate in logs
- Bundle submission errors

**Solutions:**

1. **Check Gas Settings**
   ```json
   {
     "gasLimitMultiplier": 1.5,
     "priorityFeeMultiplier": 2.0
   }
   ```

2. **Verify Wallet Balance**
   ```bash
   npm run cli wallet --balance
   ```

3. **Test Jito Connection**
   ```bash
   curl -X POST https://mainnet.block-engine.jito.wtf/api/v1/bundles \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"getInflightBundleStatuses","params":[[]]}'
   ```

4. **Enable Dry Run Mode**
   ```json
   {
     "dryRun": true
   }
   ```

## Installation Problems

### Node.js Version Issues

**Error:**
```
Error: Unsupported Node.js version
```

**Solution:**
```bash
# Install Node.js 18 or higher
nvm install 18
nvm use 18

# Or using package manager
sudo apt update
sudo apt install nodejs npm
```

### Dependency Installation Failures

**Error:**
```
npm ERR! peer dep missing
```

**Solution:**
```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Use specific npm version
npm install -g npm@latest
```

### TypeScript Compilation Errors

**Error:**
```
error TS2307: Cannot find module
```

**Solution:**
```bash
# Install TypeScript globally
npm install -g typescript

# Rebuild project
npm run clean
npm run build

# Check TypeScript configuration
npx tsc --showConfig
```

### Docker Build Issues

**Error:**
```
Docker build failed
```

**Solution:**
```bash
# Check Docker daemon
sudo systemctl status docker

# Clean Docker cache
docker system prune -a

# Build with verbose output
docker build --no-cache --progress=plain -t solana-mev-bot .

# Check Dockerfile syntax
docker build --dry-run .
```

## Configuration Issues

### Invalid JSON Configuration

**Error:**
```
SyntaxError: Unexpected token in JSON
```

**Solution:**
```bash
# Validate JSON syntax
python -m json.tool config/bot.json

# Or use jq
jq . config/bot.json

# Or use online JSON validator
```

### RPC Endpoint Problems

**Error:**
```
Failed to connect to RPC endpoint
```

**Solution:**
```bash
# Test endpoint manually
curl -X POST https://api.mainnet-beta.solana.com \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Check endpoint rate limits
# Verify API key if required
# Try alternative endpoints
```

### Wallet Configuration Issues

**Error:**
```
Invalid private key format
```

**Solution:**
```bash
# Generate new wallet
npm run generate-wallet

# Verify wallet format (should be array of 64 numbers)
node -e "
const wallet = JSON.parse(require('fs').readFileSync('config/wallet.json'));
console.log('Length:', wallet.length);
console.log('Type:', typeof wallet[0]);
"

# Convert from base58 if needed
node -e "
const bs58 = require('bs58');
const keypair = bs58.decode('your_base58_private_key');
console.log(JSON.stringify(Array.from(keypair)));
"
```

## Runtime Errors

### Memory Issues

**Error:**
```
JavaScript heap out of memory
```

**Solution:**
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"

# Or in package.json scripts
"start": "node --max-old-space-size=4096 dist/cli/cli.js"

# Monitor memory usage
npm run cli status --watch
```

### Network Timeout Errors

**Error:**
```
Request timeout after 30000ms
```

**Solution:**
```json
{
  "networkTimeout": 60000,
  "retryAttempts": 5,
  "retryDelay": 2000
}
```

### Database Connection Issues

**Error:**
```
Redis connection failed
```

**Solution:**
```bash
# Check Redis status
docker-compose ps redis

# Restart Redis
docker-compose restart redis

# Check Redis logs
docker-compose logs redis

# Test Redis connection
redis-cli ping
```

### Permission Errors

**Error:**
```
EACCES: permission denied
```

**Solution:**
```bash
# Fix file permissions
chmod 644 config/bot.json
chmod 600 config/wallet.json
chmod 755 logs/

# Fix ownership
sudo chown -R $USER:$USER .

# Run with proper user in Docker
docker run --user $(id -u):$(id -g) solana-mev-bot
```

## Performance Issues

### High Latency

**Symptoms:**
- Slow opportunity detection
- High execution times
- Poor success rates

**Solutions:**

1. **Optimize RPC Endpoints**
   ```json
   {
     "rpcEndpoints": [
       "https://your-dedicated-rpc.com",
       "wss://your-websocket-endpoint.com"
     ]
   }
   ```

2. **Tune Performance Settings**
   ```json
   {
     "maxConcurrentOpportunities": 5,
     "opportunityTimeout": 5000,
     "batchSize": 10
   }
   ```

3. **Monitor System Resources**
   ```bash
   # Check CPU and memory usage
   htop
   
   # Monitor network latency
   ping api.mainnet-beta.solana.com
   
   # Check disk I/O
   iotop
   ```

### Low Success Rate

**Symptoms:**
- Many opportunities detected but few executed
- Bundle submission failures
- Transaction timeouts

**Solutions:**

1. **Increase Gas Limits**
   ```json
   {
     "gasLimitMultiplier": 2.0,
     "priorityFeeMultiplier": 3.0
   }
   ```

2. **Optimize Timing**
   ```json
   {
     "executionDelay": 100,
     "bundleTimeout": 10000
   }
   ```

3. **Improve Competition Strategy**
   ```json
   {
     "competitiveMode": true,
     "aggressiveBidding": true
   }
   ```

### Resource Exhaustion

**Symptoms:**
- High CPU usage
- Memory leaks
- Disk space issues

**Solutions:**

1. **Resource Monitoring**
   ```bash
   # Monitor resource usage
   docker stats solana-mev-bot
   
   # Check log file sizes
   du -sh logs/
   
   # Monitor disk space
   df -h
   ```

2. **Resource Limits**
   ```yaml
   # docker-compose.yml
   deploy:
     resources:
       limits:
         memory: 2G
         cpus: '1.0'
   ```

3. **Log Rotation**
   ```json
   {
     "logging": {
       "maxFileSize": "100MB",
       "maxFiles": 5,
       "compress": true
     }
   }
   ```

## Network Problems

### RPC Connection Issues

**Symptoms:**
- Frequent disconnections
- Slow response times
- Rate limiting errors

**Solutions:**

1. **Multiple RPC Providers**
   ```json
   {
     "rpcEndpoints": [
       "https://api.mainnet-beta.solana.com",
       "https://solana-api.projectserum.com",
       "https://your-private-rpc.com"
     ]
   }
   ```

2. **Connection Pooling**
   ```json
   {
     "connectionPool": {
       "maxConnections": 10,
       "keepAlive": true,
       "timeout": 30000
     }
   }
   ```

3. **Retry Configuration**
   ```json
   {
     "retryConfig": {
       "maxRetries": 3,
       "baseDelay": 1000,
       "maxDelay": 10000
     }
   }
   ```

### WebSocket Issues

**Symptoms:**
- Connection drops
- Missing events
- Reconnection failures

**Solutions:**

1. **WebSocket Configuration**
   ```json
   {
     "websocket": {
       "reconnectInterval": 5000,
       "maxReconnectAttempts": 10,
       "pingInterval": 30000
     }
   }
   ```

2. **Fallback Mechanisms**
   ```json
   {
     "fallbackToPolling": true,
     "pollingInterval": 1000
   }
   ```

### Firewall Issues

**Symptoms:**
- Connection timeouts
- Blocked requests
- DNS resolution failures

**Solutions:**

1. **Check Firewall Rules**
   ```bash
   # Check iptables
   sudo iptables -L
   
   # Check ufw status
   sudo ufw status
   
   # Allow outbound HTTPS
   sudo ufw allow out 443
   ```

2. **DNS Configuration**
   ```bash
   # Test DNS resolution
   nslookup api.mainnet-beta.solana.com
   
   # Use alternative DNS
   echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
   ```

## Debugging Tools

### Enable Debug Logging

```bash
# Set debug log level
export LOG_LEVEL=debug

# Or in configuration
{
  "logLevel": "debug",
  "debugModules": ["monitor", "executor", "profit-calculator"]
}
```

### Transaction Tracing

```bash
# Enable transaction tracing
npm run cli start --trace-transactions

# View transaction details
npm run cli logs --level debug --filter "transaction"
```

### Performance Profiling

```bash
# Enable profiling
node --prof dist/cli/cli.js start

# Generate profile report
node --prof-process isolate-*.log > profile.txt
```

### Network Debugging

```bash
# Monitor network traffic
sudo tcpdump -i any port 443

# Check connection status
netstat -an | grep :443

# Test specific endpoints
curl -v https://api.mainnet-beta.solana.com
```

### Memory Debugging

```bash
# Generate heap snapshot
kill -USR2 <bot_process_id>

# Analyze with Chrome DevTools
# Open chrome://inspect and load the snapshot
```

## Getting Help

### Log Analysis

When reporting issues, include relevant logs:

```bash
# Get recent error logs
npm run cli logs --level error --limit 100

# Get system information
npm run cli status
npm run cli test --all

# Export configuration (remove sensitive data)
npm run cli config --show > config_export.json
```

### Issue Reporting

Include the following information:

1. **Environment Details**
   - Operating system and version
   - Node.js version
   - Docker version (if applicable)
   - Bot version

2. **Configuration**
   - Sanitized configuration file
   - RPC endpoints used
   - Monitored DEXs

3. **Error Details**
   - Complete error messages
   - Stack traces
   - Relevant log entries

4. **Reproduction Steps**
   - Steps to reproduce the issue
   - Expected vs actual behavior
   - Frequency of occurrence

### Community Support

- **GitHub Issues**: [Report bugs and feature requests](https://github.com/raikkonen09/solana-mev-sandwich-bot/issues)
- **Discussions**: [Community discussions and Q&A](https://github.com/raikkonen09/solana-mev-sandwich-bot/discussions)
- **Documentation**: [Complete documentation](https://github.com/raikkonen09/solana-mev-sandwich-bot/docs)

### Professional Support

For production deployments and custom implementations:

- **Consulting Services**: Available for setup and optimization
- **Custom Development**: Tailored solutions for specific requirements
- **24/7 Support**: Enterprise support packages available

### Emergency Procedures

If the bot is causing financial losses:

1. **Immediate Stop**
   ```bash
   npm run cli stop
   # Or kill the process
   pkill -f "solana-mev-bot"
   ```

2. **Enable Dry Run**
   ```json
   {
     "dryRun": true
   }
   ```

3. **Review Recent Activity**
   ```bash
   npm run cli wallet --transactions --limit 50
   npm run cli logs --level error --since "1 hour ago"
   ```

4. **Contact Support**
   - Document the issue
   - Preserve logs and configuration
   - Report to the development team

Remember: MEV trading involves financial risk. Always test thoroughly in dry-run mode before live trading, and never risk more than you can afford to lose.

