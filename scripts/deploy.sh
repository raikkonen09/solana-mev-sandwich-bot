#!/bin/bash
set -e

# Solana MEV Bot Deployment Script
echo "🚀 Solana MEV Sandwich Bot Deployment Script"
echo "============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check prerequisites
check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check Docker
    if ! command_exists docker; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check Docker Compose
    if ! command_exists docker-compose && ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker daemon is not running. Please start Docker first."
        exit 1
    fi
    
    print_status "Prerequisites check passed ✅"
}

# Function to setup environment
setup_environment() {
    print_step "Setting up environment..."
    
    # Create .env file if it doesn't exist
    if [ ! -f .env ]; then
        print_status "Creating .env file..."
        cat > .env << EOF
# Solana MEV Bot Environment Configuration
NODE_ENV=production
LOG_LEVEL=info
TIMEZONE=UTC

# Monitoring
MONITOR_PORT=3000
ENABLE_MONITORING=true

# Optional: Prometheus and Grafana
PROMETHEUS_PORT=9090
GRAFANA_PORT=3001
GRAFANA_PASSWORD=admin

# Redis (optional)
REDIS_HOST=redis
REDIS_PORT=6379
EOF
        print_status ".env file created. Please review and modify as needed."
    else
        print_status ".env file already exists."
    fi
    
    # Create necessary directories
    print_status "Creating directories..."
    mkdir -p config logs data backups monitoring/grafana/{dashboards,datasources}
    
    # Set proper permissions
    chmod 755 config logs data backups
    
    print_status "Environment setup completed ✅"
}

# Function to setup configuration
setup_configuration() {
    print_step "Setting up configuration..."
    
    # Create default bot configuration if it doesn't exist
    if [ ! -f config/bot.json ]; then
        print_status "Creating default bot configuration..."
        cat > config/bot.json << EOF
{
  "rpcEndpoints": [
    "https://api.mainnet-beta.solana.com",
    "https://solana-api.projectserum.com"
  ],
  "wsEndpoints": [],
  "jitoEndpoint": "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "privateKeyPath": "/app/config/wallet.json",
  "minProfitThreshold": "0.01",
  "maxSlippageTolerance": 0.1,
  "gasLimitMultiplier": 1.2,
  "retryAttempts": 3,
  "monitoredDEXs": ["raydium", "orca"],
  "flashloanProviders": [],
  "riskTolerance": 0.5,
  "maxPositionSize": "100.0",
  "dryRun": true
}
EOF
        print_warning "Default configuration created with DRY RUN enabled."
        print_warning "Please update config/bot.json with your settings before deployment."
    else
        print_status "Bot configuration already exists."
    fi
    
    # Check if wallet exists
    if [ ! -f config/wallet.json ]; then
        print_warning "Wallet file not found at config/wallet.json"
        print_warning "Please create your wallet file before starting the bot."
        print_warning "You can generate a new wallet using: npm run generate-wallet"
    else
        print_status "Wallet file found."
    fi
    
    print_status "Configuration setup completed ✅"
}

# Function to setup monitoring
setup_monitoring() {
    print_step "Setting up monitoring..."
    
    # Create Prometheus configuration
    if [ ! -f monitoring/prometheus.yml ]; then
        print_status "Creating Prometheus configuration..."
        cat > monitoring/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'mev-bot'
    static_configs:
      - targets: ['mev-bot:3000']
    scrape_interval: 5s
    metrics_path: /metrics

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
EOF
    fi
    
    # Create Grafana datasource configuration
    if [ ! -f monitoring/grafana/datasources/prometheus.yml ]; then
        print_status "Creating Grafana datasource configuration..."
        mkdir -p monitoring/grafana/datasources
        cat > monitoring/grafana/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
EOF
    fi
    
    print_status "Monitoring setup completed ✅"
}

# Function to build Docker image
build_image() {
    print_step "Building Docker image..."
    
    # Build the image
    if docker build -t solana-mev-bot:latest .; then
        print_status "Docker image built successfully ✅"
    else
        print_error "Failed to build Docker image"
        exit 1
    fi
}

