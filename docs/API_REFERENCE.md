# API Reference

## Table of Contents
1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Bot Management API](#bot-management-api)
4. [Monitoring API](#monitoring-api)
5. [Configuration API](#configuration-api)
6. [Wallet API](#wallet-api)
7. [WebSocket Events](#websocket-events)
8. [Error Handling](#error-handling)

## Overview

The Solana MEV Bot provides a comprehensive REST API for monitoring, configuration, and control. The API is designed for both programmatic access and integration with monitoring systems.

### Base URL
```
http://localhost:3000/api/v1
```

### Content Type
All API endpoints accept and return JSON data:
```
Content-Type: application/json
```

### Rate Limiting
- 100 requests per minute for monitoring endpoints
- 10 requests per minute for configuration endpoints
- 5 requests per minute for control endpoints

## Authentication

### API Key Authentication
```http
Authorization: Bearer <api_key>
```

### Generate API Key
```bash
npm run cli auth --generate-key
```

### Example Request
```bash
curl -H "Authorization: Bearer your_api_key" \
     http://localhost:3000/api/v1/status
```

## Bot Management API

### Start Bot
Start the MEV bot with specified configuration.

```http
POST /api/v1/bot/start
```

**Request Body:**
```json
{
  "config": {
    "dryRun": false,
    "minProfitThreshold": "0.01"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bot started successfully",
  "data": {
    "botId": "bot_123456",
    "startTime": "2024-01-15T10:30:00Z",
    "status": "running"
  }
}
```

### Stop Bot
Stop the running MEV bot.

```http
POST /api/v1/bot/stop
```

**Response:**
```json
{
  "success": true,
  "message": "Bot stopped successfully",
  "data": {
    "stopTime": "2024-01-15T11:30:00Z",
    "uptime": 3600000
  }
}
```

### Bot Status
Get current bot status and basic metrics.

```http
GET /api/v1/bot/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "uptime": 3600000,
    "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "metrics": {
      "opportunitiesDetected": 150,
      "bundlesSubmitted": 45,
      "successfulSandwiches": 38,
      "totalProfit": "12.45",
      "averageLatency": 450,
      "errorRate": 0.02
    },
    "config": {
      "monitoredDEXs": ["raydium", "orca"],
      "minProfitThreshold": "0.01",
      "dryRun": false
    }
  }
}
```

### Restart Bot
Restart the bot with optional new configuration.

```http
POST /api/v1/bot/restart
```

**Request Body:**
```json
{
  "config": {
    "minProfitThreshold": "0.02"
  }
}
```

## Monitoring API

### Detailed Metrics
Get comprehensive performance metrics.

```http
GET /api/v1/metrics
```

**Query Parameters:**
- `timeframe`: `1h`, `24h`, `7d`, `30d` (default: `1h`)
- `granularity`: `minute`, `hour`, `day` (default: `minute`)

**Response:**
```json
{
  "success": true,
  "data": {
    "timeframe": "1h",
    "performance": {
      "avgExecutionTime": 425,
      "fastestExecution": 180,
      "slowestExecution": 1200,
      "p95Latency": 800,
      "p99Latency": 1100
    },
    "profit": {
      "gross": "15.67",
      "gasCosts": "3.22",
      "net": "12.45",
      "margin": 79.4,
      "profitPerHour": "12.45"
    },
    "opportunities": {
      "detected": 150,
      "executed": 45,
      "successful": 38,
      "successRate": 84.4,
      "averageSize": "250.00"
    },
    "errors": {
      "total": 7,
      "network": 3,
      "bundle": 2,
      "simulation": 2,
      "errorRate": 4.7
    }
  }
}
```

### Recent Opportunities
Get list of recent sandwich opportunities.

```http
GET /api/v1/opportunities
```

**Query Parameters:**
- `limit`: Number of opportunities to return (default: 50, max: 200)
- `status`: `detected`, `executed`, `successful`, `failed`
- `dex`: `raydium`, `orca`, `phoenix`

**Response:**
```json
{
  "success": true,
  "data": {
    "opportunities": [
      {
        "id": "opp_abc123",
        "detectedAt": "2024-01-15T10:25:30Z",
        "dex": "raydium",
        "tokenPair": "SOL/USDC",
        "estimatedProfit": "0.15",
        "actualProfit": "0.12",
        "status": "successful",
        "executionTime": 420,
        "frontrunAmount": "50.00",
        "backrunAmount": "50.00",
        "gasUsed": 185000,
        "bundleId": "bundle_xyz789"
      }
    ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 50,
      "hasNext": true
    }
  }
}
```

### Health Check
Get system health status.

```http
GET /api/v1/health
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00Z",
    "components": {
      "monitorManager": {
        "status": "healthy",
        "running": true,
        "monitorsActive": 2
      },
      "executor": {
        "status": "healthy",
        "queueSize": 3,
        "processing": true
      },
      "rpcConnections": {
        "status": "healthy",
        "activeConnections": 3,
        "averageLatency": 45
      },
      "wallet": {
        "status": "healthy",
        "balance": "150.25",
        "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
      }
    }
  }
}
```

### Logs
Get recent log entries.

```http
GET /api/v1/logs
```

**Query Parameters:**
- `level`: `error`, `warn`, `info`, `debug` (default: `info`)
- `limit`: Number of log entries (default: 100, max: 1000)
- `since`: ISO timestamp to get logs since

**Response:**
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "timestamp": "2024-01-15T10:30:00Z",
        "level": "info",
        "message": "Sandwich executed successfully",
        "metadata": {
          "opportunityId": "opp_abc123",
          "profit": "0.12",
          "executionTime": 420
        }
      }
    ],
    "total": 1500
  }
}
```

## Configuration API

### Get Configuration
Get current bot configuration.

```http
GET /api/v1/config
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rpcEndpoints": [
      "https://api.mainnet-beta.solana.com"
    ],
    "jitoEndpoint": "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
    "minProfitThreshold": "0.01",
    "maxSlippageTolerance": 0.1,
    "monitoredDEXs": ["raydium", "orca"],
    "riskTolerance": 0.5,
    "maxPositionSize": "100.0",
    "dryRun": false
  }
}
```

### Update Configuration
Update bot configuration (requires restart).

```http
PUT /api/v1/config
```

**Request Body:**
```json
{
  "minProfitThreshold": "0.02",
  "maxSlippageTolerance": 0.05,
  "riskTolerance": 0.3
}
```

**Response:**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "data": {
    "updated": ["minProfitThreshold", "maxSlippageTolerance", "riskTolerance"],
    "requiresRestart": true
  }
}
```

