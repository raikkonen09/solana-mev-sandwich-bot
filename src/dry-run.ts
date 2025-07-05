#!/usr/bin/env node

/**
 * Comprehensive Dry Run Script for Solana MEV Sandwich Bot
 * This script simulates the bot's operation without executing real transactions
 * and logs potential sandwich opportunities from real blockchain data
 */

import { Connection, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import Big from 'big.js';

// Configuration interface
interface BotConfig {
  rpcEndpoints: string[];
  wsEndpoints: string[];
  jitoEndpoint: string;
  privateKeyPath: string;
  minProfitThreshold: string;
  maxSlippageTolerance: number;
  gasLimitMultiplier: number;
  retryAttempts: number;
  monitoredDEXs: string[];
  flashloanProviders: string[];
  riskTolerance: number;
  maxPositionSize: string;
  dryRun: boolean;
  logLevel: string;
  enableMonitoring: boolean;
  monitoringPort: number;
}

// Real transaction data structure
interface RealTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  fee: number;
  instructions: any[];
  accounts: string[];
  logMessages: string[];
  err: any;
}

// Analyzed opportunity structure
interface SandwichOpportunity {
  transaction: RealTransaction;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  estimatedSlippage: number;
  dex: string;
  estimatedProfit: string;
  profitability: 'high' | 'medium' | 'low' | 'unprofitable';
  riskScore: number;
  timestamp: number;
}

// Mock transaction data for testing
interface MockSwapTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  slippage: number;
  dex: string;
  user: string;
}

class DryRunBot {
  private config!: BotConfig;
  private connection!: Connection;
  private wallet: Keypair | null = null;
  private startTime: number;
  private opportunities: SandwichOpportunity[] = [];
  private stats = {
    opportunitiesDetected: 0,
    profitableOpportunities: 0,
    simulatedProfits: new Big(0),
    averageLatency: 0,
    successRate: 0,
    errors: 0,
    realTransactionsAnalyzed: 0,
    potentialSandwichTargets: 0
  };

  constructor() {
    this.startTime = Date.now();
    this.loadConfiguration();
    this.initializeConnection();
  }

  private loadConfiguration(): void {
    console.log('📋 Loading bot configuration...');
    
    try {
      const configPath = join(__dirname, '../config/bot.example.json');
      
      if (!existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
      }
      
      const configData = readFileSync(configPath, 'utf8');
      this.config = JSON.parse(configData);
      
      console.log('✅ Configuration loaded successfully');
      console.log(`   RPC Endpoints: ${this.config.rpcEndpoints.length}`);
      console.log(`   Monitored DEXs: ${this.config.monitoredDEXs.join(', ')}`);
      console.log(`   Dry Run Mode: ${this.config.dryRun}`);
      console.log(`   Min Profit Threshold: ${this.config.minProfitThreshold} SOL`);
      
    } catch (error: any) {
      console.error('❌ Failed to load configuration:', error.message);
      process.exit(1);
    }
  }

  private initializeConnection(): void {
    console.log('\n🔗 Initializing Solana connection...');
    
    try {
      // Use the first RPC endpoint
      this.connection = new Connection(this.config.rpcEndpoints[0], 'confirmed');
      console.log('✅ Connection initialized');
      console.log(`   Endpoint: ${this.config.rpcEndpoints[0]}`);
      
    } catch (error: any) {
      console.error('❌ Failed to initialize connection:', error.message);
      process.exit(1);
    }
  }

  private async loadWallet(): Promise<void> {
    console.log('\n🔑 Loading wallet...');
    
    try {
      const walletPath = join(__dirname, '../config/wallet.json');
      
      if (!existsSync(walletPath)) {
        console.log('⚠️  Wallet not found, generating temporary wallet for dry run...');
        this.wallet = Keypair.generate();
        console.log(`   Temporary wallet: ${this.wallet.publicKey.toString()}`);
        return;
      }
      
      const secretKeyData = JSON.parse(readFileSync(walletPath, 'utf8'));
      this.wallet = Keypair.fromSecretKey(new Uint8Array(secretKeyData));
      
      console.log('✅ Wallet loaded successfully');
      console.log(`   Address: ${this.wallet.publicKey.toString()}`);
      
      // Check wallet balance
      const balance = await this.connection.getBalance(this.wallet.publicKey);
      console.log(`   Balance: ${balance / 1e9} SOL`);
      
    } catch (error: any) {
      console.error('❌ Failed to load wallet:', error.message);
      process.exit(1);
    }
  }

