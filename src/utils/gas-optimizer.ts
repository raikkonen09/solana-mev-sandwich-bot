import { 
  Connection, 
  Transaction, 
  TransactionInstruction, 
  PublicKey,
  ComputeBudgetProgram 
} from '@solana/web3.js';
import { DEXType, BundleTransaction } from '../types';
import { logger } from './logger';
import { ConnectionManager } from './connection';
import Big from 'big.js';

interface GasOptimizationResult {
  optimizedTransaction: Transaction;
  estimatedGas: number;
  priorityFee: number;
  totalCost: Big;
}

interface NetworkConditions {
  congestionLevel: number; // 0-1 scale
  averageGasPrice: number;
  blockTime: number;
  successRate: number;
}

export class GasOptimizer {
  private connectionManager: ConnectionManager;
  private gasHistory: Map<DEXType, number[]> = new Map();
  private networkConditions: NetworkConditions | null = null;
  private lastConditionsUpdate = 0;

  constructor(rpcEndpoints: string[]) {
    this.connectionManager = new ConnectionManager(rpcEndpoints);
    this.initializeGasHistory();
    this.startNetworkMonitoring();
  }

  private initializeGasHistory(): void {
    // Initialize gas history for each DEX
    this.gasHistory.set(DEXType.RAYDIUM, []);
    this.gasHistory.set(DEXType.ORCA, []);
    this.gasHistory.set(DEXType.PHOENIX, []);
  }

  private startNetworkMonitoring(): void {
    // Update network conditions every 10 seconds
    setInterval(async () => {
      try {
        await this.updateNetworkConditions();
      } catch (error) {
        logger.error('Error updating network conditions', error);
      }
    }, 10000);
  }