### Validate Configuration
Validate configuration without applying changes.

```http
POST /api/v1/config/validate
```

**Request Body:**
```json
{
  "minProfitThreshold": "0.02",
  "monitoredDEXs": ["raydium", "orca", "phoenix"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "warnings": [
      "Phoenix DEX support is experimental"
    ]
  }
}
```

## Wallet API

### Wallet Balance
Get wallet balance for SOL and major tokens.

```http
GET /api/v1/wallet/balance
```

**Response:**
```json
{
  "success": true,
  "data": {
    "address": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    "balances": {
      "SOL": {
        "amount": "150.25",
        "usdValue": "15025.00"
      },
      "USDC": {
        "amount": "5000.00",
        "usdValue": "5000.00"
      }
    },
    "totalUsdValue": "20025.00"
  }
}
```

### Transaction History
Get recent wallet transactions.

```http
GET /api/v1/wallet/transactions
```

**Query Parameters:**
- `limit`: Number of transactions (default: 50, max: 200)
- `type`: `all`, `sandwich`, `gas`, `transfer`

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "signature": "5j7s8K9mN2pQ3rT4uV5wX6yZ7a8B9c0D1e2F3g4H5i6J7k8L9m0N1o2P3q4R5s6T",
        "timestamp": "2024-01-15T10:25:30Z",
        "type": "sandwich",
        "status": "confirmed",
        "amount": "50.00",
        "token": "SOL",
        "profit": "0.12",
        "gasUsed": 185000,
        "gasCost": "0.00925"
      }
    ],
    "pagination": {
      "total": 500,
      "page": 1,
      "limit": 50
    }
  }
}
```

## WebSocket Events

### Connection
Connect to real-time event stream.

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
```