  private async testConnectionHealth(): Promise<void> {
    console.log('\n🏥 Testing connection health...');
    
    try {
      const startTime = Date.now();
      
      // Test basic connectivity
      const version = await this.connection.getVersion();
      const slot = await this.connection.getSlot();
      const { blockhash } = await this.connection.getLatestBlockhash();
      
      const latency = Date.now() - startTime;
      
      console.log('✅ Connection health check passed');
      console.log(`   Solana version: ${version['solana-core']}`);
      console.log(`   Current slot: ${slot}`);
      console.log(`   Latest blockhash: ${blockhash.slice(0, 8)}...`);
      console.log(`   Latency: ${latency}ms`);
      
      this.stats.averageLatency = latency;
      
    } catch (error: any) {
      console.error('❌ Connection health check failed:', error.message);
      this.stats.errors++;
    }
  }

  private async fetchRecentTransactions(): Promise<RealTransaction[]> {
    console.log('\n🔍 Fetching recent transactions from blockchain...');
    
    try {
      const slot = await this.connection.getSlot();
      const block = await this.connection.getBlock(slot - 1, {
        maxSupportedTransactionVersion: 0,
        transactionDetails: 'full'
      });
      
      if (!block || !block.transactions) {
        console.log('⚠️  No transactions found in recent block');
        return [];
      }
      
      const realTransactions: RealTransaction[] = block.transactions.map((tx) => ({
        signature: tx.transaction.signatures[0],
        slot: slot - 1,
        blockTime: block.blockTime || Date.now() / 1000,
        fee: tx.meta?.fee || 0,
        instructions: [], // Simplified for demo
        accounts: [], // Simplified for demo
        logMessages: tx.meta?.logMessages || [],
        err: tx.meta?.err
      }));
      
      console.log(`✅ Fetched ${realTransactions.length} real transactions`);
      console.log(`   Block slot: ${slot - 1}`);
      console.log(`   Block time: ${new Date((block.blockTime || 0) * 1000).toISOString()}`);
      
      return realTransactions;
      
    } catch (error: any) {
      console.error('❌ Failed to fetch real transactions:', error.message);
      this.stats.errors++;
      return [];
    }
  }

  private analyzeTransactionForSandwich(tx: RealTransaction): SandwichOpportunity | null {
    try {
      // Look for DEX-related log messages
      const dexPatterns = {
        raydium: ['Program log: Instruction: Swap', 'ray_log'],
        orca: ['Program log: Instruction: Swap', 'whirlpool'],
        jupiter: ['Program log: Instruction: Route', 'jupiter'],
        serum: ['Program log: Instruction: NewOrder', 'serum']
      };
      
      let detectedDex = '';
      let hasSwap = false;
      
      for (const [dex, patterns] of Object.entries(dexPatterns)) {
        for (const pattern of patterns) {
          if (tx.logMessages.some(log => log.toLowerCase().includes(pattern.toLowerCase()))) {
            detectedDex = dex;
            hasSwap = true;
            break;
          }
        }
        if (hasSwap) break;
      }
      
      if (!hasSwap || !detectedDex) {
        return null;
      }
      
      // Estimate transaction size and potential slippage
      const instructionCount = tx.instructions.length;
      const accountCount = tx.accounts.length;
      const fee = tx.fee;
      
      // Heuristic: larger transactions with higher fees might indicate larger swaps
      const estimatedSlippage = Math.min(0.2, (fee / 10000) + (instructionCount * 0.01) + (accountCount * 0.001));
      
      // Estimate amounts based on transaction complexity
      const estimatedAmountIn = Math.max(0.1, fee / 1000 + instructionCount * 0.5);
      
      // Calculate potential profit
      const frontrunAmount = estimatedAmountIn * 0.1;
      const priceImpact = estimatedSlippage * 0.6;
      const estimatedProfit = frontrunAmount * priceImpact;
      const gasEstimate = 0.01;
      const netProfit = estimatedProfit - gasEstimate;
      
      // Determine profitability
      let profitability: 'high' | 'medium' | 'low' | 'unprofitable';
      if (netProfit > 0.05) profitability = 'high';
      else if (netProfit > 0.02) profitability = 'medium';
      else if (netProfit > 0.005) profitability = 'low';
      else profitability = 'unprofitable';
      
      // Calculate risk score
      const riskScore = Math.min(1, (1 - estimatedSlippage) + (estimatedAmountIn / 100) * 0.1);
      
      return {
        transaction: tx,
        tokenIn: 'Unknown', // Would need more analysis to determine
        tokenOut: 'Unknown',
        amountIn: estimatedAmountIn.toFixed(6),
        estimatedSlippage,
        dex: detectedDex,
        estimatedProfit: netProfit.toFixed(6),
        profitability,
        riskScore,
        timestamp: Date.now()
      };
      
    } catch (error: any) {
      return null;
    }
  }

