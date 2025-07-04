import { EventEmitter } from 'events';
import { Keypair } from '@solana/web3.js';
import { 
  BotConfig, 
  SandwichOpportunity, 
  ExecutionResult, 
  BotMetrics,
  MonitorConfig,
  DEXType
} from './types';
import { MonitorManager } from './monitors/monitor-manager';
import { SandwichExecutor } from './executors/sandwich-executor';
import { ProfitCalculator } from './analyzers/profit-calculator';
import { GasOptimizer } from './utils/gas-optimizer';
import { ErrorHandler } from './utils/error-handler';
import { logger } from './utils/logger';
import fs from 'fs';
import Big from 'big.js';

export class SolanaBot extends EventEmitter {
  private config: BotConfig;
  private wallet: Keypair;
  private monitorManager: MonitorManager;
  private executor: SandwichExecutor;
  private profitCalculator: ProfitCalculator;
  private gasOptimizer: GasOptimizer;
  private errorHandler: ErrorHandler;
  
  private isRunning = false;
  private startTime = 0;
  private metrics: BotMetrics;
  private recentOpportunities: SandwichOpportunity[] = [];

  constructor(config: BotConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
    
    // Load wallet
    this.wallet = this.loadWallet();
    
    // Initialize components
    this.initializeComponents();
    
    // Setup event handlers
    this.setupEventHandlers();
    
    logger.info('Solana MEV Bot initialized', {
      walletAddress: this.wallet.publicKey.toString(),
      monitoredDEXs: this.config.monitoredDEXs,
      minProfitThreshold: this.config.minProfitThreshold.toString()
    });
  }

  private loadWallet(): Keypair {
    try {
      if (!fs.existsSync(this.config.privateKeyPath)) {
        throw new Error(`Private key file not found: ${this.config.privateKeyPath}`);
      }
      
      const privateKeyData = fs.readFileSync(this.config.privateKeyPath, 'utf8');
      const privateKeyArray = JSON.parse(privateKeyData);
      
      return Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
    } catch (error) {
      logger.error('Failed to load wallet', error);
      throw new Error(`Failed to load wallet: ${error.message}`);
    }
  }

  private initializeComponents(): void {
    // Create monitor configuration
    const monitorConfig: MonitorConfig = {
      rpcEndpoints: this.config.rpcEndpoints,
      wsEndpoints: this.config.wsEndpoints || [],
      monitoredDEXs: this.config.monitoredDEXs,
      minSlippageThreshold: this.config.maxSlippageTolerance,
      minAmountThreshold: this.config.minProfitThreshold,
      maxLatency: 5000 // 5 seconds max latency
    };

    // Initialize components
    this.monitorManager = new MonitorManager(monitorConfig);
    this.executor = new SandwichExecutor(
      this.config.rpcEndpoints,
      this.config.jitoEndpoint,
      this.wallet,
      this.config.flashloanProviders || []
    );
    this.profitCalculator = new ProfitCalculator(this.config.rpcEndpoints);
    this.gasOptimizer = new GasOptimizer(this.config.rpcEndpoints);
    this.errorHandler = new ErrorHandler({
      maxRetries: this.config.retryAttempts,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2
    });

    logger.info('Bot components initialized successfully');
  }

  private setupEventHandlers(): void {
    // Handle sandwich opportunities from monitor manager
    this.monitorManager.on('sandwich-opportunity', async (opportunity: SandwichOpportunity) => {
      try {
        await this.handleOpportunity(opportunity);
      } catch (error) {
        logger.error('Error handling opportunity', error);
      }
    });

    // Handle execution results
    this.monitorManager.on('execute-opportunity', async (opportunity: SandwichOpportunity) => {
      try {
        await this.executeOpportunity(opportunity);
      } catch (error) {
        logger.error('Error executing opportunity', error);
      }
    });

    logger.debug('Event handlers setup completed');
  }

