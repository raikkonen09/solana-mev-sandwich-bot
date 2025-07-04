import { 
  Connection, 
  Transaction, 
  PublicKey, 
  Keypair,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  SandwichOpportunity, 
  BundleTransaction, 
  ExecutionResult, 
  TokenInfo,
  FlashloanProvider 
} from '../types';
import { logger } from '../utils/logger';
import { ConnectionManager } from '../utils/connection';
import { JitoBundleManager } from './jito-bundle-manager';
import { FlashloanManager } from './flashloan-manager';
import { TransactionBuilder } from './transaction-builder';
import Big from 'big.js';

export class SandwichExecutor {
  private connectionManager: ConnectionManager;
  private bundleManager: JitoBundleManager;
  private flashloanManager: FlashloanManager;
  private transactionBuilder: TransactionBuilder;
  private wallet: Keypair;
  private isExecuting = false;
  private executionQueue: SandwichOpportunity[] = [];

  constructor(
    rpcEndpoints: string[],
    jitoEndpoint: string,
    wallet: Keypair,
    flashloanProviders: FlashloanProvider[]
  ) {
    this.connectionManager = new ConnectionManager(rpcEndpoints);
    this.bundleManager = new JitoBundleManager(jitoEndpoint);
    this.flashloanManager = new FlashloanManager(flashloanProviders);
    this.transactionBuilder = new TransactionBuilder();
    this.wallet = wallet;
  }

