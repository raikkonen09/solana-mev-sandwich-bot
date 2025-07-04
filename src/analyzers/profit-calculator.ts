import { 
  SwapTransaction, 
  ProfitCalculation, 
  RiskAssessment, 
  TokenInfo, 
  DEXType,
  MarketData 
} from '../types';
import { logger } from '../utils/logger';
import { ConnectionManager } from '../utils/connection';
import Big from 'big.js';

export class ProfitCalculator {
  private connectionManager: ConnectionManager;
  private priceCache: Map<string, MarketData> = new Map();
  private gasEstimates: Map<DEXType, number> = new Map();

  constructor(rpcEndpoints: string[]) {
    this.connectionManager = new ConnectionManager(rpcEndpoints);
    this.initializeGasEstimates();
    this.startPriceCacheUpdates();
  }

  private initializeGasEstimates(): void {
    // Initialize gas estimates for different DEXs
    this.gasEstimates.set(DEXType.RAYDIUM, 180000);
    this.gasEstimates.set(DEXType.ORCA, 350000);
    this.gasEstimates.set(DEXType.PHOENIX, 200000);
  }

  private startPriceCacheUpdates(): void {
    // Update price cache every 5 seconds
    setInterval(async () => {
      try {
        await this.updatePriceCache();
      } catch (error) {
        logger.error('Error updating price cache', error);
      }
    }, 5000);
  }

  async calculateSandwichProfit(
    targetTransaction: SwapTransaction,
    frontrunAmount: Big,
    backrunAmount: Big,
    useFlashloan: boolean = false
  ): Promise<ProfitCalculation> {
    try {
      logger.debug('Calculating sandwich profit', {
        target: targetTransaction.signature,
        frontrunAmount: frontrunAmount.toString(),
        backrunAmount: backrunAmount.toString(),
        useFlashloan
      });

      // Get current market data
      const marketData = await this.getMarketData(
        targetTransaction.tokenIn,
        targetTransaction.tokenOut
      );

      // Calculate price impact of victim transaction
      const priceImpact = await this.calculatePriceImpact(
        targetTransaction,
        marketData
      );

      // Calculate frontrun profit
      const frontrunProfit = await this.calculateFrontrunProfit(
        targetTransaction,
        frontrunAmount,
        priceImpact,
        marketData
      );

      // Calculate backrun profit
      const backrunProfit = await this.calculateBackrunProfit(
        targetTransaction,
        backrunAmount,
        priceImpact,
        marketData
      );

      // Calculate total gas costs
      const gasCosts = await this.calculateGasCosts(
        targetTransaction.dex,
        useFlashloan
      );

      // Calculate flashloan costs if applicable
      const flashloanCosts = useFlashloan ? 
        await this.calculateFlashloanCosts(frontrunAmount, targetTransaction.tokenIn) :
        new Big(0);

      // Calculate slippage impact
      const slippageImpact = await this.calculateSlippageImpact(
        targetTransaction,
        frontrunAmount,
        backrunAmount
      );

      // Calculate market impact
      const marketImpact = await this.calculateMarketImpact(
        targetTransaction,
        frontrunAmount,
        marketData
      );

      // Calculate gross and net profit
      const grossProfit = frontrunProfit.plus(backrunProfit);
      const totalCosts = gasCosts.plus(flashloanCosts).plus(slippageImpact);
      const netProfit = grossProfit.minus(totalCosts);

      // Calculate profit margin
      const totalInvestment = useFlashloan ? flashloanCosts : frontrunAmount;
      const profitMargin = totalInvestment.gt(0) ? 
        netProfit.div(totalInvestment).mul(100).toNumber() : 0;

      // Calculate risk-adjusted return
      const riskAssessment = await this.assessRisk(targetTransaction, marketData);
      const riskAdjustment = 1 - (riskAssessment.overallRisk * 0.5); // Max 50% risk discount
      const riskAdjustedReturn = netProfit.mul(riskAdjustment);

      const result: ProfitCalculation = {
        expectedProfit: grossProfit,
        gasCosts,
        slippageImpact,
        marketImpact,
        netProfit,
        profitMargin,
        riskAdjustedReturn
      };

      logger.info('Profit calculation completed', {
        grossProfit: grossProfit.toString(),
        netProfit: netProfit.toString(),
        profitMargin: profitMargin.toFixed(2) + '%',
        riskScore: riskAssessment.overallRisk
      });

      return result;
    } catch (error) {
      logger.error('Error calculating sandwich profit', error);
      throw error;
    }
  }

  private async calculatePriceImpact(
    transaction: SwapTransaction,
    marketData: MarketData
  ): Promise<Big> {
    try {
      // Calculate price impact based on transaction size and liquidity
      const liquidityRatio = transaction.amountIn.div(marketData.liquidity);
      
      // Use square root price impact model (common in AMMs)
      const priceImpact = liquidityRatio.sqrt().mul(0.5); // 50% of sqrt ratio
      
      // Cap price impact at 50%
      return Big.min(priceImpact, new Big(0.5));
    } catch (error) {
      logger.error('Error calculating price impact', error);
      return new Big(0.01); // Default 1% impact
    }
  }

  private async calculateFrontrunProfit(
    transaction: SwapTransaction,
    frontrunAmount: Big,
    priceImpact: Big,
    marketData: MarketData
  ): Promise<Big> {
    try {
      // Calculate profit from frontrun transaction
      const currentPrice = marketData.price;
      const impactedPrice = currentPrice.mul(new Big(1).plus(priceImpact));
      
      // Frontrun buys at current price, sells at impacted price
      const tokensReceived = frontrunAmount.div(currentPrice);
      const sellValue = tokensReceived.mul(impactedPrice);
      
      return sellValue.minus(frontrunAmount);
    } catch (error) {
      logger.error('Error calculating frontrun profit', error);
      return new Big(0);
    }
  }

  private async calculateBackrunProfit(
    transaction: SwapTransaction,
    backrunAmount: Big,
    priceImpact: Big,
    marketData: MarketData
  ): Promise<Big> {
    try {
      // Calculate profit from backrun transaction
      const currentPrice = marketData.price;
      const impactedPrice = currentPrice.mul(new Big(1).plus(priceImpact));
      
      // Backrun sells at impacted price, buys back at recovered price
      const recoveredPrice = currentPrice.mul(new Big(1).plus(priceImpact.mul(0.7))); // 70% recovery
      
      const tokensToSell = backrunAmount.div(impactedPrice);
      const buyBackCost = tokensToSell.mul(recoveredPrice);
      
      return backrunAmount.minus(buyBackCost);
    } catch (error) {
      logger.error('Error calculating backrun profit', error);
      return new Big(0);
    }
  }

  private async calculateGasCosts(dex: DEXType, useFlashloan: boolean): Promise<Big> {
    try {
      const baseGas = this.gasEstimates.get(dex) || 200000;
      const flashloanGas = useFlashloan ? 150000 : 0; // Additional gas for flashloan
      const totalGas = baseGas + flashloanGas;
      
      // Get current SOL price and gas price
      const solPrice = await this.getSolPrice();
      const gasPrice = await this.getCurrentGasPrice();
      
      // Calculate gas cost in USD equivalent
      const gasCostSol = new Big(totalGas).mul(gasPrice).div(1e9); // Convert to SOL
      const gasCostUsd = gasCostSol.mul(solPrice);
      
      logger.debug('Gas cost calculated', {
        dex,
        totalGas,
        gasCostSol: gasCostSol.toString(),
        gasCostUsd: gasCostUsd.toString()
      });
      
      return gasCostUsd;
    } catch (error) {
      logger.error('Error calculating gas costs', error);
      return new Big('0.01'); // Default $0.01
    }
  }

  private async calculateFlashloanCosts(
    amount: Big,
    token: TokenInfo
  ): Promise<Big> {
    try {
      // Typical flashloan fee is 0.05% to 0.1%
      const feeRate = new Big(0.0009); // 0.09% fee
      const fee = amount.mul(feeRate);
      
      // Convert to USD if needed
      const tokenPrice = await this.getTokenPrice(token);
      const feeUsd = fee.mul(tokenPrice);
      
      logger.debug('Flashloan cost calculated', {
        amount: amount.toString(),
        fee: fee.toString(),
        feeUsd: feeUsd.toString()
      });
      
      return feeUsd;
    } catch (error) {
      logger.error('Error calculating flashloan costs', error);
      return amount.mul(0.001); // Default 0.1% fee
    }
  }

  private async calculateSlippageImpact(
    transaction: SwapTransaction,
    frontrunAmount: Big,
    backrunAmount: Big
  ): Promise<Big> {
    try {
      // Calculate slippage impact on our transactions
      const frontrunSlippage = frontrunAmount.mul(0.005); // 0.5% slippage
      const backrunSlippage = backrunAmount.mul(0.005); // 0.5% slippage
      
      return frontrunSlippage.plus(backrunSlippage);
    } catch (error) {
      logger.error('Error calculating slippage impact', error);
      return new Big(0);
    }
  }

  private async calculateMarketImpact(
    transaction: SwapTransaction,
    frontrunAmount: Big,
    marketData: MarketData
  ): Promise<Big> {
    try {
      // Calculate permanent market impact
      const liquidityRatio = frontrunAmount.div(marketData.liquidity);
      const permanentImpact = liquidityRatio.mul(0.1); // 10% of liquidity ratio
      
      return frontrunAmount.mul(permanentImpact);
    } catch (error) {
      logger.error('Error calculating market impact', error);
      return new Big(0);
    }
  }

  private async assessRisk(
    transaction: SwapTransaction,
    marketData: MarketData
  ): Promise<RiskAssessment> {
    try {
      // Execution risk (based on network congestion and competition)
      const executionRisk = await this.calculateExecutionRisk(transaction);
      
      // Market risk (based on volatility and liquidity)
      const marketRisk = await this.calculateMarketRisk(marketData);
      
      // Liquidity risk (based on pool depth)
      const liquidityRisk = await this.calculateLiquidityRisk(transaction, marketData);
      
      // Competition risk (based on MEV activity)
      const competitionRisk = await this.calculateCompetitionRisk(transaction);
      
      // Overall risk (weighted average)
      const overallRisk = (
        executionRisk * 0.3 +
        marketRisk * 0.25 +
        liquidityRisk * 0.25 +
        competitionRisk * 0.2
      );
      
      return {
        executionRisk,
        marketRisk,
        liquidityRisk,
        competitionRisk,
        overallRisk
      };
    } catch (error) {
      logger.error('Error assessing risk', error);
      return {
        executionRisk: 0.5,
        marketRisk: 0.5,
        liquidityRisk: 0.5,
        competitionRisk: 0.5,
        overallRisk: 0.5
      };
    }
  }

  private async calculateExecutionRisk(transaction: SwapTransaction): Promise<number> {
    try {
      // Check network congestion
      const connection = this.connectionManager.getConnection();
      const recentPerformance = await connection.getRecentPerformanceSamples(10);
      
      const avgTps = recentPerformance.reduce((sum, sample) => 
        sum + sample.numTransactions / sample.samplePeriodSecs, 0
      ) / recentPerformance.length;
      
      // Higher TPS = lower execution risk
      const networkRisk = Math.max(0, 1 - (avgTps / 3000)); // Normalize to 3000 TPS
      
      // Transaction size risk (larger transactions have higher execution risk)
      const sizeRisk = Math.min(1, transaction.amountIn.div(1000000).toNumber()); // Normalize to 1M
      
      return (networkRisk + sizeRisk) / 2;
    } catch (error) {
      logger.error('Error calculating execution risk', error);
      return 0.3; // Default moderate risk
    }
  }

  private async calculateMarketRisk(marketData: MarketData): Promise<number> {
    try {
      // Volatility risk
      const volatilityRisk = Math.abs(marketData.priceChange24h) / 100;
      
      // Volume risk (low volume = high risk)
      const volumeRisk = Math.max(0, 1 - marketData.volume24h.div(1000000).toNumber());
      
      return Math.min(1, (volatilityRisk + volumeRisk) / 2);
    } catch (error) {
      logger.error('Error calculating market risk', error);
      return 0.3; // Default moderate risk
    }
  }

  private async calculateLiquidityRisk(
    transaction: SwapTransaction,
    marketData: MarketData
  ): Promise<number> {
    try {
      // Liquidity depth risk
      const liquidityRatio = transaction.amountIn.div(marketData.liquidity);
      const liquidityRisk = Math.min(1, liquidityRatio.mul(10).toNumber()); // 10x multiplier
      
      return liquidityRisk;
    } catch (error) {
      logger.error('Error calculating liquidity risk', error);
      return 0.2; // Default low risk
    }
  }

  private async calculateCompetitionRisk(transaction: SwapTransaction): Promise<number> {
    try {
      // MEV competition risk based on transaction attractiveness
      const profitPotential = transaction.amountIn.mul(transaction.slippageTolerance);
      
      // Higher profit potential = higher competition
      const competitionRisk = Math.min(1, profitPotential.div(100000).toNumber()); // Normalize
      
      return competitionRisk;
    } catch (error) {
      logger.error('Error calculating competition risk', error);
      return 0.4; // Default moderate-high risk
    }
  }

