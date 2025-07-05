import { PublicKey, Transaction, Keypair } from '@solana/web3.js';
import Big from 'big.js';

// Core Types
export interface TokenInfo {
  mint: PublicKey;
  symbol: string;
  decimals: number;
  name?: string;
  logoURI?: string;
}

export interface SwapTransaction {
  signature: string;
  slot: number;
  blockTime: number;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: Big;
  amountOut: Big;
  slippage: Big;
  dex: DEXType;
  poolAddress: PublicKey;
  userAddress: PublicKey;
  instructions: any[];
  logs: string[];
}

export interface SandwichOpportunity {
  id: string;
  victimTransaction: SwapTransaction;
  estimatedProfit: Big;
  confidence: number;
  riskScore: number;
  frontrunAmount: Big;
  backrunAmount: Big;
  maxSlippage: Big;
  gasEstimate: number;
  timestamp: number;
  dex: DEXType;
  priority: 'very_high' | 'high' | 'medium' | 'low';
}

export interface ExecutionResult {
  bundleId: string;
  success: boolean;
  actualProfit?: Big;
  gasUsed?: number;
  error?: string;
  executionTime: number;
}

export interface BundleTransaction {
  transaction: Transaction;
  type: 'frontrun' | 'victim' | 'backrun';
  expectedGas: number;
}

export interface JitoBundleStatus {
  processed: boolean;
  confirmed: boolean;
  error?: string;
  transactions: any;
  totalGasUsed: number;
}

export interface SigningResult {
  success: boolean;
  signedTransaction?: Transaction;
  signature?: string;
  error?: string;
}

export interface ProfitCalculation {
  estimatedProfit: Big;
  confidence: number;
  riskScore: number;
  frontrunAmount: Big;
  backrunAmount: Big;
  maxSlippage: Big;
  gasEstimate: number;
  priceImpact: Big;
  liquidityDepth: Big;
  marketConditions: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface MarketData {
  price: Big;
  liquidity: Big;
  volume24h: Big;
  priceChange24h: Big;
  lastUpdated: number;
}

export interface BotConfig {
  rpcEndpoints: string[];
  jitoEndpoints?: string[];
  dryRun: boolean;
  minProfitThreshold: number;
  maxSlippageTolerance: number;
  maxGasPrice: number;
  monitoringInterval: number;
  enabledDEXs: DEXType[];
  riskManagement: {
    maxPositionSize: number;
    stopLossThreshold: number;
    maxDailyLoss: number;
  };
  flashloan: {
    enabled: boolean;
    providers: string[];
    maxAmount: number;
  };
  logging: {
    level: string;
    enableFileLogging: boolean;
    logDirectory: string;
  };
}

export interface LogEntry {
  timestamp: number;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  data?: any;
  component?: string;
}

export enum DEXType {
  RAYDIUM = 'raydium',
  ORCA = 'orca',
  PHOENIX = 'phoenix',
  JUPITER = 'jupiter',
  SERUM = 'serum'
}

export enum ErrorType {
  NETWORK_ERROR = 'network_error',
  TRANSACTION_ERROR = 'transaction_error',
  SIMULATION_ERROR = 'simulation_error',
  BUNDLE_ERROR = 'bundle_error',
  WALLET_ERROR = 'wallet_error',
  CONFIGURATION_ERROR = 'configuration_error',
  UNKNOWN_ERROR = 'unknown_error'
}

// Event Types
export interface OpportunityDetectedEvent {
  opportunity: SandwichOpportunity;
  timestamp: number;
}

export interface ExecutionCompletedEvent {
  result: ExecutionResult;
  opportunity: SandwichOpportunity;
  timestamp: number;
}

export interface ErrorEvent {
  error: Error;
  type: ErrorType;
  context?: any;
  timestamp: number;
}

// Utility Types
export type ConnectionConfig = {
  commitment: 'processed' | 'confirmed' | 'finalized';
  confirmTransactionInitialTimeout: number;
  wsEndpoint?: string;
};

export type SendOptions = {
  skipPreflight?: boolean;
  preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
};

// Re-export commonly used types
export { PublicKey, Transaction, Keypair } from '@solana/web3.js';
export { default as Big } from 'big.js';