  async optimizeTransaction(
    transaction: Transaction,
    dex: DEXType,
    urgency: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<GasOptimizationResult> {
    try {
      logger.debug('Optimizing transaction gas', {
        dex,
        urgency,
        instructionCount: transaction.instructions.length
      });

      // Get current network conditions
      const conditions = await this.getNetworkConditions();

      // Estimate base gas requirement
      const baseGasEstimate = await this.estimateBaseGas(transaction, dex);

      // Calculate optimal compute unit limit
      const computeUnitLimit = await this.calculateOptimalComputeUnits(
        baseGasEstimate,
        conditions,
        urgency
      );

      // Calculate optimal priority fee
      const priorityFee = await this.calculateOptimalPriorityFee(
        conditions,
        urgency,
        dex
      );

      // Create optimized transaction
      const optimizedTransaction = await this.createOptimizedTransaction(
        transaction,
        computeUnitLimit,
        priorityFee
      );

      // Calculate total cost
      const totalCost = await this.calculateTotalCost(
        computeUnitLimit,
        priorityFee
      );

      const result: GasOptimizationResult = {
        optimizedTransaction,
        estimatedGas: computeUnitLimit,
        priorityFee,
        totalCost
      };

      logger.info('Transaction gas optimization completed', {
        dex,
        urgency,
        estimatedGas: computeUnitLimit,
        priorityFee,
        totalCost: totalCost.toString()
      });

      return result;
    } catch (error) {
      logger.error('Error optimizing transaction gas', error);
      throw error;
    }
  }

  private async estimateBaseGas(transaction: Transaction, dex: DEXType): Promise<number> {
    try {
      // Simulate transaction to get accurate gas estimate
      const connection = this.connectionManager.getConnection();
      const simulation = await connection.simulateTransaction(transaction, {
        commitment: 'confirmed',
        sigVerify: false,
        replaceRecentBlockhash: true
      });

      if (simulation.value.err) {
        logger.warn('Transaction simulation failed, using fallback estimate', {
          error: simulation.value.err
        });
        return this.getFallbackGasEstimate(dex);
      }

      const gasUsed = simulation.value.unitsConsumed || 0;
      
      // Add buffer for safety (20%)
      const gasWithBuffer = Math.ceil(gasUsed * 1.2);

      // Update gas history
      this.updateGasHistory(dex, gasUsed);

      logger.debug('Base gas estimated', {
        dex,
        simulatedGas: gasUsed,
        gasWithBuffer
      });

      return gasWithBuffer;
    } catch (error) {
      logger.error('Error estimating base gas', error);
      return this.getFallbackGasEstimate(dex);
    }
  }

  private getFallbackGasEstimate(dex: DEXType): number {
    // Fallback gas estimates based on DEX complexity
    switch (dex) {
      case DEXType.RAYDIUM:
        return 200000;
      case DEXType.ORCA:
        return 400000; // Higher due to concentrated liquidity
      case DEXType.PHOENIX:
        return 250000;
      default:
        return 300000;
    }
  }

  private async calculateOptimalComputeUnits(
    baseEstimate: number,
    conditions: NetworkConditions,
    urgency: 'low' | 'medium' | 'high'
  ): Promise<number> {
    try {
      // Base multiplier based on urgency
      const urgencyMultipliers = {
        low: 1.1,    // 10% buffer
        medium: 1.25, // 25% buffer
        high: 1.5    // 50% buffer
      };

      // Network congestion multiplier
      const congestionMultiplier = 1 + (conditions.congestionLevel * 0.3); // Up to 30% increase

      // Calculate optimal compute units
      const multiplier = urgencyMultipliers[urgency] * congestionMultiplier;
      const optimalUnits = Math.ceil(baseEstimate * multiplier);

      // Cap at maximum allowed compute units
      const maxComputeUnits = 1400000; // Solana limit
      const finalUnits = Math.min(optimalUnits, maxComputeUnits);

      logger.debug('Optimal compute units calculated', {
        baseEstimate,
        urgency,
        congestionLevel: conditions.congestionLevel,
        multiplier: multiplier.toFixed(2),
        finalUnits
      });

      return finalUnits;
    } catch (error) {
      logger.error('Error calculating optimal compute units', error);
      return Math.min(baseEstimate * 1.3, 1400000); // Default 30% buffer
    }
  }

  private async calculateOptimalPriorityFee(
    conditions: NetworkConditions,
    urgency: 'low' | 'medium' | 'high',
    dex: DEXType
  ): Promise<number> {
    try {
      // Base priority fee in micro-lamports per compute unit
      const baseFee = conditions.averageGasPrice;

      // Urgency multipliers
      const urgencyMultipliers = {
        low: 1.0,    // No premium
        medium: 2.0, // 2x premium
        high: 5.0    // 5x premium
      };

      // Congestion multiplier
      const congestionMultiplier = 1 + (conditions.congestionLevel * 2); // Up to 3x increase

      // DEX-specific multiplier (some DEXs are more competitive)
      const dexMultipliers = {
        [DEXType.RAYDIUM]: 1.2, // 20% premium for popular DEX
        [DEXType.ORCA]: 1.0,    // Standard
        [DEXType.PHOENIX]: 0.8  // 20% discount for less competitive DEX
      };

      // Calculate optimal priority fee
      const multiplier = urgencyMultipliers[urgency] * 
                        congestionMultiplier * 
                        dexMultipliers[dex];
      
      const optimalFee = Math.ceil(baseFee * multiplier);

      // Cap at reasonable maximum (1000 micro-lamports per CU)
      const maxFee = 1000;
      const finalFee = Math.min(optimalFee, maxFee);

      logger.debug('Optimal priority fee calculated', {
        baseFee,
        urgency,
        congestionLevel: conditions.congestionLevel,
        dex,
        multiplier: multiplier.toFixed(2),
        finalFee
      });

      return finalFee;
    } catch (error) {
      logger.error('Error calculating optimal priority fee', error);
      return 100; // Default 100 micro-lamports per CU
    }
  }

  private async createOptimizedTransaction(
    originalTransaction: Transaction,
    computeUnitLimit: number,
    priorityFee: number
  ): Promise<Transaction> {
    try {
      // Create new transaction with optimized parameters
      const optimizedTransaction = new Transaction();

      // Add compute budget instructions first
      const computeBudgetInstructions = [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: computeUnitLimit
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFee
        })
      ];

      // Add compute budget instructions
      for (const instruction of computeBudgetInstructions) {
        optimizedTransaction.add(instruction);
      }

      // Add original instructions
      for (const instruction of originalTransaction.instructions) {
        optimizedTransaction.add(instruction);
      }

      // Copy other transaction properties
      optimizedTransaction.recentBlockhash = originalTransaction.recentBlockhash;
      optimizedTransaction.feePayer = originalTransaction.feePayer;

      logger.debug('Optimized transaction created', {
        originalInstructions: originalTransaction.instructions.length,
        optimizedInstructions: optimizedTransaction.instructions.length,
        computeUnitLimit,
        priorityFee
      });

      return optimizedTransaction;
    } catch (error) {
      logger.error('Error creating optimized transaction', error);
      throw error;
    }
  }

  private async calculateTotalCost(
    computeUnitLimit: number,
    priorityFee: number
  ): Promise<Big> {
    try {
      // Base transaction fee (5000 lamports)
      const baseFee = new Big('5000');

      // Priority fee cost
      const priorityFeeCost = new Big(computeUnitLimit)
        .mul(priorityFee)
        .div(1000000); // Convert micro-lamports to lamports

      // Total cost in lamports
      const totalLamports = baseFee.plus(priorityFeeCost);

      // Convert to SOL
      const totalSol = totalLamports.div(1e9);

      logger.debug('Total transaction cost calculated', {
        baseFee: baseFee.toString(),
        priorityFeeCost: priorityFeeCost.toString(),
        totalLamports: totalLamports.toString(),
        totalSol: totalSol.toString()
      });

      return totalSol;
    } catch (error) {
      logger.error('Error calculating total cost', error);
      return new Big('0.001'); // Default 0.001 SOL
    }
  }

  async optimizeBundleGas(
    bundleTransactions: BundleTransaction[],
    urgency: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<BundleTransaction[]> {
    try {
      logger.info('Optimizing bundle gas', {
        transactionCount: bundleTransactions.length,
        urgency
      });

      const optimizedBundle: BundleTransaction[] = [];

      for (const bundleTx of bundleTransactions) {
        try {
          // Determine DEX from transaction (simplified)
          const dex = this.inferDexFromTransaction(bundleTx.transaction);

          // Optimize individual transaction
          const optimizationResult = await this.optimizeTransaction(
            bundleTx.transaction,
            dex,
            urgency
          );

          // Update bundle transaction
          const optimizedBundleTx: BundleTransaction = {
            ...bundleTx,
            transaction: optimizationResult.optimizedTransaction,
            expectedGas: optimizationResult.estimatedGas
          };

          optimizedBundle.push(optimizedBundleTx);

          logger.debug('Bundle transaction optimized', {
            type: bundleTx.type,
            originalGas: bundleTx.expectedGas,
            optimizedGas: optimizationResult.estimatedGas,
            priorityFee: optimizationResult.priorityFee
          });

        } catch (error) {
          logger.error(`Error optimizing bundle transaction ${bundleTx.type}`, error);
          // Keep original transaction if optimization fails
          optimizedBundle.push(bundleTx);
        }
      }

      logger.info('Bundle gas optimization completed', {
        originalCount: bundleTransactions.length,
        optimizedCount: optimizedBundle.length
      });

      return optimizedBundle;
    } catch (error) {
      logger.error('Error optimizing bundle gas', error);
      return bundleTransactions; // Return original if optimization fails
    }
  }

  private inferDexFromTransaction(transaction: Transaction): DEXType {
    // Infer DEX from transaction program IDs
    const programIds = transaction.instructions.map(ix => ix.programId.toString());

    if (programIds.includes('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')) {
      return DEXType.RAYDIUM;
    } else if (programIds.includes('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc')) {
      return DEXType.ORCA;
    } else if (programIds.includes('PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY')) {
      return DEXType.PHOENIX;
    }

    return DEXType.RAYDIUM; // Default fallback
  }

  private async updateNetworkConditions(): Promise<void> {
    try {
      const connection = this.connectionManager.getConnection();

      // Get recent performance samples
      const performanceSamples = await connection.getRecentPerformanceSamples(20);

      // Calculate average TPS
      const avgTps = performanceSamples.reduce((sum, sample) => 
        sum + (sample.numTransactions / sample.samplePeriodSecs), 0
      ) / performanceSamples.length;

      // Calculate congestion level (0-1 scale)
      const maxTps = 3000; // Theoretical max TPS for Solana
      const congestionLevel = Math.min(1, avgTps / maxTps);

      // Get recent blockhash for block time estimation
      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      const prevBlockTime = await connection.getBlockTime(slot - 1);
      const currentBlockTime = blockTime && prevBlockTime ? 
        (blockTime - prevBlockTime) : 400; // Default 400ms

      // Estimate average gas price (simplified)
      const averageGasPrice = Math.max(1, Math.ceil(congestionLevel * 100)); // 1-100 micro-lamports

      // Calculate success rate (simplified)
      const successRate = Math.max(0.8, 1 - (congestionLevel * 0.3)); // 80-100%

      this.networkConditions = {
        congestionLevel,
        averageGasPrice,
        blockTime: currentBlockTime,
        successRate
      };

      this.lastConditionsUpdate = Date.now();

      logger.debug('Network conditions updated', {
        congestionLevel: congestionLevel.toFixed(3),
        avgTps: avgTps.toFixed(0),
        averageGasPrice,
        blockTime: currentBlockTime,
        successRate: successRate.toFixed(3)
      });

    } catch (error) {
      logger.error('Error updating network conditions', error);
      
      // Use default conditions if update fails
      if (!this.networkConditions) {
        this.networkConditions = {
          congestionLevel: 0.5,
          averageGasPrice: 50,
          blockTime: 400,
          successRate: 0.9
        };
      }
    }
  }

  private async getNetworkConditions(): Promise<NetworkConditions> {
    // Update conditions if stale (older than 30 seconds)
    if (!this.networkConditions || Date.now() - this.lastConditionsUpdate > 30000) {
      await this.updateNetworkConditions();
    }

    return this.networkConditions!;
  }

  private updateGasHistory(dex: DEXType, gasUsed: number): void {
    const history = this.gasHistory.get(dex) || [];
    
    // Add new gas usage
    history.push(gasUsed);
    
    // Keep only last 100 entries
    if (history.length > 100) {
      history.shift();
    }
    
    this.gasHistory.set(dex, history);
  }

  async getGasStatistics(dex: DEXType): Promise<any> {
    const history = this.gasHistory.get(dex) || [];
    
    if (history.length === 0) {
      return {
        count: 0,
        average: 0,
        median: 0,
        min: 0,
        max: 0
      };
    }

    const sorted = [...history].sort((a, b) => a - b);
    const average = history.reduce((sum, gas) => sum + gas, 0) / history.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const min = sorted[0];
    const max = sorted[sorted.length - 1];

    return {
      count: history.length,
      average: Math.round(average),
      median,
      min,
      max
    };
  }

  getStatus(): any {
    const gasStats = {};
    for (const dex of Object.values(DEXType)) {
      gasStats[dex] = this.getGasStatistics(dex);
    }

    return {
      networkConditions: this.networkConditions,
      lastConditionsUpdate: this.lastConditionsUpdate,
      gasHistory: gasStats,
      connectionStats: this.connectionManager.getConnectionStats()
    };
  }

  clearHistory(): void {
    this.gasHistory.clear();
    this.initializeGasHistory();
    logger.info('Gas history cleared');
  }
}

