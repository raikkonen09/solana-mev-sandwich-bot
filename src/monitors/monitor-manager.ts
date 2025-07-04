import { EventEmitter } from 'events';
import { BaseMonitor } from './base-monitor';
import { RaydiumMonitor } from './raydium-monitor';
import { TransactionSimulator } from './transaction-simulator';
import { SwapTransaction, DEXType, MonitorConfig, SandwichOpportunity } from '../types';
import { logger } from '../utils/logger';
import Big from 'big.js';

export class MonitorManager extends EventEmitter {
  private monitors: Map<DEXType, BaseMonitor> = new Map();
  private simulator: TransactionSimulator;
  private config: MonitorConfig;
  private isRunning = false;
  private opportunityQueue: SandwichOpportunity[] = [];
  private processedSignatures: Set<string> = new Set();

  constructor(config: MonitorConfig) {
    super();
    this.config = config;
    this.simulator = new TransactionSimulator(config.rpcEndpoints);
    this.initializeMonitors();
  }

  private initializeMonitors(): void {
    // Initialize monitors for each configured DEX
    if (this.config.monitoredDEXs.includes(DEXType.RAYDIUM)) {
      const raydiumMonitor = new RaydiumMonitor(this.config);
      this.monitors.set(DEXType.RAYDIUM, raydiumMonitor);
      
      raydiumMonitor.on('opportunity', (transaction: SwapTransaction) => {
        this.handleOpportunity(transaction);
      });
    }

    // TODO: Add Orca and Phoenix monitors when implemented
    // if (this.config.monitoredDEXs.includes(DEXType.ORCA)) {
    //   const orcaMonitor = new OrcaMonitor(this.config);
    //   this.monitors.set(DEXType.ORCA, orcaMonitor);
    // }

    // if (this.config.monitoredDEXs.includes(DEXType.PHOENIX)) {
    //   const phoenixMonitor = new PhoenixMonitor(this.config);
    //   this.monitors.set(DEXType.PHOENIX, phoenixMonitor);
    // }

    logger.info(`Initialized ${this.monitors.size} monitors`);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Monitor manager is already running');
      return;
    }

    logger.info('Starting monitor manager');
    this.isRunning = true;

