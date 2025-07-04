#!/bin/bash
set -e

# Solana MEV Bot Docker Entrypoint Script
echo "🚀 Starting Solana MEV Sandwich Bot..."

# Function to log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to check if file exists and is readable
check_file() {
    if [ ! -f "$1" ]; then
        log "❌ Error: File $1 not found"
        return 1
    fi
    if [ ! -r "$1" ]; then
        log "❌ Error: File $1 is not readable"
        return 1
    fi
    return 0
}

# Function to validate configuration
validate_config() {
    log "🔍 Validating configuration..."
    
    if ! check_file "$CONFIG_PATH"; then
        log "❌ Configuration file validation failed"
        exit 1
    fi
    
    # Validate JSON syntax
    if ! node -e "JSON.parse(require('fs').readFileSync('$CONFIG_PATH', 'utf8'))"; then
        log "❌ Invalid JSON in configuration file"
        exit 1
    fi
    
    log "✅ Configuration validation passed"
}

# Function to validate wallet
validate_wallet() {
    log "🔍 Validating wallet..."
    
    if ! check_file "$WALLET_PATH"; then
        log "❌ Wallet file validation failed"
        exit 1
    fi
    
    # Validate wallet JSON syntax
    if ! node -e "JSON.parse(require('fs').readFileSync('$WALLET_PATH', 'utf8'))"; then
        log "❌ Invalid JSON in wallet file"
        exit 1
    fi
    
    log "✅ Wallet validation passed"
}

# Function to setup directories
setup_directories() {
    log "📁 Setting up directories..."
    
    # Create necessary directories
    mkdir -p /app/logs
    mkdir -p /app/data
    mkdir -p /app/backups
    
    # Set proper permissions
    chmod 755 /app/logs
    chmod 755 /app/data
    chmod 755 /app/backups
    
    log "✅ Directories setup completed"
}

# Function to check network connectivity
check_connectivity() {
    log "🌐 Checking network connectivity..."
    
    # Test basic internet connectivity
    if ! curl -s --max-time 10 https://api.mainnet-beta.solana.com > /dev/null; then
        log "⚠️  Warning: Cannot reach Solana mainnet RPC"
    else
        log "✅ Solana mainnet RPC connectivity OK"
    fi
    
    # Test Jito endpoint if configured
    if [ -n "$JITO_ENDPOINT" ]; then
        if ! curl -s --max-time 10 "$JITO_ENDPOINT" > /dev/null; then
            log "⚠️  Warning: Cannot reach Jito endpoint"
        else
            log "✅ Jito endpoint connectivity OK"
        fi
    fi
}

# Function to wait for dependencies
wait_for_dependencies() {
    log "⏳ Waiting for dependencies..."
    
    # Wait for Redis if configured
    if [ -n "$REDIS_HOST" ]; then
        log "Waiting for Redis at $REDIS_HOST:${REDIS_PORT:-6379}..."
        while ! nc -z "$REDIS_HOST" "${REDIS_PORT:-6379}"; do
            sleep 1
        done
        log "✅ Redis is ready"
    fi
    
    # Wait for any other dependencies here
}

# Function to perform health check
health_check() {
    log "🏥 Performing initial health check..."
    
    # Check if bot can start (dry run)
    if node dist/cli/cli.js test --config "$CONFIG_PATH" --connection; then
        log "✅ Health check passed"
    else
        log "⚠️  Warning: Health check failed, but continuing..."
    fi
}

# Function to setup monitoring
setup_monitoring() {
    log "📊 Setting up monitoring..."
    
    # Create monitoring endpoint
    if [ "$ENABLE_MONITORING" = "true" ]; then
        log "✅ Monitoring enabled on port ${MONITOR_PORT:-3000}"
    else
        log "ℹ️  Monitoring disabled"
    fi
}

# Function to handle graceful shutdown
cleanup() {
    log "🛑 Received shutdown signal, cleaning up..."
    
    # Kill background processes
    if [ -n "$BOT_PID" ]; then
        kill -TERM "$BOT_PID" 2>/dev/null || true
        wait "$BOT_PID" 2>/dev/null || true
    fi
    
    log "✅ Cleanup completed"
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Main execution
main() {
    log "🔧 Initializing Solana MEV Bot container..."
    
    # Set default values
    CONFIG_PATH=${CONFIG_PATH:-/app/config/bot.json}
    WALLET_PATH=${WALLET_PATH:-/app/config/wallet.json}
    LOG_LEVEL=${LOG_LEVEL:-info}
    NODE_ENV=${NODE_ENV:-production}
    
    log "📋 Configuration:"
    log "  - Config Path: $CONFIG_PATH"
    log "  - Wallet Path: $WALLET_PATH"
    log "  - Log Level: $LOG_LEVEL"
    log "  - Environment: $NODE_ENV"
    
    # Setup directories
    setup_directories
    
    # Validate configuration and wallet
    validate_config
    validate_wallet
    
    # Check network connectivity
    check_connectivity
    
    # Wait for dependencies
    wait_for_dependencies
    
    # Setup monitoring
    setup_monitoring
    
    # Perform health check
    health_check
    
    log "🎯 Starting MEV bot with command: $*"
    
    # Execute the main command
    if [ $# -eq 0 ]; then
        # Default command
        exec node dist/cli/cli.js start --config "$CONFIG_PATH"
    else
        # Custom command
        exec "$@"
    fi
}

# Check if running as root (security warning)
if [ "$(id -u)" = "0" ]; then
    log "⚠️  Warning: Running as root user. Consider using a non-root user for security."
fi

# Check if in development mode
if [ "$NODE_ENV" = "development" ]; then
    log "🔧 Development mode detected"
    # Skip some validations in development
    main "$@"
else
    # Production mode - full validation
    main "$@"
fi