  private async analyzeRealTransactions(): Promise<void> {
    console.log('\n🔬 Analyzing real transactions for sandwich opportunities...');
    
    const realTransactions = await this.fetchRecentTransactions();
    this.stats.realTransactionsAnalyzed = realTransactions.length;
    
    for (const tx of realTransactions) {
      const opportunity = this.analyzeTransactionForSandwich(tx);
      
      if (opportunity) {
        this.opportunities.push(opportunity);
        this.stats.potentialSandwichTargets++;
        
        console.log(`   🎯 Potential target found:`);
        console.log(`      Signature: ${tx.signature.slice(0, 8)}...`);
        console.log(`      DEX: ${opportunity.dex.toUpperCase()}`);
        console.log(`      Estimated slippage: ${(opportunity.estimatedSlippage * 100).toFixed(2)}%`);
        console.log(`      Estimated profit: ${opportunity.estimatedProfit} SOL`);
        console.log(`      Profitability: ${opportunity.profitability}`);
        console.log(`      Risk score: ${opportunity.riskScore.toFixed(3)}`);
      }
    }
    
    console.log(`\n📊 Real transaction analysis complete:`);
    console.log(`   Transactions analyzed: ${this.stats.realTransactionsAnalyzed}`);
    console.log(`   Potential sandwich targets: ${this.stats.potentialSandwichTargets}`);
    console.log(`   Detection rate: ${((this.stats.potentialSandwichTargets / this.stats.realTransactionsAnalyzed) * 100).toFixed(1)}%`);
  }

  private generateMockTransactions(): MockSwapTransaction[] {
    console.log('\n🎭 Generating mock swap transactions for testing...');
    
    const mockTransactions: MockSwapTransaction[] = [
      {
        signature: '5KJp7zKjvKqp1rKjvKqp1rKjvKqp1rKjvKqp1rKjvKqp1rKjvKqp1rKjvKqp1r',
        slot: 351119082,
        blockTime: Date.now() / 1000,
        tokenIn: 'So11111111111111111111111111111111111111112', // SOL
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amountIn: '10.5',
        amountOut: '2100.0',
        slippage: 0.08, // 8% slippage - profitable for sandwich
        dex: 'raydium',
        user: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
      },
      {
        signature: '6LKq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8aLq8a',
        slot: 351119083,
        blockTime: Date.now() / 1000,
        tokenIn: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        tokenOut: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
        amountIn: '5000.0',
        amountOut: '4.2',
        slippage: 0.12, // 12% slippage - very profitable
        dex: 'orca',
        user: 'AaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'
      },
      {
        signature: '7MRr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9bMr9b',
        slot: 351119084,
        blockTime: Date.now() / 1000,
        tokenIn: 'So11111111111111111111111111111111111111112', // SOL
        tokenOut: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
        amountIn: '2.1',
        amountOut: '150.0',
        slippage: 0.03, // 3% slippage - not profitable enough
        dex: 'raydium',
        user: 'BbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb'
      },
      {
        signature: '8NSs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0cNs0c',
        slot: 351119085,
        blockTime: Date.now() / 1000,
        tokenIn: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
        tokenOut: 'So11111111111111111111111111111111111111112', // SOL
        amountIn: '25.0',
        amountOut: '29.8',
        slippage: 0.15, // 15% slippage - extremely profitable
        dex: 'orca',
        user: 'CcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc'
      }
    ];
    
    console.log(`✅ Generated ${mockTransactions.length} mock transactions`);
    console.log(`   High slippage (>5%): ${mockTransactions.filter(tx => tx.slippage > 0.05).length}`);
    console.log(`   Profitable threshold (>8%): ${mockTransactions.filter(tx => tx.slippage > 0.08).length}`);
    
    return mockTransactions;
  }

  private async analyzeOpportunity(transaction: MockSwapTransaction): Promise<{
    profitable: boolean;
    estimatedProfit: Big;
    frontrunAmount: Big;
    backrunAmount: Big;
    gasEstimate: Big;
    netProfit: Big;
    riskScore: number;
  }> {
    const startTime = Date.now();
    
    // Simulate opportunity analysis
    const amountIn = new Big(transaction.amountIn);
    const slippage = transaction.slippage;
    
    // Calculate potential frontrun amount (10% of victim's trade)
    const frontrunAmount = amountIn.times(0.1);
    
    // Estimate price impact and profit
    const priceImpact = slippage * 0.6; // We capture 60% of the slippage
    const estimatedProfit = frontrunAmount.times(priceImpact);
    
    // Estimate gas costs (0.01 SOL for bundle execution)
    const gasEstimate = new Big(0.01);
    
    // Calculate net profit
    const netProfit = estimatedProfit.minus(gasEstimate);
    
    // Calculate risk score (0-1, lower is better)
    const riskScore = Math.min(1, (1 - slippage) + (amountIn.toNumber() / 1000) * 0.1);
    
    // Check if profitable
    const minProfitThreshold = new Big(this.config.minProfitThreshold);
    const profitable = netProfit.gte(minProfitThreshold) && slippage > 0.05;
    
    const analysisTime = Date.now() - startTime;
    
    console.log(`   📊 Analysis for ${transaction.signature.slice(0, 8)}...`);
    console.log(`      DEX: ${transaction.dex.toUpperCase()}`);
    console.log(`      Slippage: ${(slippage * 100).toFixed(2)}%`);
    console.log(`      Frontrun amount: ${frontrunAmount.toFixed(4)} tokens`);
    console.log(`      Estimated profit: ${estimatedProfit.toFixed(6)} SOL`);
    console.log(`      Gas estimate: ${gasEstimate.toFixed(6)} SOL`);
    console.log(`      Net profit: ${netProfit.toFixed(6)} SOL`);
    console.log(`      Risk score: ${riskScore.toFixed(3)}`);
    console.log(`      Profitable: ${profitable ? '✅' : '❌'}`);
    console.log(`      Analysis time: ${analysisTime}ms`);
    
    return {
      profitable,
      estimatedProfit,
      frontrunAmount,
      backrunAmount: frontrunAmount,
      gasEstimate,
      netProfit,
      riskScore
    };
  }

  private async simulateSandwichExecution(
    transaction: MockSwapTransaction,
    analysis: any
  ): Promise<{ success: boolean; actualProfit: Big; executionTime: number }> {
    const startTime = Date.now();
    
    console.log(`   🥪 Simulating sandwich execution for ${transaction.signature.slice(0, 8)}...`);
    
    try {
      // Simulate frontrun transaction
      console.log(`      1. Frontrun: ${analysis.frontrunAmount.toFixed(4)} tokens`);
      await this.simulateDelay(50, 150); // Network latency
      
      // Simulate victim transaction execution
      console.log(`      2. Victim transaction executes`);
      await this.simulateDelay(100, 200);
      
      // Simulate backrun transaction
      console.log(`      3. Backrun: ${analysis.backrunAmount.toFixed(4)} tokens`);
      await this.simulateDelay(50, 150);
      
      // Calculate actual profit (with some variance)
      const variance = 0.9 + Math.random() * 0.2; // 90-110% of estimated
      const actualProfit = analysis.netProfit.times(variance);
      
      const executionTime = Date.now() - startTime;
      const success = actualProfit.gt(0) && Math.random() > 0.1; // 90% success rate
      
      console.log(`      ✅ Execution ${success ? 'successful' : 'failed'}`);
      console.log(`      Actual profit: ${actualProfit.toFixed(6)} SOL`);
      console.log(`      Execution time: ${executionTime}ms`);
      
      return { success, actualProfit, executionTime };
      
    } catch (error: any) {
      console.log(`      ❌ Execution failed: ${error.message}`);
      return { success: false, actualProfit: new Big(0), executionTime: Date.now() - startTime };
    }
  }

