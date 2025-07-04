import { 
  Connection, 
  Transaction, 
  VersionedTransaction,
  TransactionSignature,
  SendOptions,
  Commitment,
  RpcResponseAndContext,
  SignatureStatus
} from '@solana/web3.js';
import { BundleTransaction } from '../types';
import { logger } from './logger';
import { ConnectionManager } from './connection';
import { ErrorHandler, ErrorType } from './error-handler';

export interface BroadcastResult {
  success: boolean;
  signature?: string;
  error?: string;
  confirmationTime?: number;
  rpcEndpoint?: string;
}

export interface BroadcastConfig {
  maxRetries: number;
  retryDelay: number;
  confirmationTimeout: number;
  commitment: Commitment;
  skipPreflight: boolean;
  maxRetransmits: number;
}

export interface BundleBroadcastResult {
  bundleId: string;
  success: boolean;
  transactions: BroadcastResult[];
  totalTime: number;
  error?: string;
}

export class TransactionBroadcaster {
  private connectionManager: ConnectionManager;
  private errorHandler: ErrorHandler;
  private config: BroadcastConfig;
  private broadcastHistory: Map<string, BroadcastResult> = new Map();

  constructor(
    rpcEndpoints: string[],
    config?: Partial<BroadcastConfig>
  ) {
    this.connectionManager = new ConnectionManager(rpcEndpoints);
    this.errorHandler = new ErrorHandler();
    
    this.config = {
      maxRetries: 3,
      retryDelay: 1000,
      confirmationTimeout: 30000,
      commitment: 'confirmed',
      skipPreflight: false,
      maxRetransmits: 3,
      ...config
    };

    logger.info('Transaction broadcaster initialized', {
      rpcEndpoints: rpcEndpoints.length,
      config: this.config
    });
  }

  async broadcastTransaction(
    transaction: Transaction | VersionedTransaction,
    options?: Partial<SendOptions>
  ): Promise<BroadcastResult> {
    const startTime = Date.now();
    
    try {
      logger.debug('Broadcasting transaction', {
        type: transaction instanceof VersionedTransaction ? 'versioned' : 'legacy',
        instructionCount: transaction instanceof VersionedTransaction ? 
          transaction.message.compiledInstructions.length : 
          transaction.instructions.length
      });

      // Prepare send options
      const sendOptions: SendOptions = {
        skipPreflight: this.config.skipPreflight,
        maxRetries: this.config.maxRetransmits,
        ...options
      };

      // Try broadcasting with retry logic
      const result = await this.errorHandler.executeWithRetry(
        () => this.attemptBroadcast(transaction, sendOptions),
        'transaction_broadcast',
        { transactionType: transaction.constructor.name }
      );

      // Wait for confirmation
      if (result.signature) {
        const confirmationResult = await this.waitForConfirmation(
          result.signature,
          result.rpcEndpoint!
        );

        if (confirmationResult.confirmed) {
          result.confirmationTime = Date.now() - startTime;
          
          logger.info('Transaction confirmed', {
            signature: result.signature,
            confirmationTime: result.confirmationTime,
            rpcEndpoint: result.rpcEndpoint
          });
        } else {
          result.success = false;
          result.error = 'Transaction confirmation timeout';
          
          logger.warn('Transaction confirmation timeout', {
            signature: result.signature,
            timeout: this.config.confirmationTimeout
          });
        }
      }

      // Store in history
      if (result.signature) {
        this.broadcastHistory.set(result.signature, result);
      }

      return result;
    } catch (error) {
      const errorResult: BroadcastResult = {
        success: false,
        error: error.message
      };

      logger.error('Transaction broadcast failed', error);
      return errorResult;
    }
  }

  private async attemptBroadcast(
    transaction: Transaction | VersionedTransaction,
    options: SendOptions
  ): Promise<BroadcastResult> {
    const connection = this.connectionManager.getConnection();
    const rpcEndpoint = this.connectionManager.getCurrentEndpoint();

    try {
      let signature: string;

      if (transaction instanceof VersionedTransaction) {
        signature = await connection.sendTransaction(transaction, options);
      } else {
        signature = await connection.sendTransaction(transaction, options);
      }

      logger.debug('Transaction sent', {
        signature,
        rpcEndpoint
      });

      return {
        success: true,
        signature,
        rpcEndpoint
      };
    } catch (error) {
      logger.error('Broadcast attempt failed', {
        rpcEndpoint,
        error: error.message
      });

      // Try next RPC endpoint
      this.connectionManager.rotateConnection();
      throw error;
    }
  }

