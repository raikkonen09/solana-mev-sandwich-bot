import { Connection, Transaction } from '@solana/web3.js';
import { BundleTransaction } from '../types';
import { logger } from '../utils/logger';
import axios from 'axios';

interface JitoBundleStatus {
  processed: boolean;
  confirmed: boolean;
  error?: string;
  transactions?: string[];
  totalGasUsed?: number;
}

interface JitoBundleSubmissionResult {
  success: boolean;
  bundleId?: string;
  error?: string;
}

export class JitoBundleManager {
  private jitoEndpoint: string;
  private submittedBundles: Map<string, any> = new Map();

  constructor(jitoEndpoint: string) {
    this.jitoEndpoint = jitoEndpoint;
  }

  async submitBundle(
    transactions: BundleTransaction[],
    bundleId: string
  ): Promise<JitoBundleSubmissionResult> {
    try {
      logger.info('Submitting bundle to Jito', {
        bundleId,
        transactionCount: transactions.length
      });

      // Sort transactions by priority
      const sortedTransactions = transactions.sort((a, b) => a.priority - b.priority);

      // Prepare bundle payload
      const bundlePayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [
          sortedTransactions.map(tx => ({
            transaction: tx.transaction.serialize({ 
              requireAllSignatures: false,
              verifySignatures: false 
            }).toString('base64'),
            isVote: false
          }))
        ]
      };

      // Submit to Jito
      const response = await axios.post(this.jitoEndpoint, bundlePayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.data.error) {
        throw new Error(`Jito error: ${response.data.error.message}`);
      }

      const jitoBundleId = response.data.result;

      // Store bundle info for monitoring
      this.submittedBundles.set(bundleId, {
        jitoBundleId,
        transactions: sortedTransactions,
        submittedAt: Date.now(),
        status: 'submitted'
      });

      logger.info('Bundle submitted successfully', {
        bundleId,
        jitoBundleId
      });

      return {
        success: true,
        bundleId: jitoBundleId
      };

    } catch (error) {
      logger.error('Bundle submission failed', {
        bundleId,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async getBundleStatus(jitoBundleId: string): Promise<JitoBundleStatus> {
    try {
      // Query bundle status from Jito
      const statusPayload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[jitoBundleId]]
      };

      const response = await axios.post(this.jitoEndpoint, statusPayload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 5000
      });

      if (response.data.error) {
        throw new Error(`Jito status error: ${response.data.error.message}`);
      }

      const bundleStatuses = response.data.result.value;
      if (!bundleStatuses || bundleStatuses.length === 0) {
        return {
          processed: false,
          confirmed: false
        };
      }

      const status = bundleStatuses[0];
      
      return {
        processed: status.confirmation_status !== 'not_processed',
        confirmed: status.confirmation_status === 'confirmed',
        error: status.err ? JSON.stringify(status.err) : undefined,
        transactions: status.transactions || [],
        totalGasUsed: this.calculateTotalGasUsed(status.transactions || [])
      };

    } catch (error) {
      logger.error('Error getting bundle status', {
        jitoBundleId,
        error: error.message
      });

      return {
        processed: false,
        confirmed: false,
        error: error.message
      };
    }
  }

  private calculateTotalGasUsed(transactions: string[]): number {
    // This would calculate actual gas used from transaction results
    // For now, return estimated value
    return transactions.length * 200000; // 200k compute units per transaction
  }

  async createBundle(
    frontrunTx: Transaction,
    victimTx: Transaction,
    backrunTx: Transaction,
    tip: number = 0.001 // SOL tip for validators
  ): Promise<BundleTransaction[]> {
    try {
      logger.info('Creating Jito bundle with tip', { tip });

      // Add tip instruction to frontrun transaction if specified
      if (tip > 0) {
        const tipInstruction = await this.createTipInstruction(tip);
        frontrunTx.add(tipInstruction);
      }

      return [
        {
          transaction: frontrunTx,
          type: 'frontrun',
          expectedGas: 200000,
          priority: 1
        },
        {
          transaction: victimTx,
          type: 'victim',
          expectedGas: 200000,
          priority: 2
        },
        {
          transaction: backrunTx,
          type: 'backrun',
          expectedGas: 200000,
          priority: 3
        }
      ];
    } catch (error) {
      logger.error('Error creating bundle', error);
      throw error;
    }
  }