  async executeSandwich(opportunity: SandwichOpportunity): Promise<ExecutionResult> {
    const startTime = Date.now();
    const bundleId = `bundle_${opportunity.id}_${startTime}`;

    try {
      logger.info('Executing sandwich attack', {
        opportunityId: opportunity.id,
        bundleId,
        estimatedProfit: opportunity.estimatedProfit.toString()
      });

      // Check if we need a flashloan
      const needsFlashloan = await this.needsFlashloan(opportunity);
      
      let bundleTransactions: BundleTransaction[];
      
      if (needsFlashloan) {
        bundleTransactions = await this.createFlashloanSandwichBundle(opportunity);
      } else {
        bundleTransactions = await this.createDirectSandwichBundle(opportunity);
      }

      // Validate bundle before submission
      const isValid = await this.validateBundle(bundleTransactions);
      if (!isValid) {
        throw new Error('Bundle validation failed');
      }

      // Submit bundle to Jito
      const submissionResult = await this.bundleManager.submitBundle(
        bundleTransactions,
        bundleId
      );

      if (!submissionResult.success) {
        throw new Error(`Bundle submission failed: ${submissionResult.error}`);
      }

      // Monitor execution
      const executionResult = await this.monitorExecution(
        bundleId,
        submissionResult.bundleId!,
        opportunity
      );

      const executionTime = Date.now() - startTime;

      logger.info('Sandwich execution completed', {
        bundleId,
        success: executionResult.success,
        profit: executionResult.actualProfit?.toString(),
        executionTime
      });

      return {
        bundleId,
        success: executionResult.success,
        actualProfit: executionResult.actualProfit,
        gasUsed: executionResult.gasUsed,
        error: executionResult.error,
        executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      logger.error('Sandwich execution failed', {
        bundleId,
        error: error.message,
        executionTime
      });

      return {
        bundleId,
        success: false,
        error: error.message,
        executionTime
      };
    }
  }

  private async needsFlashloan(opportunity: SandwichOpportunity): Promise<boolean> {
    try {
      // Check if we have sufficient balance for the frontrun
      const connection = this.connectionManager.getConnection();
      const balance = await connection.getBalance(this.wallet.publicKey);
      
      // Convert frontrun amount to SOL equivalent for comparison
      const frontrunValueInSol = await this.convertToSol(
        opportunity.frontrunAmount,
        opportunity.targetTransaction.tokenIn
      );

      // Add buffer for gas costs
      const requiredBalance = frontrunValueInSol.plus(new Big('0.01')); // 0.01 SOL buffer
      
      const hasBalance = new Big(balance).div(1e9).gte(requiredBalance);
      
      logger.debug('Checking flashloan requirement', {
        currentBalance: new Big(balance).div(1e9).toString(),
        requiredBalance: requiredBalance.toString(),
        needsFlashloan: !hasBalance
      });

      return !hasBalance;
    } catch (error) {
      logger.error('Error checking flashloan requirement', error);
      return true; // Default to flashloan if uncertain
    }
  }

  private async createDirectSandwichBundle(
    opportunity: SandwichOpportunity
  ): Promise<BundleTransaction[]> {
    try {
      logger.info('Creating direct sandwich bundle');

      // Create frontrun transaction
      const frontrunTx = await this.transactionBuilder.createSwapTransaction(
        opportunity.targetTransaction.tokenIn,
        opportunity.targetTransaction.tokenOut,
        opportunity.frontrunAmount,
        opportunity.targetTransaction.dex,
        this.wallet.publicKey,
        0.01 // 1% slippage for frontrun
      );

      // Create backrun transaction (reverse swap)
      const backrunTx = await this.transactionBuilder.createSwapTransaction(
        opportunity.targetTransaction.tokenOut,
        opportunity.targetTransaction.tokenIn,
        opportunity.backrunAmount,
        opportunity.targetTransaction.dex,
        this.wallet.publicKey,
        0.01 // 1% slippage for backrun
      );

      // Get recent blockhash
      const connection = this.connectionManager.getConnection();
      const { blockhash } = await connection.getLatestBlockhash();

      // Set blockhash and sign transactions
      frontrunTx.recentBlockhash = blockhash;
      frontrunTx.feePayer = this.wallet.publicKey;
      frontrunTx.sign(this.wallet);

      backrunTx.recentBlockhash = blockhash;
      backrunTx.feePayer = this.wallet.publicKey;
      backrunTx.sign(this.wallet);

      return [
        {
          transaction: frontrunTx,
          type: 'frontrun',
          expectedGas: 200000,
          priority: 1
        },
        {
          transaction: backrunTx,
          type: 'backrun',
          expectedGas: 200000,
          priority: 3
        }
      ];
    } catch (error) {
      logger.error('Error creating direct sandwich bundle', error);
      throw error;
    }
  }

  private async createFlashloanSandwichBundle(
    opportunity: SandwichOpportunity
  ): Promise<BundleTransaction[]> {
    try {
      logger.info('Creating flashloan sandwich bundle');

      // Find best flashloan provider
      const provider = await this.flashloanManager.findBestProvider(
        opportunity.targetTransaction.tokenIn,
        opportunity.frontrunAmount
      );

      if (!provider) {
        throw new Error('No suitable flashloan provider found');
      }

      // Create flashloan transaction with embedded sandwich logic
      const flashloanTx = await this.flashloanManager.createFlashloanTransaction(
        provider,
        opportunity.targetTransaction.tokenIn,
        opportunity.frontrunAmount,
        async (borrowedAmount: Big) => {
          // This callback contains the sandwich logic
          return await this.createSandwichInstructions(opportunity, borrowedAmount);
        }
      );

      // Get recent blockhash and sign
      const connection = this.connectionManager.getConnection();
      const { blockhash } = await connection.getLatestBlockhash();

      flashloanTx.recentBlockhash = blockhash;
      flashloanTx.feePayer = this.wallet.publicKey;
      flashloanTx.sign(this.wallet);

      return [
        {
          transaction: flashloanTx,
          type: 'frontrun', // Flashloan contains both frontrun and backrun
          expectedGas: 400000, // Higher gas for complex transaction
          priority: 1
        }
      ];
    } catch (error) {
      logger.error('Error creating flashloan sandwich bundle', error);
      throw error;
    }
  }

  private async createSandwichInstructions(
    opportunity: SandwichOpportunity,
    borrowedAmount: Big
  ): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];