# Function to start services
start_services() {
    print_step "Starting services..."
    
    # Determine docker-compose command
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Start services
    if $COMPOSE_CMD up -d; then
        print_status "Services started successfully ✅"
        
        # Show running containers
        print_status "Running containers:"
        $COMPOSE_CMD ps
        
        # Show logs
        print_status "Recent logs:"
        $COMPOSE_CMD logs --tail=20 mev-bot
        
    else
        print_error "Failed to start services"
        exit 1
    fi
}

# Function to show status
show_status() {
    print_step "Checking service status..."
    
    # Determine docker-compose command
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Show container status
    $COMPOSE_CMD ps
    
    # Show health status
    print_status "Health check status:"
    docker inspect --format='{{.State.Health.Status}}' solana-mev-bot 2>/dev/null || echo "Health check not available"
    
    # Show resource usage
    print_status "Resource usage:"
    docker stats --no-stream solana-mev-bot 2>/dev/null || echo "Container not running"
}

# Function to show logs
show_logs() {
    print_step "Showing logs..."
    
    # Determine docker-compose command
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Follow logs
    $COMPOSE_CMD logs -f mev-bot
}

# Function to stop services
stop_services() {
    print_step "Stopping services..."
    
    # Determine docker-compose command
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Stop services
    if $COMPOSE_CMD down; then
        print_status "Services stopped successfully ✅"
    else
        print_error "Failed to stop services"
        exit 1
    fi
}

# Function to clean up
cleanup() {
    print_step "Cleaning up..."
    
    # Determine docker-compose command
    if command_exists docker-compose; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
    
    # Stop and remove containers, networks, volumes
    $COMPOSE_CMD down -v --remove-orphans
    
    # Remove images
    docker rmi solana-mev-bot:latest 2>/dev/null || true
    
    # Clean up unused Docker resources
    docker system prune -f
    
    print_status "Cleanup completed ✅"
}

# Function to update
update() {
    print_step "Updating bot..."
    
    # Pull latest code (if in git repo)
    if [ -d .git ]; then
        git pull origin main
    fi
    
    # Rebuild and restart
    build_image
    stop_services
    start_services
    
    print_status "Update completed ✅"
}

# Function to backup
backup() {
    print_step "Creating backup..."
    
    BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Backup configuration
    cp -r config "$BACKUP_DIR/"
    cp -r data "$BACKUP_DIR/" 2>/dev/null || true
    cp .env "$BACKUP_DIR/" 2>/dev/null || true
    
    # Create archive
    tar -czf "${BACKUP_DIR}.tar.gz" "$BACKUP_DIR"
    rm -rf "$BACKUP_DIR"
    
    print_status "Backup created: ${BACKUP_DIR}.tar.gz ✅"
}

# Function to show help
show_help() {
    echo "Solana MEV Bot Deployment Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  setup     - Setup environment and configuration"
    echo "  build     - Build Docker image"
    echo "  start     - Start services"
    echo "  stop      - Stop services"
    echo "  restart   - Restart services"
    echo "  status    - Show service status"
    echo "  logs      - Show and follow logs"
    echo "  update    - Update and restart bot"
    echo "  backup    - Create backup"
    echo "  cleanup   - Clean up all resources"
    echo "  help      - Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 setup     # Initial setup"
    echo "  $0 start     # Start the bot"
    echo "  $0 logs      # View logs"
    echo "  $0 status    # Check status"
}

# Main script logic
case "${1:-help}" in
    setup)
        check_prerequisites
        setup_environment
        setup_configuration
        setup_monitoring
        print_status "Setup completed! Next steps:"
        print_status "1. Update config/bot.json with your settings"
        print_status "2. Add your wallet to config/wallet.json"
        print_status "3. Run: $0 build"
        print_status "4. Run: $0 start"
        ;;
    build)
        check_prerequisites
        build_image
        ;;
    start)
        check_prerequisites
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        start_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    update)
        check_prerequisites
        update
        ;;
    backup)
        backup
        ;;
    cleanup)
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        print_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac

