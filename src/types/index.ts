import { PublicKey, Transaction } from '@solana/web3.js';
import Big from 'big.js';

export interface TokenInfo {
  mint: PublicKey;
  symbol: string;
  decimals: number;
  name: string;
}

export interface TokenPair {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
}

export interface SwapTransaction {
  signature: string;
  programId: PublicKey;
  accounts: PublicKey[];
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: Big;
  minimumAmountOut: Big;
  slippageTolerance: number;
  timestamp: number;
  dex: DEXType;
  poolAddress: PublicKey;
}

export enum DEXType {
  RAYDIUM = 'raydium',
  ORCA = 'orca',
  PHOENIX = 'phoenix'
}

export interface SandwichOpportunity {
  id: string;
  targetTransaction: SwapTransaction;
  estimatedProfit: Big;
  frontrunAmount: Big;
  backrunAmount: Big;
  gasEstimate: Big;
  riskScore: number;
  confidence: number;
  detectedAt: number;
}

export interface BundleTransaction {
  transaction: Transaction;
  type: 'frontrun' | 'victim' | 'backrun';
  expectedGas: number;
  priority: number;
}

export interface ExecutionResult {
  bundleId: string;
  success: boolean;
  actualProfit?: Big;
  gasUsed?: number;
  error?: string;
  executionTime: number;
}

export interface MonitorConfig {
  rpcEndpoints: string[];
  wsEndpoints: string[];
  monitoredDEXs: DEXType[];
  minSlippageThreshold: number;
  minAmountThreshold: Big;
  maxLatency: number;
}

export interface ProfitCalculation {
  expectedProfit: Big;
  gasCosts: Big;
  slippageImpact: Big;
  marketImpact: Big;
  netProfit: Big;
  profitMargin: number;
  riskAdjustedReturn: Big;
}

export interface RiskAssessment {
  executionRisk: number;
  marketRisk: number;
  liquidityRisk: number;
  competitionRisk: number;
  overallRisk: number;
}

export interface BotMetrics {
  opportunitiesDetected: number;
  bundlesSubmitted: number;
  successfulSandwiches: number;
  totalProfit: Big;
  averageLatency: number;
  errorRate: number;
  uptime: number;
}

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: any;
}

export interface PoolInfo {
  address: PublicKey;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  liquidity: Big;
  fee: number;
  dex: DEXType;
}

export interface MarketData {
  price: Big;
  volume24h: Big;
  liquidity: Big;
  priceChange24h: number;
  lastUpdated: number;
}

export interface FlashloanProvider {
  name: string;
  programId: PublicKey;
  fee: number;
  maxAmount: Big;
  supportedTokens: PublicKey[];
}

export interface BotConfig {
  rpcEndpoints: string[];
  wsEndpoints: string[];
  jitoEndpoint: string;
  privateKeyPath: string;
  minProfitThreshold: Big;
  maxSlippageTolerance: number;
  gasLimitMultiplier: number;
  retryAttempts: number;
  monitoredDEXs: DEXType[];
  flashloanProviders: FlashloanProvider[];
  riskTolerance: number;
  maxPositionSize: Big;
}