  private async createTipInstruction(tipAmount: number): Promise<any> {
    // Create instruction to tip Jito validators
    // This would implement the actual tip instruction
    // For now, return a placeholder
    return {
      keys: [],
      programId: new PublicKey('11111111111111111111111111111111'),
      data: Buffer.alloc(0)
    };
  }

  async estimateBundleFee(transactions: BundleTransaction[]): Promise<number> {
    try {
      // Estimate total fee for bundle execution
      let totalFee = 0;

      for (const tx of transactions) {
        // Base transaction fee
        totalFee += 5000; // 5000 lamports base fee

        // Compute unit fee
        totalFee += tx.expectedGas * 0.000001; // Micro-lamports per compute unit
      }

      // Add Jito tip (recommended)
      totalFee += 0.001 * 1e9; // 0.001 SOL in lamports

      logger.debug('Bundle fee estimated', {
        totalFee,
        transactionCount: transactions.length
      });

      return totalFee;
    } catch (error) {
      logger.error('Error estimating bundle fee', error);
      return 0.01 * 1e9; // Default 0.01 SOL
    }
  }

  async optimizeBundleForLatency(transactions: BundleTransaction[]): Promise<BundleTransaction[]> {
    try {
      // Optimize transaction ordering and parameters for minimum latency
      const optimized = [...transactions];

      // Sort by priority (lower number = higher priority)
      optimized.sort((a, b) => a.priority - b.priority);

      // Optimize compute unit limits
      for (const tx of optimized) {
        // Set optimal compute unit limit
        tx.expectedGas = Math.min(tx.expectedGas, 400000); // Cap at 400k units
        
        // Add compute budget instruction if needed
        if (tx.expectedGas > 200000) {
          await this.addComputeBudgetInstruction(tx.transaction, tx.expectedGas);
        }
      }

      logger.debug('Bundle optimized for latency', {
        transactionCount: optimized.length
      });

      return optimized;
    } catch (error) {
      logger.error('Error optimizing bundle', error);
      return transactions;
    }
  }

  private async addComputeBudgetInstruction(
    transaction: Transaction,
    computeUnits: number
  ): Promise<void> {
    // Add compute budget instruction to transaction
    // This would implement the actual compute budget instruction
    // For now, this is a placeholder
    logger.debug('Adding compute budget instruction', { computeUnits });
  }

  async retryFailedBundle(
    bundleId: string,
    retryCount: number = 1
  ): Promise<JitoBundleSubmissionResult> {
    try {
      const bundleInfo = this.submittedBundles.get(bundleId);
      if (!bundleInfo) {
        throw new Error('Bundle not found for retry');
      }

      logger.info('Retrying failed bundle', {
        bundleId,
        retryCount,
        originalSubmission: bundleInfo.submittedAt
      });

      // Update recent blockhash for all transactions
      const connection = new Connection(this.jitoEndpoint.replace('/api/v1/bundles', ''));
      const { blockhash } = await connection.getLatestBlockhash();

      for (const tx of bundleInfo.transactions) {
        tx.transaction.recentBlockhash = blockhash;
      }

      // Resubmit with higher tip
      const newBundleId = `${bundleId}_retry_${retryCount}`;
      return await this.submitBundle(bundleInfo.transactions, newBundleId);

    } catch (error) {
      logger.error('Bundle retry failed', {
        bundleId,
        retryCount,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  getSubmittedBundles(): Map<string, any> {
    return new Map(this.submittedBundles);
  }

  cleanupOldBundles(maxAge: number = 300000): void {
    // Clean up bundles older than maxAge (default 5 minutes)
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [bundleId, bundleInfo] of this.submittedBundles) {
      if (now - bundleInfo.submittedAt > maxAge) {
        toDelete.push(bundleId);
      }
    }

    for (const bundleId of toDelete) {
      this.submittedBundles.delete(bundleId);
    }

    if (toDelete.length > 0) {
      logger.debug('Cleaned up old bundles', { count: toDelete.length });
    }
  }

  getStatus(): any {
    const now = Date.now();
    const recentBundles = Array.from(this.submittedBundles.values())
      .filter(bundle => now - bundle.submittedAt < 60000); // Last minute

    return {
      endpoint: this.jitoEndpoint,
      totalBundles: this.submittedBundles.size,
      recentBundles: recentBundles.length,
      oldestBundle: this.submittedBundles.size > 0 ? 
        Math.min(...Array.from(this.submittedBundles.values()).map(b => b.submittedAt)) : null
    };
  }
}