  private initializeMetrics(): BotMetrics {
    return {
      opportunitiesDetected: 0,
      bundlesSubmitted: 0,
      successfulSandwiches: 0,
      totalProfit: new Big(0),
      averageLatency: 0,
      errorRate: 0,
      uptime: 0
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    try {
      logger.info('Starting Solana MEV Bot');
      this.startTime = Date.now();
      this.isRunning = true;

      // Start all components
      await this.monitorManager.start();
      
      // Start metrics collection
      this.startMetricsCollection();
      
      // Start health monitoring
      this.startHealthMonitoring();

      logger.info('Solana MEV Bot started successfully', {
        walletAddress: this.wallet.publicKey.toString(),
        monitoredDEXs: this.config.monitoredDEXs
      });

      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      logger.error('Failed to start bot', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    try {
      logger.info('Stopping Solana MEV Bot');
      this.isRunning = false;

      // Stop all components
      await this.monitorManager.stop();

      logger.info('Solana MEV Bot stopped successfully');
      this.emit('stopped');
    } catch (error) {
      logger.error('Error stopping bot', error);
      throw error;
    }
  }

  private async handleOpportunity(opportunity: SandwichOpportunity): Promise<void> {
    try {
      logger.info('New sandwich opportunity detected', {
        id: opportunity.id,
        estimatedProfit: opportunity.estimatedProfit.toString(),
        riskScore: opportunity.riskScore,
        confidence: opportunity.confidence
      });

      // Update metrics
      this.metrics.opportunitiesDetected++;

      // Add to recent opportunities
      this.recentOpportunities.unshift(opportunity);
      if (this.recentOpportunities.length > 100) {
        this.recentOpportunities = this.recentOpportunities.slice(0, 100);
      }

      // Check if opportunity meets our criteria
      if (!await this.shouldExecuteOpportunity(opportunity)) {
        logger.debug('Opportunity rejected by filters', {
          id: opportunity.id,
          reason: 'Failed criteria check'
        });
        return;
      }

      // Emit for execution
      this.emit('opportunity-validated', opportunity);
    } catch (error) {
      await this.errorHandler.handleError(error, 'handle_opportunity', {
        opportunityId: opportunity.id
      });
    }
  }

  private async shouldExecuteOpportunity(opportunity: SandwichOpportunity): Promise<boolean> {
    try {
      // Check minimum profit threshold
      if (opportunity.estimatedProfit.lt(this.config.minProfitThreshold)) {
        return false;
      }

      // Check risk tolerance
      if (opportunity.riskScore > this.config.riskTolerance) {
        return false;
      }

      // Check if we have sufficient balance (if not using flashloan)
      const needsFlashloan = opportunity.frontrunAmount.gt(this.config.maxPositionSize);
      if (!needsFlashloan) {
        // Check wallet balance
        // This would implement actual balance checking
        // For now, assume we have sufficient balance
      }

      // Check opportunity age (don't execute stale opportunities)
      const age = Date.now() - opportunity.detectedAt;
      if (age > 5000) { // 5 seconds max age
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking opportunity criteria', error);
      return false;
    }
  }

  private async executeOpportunity(opportunity: SandwichOpportunity): Promise<void> {
    if (this.config.dryRun) {
      await this.simulateExecution(opportunity);
      return;
    }

    try {
      logger.info('Executing sandwich opportunity', {
        id: opportunity.id,
        estimatedProfit: opportunity.estimatedProfit.toString()
      });

      // Update metrics
      this.metrics.bundlesSubmitted++;

      // Execute with error handling and retries
      const result = await this.errorHandler.executeWithRetry(
        () => this.executor.executeSandwich(opportunity),
        'sandwich_execution',
        { opportunityId: opportunity.id }
      );

      await this.handleExecutionResult(opportunity, result);

    } catch (error) {
      const errorResult = await this.errorHandler.handleSandwichExecutionError(
        opportunity,
        error,
        { timestamp: Date.now() }
      );

      await this.handleExecutionResult(opportunity, errorResult);
    }
  }

  private async simulateExecution(opportunity: SandwichOpportunity): Promise<void> {
    try {
      logger.info('SIMULATION: Would execute sandwich opportunity', {
        id: opportunity.id,
        estimatedProfit: opportunity.estimatedProfit.toString(),
        frontrunAmount: opportunity.frontrunAmount.toString(),
        backrunAmount: opportunity.backrunAmount.toString()
      });

      // Simulate successful execution
      const simulatedResult: ExecutionResult = {
        bundleId: `sim_${opportunity.id}`,
        success: true,
        actualProfit: opportunity.estimatedProfit.mul(0.9), // 90% of estimated
        gasUsed: 400000,
        executionTime: Math.random() * 2000 + 500 // 500-2500ms
      };

      await this.handleExecutionResult(opportunity, simulatedResult);
    } catch (error) {
      logger.error('Error in simulation', error);
    }
  }

  private async handleExecutionResult(
    opportunity: SandwichOpportunity,
    result: ExecutionResult
  ): Promise<void> {
    try {
      if (result.success) {
        // Update success metrics
        this.metrics.successfulSandwiches++;
        if (result.actualProfit) {
          this.metrics.totalProfit = this.metrics.totalProfit.plus(result.actualProfit);
        }

        logger.info('Sandwich executed successfully', {
          opportunityId: opportunity.id,
          bundleId: result.bundleId,
          actualProfit: result.actualProfit?.toString(),
          executionTime: result.executionTime
        });

        this.emit('execution-success', {
          opportunity,
          result
        });
      } else {
        logger.warn('Sandwich execution failed', {
          opportunityId: opportunity.id,
          bundleId: result.bundleId,
          error: result.error,
          executionTime: result.executionTime
        });

        this.emit('execution-failure', {
          opportunity,
          result
        });
      }

      // Update latency metrics
      this.updateLatencyMetrics(result.executionTime);

    } catch (error) {
      logger.error('Error handling execution result', error);
    }
  }

  private updateLatencyMetrics(executionTime: number): void {
    // Update average latency using exponential moving average
    const alpha = 0.1; // Smoothing factor
    this.metrics.averageLatency = this.metrics.averageLatency === 0 ?
      executionTime :
      this.metrics.averageLatency * (1 - alpha) + executionTime * alpha;
  }

  private startMetricsCollection(): void {
    // Update metrics every 30 seconds
    setInterval(() => {
      try {
        this.updateMetrics();
      } catch (error) {
        logger.error('Error updating metrics', error);
      }
    }, 30000);
  }

  private updateMetrics(): void {
    // Update uptime
    this.metrics.uptime = Date.now() - this.startTime;

    // Update error rate
    const errorStats = this.errorHandler.getErrorStatistics(3600000); // Last hour
    this.metrics.errorRate = errorStats.errorRate;

    // Log metrics periodically
    logger.info('Bot metrics update', {
      opportunitiesDetected: this.metrics.opportunitiesDetected,
      bundlesSubmitted: this.metrics.bundlesSubmitted,
      successfulSandwiches: this.metrics.successfulSandwiches,
      totalProfit: this.metrics.totalProfit.toString(),
      successRate: this.metrics.bundlesSubmitted > 0 ?
        (this.metrics.successfulSandwiches / this.metrics.bundlesSubmitted * 100).toFixed(2) + '%' :
        '0%',
      uptime: this.formatUptime(this.metrics.uptime)
    });
  }

  private startHealthMonitoring(): void {
    // Health check every 60 seconds
    setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Health check failed', error);
      }
    }, 60000);
  }

  private async performHealthCheck(): Promise<void> {
    const health = {
      timestamp: Date.now(),
      monitorManager: this.monitorManager.getStatus(),
      executor: this.executor.getStatus(),
      profitCalculator: this.profitCalculator.getStatus(),
      gasOptimizer: this.gasOptimizer.getStatus(),
      errorHandler: this.errorHandler.getStatus()
    };

    // Check for critical issues
    const issues: string[] = [];

    if (!health.monitorManager.running) {
      issues.push('Monitor manager not running');
    }

    if (health.executor.queueSize > 100) {
      issues.push('Execution queue overloaded');
    }

    if (health.errorHandler.circuitBreakers.open > 0) {
      issues.push(`${health.errorHandler.circuitBreakers.open} circuit breakers open`);
    }

    if (issues.length > 0) {
      logger.warn('Health check detected issues', { issues });
      this.emit('health-warning', { issues, health });
    } else {
      logger.debug('Health check passed', {
        monitorStatus: health.monitorManager.running,
        executorQueue: health.executor.queueSize,
        errorRate: this.metrics.errorRate
      });
    }
  }

  private formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else {
      return `${minutes}m ${seconds % 60}s`;
    }
  }