  private async getMarketData(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<MarketData> {
    try {
      const cacheKey = `${tokenIn.mint.toString()}_${tokenOut.mint.toString()}`;
      const cached = this.priceCache.get(cacheKey);
      
      if (cached && Date.now() - cached.lastUpdated < 10000) { // 10 second cache
        return cached;
      }
      
      // Fetch fresh market data
      const marketData = await this.fetchMarketData(tokenIn, tokenOut);
      this.priceCache.set(cacheKey, marketData);
      
      return marketData;
    } catch (error) {
      logger.error('Error getting market data', error);
      // Return default market data
      return {
        price: new Big('100'),
        volume24h: new Big('1000000'),
        liquidity: new Big('5000000'),
        priceChange24h: 0,
        lastUpdated: Date.now()
      };
    }
  }

  private async fetchMarketData(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<MarketData> {
    // This would integrate with price APIs like CoinGecko, Jupiter, etc.
    // For now, return mock data
    return {
      price: new Big('100'),
      volume24h: new Big('1000000'),
      liquidity: new Big('5000000'),
      priceChange24h: Math.random() * 20 - 10, // -10% to +10%
      lastUpdated: Date.now()
    };
  }

  private async updatePriceCache(): Promise<void> {
    // Update all cached prices
    const now = Date.now();
    const staleEntries = Array.from(this.priceCache.entries())
      .filter(([_, data]) => now - data.lastUpdated > 30000); // 30 seconds
    
    for (const [key, _] of staleEntries) {
      try {
        // Parse key to get token info
        const [tokenInMint, tokenOutMint] = key.split('_');
        // Fetch updated data (simplified)
        const updatedData = await this.fetchMarketData(
          { mint: new PublicKey(tokenInMint) } as TokenInfo,
          { mint: new PublicKey(tokenOutMint) } as TokenInfo
        );
        this.priceCache.set(key, updatedData);
      } catch (error) {
        logger.debug(`Error updating price cache for ${key}`, error);
      }
    }
  }

  private async getSolPrice(): Promise<Big> {
    try {
      // Fetch SOL price from price API
      // For now, return mock price
      return new Big('100'); // $100 SOL
    } catch (error) {
      logger.error('Error getting SOL price', error);
      return new Big('100');
    }
  }

  private async getTokenPrice(token: TokenInfo): Promise<Big> {
    try {
      // Fetch token price from price API
      // For now, return mock price based on symbol
      if (token.symbol === 'SOL') return new Big('100');
      if (token.symbol === 'USDC') return new Big('1');
      return new Big('10'); // Default price
    } catch (error) {
      logger.error('Error getting token price', error);
      return new Big('1');
    }
  }

  private async getCurrentGasPrice(): Promise<Big> {
    try {
      // Get current gas price from network
      // For now, return default gas price
      return new Big('0.000005'); // 5 micro-lamports per compute unit
    } catch (error) {
      logger.error('Error getting gas price', error);
      return new Big('0.000005');
    }
  }

  async optimizeTradeSize(
    transaction: SwapTransaction,
    maxInvestment: Big,
    minProfitThreshold: Big
  ): Promise<{ frontrunAmount: Big; backrunAmount: Big; expectedProfit: Big }> {
    try {
      logger.info('Optimizing trade size', {
        maxInvestment: maxInvestment.toString(),
        minProfitThreshold: minProfitThreshold.toString()
      });

      let bestFrontrun = new Big(0);
      let bestBackrun = new Big(0);
      let bestProfit = new Big(0);

      // Binary search for optimal size
      let low = maxInvestment.div(1000); // 0.1% of max
      let high = maxInvestment;

      for (let i = 0; i < 20; i++) { // 20 iterations
        const mid = low.plus(high).div(2);
        
        try {
          const profitCalc = await this.calculateSandwichProfit(
            transaction,
            mid,
            mid, // Assume symmetric for simplicity
            mid.gt(maxInvestment.div(2)) // Use flashloan for large amounts
          );

          if (profitCalc.netProfit.gt(bestProfit) && profitCalc.netProfit.gt(minProfitThreshold)) {
            bestProfit = profitCalc.netProfit;
            bestFrontrun = mid;
            bestBackrun = mid;
          }

          if (profitCalc.netProfit.gt(minProfitThreshold)) {
            low = mid;
          } else {
            high = mid;
          }
        } catch (error) {
          high = mid; // Reduce size if calculation fails
        }
      }

      logger.info('Trade size optimization completed', {
        bestFrontrun: bestFrontrun.toString(),
        bestBackrun: bestBackrun.toString(),
        expectedProfit: bestProfit.toString()
      });

      return {
        frontrunAmount: bestFrontrun,
        backrunAmount: bestBackrun,
        expectedProfit: bestProfit
      };
    } catch (error) {
      logger.error('Error optimizing trade size', error);
      throw error;
    }
  }

  getStatus(): any {
    return {
      priceCache: {
        size: this.priceCache.size,
        entries: Array.from(this.priceCache.keys()).slice(0, 5) // First 5 entries
      },
      gasEstimates: Object.fromEntries(this.gasEstimates),
      connectionStats: this.connectionManager.getConnectionStats()
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    logger.info('Price cache cleared');
  }
}