    try {
      // 1. Frontrun swap instruction
      const frontrunInstruction = await this.transactionBuilder.createSwapInstruction(
        opportunity.targetTransaction.tokenIn,
        opportunity.targetTransaction.tokenOut,
        borrowedAmount,
        opportunity.targetTransaction.dex,
        this.wallet.publicKey,
        0.01
      );
      instructions.push(frontrunInstruction);

      // 2. Wait for victim transaction (this is handled by bundle ordering)
      
      // 3. Backrun swap instruction
      const backrunInstruction = await this.transactionBuilder.createSwapInstruction(
        opportunity.targetTransaction.tokenOut,
        opportunity.targetTransaction.tokenIn,
        opportunity.backrunAmount,
        opportunity.targetTransaction.dex,
        this.wallet.publicKey,
        0.01
      );
      instructions.push(backrunInstruction);

      return instructions;
    } catch (error) {
      logger.error('Error creating sandwich instructions', error);
      throw error;
    }
  }

  private async validateBundle(transactions: BundleTransaction[]): Promise<boolean> {
    try {
      logger.info('Validating bundle transactions');

      // Check transaction count
      if (transactions.length === 0 || transactions.length > 5) {
        logger.warn('Invalid bundle size', { count: transactions.length });
        return false;
      }

      // Validate each transaction
      for (const bundleTx of transactions) {
        // Check if transaction is properly signed
        if (!bundleTx.transaction.signature) {
          logger.warn('Transaction not signed', { type: bundleTx.type });
          return false;
        }

        // Check gas limits
        if (bundleTx.expectedGas > 1000000) { // 1M compute units max
          logger.warn('Transaction exceeds gas limit', { 
            type: bundleTx.type,
            gas: bundleTx.expectedGas 
          });
          return false;
        }

        // Validate transaction structure
        if (!bundleTx.transaction.recentBlockhash || !bundleTx.transaction.feePayer) {
          logger.warn('Invalid transaction structure', { type: bundleTx.type });
          return false;
        }
      }

      logger.info('Bundle validation successful');
      return true;
    } catch (error) {
      logger.error('Bundle validation failed', error);
      return false;
    }
  }

  private async monitorExecution(
    localBundleId: string,
    jitoBundleId: string,
    opportunity: SandwichOpportunity
  ): Promise<ExecutionResult> {
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    try {
      logger.info('Monitoring bundle execution', {
        localBundleId,
        jitoBundleId
      });

      while (Date.now() - startTime < maxWaitTime) {
        try {
          // Check bundle status with Jito
          const status = await this.bundleManager.getBundleStatus(jitoBundleId);
          
          if (status.processed) {
            if (status.confirmed) {
              // Bundle was successful
              const actualProfit = await this.calculateActualProfit(
                status.transactions || [],
                opportunity
              );

              return {
                bundleId: localBundleId,
                success: true,
                actualProfit,
                gasUsed: status.totalGasUsed,
                executionTime: Date.now() - startTime
              };
            } else {
              // Bundle failed
              return {
                bundleId: localBundleId,
                success: false,
                error: status.error || 'Bundle execution failed',
                executionTime: Date.now() - startTime
              };
            }
          }

          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          logger.debug('Error checking bundle status', error);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Timeout
      return {
        bundleId: localBundleId,
        success: false,
        error: 'Execution timeout',
        executionTime: maxWaitTime
      };

    } catch (error) {
      logger.error('Error monitoring execution', error);
      return {
        bundleId: localBundleId,
        success: false,
        error: error.message,
        executionTime: Date.now() - startTime
      };
    }
  }

  private async calculateActualProfit(
    transactions: string[],
    opportunity: SandwichOpportunity
  ): Promise<Big> {
    try {
      // Analyze the executed transactions to calculate actual profit
      const connection = this.connectionManager.getConnection();
      
      let totalProfit = new Big(0);

      for (const txSignature of transactions) {
        try {
          const tx = await connection.getParsedTransaction(txSignature, {
            commitment: 'confirmed'
          });

          if (tx && tx.meta) {
            // Parse token balance changes
            const balanceChanges = this.parseTokenBalanceChanges(tx.meta);
            
            // Calculate profit from balance changes
            const txProfit = this.calculateProfitFromBalanceChanges(
              balanceChanges,
              opportunity.targetTransaction.tokenIn,
              opportunity.targetTransaction.tokenOut
            );

            totalProfit = totalProfit.plus(txProfit);
          }
        } catch (error) {
          logger.debug(`Error analyzing transaction ${txSignature}`, error);
        }
      }

      logger.info('Actual profit calculated', {
        profit: totalProfit.toString(),
        estimated: opportunity.estimatedProfit.toString()
      });

      return totalProfit;
    } catch (error) {
      logger.error('Error calculating actual profit', error);
      return new Big(0);
    }
  }

  private parseTokenBalanceChanges(meta: any): any[] {
    // Parse pre and post token balances to determine changes
    const changes: any[] = [];

    if (meta.preTokenBalances && meta.postTokenBalances) {
      const preBalances = new Map();
      const postBalances = new Map();

      // Index pre-balances
      meta.preTokenBalances.forEach((balance: any) => {
        const key = `${balance.accountIndex}_${balance.mint}`;
        preBalances.set(key, balance);
      });

      // Calculate changes
      meta.postTokenBalances.forEach((balance: any) => {
        const key = `${balance.accountIndex}_${balance.mint}`;
        const preBalance = preBalances.get(key);
        
        if (preBalance) {
          const change = new Big(balance.uiTokenAmount.amount)
            .minus(new Big(preBalance.uiTokenAmount.amount));
          
          if (!change.eq(0)) {
            changes.push({
              mint: balance.mint,
              change,
              decimals: balance.uiTokenAmount.decimals
            });
          }
        }
      });
    }

    return changes;
  }

  private calculateProfitFromBalanceChanges(
    changes: any[],
    tokenIn: TokenInfo,
    tokenOut: TokenInfo
  ): Big {
    // Calculate profit based on token balance changes
    let profit = new Big(0);

    for (const change of changes) {
      if (change.mint === tokenIn.mint.toString()) {
        // Input token change (should be negative for cost)
        profit = profit.plus(change.change);
      } else if (change.mint === tokenOut.mint.toString()) {
        // Output token change (should be positive for gain)
        profit = profit.plus(change.change);
      }
    }

    return profit;
  }

  private async convertToSol(amount: Big, token: TokenInfo): Promise<Big> {
    // Convert token amount to SOL equivalent
    // This would integrate with price oracles
    // For now, return a simplified conversion
    if (token.symbol === 'SOL') {
      return amount.div(Math.pow(10, token.decimals));
    }
    
    // Placeholder conversion rate (would use real price data)
    const conversionRate = new Big('0.01'); // 1 token = 0.01 SOL
    return amount.mul(conversionRate).div(Math.pow(10, token.decimals));
  }

  async queueExecution(opportunity: SandwichOpportunity): Promise<void> {
    this.executionQueue.push(opportunity);
    this.executionQueue.sort((a, b) => 
      b.estimatedProfit.minus(a.estimatedProfit).toNumber()
    );

    if (!this.isExecuting) {
      this.processExecutionQueue();
    }
  }

  private async processExecutionQueue(): Promise<void> {
    if (this.isExecuting || this.executionQueue.length === 0) {
      return;
    }

    this.isExecuting = true;

    try {
      while (this.executionQueue.length > 0) {
        const opportunity = this.executionQueue.shift()!;
        
        // Check if opportunity is still valid
        const age = Date.now() - opportunity.detectedAt;
        if (age > 5000) { // 5 second max age
          logger.debug('Skipping stale opportunity', {
            id: opportunity.id,
            age
          });
          continue;
        }

        await this.executeSandwich(opportunity);
        
        // Small delay between executions
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      logger.error('Error processing execution queue', error);
    } finally {
      this.isExecuting = false;
    }
  }

  getStatus(): any {
    return {
      isExecuting: this.isExecuting,
      queueSize: this.executionQueue.length,
      walletAddress: this.wallet.publicKey.toString(),
      bundleManagerStatus: this.bundleManager.getStatus(),
      flashloanManagerStatus: this.flashloanManager.getStatus()
    };
  }

  clearQueue(): void {
    this.executionQueue = [];
    logger.info('Execution queue cleared');
  }
}