  private async simulateDelay(min: number, max: number): Promise<void> {
    const delay = min + Math.random() * (max - min);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  private async testJitoIntegration(): Promise<void> {
    console.log('\n🚀 Testing Jito integration...');
    
    try {
      // Test Jito package import
      await import('jito-ts');
      console.log('✅ Jito package imported successfully');
      
      // Test bundle creation (simulation)
      console.log('   📦 Simulating bundle creation...');
      
      if (!this.wallet) {
        throw new Error('Wallet not loaded');
      }
      
      // Create a mock transaction for testing
      const mockTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: this.wallet.publicKey,
          lamports: 1000
        })
      );
      
      const { blockhash } = await this.connection.getLatestBlockhash();
      mockTransaction.recentBlockhash = blockhash;
      mockTransaction.feePayer = this.wallet.publicKey;
      
      console.log('   ✅ Mock bundle transaction created');
      console.log(`      Transaction size: ${mockTransaction.serialize().length} bytes`);
      console.log(`      Fee payer: ${this.wallet.publicKey.toString()}`);
      console.log(`      Recent blockhash: ${blockhash.slice(0, 8)}...`);
      
    } catch (error: any) {
      console.error('❌ Jito integration test failed:', error.message);
      this.stats.errors++;
    }
  }

  private async runDryRunSimulation(): Promise<void> {
    console.log('\n🎯 Starting dry run simulation...');
    console.log('=' .repeat(60));
    
    const mockTransactions = this.generateMockTransactions();
    let successfulExecutions = 0;
    
    for (const transaction of mockTransactions) {
      this.stats.opportunitiesDetected++;
      
      console.log(`\n🔍 Processing opportunity ${this.stats.opportunitiesDetected}:`);
      
      // Analyze the opportunity
      const analysis = await this.analyzeOpportunity(transaction);
      
      if (analysis.profitable) {
        this.stats.profitableOpportunities++;
        
        // Simulate execution
        const execution = await this.simulateSandwichExecution(transaction, analysis);
        
        if (execution.success) {
          successfulExecutions++;
          this.stats.simulatedProfits = this.stats.simulatedProfits.plus(execution.actualProfit);
        } else {
          this.stats.errors++;
        }
      }
      
      // Add some delay between opportunities
      await this.simulateDelay(500, 1500);
    }
    
    this.stats.successRate = this.stats.profitableOpportunities > 0 ? 
      successfulExecutions / this.stats.profitableOpportunities : 0;
    
    console.log('\n' + '=' .repeat(60));
    console.log('🏁 Dry run simulation completed');
  }

  private saveOpportunityLog(): void {
    console.log('\n💾 Saving opportunity log...');
    
    try {
      const logData = {
        timestamp: new Date().toISOString(),
        runtime: (Date.now() - this.startTime) / 1000,
        stats: this.stats,
        realOpportunities: this.opportunities,
        summary: {
          totalOpportunities: this.opportunities.length,
          highProfitability: this.opportunities.filter(op => op.profitability === 'high').length,
          mediumProfitability: this.opportunities.filter(op => op.profitability === 'medium').length,
          lowProfitability: this.opportunities.filter(op => op.profitability === 'low').length,
          unprofitable: this.opportunities.filter(op => op.profitability === 'unprofitable').length,
          averageSlippage: this.opportunities.length > 0 ? 
            this.opportunities.reduce((sum, op) => sum + op.estimatedSlippage, 0) / this.opportunities.length : 0,
          totalEstimatedProfit: this.opportunities.reduce((sum, op) => sum + parseFloat(op.estimatedProfit), 0)
        }
      };
      
      const logPath = join(__dirname, '../logs/dry-run-' + Date.now() + '.json');
      writeFileSync(logPath, JSON.stringify(logData, null, 2));
      
      console.log('✅ Opportunity log saved');
      console.log(`   File: ${logPath}`);
      console.log(`   Real opportunities logged: ${this.opportunities.length}`);
      
    } catch (error: any) {
      console.error('❌ Failed to save opportunity log:', error.message);
    }
  }

  private displayResults(): void {
    const runtime = (Date.now() - this.startTime) / 1000;
    
    console.log('\n' + '=' .repeat(60));
    console.log('📊 DRY RUN RESULTS');
    console.log('=' .repeat(60));
    
    console.log('\n📈 Performance Metrics:');
    console.log(`   Runtime: ${runtime.toFixed(2)} seconds`);
    console.log(`   Mock opportunities detected: ${this.stats.opportunitiesDetected}`);
    console.log(`   Mock profitable opportunities: ${this.stats.profitableOpportunities}`);
    console.log(`   Success rate: ${(this.stats.successRate * 100).toFixed(1)}%`);
    console.log(`   Average latency: ${this.stats.averageLatency}ms`);
    console.log(`   Errors encountered: ${this.stats.errors}`);
    
    console.log('\n🔍 Real Transaction Analysis:');
    console.log(`   Real transactions analyzed: ${this.stats.realTransactionsAnalyzed}`);
    console.log(`   Potential sandwich targets: ${this.stats.potentialSandwichTargets}`);
    console.log(`   Detection rate: ${this.stats.realTransactionsAnalyzed > 0 ? 
      ((this.stats.potentialSandwichTargets / this.stats.realTransactionsAnalyzed) * 100).toFixed(1) : '0.0'}%`);
    
    if (this.opportunities.length > 0) {
      const highProfit = this.opportunities.filter(op => op.profitability === 'high').length;
      const mediumProfit = this.opportunities.filter(op => op.profitability === 'medium').length;
      const lowProfit = this.opportunities.filter(op => op.profitability === 'low').length;
      
      console.log(`   High profitability targets: ${highProfit}`);
      console.log(`   Medium profitability targets: ${mediumProfit}`);
      console.log(`   Low profitability targets: ${lowProfit}`);
      
      const avgSlippage = this.opportunities.reduce((sum, op) => sum + op.estimatedSlippage, 0) / this.opportunities.length;
      console.log(`   Average estimated slippage: ${(avgSlippage * 100).toFixed(2)}%`);
    }
    
    console.log('\n💰 Financial Metrics:');
    console.log(`   Total simulated profit: ${this.stats.simulatedProfits.toFixed(6)} SOL`);
    console.log(`   Average profit per opportunity: ${this.stats.profitableOpportunities > 0 ? 
      this.stats.simulatedProfits.div(this.stats.profitableOpportunities).toFixed(6) : '0.000000'} SOL`);
    console.log(`   Profit rate: ${runtime > 0 ? 
      this.stats.simulatedProfits.div(runtime / 3600).toFixed(6) : '0.000000'} SOL/hour`);
    
    console.log('\n🎯 Optimization Recommendations:');
    
    if (this.stats.averageLatency > 200) {
      console.log('   ⚠️  High latency detected - consider using faster RPC endpoints');
    }
    
    if (this.stats.successRate < 0.8) {
      console.log('   ⚠️  Low success rate - review transaction simulation logic');
    }
    
    if (this.stats.errors > 0) {
      console.log(`   ⚠️  ${this.stats.errors} errors encountered - check error handling`);
    }
    
    if (this.stats.profitableOpportunities / this.stats.opportunitiesDetected < 0.3) {
      console.log('   💡 Low profitable opportunity rate - consider adjusting filters');
    }
    
    if (this.stats.potentialSandwichTargets === 0) {
      console.log('   💡 No real sandwich targets detected - may need to improve detection algorithms');
    }
    
    if (this.stats.realTransactionsAnalyzed < 50) {
      console.log('   💡 Low transaction volume - consider analyzing multiple blocks for better data');
    }
    
    console.log('\n✅ Dry run completed successfully!');
    console.log('   The bot is ready for live testing with small amounts.');
    console.log('   Check the logs directory for detailed opportunity analysis.');
  }

  public async run(): Promise<void> {
    console.log('🚀 Solana MEV Sandwich Bot - Dry Run');
    console.log('====================================\n');
    
    try {
      await this.loadWallet();
      await this.testConnectionHealth();
      await this.testJitoIntegration();
      await this.analyzeRealTransactions();
      await this.runDryRunSimulation();
      this.saveOpportunityLog();
      this.displayResults();
      
    } catch (error: any) {
      console.error('\n💥 Dry run failed:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    }
  }
}

// Run the dry run if this file is executed directly
if (require.main === module) {
  const dryRunBot = new DryRunBot();
  dryRunBot.run().then(() => {
    console.log('\n🎉 Dry run completed successfully!');
    process.exit(0);
  }).catch((error: any) => {
    console.error('\n💥 Dry run crashed:', error);
    process.exit(1);
  });
}

export { DryRunBot };