  // Public API methods

  async getStatus(): Promise<any> {
    return {
      running: this.isRunning,
      uptime: this.metrics.uptime,
      walletAddress: this.wallet.publicKey.toString(),
      metrics: this.metrics,
      monitors: this.monitorManager.getStatus().monitors,
      recentOpportunities: this.recentOpportunities.slice(0, 10), // Last 10
      config: {
        monitoredDEXs: this.config.monitoredDEXs,
        minProfitThreshold: this.config.minProfitThreshold.toString(),
        maxSlippageTolerance: this.config.maxSlippageTolerance,
        riskTolerance: this.config.riskTolerance,
        dryRun: this.config.dryRun
      }
    };
  }

  async getDetailedMetrics(): Promise<any> {
    const errorStats = this.errorHandler.getErrorStatistics();
    
    return {
      performance: {
        avgExecutionTime: Math.round(this.metrics.averageLatency),
        fastestExecution: 0, // Would track this
        slowestExecution: 0  // Would track this
      },
      profit: {
        gross: this.metrics.totalProfit,
        gasCosts: new Big(0), // Would track this
        net: this.metrics.totalProfit,
        margin: this.metrics.bundlesSubmitted > 0 ?
          (this.metrics.successfulSandwiches / this.metrics.bundlesSubmitted * 100) : 0
      },
      errors: {
        total: errorStats.totalErrors,
        network: errorStats.errorsByType.NETWORK_ERROR || 0,
        bundle: errorStats.errorsByType.BUNDLE_ERROR || 0,
        simulation: errorStats.errorsByType.SIMULATION_ERROR || 0
      },
      opportunities: {
        detected: this.metrics.opportunitiesDetected,
        executed: this.metrics.bundlesSubmitted,
        successful: this.metrics.successfulSandwiches,
        successRate: this.metrics.bundlesSubmitted > 0 ?
          (this.metrics.successfulSandwiches / this.metrics.bundlesSubmitted) : 0
      }
    };
  }