    // Start all monitors
    const startPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.start().catch(error => {
        logger.error(`Failed to start monitor`, error);
      })
    );

    await Promise.all(startPromises);

    // Start opportunity processing
    this.startOpportunityProcessing();

    // Start cleanup routine
    this.startCleanupRoutine();

    logger.info('Monitor manager started successfully');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping monitor manager');
    this.isRunning = false;

    // Stop all monitors
    const stopPromises = Array.from(this.monitors.values()).map(monitor => 
      monitor.stop().catch(error => {
        logger.error(`Failed to stop monitor`, error);
      })
    );

    await Promise.all(stopPromises);

    // Clear queues
    this.opportunityQueue = [];
    this.processedSignatures.clear();

    logger.info('Monitor manager stopped');
  }

  private async handleOpportunity(transaction: SwapTransaction): Promise<void> {
    try {
      // Check if we've already processed this transaction
      if (this.processedSignatures.has(transaction.signature)) {
        logger.debug(`Transaction already processed: ${transaction.signature}`);
        return;
      }

      this.processedSignatures.add(transaction.signature);

      logger.info('Processing new opportunity', {
        signature: transaction.signature,
        dex: transaction.dex,
        amountIn: transaction.amountIn.toString(),
        slippage: transaction.slippageTolerance
      });

      // Estimate optimal amounts for sandwich attack
      const optimalAmounts = await this.simulator.estimateOptimalAmounts(transaction);

      // Validate profitability
      const profitCalculation = await this.simulator.validateProfitability(
        transaction,
        optimalAmounts.frontrunAmount,
        optimalAmounts.backrunAmount
      );

      // Check if opportunity meets minimum profit threshold
      if (profitCalculation.netProfit.lt(this.config.minAmountThreshold)) {
        logger.debug('Opportunity below profit threshold', {
          signature: transaction.signature,
          profit: profitCalculation.netProfit.toString(),
          threshold: this.config.minAmountThreshold.toString()
        });
        return;
      }

      // Create sandwich opportunity
      const opportunity: SandwichOpportunity = {
        id: `${transaction.dex}_${transaction.signature}_${Date.now()}`,
        targetTransaction: transaction,
        estimatedProfit: profitCalculation.netProfit,
        frontrunAmount: optimalAmounts.frontrunAmount,
        backrunAmount: optimalAmounts.backrunAmount,
        gasEstimate: profitCalculation.gasCosts,
        riskScore: this.calculateRiskScore(transaction, profitCalculation),
        confidence: this.calculateConfidence(transaction, profitCalculation),
        detectedAt: Date.now()
      };

      // Add to opportunity queue
      this.opportunityQueue.push(opportunity);
      this.opportunityQueue.sort((a, b) => 
        b.estimatedProfit.minus(a.estimatedProfit).toNumber()
      );

      // Emit opportunity event
      this.emit('sandwich-opportunity', opportunity);

      logger.info('Sandwich opportunity created', {
        id: opportunity.id,
        profit: opportunity.estimatedProfit.toString(),
        riskScore: opportunity.riskScore,
        confidence: opportunity.confidence
      });

    } catch (error) {
      logger.error('Error handling opportunity', error);
    }
  }

  private calculateRiskScore(
    transaction: SwapTransaction, 
    profitCalc: ProfitCalculation
  ): number {
    // Calculate risk score based on various factors
    let riskScore = 0;

    // Slippage risk
    if (transaction.slippageTolerance > 0.1) riskScore += 0.3; // High slippage
    else if (transaction.slippageTolerance > 0.05) riskScore += 0.2; // Medium slippage
    else riskScore += 0.1; // Low slippage

    // Profit margin risk
    if (profitCalc.profitMargin < 1) riskScore += 0.4; // Low margin
    else if (profitCalc.profitMargin < 5) riskScore += 0.2; // Medium margin
    else riskScore += 0.1; // High margin

    // Market impact risk
    const marketImpact = transaction.amountIn.div(1000000); // Simplified calculation
    if (marketImpact.gt(100)) riskScore += 0.3; // High impact
    else if (marketImpact.gt(10)) riskScore += 0.2; // Medium impact
    else riskScore += 0.1; // Low impact

    return Math.min(riskScore, 1.0); // Cap at 1.0
  }

  private calculateConfidence(
    transaction: SwapTransaction,
    profitCalc: ProfitCalculation
  ): number {
    // Calculate confidence based on various factors
    let confidence = 1.0;

    // Reduce confidence for high slippage
    if (transaction.slippageTolerance > 0.1) confidence -= 0.2;
    else if (transaction.slippageTolerance > 0.05) confidence -= 0.1;

    // Reduce confidence for low profit margins
    if (profitCalc.profitMargin < 1) confidence -= 0.3;
    else if (profitCalc.profitMargin < 5) confidence -= 0.1;

    // Reduce confidence for large transactions (more competition)
    if (transaction.amountIn.gt(new Big('10000000000'))) confidence -= 0.2; // > 10 SOL

    return Math.max(confidence, 0.1); // Minimum 10% confidence
  }

  private startOpportunityProcessing(): void {
    // Process opportunities from queue
    setInterval(() => {
      if (!this.isRunning || this.opportunityQueue.length === 0) return;

      // Process highest profit opportunity first
      const opportunity = this.opportunityQueue.shift();
      if (opportunity) {
        this.processOpportunity(opportunity);
      }
    }, 100); // Process every 100ms
  }

  private async processOpportunity(opportunity: SandwichOpportunity): Promise<void> {
    try {
      // Check if opportunity is still valid (not too old)
      const age = Date.now() - opportunity.detectedAt;
      if (age > this.config.maxLatency) {
        logger.debug('Opportunity expired', {
          id: opportunity.id,
          age,
          maxLatency: this.config.maxLatency
        });
        return;
      }

      // Emit for execution
      this.emit('execute-opportunity', opportunity);

    } catch (error) {
      logger.error('Error processing opportunity', error);
    }
  }

  private startCleanupRoutine(): void {
    // Clean up old processed signatures to prevent memory leaks
    setInterval(() => {
      if (this.processedSignatures.size > 10000) {
        // Keep only the most recent 5000 signatures
        const signatures = Array.from(this.processedSignatures);
        this.processedSignatures.clear();
        signatures.slice(-5000).forEach(sig => this.processedSignatures.add(sig));
        
        logger.debug('Cleaned up processed signatures cache');
      }
    }, 300000); // Every 5 minutes
  }

  getStatus(): any {
    const monitorStatuses = Array.from(this.monitors.entries()).map(([dex, monitor]) => ({
      dex,
      status: monitor.getStatus()
    }));

    return {
      running: this.isRunning,
      monitors: monitorStatuses,
      opportunityQueueSize: this.opportunityQueue.length,
      processedSignatures: this.processedSignatures.size,
      config: {
        monitoredDEXs: this.config.monitoredDEXs,
        minSlippageThreshold: this.config.minSlippageThreshold,
        minAmountThreshold: this.config.minAmountThreshold.toString(),
        maxLatency: this.config.maxLatency
      }
    };
  }

  getOpportunityQueue(): SandwichOpportunity[] {
    return [...this.opportunityQueue]; // Return copy
  }

  clearOpportunityQueue(): void {
    this.opportunityQueue = [];
    logger.info('Opportunity queue cleared');
  }

  updateConfig(newConfig: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Monitor configuration updated', newConfig);
  }
}