### Authentication
```javascript
ws.send(JSON.stringify({
  type: 'auth',
  token: 'your_api_key'
}));
```

### Event Types

#### Opportunity Detected
```json
{
  "type": "opportunity_detected",
  "data": {
    "id": "opp_abc123",
    "dex": "raydium",
    "estimatedProfit": "0.15",
    "confidence": 0.85,
    "detectedAt": "2024-01-15T10:25:30Z"
  }
}
```

#### Execution Started
```json
{
  "type": "execution_started",
  "data": {
    "opportunityId": "opp_abc123",
    "bundleId": "bundle_xyz789",
    "startedAt": "2024-01-15T10:25:31Z"
  }
}
```

#### Execution Completed
```json
{
  "type": "execution_completed",
  "data": {
    "opportunityId": "opp_abc123",
    "bundleId": "bundle_xyz789",
    "success": true,
    "actualProfit": "0.12",
    "executionTime": 420,
    "completedAt": "2024-01-15T10:25:31.420Z"
  }
}
```

#### Error Event
```json
{
  "type": "error",
  "data": {
    "errorType": "BUNDLE_ERROR",
    "message": "Bundle submission failed",
    "context": {
      "opportunityId": "opp_abc123",
      "bundleId": "bundle_xyz789"
    },
    "timestamp": "2024-01-15T10:25:31Z"
  }
}
```

#### Status Update
```json
{
  "type": "status_update",
  "data": {
    "status": "running",
    "metrics": {
      "opportunitiesDetected": 151,
      "totalProfit": "12.57"
    },
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Subscription Management
```javascript
// Subscribe to specific events
ws.send(JSON.stringify({
  type: 'subscribe',
  events: ['opportunity_detected', 'execution_completed']
}));

// Unsubscribe from events
ws.send(JSON.stringify({
  type: 'unsubscribe',
  events: ['status_update']
}));
```

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CONFIG",
    "message": "Invalid configuration parameter",
    "details": {
      "field": "minProfitThreshold",
      "value": "-0.01",
      "reason": "Must be positive"
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### HTTP Status Codes
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (invalid API key)
- `403`: Forbidden (insufficient permissions)
- `404`: Not Found
- `429`: Too Many Requests (rate limited)
- `500`: Internal Server Error
- `503`: Service Unavailable (bot not running)

### Error Codes

#### Configuration Errors
- `INVALID_CONFIG`: Invalid configuration parameter
- `CONFIG_VALIDATION_FAILED`: Configuration validation failed
- `MISSING_REQUIRED_FIELD`: Required configuration field missing

#### Authentication Errors
- `INVALID_API_KEY`: Invalid or expired API key
- `MISSING_AUTH_HEADER`: Authorization header missing
- `INSUFFICIENT_PERMISSIONS`: Insufficient permissions for operation

#### Bot Errors
- `BOT_NOT_RUNNING`: Bot is not currently running
- `BOT_ALREADY_RUNNING`: Bot is already running
- `START_FAILED`: Failed to start bot
- `STOP_FAILED`: Failed to stop bot

#### Wallet Errors
- `WALLET_NOT_FOUND`: Wallet file not found
- `INSUFFICIENT_BALANCE`: Insufficient wallet balance
- `WALLET_LOCKED`: Wallet is locked or encrypted

#### Network Errors
- `RPC_CONNECTION_FAILED`: Failed to connect to RPC endpoint
- `NETWORK_TIMEOUT`: Network request timeout
- `RATE_LIMITED`: Rate limited by external service

### Retry Logic
For transient errors (5xx status codes), implement exponential backoff:

```javascript
async function apiRequest(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response.json();
      if (response.status < 500) throw new Error('Client error');
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

This API reference provides comprehensive documentation for integrating with the Solana MEV Bot. For additional examples and SDKs, see the [examples](../examples/) directory.