  private async waitForConfirmation(
    signature: string,
    rpcEndpoint: string
  ): Promise<{ confirmed: boolean; status?: SignatureStatus }> {
    const connection = new Connection(rpcEndpoint, this.config.commitment);
    const startTime = Date.now();

    try {
      while (Date.now() - startTime < this.config.confirmationTimeout) {
        try {
          const status = await connection.getSignatureStatus(signature);
          
          if (status.value) {
            if (status.value.confirmationStatus === this.config.commitment ||
                status.value.confirmationStatus === 'finalized') {
              return { confirmed: true, status: status.value };
            }

            if (status.value.err) {
              logger.warn('Transaction failed on-chain', {
                signature,
                error: status.value.err
              });
              return { confirmed: false, status: status.value };
            }
          }

          // Wait before next check
          await this.sleep(1000);
        } catch (error) {
          logger.debug('Error checking signature status', {
            signature,
            error: error.message
          });
          await this.sleep(2000);
        }
      }

      return { confirmed: false };
    } catch (error) {
      logger.error('Error waiting for confirmation', {
        signature,
        error: error.message
      });
      return { confirmed: false };
    }
  }

  async broadcastBundle(
    bundleTransactions: BundleTransaction[],
    bundleId: string
  ): Promise<BundleBroadcastResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Broadcasting transaction bundle', {
        bundleId,
        transactionCount: bundleTransactions.length
      });

      const results: BroadcastResult[] = [];
      let allSuccessful = true;

      // Broadcast transactions in order
      for (let i = 0; i < bundleTransactions.length; i++) {
        const bundleTx = bundleTransactions[i];
        
        try {
          logger.debug('Broadcasting bundle transaction', {
            bundleId,
            index: i,
            type: bundleTx.type
          });

          const result = await this.broadcastTransaction(bundleTx.transaction, {
            skipPreflight: true, // Skip preflight for bundle transactions
            maxRetries: 1 // Reduce retries for bundle transactions
          });

          results.push(result);

          if (!result.success) {
            allSuccessful = false;
            logger.warn('Bundle transaction failed', {
              bundleId,
              index: i,
              type: bundleTx.type,
              error: result.error
            });

            // For critical failures, stop broadcasting remaining transactions
            if (this.isCriticalBundleFailure(result.error)) {
              logger.error('Critical bundle failure, stopping broadcast', {
                bundleId,
                failedIndex: i,
                error: result.error
              });
              break;
            }
          } else {
            logger.debug('Bundle transaction broadcast successful', {
              bundleId,
              index: i,
              type: bundleTx.type,
              signature: result.signature
            });
          }

          // Small delay between transactions to avoid rate limiting
          if (i < bundleTransactions.length - 1) {
            await this.sleep(100);
          }

        } catch (error) {
          allSuccessful = false;
          const errorResult: BroadcastResult = {
            success: false,
            error: error.message
          };
          results.push(errorResult);

          logger.error('Bundle transaction broadcast error', {
            bundleId,
            index: i,
            type: bundleTx.type,
            error: error.message
          });
        }
      }

      const totalTime = Date.now() - startTime;

      const bundleResult: BundleBroadcastResult = {
        bundleId,
        success: allSuccessful,
        transactions: results,
        totalTime
      };

      if (!allSuccessful) {
        bundleResult.error = 'One or more bundle transactions failed';
      }

      logger.info('Bundle broadcast completed', {
        bundleId,
        success: allSuccessful,
        totalTime,
        successfulTransactions: results.filter(r => r.success).length,
        totalTransactions: results.length
      });

      return bundleResult;
    } catch (error) {
      logger.error('Bundle broadcast failed', {
        bundleId,
        error: error.message
      });

      return {
        bundleId,
        success: false,
        transactions: [],
        totalTime: Date.now() - startTime,
        error: error.message
      };
    }
  }

  private isCriticalBundleFailure(error?: string): boolean {
    if (!error) return false;

    const criticalErrors = [
      'insufficient funds',
      'account not found',
      'invalid signature',
      'blockhash not found'
    ];

    const errorLower = error.toLowerCase();
    return criticalErrors.some(critical => errorLower.includes(critical));
  }

  async broadcastWithFallback(
    transaction: Transaction | VersionedTransaction,
    fallbackEndpoints?: string[]
  ): Promise<BroadcastResult> {
    try {
      // Try primary broadcast
      const primaryResult = await this.broadcastTransaction(transaction);
      
      if (primaryResult.success) {
        return primaryResult;
      }

      // If primary failed and we have fallback endpoints, try them
      if (fallbackEndpoints && fallbackEndpoints.length > 0) {
        logger.info('Primary broadcast failed, trying fallback endpoints', {
          fallbackCount: fallbackEndpoints.length,
          primaryError: primaryResult.error
        });

        for (const endpoint of fallbackEndpoints) {
          try {
            const fallbackConnection = new Connection(endpoint, this.config.commitment);
            
            let signature: string;
            if (transaction instanceof VersionedTransaction) {
              signature = await fallbackConnection.sendTransaction(transaction, {
                skipPreflight: this.config.skipPreflight,
                maxRetries: 1
              });
            } else {
              signature = await fallbackConnection.sendTransaction(transaction, {
                skipPreflight: this.config.skipPreflight,
                maxRetries: 1
              });
            }

            // Wait for confirmation on fallback endpoint
            const confirmationResult = await this.waitForConfirmation(signature, endpoint);

            if (confirmationResult.confirmed) {
              logger.info('Fallback broadcast successful', {
                signature,
                endpoint
              });

              return {
                success: true,
                signature,
                rpcEndpoint: endpoint,
                confirmationTime: 0 // Not tracking for fallback
              };
            }
          } catch (fallbackError) {
            logger.debug('Fallback endpoint failed', {
              endpoint,
              error: fallbackError.message
            });
          }
        }
      }

      // All attempts failed
      return primaryResult;
    } catch (error) {
      logger.error('Broadcast with fallback failed', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getTransactionStatus(signature: string): Promise<SignatureStatus | null> {
    try {
      const connection = this.connectionManager.getConnection();
      const status = await connection.getSignatureStatus(signature);
      
      return status.value;
    } catch (error) {
      logger.error('Error getting transaction status', {
        signature,
        error: error.message
      });
      return null;
    }
  }

  async waitForMultipleConfirmations(
    signatures: string[],
    timeout: number = 30000
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const startTime = Date.now();

    try {
      logger.info('Waiting for multiple confirmations', {
        signatures: signatures.length,
        timeout
      });

      const connection = this.connectionManager.getConnection();
      const pendingSignatures = new Set(signatures);

      while (pendingSignatures.size > 0 && Date.now() - startTime < timeout) {
        const statusPromises = Array.from(pendingSignatures).map(async (signature) => {
          try {
            const status = await connection.getSignatureStatus(signature);
            return { signature, status: status.value };
          } catch (error) {
            return { signature, status: null };
          }
        });

        const statuses = await Promise.all(statusPromises);

        for (const { signature, status } of statuses) {
          if (status) {
            if (status.confirmationStatus === this.config.commitment ||
                status.confirmationStatus === 'finalized') {
              results.set(signature, true);
              pendingSignatures.delete(signature);
              
              logger.debug('Transaction confirmed', {
                signature,
                confirmationStatus: status.confirmationStatus
              });
            } else if (status.err) {
              results.set(signature, false);
              pendingSignatures.delete(signature);
              
              logger.warn('Transaction failed', {
                signature,
                error: status.err
              });
            }
          }
        }

        if (pendingSignatures.size > 0) {
          await this.sleep(1000);
        }
      }

      // Mark remaining signatures as timed out
      for (const signature of pendingSignatures) {
        results.set(signature, false);
        logger.warn('Transaction confirmation timeout', { signature });
      }

      logger.info('Multiple confirmations completed', {
        total: signatures.length,
        confirmed: Array.from(results.values()).filter(Boolean).length,
        failed: Array.from(results.values()).filter(v => !v).length
      });

      return results;
    } catch (error) {
      logger.error('Error waiting for multiple confirmations', error);
      
      // Return all as failed
      for (const signature of signatures) {
        results.set(signature, false);
      }
      return results;
    }
  }

  async estimateTransactionFee(
    transaction: Transaction | VersionedTransaction
  ): Promise<number> {
    try {
      const connection = this.connectionManager.getConnection();
      
      // Simulate transaction to get fee estimate
      let simulation;
      if (transaction instanceof VersionedTransaction) {
        simulation = await connection.simulateTransaction(transaction);
      } else {
        simulation = await connection.simulateTransaction(transaction);
      }

      if (simulation.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      // Calculate fee based on compute units used
      const computeUnits = simulation.value.unitsConsumed || 200000;
      const baseFee = 5000; // Base transaction fee in lamports
      const computeFee = computeUnits * 0.000001; // Micro-lamports per compute unit

      const totalFee = baseFee + computeFee;

      logger.debug('Transaction fee estimated', {
        computeUnits,
        baseFee,
        computeFee,
        totalFee
      });

      return totalFee;
    } catch (error) {
      logger.error('Error estimating transaction fee', error);
      return 10000; // Default fallback fee
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getBroadcastHistory(): Map<string, BroadcastResult> {
    return new Map(this.broadcastHistory);
  }

  clearHistory(): void {
    this.broadcastHistory.clear();
    logger.info('Broadcast history cleared');
  }

  getStatistics(): any {
    const history = Array.from(this.broadcastHistory.values());
    const successful = history.filter(r => r.success);
    const failed = history.filter(r => !r.success);

    const avgConfirmationTime = successful.length > 0 ?
      successful.reduce((sum, r) => sum + (r.confirmationTime || 0), 0) / successful.length :
      0;

    return {
      total: history.length,
      successful: successful.length,
      failed: failed.length,
      successRate: history.length > 0 ? (successful.length / history.length) : 0,
      averageConfirmationTime: Math.round(avgConfirmationTime),
      config: this.config,
      connectionStats: this.connectionManager.getConnectionStats()
    };
  }

  updateConfig(newConfig: Partial<BroadcastConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Broadcast config updated', this.config);
  }

  getStatus(): any {
    return {
      config: this.config,
      historySize: this.broadcastHistory.size,
      statistics: this.getStatistics(),
      connectionManager: this.connectionManager.getConnectionStats()
    };
  }
}