  async updateConfig(newConfig: Partial<BotConfig>): Promise<void> {
    try {
      logger.info('Updating bot configuration', newConfig);
      
      // Update configuration
      this.config = { ...this.config, ...newConfig };
      
      // Update monitor configuration if needed
      if (newConfig.monitoredDEXs || newConfig.rpcEndpoints) {
        const monitorConfig: MonitorConfig = {
          rpcEndpoints: this.config.rpcEndpoints,
          wsEndpoints: this.config.wsEndpoints || [],
          monitoredDEXs: this.config.monitoredDEXs,
          minSlippageThreshold: this.config.maxSlippageTolerance,
          minAmountThreshold: this.config.minProfitThreshold,
          maxLatency: 5000
        };
        
        this.monitorManager.updateConfig(monitorConfig);
      }
      
      logger.info('Bot configuration updated successfully');
      this.emit('config-updated', this.config);
    } catch (error) {
      logger.error('Error updating configuration', error);
      throw error;
    }
  }

  getWalletAddress(): string {
    return this.wallet.publicKey.toString();
  }

  getMetrics(): BotMetrics {
    return { ...this.metrics };
  }

  clearMetrics(): void {
    this.metrics = this.initializeMetrics();
    this.recentOpportunities = [];
    logger.info('Bot metrics cleared');
  }
}

