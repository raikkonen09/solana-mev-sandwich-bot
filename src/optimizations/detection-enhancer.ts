/**
 * Detection Enhancement Module
 * Improves sandwich opportunity detection based on real transaction patterns
 */

import { Connection, PublicKey } from '@solana/web3.js';

export interface EnhancedOpportunity {
  signature: string;
  dex: string;
  tokenA: string;
  tokenB: string;
  amountIn: number;
  estimatedSlippage: number;
  confidence: number;
  profitPotential: 'very_high' | 'high' | 'medium' | 'low';
  riskLevel: 'low' | 'medium' | 'high';
  timeWindow: number; // milliseconds to execute
}

export interface DEXPattern {
  programId: string;
  swapInstructionPattern: string[];
  logPatterns: string[];
  accountPatterns: string[];
}

export class DetectionEnhancer {
  private dexPatterns: Map<string, DEXPattern> = new Map();
  private historicalData: Map<string, number[]> = new Map(); // Track slippage patterns
  private confidenceThreshold = 0.7;

  constructor() {
    this.initializeDEXPatterns();
  }

  private initializeDEXPatterns(): void {
    // Raydium patterns
    this.dexPatterns.set('raydium', {
      programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      swapInstructionPattern: ['Instruction: Swap', 'ray_log'],
      logPatterns: [
        'Program log: Instruction: Swap',
        'Program log: ray_log',
        'Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke',
        'Program log: SwapBaseIn',
        'Program log: SwapBaseOut'
      ],
      accountPatterns: ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8']
    });

    // Orca patterns
    this.dexPatterns.set('orca', {
      programId: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
      swapInstructionPattern: ['Instruction: Swap', 'whirlpool'],
      logPatterns: [
        'Program log: Instruction: Swap',
        'Program whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc invoke',
        'Program log: whirlpool',
        'Program log: Instruction: TwoHopSwap'
      ],
      accountPatterns: ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc']
    });

    // Jupiter patterns
    this.dexPatterns.set('jupiter', {
      programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
      swapInstructionPattern: ['Instruction: Route', 'jupiter'],
      logPatterns: [
        'Program log: Instruction: Route',
        'Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke',
        'Program log: jupiter'
      ],
      accountPatterns: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']
    });

    // Serum patterns
    this.dexPatterns.set('serum', {
      programId: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      swapInstructionPattern: ['Instruction: NewOrder', 'serum'],
      logPatterns: [
        'Program log: Instruction: NewOrder',
        'Program 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin invoke',
        'Program log: serum'
      ],
      accountPatterns: ['9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin']
    });
  }

  analyzeTransactionForEnhancedDetection(
    signature: string,
    logMessages: string[],
    fee: number,
    accounts: string[],
    blockTime: number
  ): EnhancedOpportunity | null {
    
    // Step 1: Identify DEX
    const detectedDEX = this.identifyDEX(logMessages, accounts);
    if (!detectedDEX) return null;

    // Step 2: Extract swap details
    const swapDetails = this.extractSwapDetails(logMessages, fee, detectedDEX);
    if (!swapDetails) return null;

    // Step 3: Calculate confidence score
    const confidence = this.calculateConfidence(logMessages, swapDetails, detectedDEX);
    if (confidence < this.confidenceThreshold) return null;

    // Step 4: Estimate profit potential
    const profitPotential = this.estimateProfitPotential(swapDetails.estimatedSlippage, swapDetails.amountIn);

    // Step 5: Assess risk level
    const riskLevel = this.assessRiskLevel(swapDetails.estimatedSlippage, swapDetails.amountIn, confidence);

    // Step 6: Calculate execution time window
    const timeWindow = this.calculateTimeWindow(detectedDEX, swapDetails.amountIn);

    return {
      signature,
      dex: detectedDEX,
      tokenA: swapDetails.tokenA,
      tokenB: swapDetails.tokenB,
      amountIn: swapDetails.amountIn,
      estimatedSlippage: swapDetails.estimatedSlippage,
      confidence,
      profitPotential,
      riskLevel,
      timeWindow
    };
  }

  private identifyDEX(logMessages: string[], accounts: string[]): string | null {
    let bestMatch = '';
    let highestScore = 0;

    for (const [dexName, pattern] of this.dexPatterns.entries()) {
      let score = 0;

      // Check log patterns
      for (const logPattern of pattern.logPatterns) {
        if (logMessages.some(log => log.includes(logPattern))) {
          score += 2;
        }
      }

      // Check account patterns
      for (const accountPattern of pattern.accountPatterns) {
        if (accounts.some(account => account === accountPattern)) {
          score += 3;
        }
      }

      // Check program ID in logs
      if (logMessages.some(log => log.includes(pattern.programId))) {
        score += 5;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = dexName;
      }
    }

    return highestScore >= 3 ? bestMatch : null;
  }

  private extractSwapDetails(logMessages: string[], fee: number, dex: string): {
    tokenA: string;
    tokenB: string;
    amountIn: number;
    estimatedSlippage: number;
  } | null {
    
    // Enhanced heuristics based on real transaction analysis
    let amountIn = 0;
    let estimatedSlippage = 0;

    // Analyze fee to estimate transaction size
    if (fee > 100000) { // High fee transactions
      amountIn = Math.max(1, fee / 10000); // Larger swaps
      estimatedSlippage = Math.min(0.25, fee / 500000); // Higher slippage for larger amounts
    } else if (fee > 50000) { // Medium fee transactions
      amountIn = Math.max(0.5, fee / 20000);
      estimatedSlippage = Math.min(0.15, fee / 300000);
    } else { // Low fee transactions
      amountIn = Math.max(0.1, fee / 50000);
      estimatedSlippage = Math.min(0.05, fee / 100000);
    }

    // DEX-specific adjustments
    switch (dex) {
      case 'raydium':
        estimatedSlippage *= 1.2; // Raydium tends to have higher slippage
        break;
      case 'orca':
        estimatedSlippage *= 0.9; // Orca is more efficient
        break;
      case 'jupiter':
        estimatedSlippage *= 1.5; // Jupiter aggregates, higher slippage
        break;
    }

    // Look for specific token patterns in logs
    const tokenA = this.extractTokenFromLogs(logMessages, 0) || 'So11111111111111111111111111111111111111112'; // Default to SOL
    const tokenB = this.extractTokenFromLogs(logMessages, 1) || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // Default to USDC

    return {
      tokenA,
      tokenB,
      amountIn,
      estimatedSlippage: Math.max(0.001, estimatedSlippage) // Minimum 0.1% slippage
    };
  }

  private extractTokenFromLogs(logMessages: string[], index: number): string | null {
    // Look for token addresses in logs
    const tokenPattern = /[A-Za-z0-9]{32,44}/g;
    const potentialTokens: string[] = [];

    for (const log of logMessages) {
      const matches = log.match(tokenPattern);
      if (matches) {
        potentialTokens.push(...matches);
      }
    }

    // Return the token at the specified index, or null if not found
    return potentialTokens[index] || null;
  }

  private calculateConfidence(logMessages: string[], swapDetails: any, dex: string): number {
    let confidence = 0.5; // Base confidence

    const pattern = this.dexPatterns.get(dex);
    if (!pattern) return 0;

    // Increase confidence based on pattern matches
    let patternMatches = 0;
    for (const logPattern of pattern.logPatterns) {
      if (logMessages.some(log => log.includes(logPattern))) {
        patternMatches++;
      }
    }

    confidence += (patternMatches / pattern.logPatterns.length) * 0.3;

    // Increase confidence based on swap amount (larger swaps are more likely to be profitable)
    if (swapDetails.amountIn > 10) confidence += 0.1;
    if (swapDetails.amountIn > 100) confidence += 0.1;

    // Increase confidence based on estimated slippage
    if (swapDetails.estimatedSlippage > 0.05) confidence += 0.1;
    if (swapDetails.estimatedSlippage > 0.1) confidence += 0.1;

    return Math.min(1, confidence);
  }

  private estimateProfitPotential(slippage: number, amountIn: number): 'very_high' | 'high' | 'medium' | 'low' {
    const potentialProfit = amountIn * slippage * 0.6; // Assume we capture 60% of slippage

    if (potentialProfit > 1) return 'very_high';
    if (potentialProfit > 0.1) return 'high';
    if (potentialProfit > 0.02) return 'medium';
    return 'low';
  }

  private assessRiskLevel(slippage: number, amountIn: number, confidence: number): 'low' | 'medium' | 'high' {
    let riskScore = 0;

    // Higher slippage = higher risk
    if (slippage > 0.2) riskScore += 2;
    else if (slippage > 0.1) riskScore += 1;

    // Larger amounts = higher risk
    if (amountIn > 100) riskScore += 2;
    else if (amountIn > 10) riskScore += 1;

    // Lower confidence = higher risk
    if (confidence < 0.8) riskScore += 1;
    if (confidence < 0.6) riskScore += 1;

    if (riskScore >= 4) return 'high';
    if (riskScore >= 2) return 'medium';
    return 'low';
  }

  private calculateTimeWindow(dex: string, amountIn: number): number {
    // Base time window in milliseconds
    let baseWindow = 2000; // 2 seconds

    // DEX-specific adjustments
    switch (dex) {
      case 'raydium':
        baseWindow = 1500; // Faster execution needed
        break;
      case 'orca':
        baseWindow = 2000; // Standard
        break;
      case 'jupiter':
        baseWindow = 3000; // More complex routing, need more time
        break;
    }

    // Larger amounts need faster execution
    if (amountIn > 100) baseWindow *= 0.7;
    else if (amountIn > 10) baseWindow *= 0.8;

    return Math.max(500, baseWindow); // Minimum 500ms
  }

  // Machine learning-like pattern recognition
  updateHistoricalData(dex: string, actualSlippage: number): void {
    if (!this.historicalData.has(dex)) {
      this.historicalData.set(dex, []);
    }

    const history = this.historicalData.get(dex)!;
    history.push(actualSlippage);

    // Keep only last 1000 data points
    if (history.length > 1000) {
      history.shift();
    }
  }

  getAverageSlippage(dex: string): number {
    const history = this.historicalData.get(dex);
    if (!history || history.length === 0) return 0.05; // Default 5%

    return history.reduce((sum, slippage) => sum + slippage, 0) / history.length;
  }

  // Advanced filtering for high-value opportunities
  filterHighValueOpportunities(opportunities: EnhancedOpportunity[]): EnhancedOpportunity[] {
    return opportunities.filter(op => {
      // Must have high confidence
      if (op.confidence < 0.8) return false;

      // Must have reasonable profit potential
      if (op.profitPotential === 'low') return false;

      // Must not be too risky
      if (op.riskLevel === 'high' && op.profitPotential !== 'very_high') return false;

      // Must have sufficient slippage
      if (op.estimatedSlippage < 0.03) return false; // Minimum 3%

      return true;
    }).sort((a, b) => {
      // Sort by profit potential and confidence
      const scoreA = this.calculateOpportunityScore(a);
      const scoreB = this.calculateOpportunityScore(b);
      return scoreB - scoreA;
    });
  }

  private calculateOpportunityScore(opportunity: EnhancedOpportunity): number {
    let score = 0;

    // Profit potential scoring
    switch (opportunity.profitPotential) {
      case 'very_high': score += 40; break;
      case 'high': score += 30; break;
      case 'medium': score += 20; break;
      case 'low': score += 10; break;
    }

    // Confidence scoring
    score += opportunity.confidence * 30;

    // Risk penalty
    switch (opportunity.riskLevel) {
      case 'low': score += 10; break;
      case 'medium': score += 0; break;
      case 'high': score -= 10; break;
    }

    // Slippage bonus
    score += Math.min(20, opportunity.estimatedSlippage * 100);

    return score;
  }

  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0.1, Math.min(1, threshold));
  }

  getDetectionStats(): {
    totalPatterns: number;
    historicalDataPoints: number;
    averageConfidence: number;
  } {
    const totalDataPoints = Array.from(this.historicalData.values())
      .reduce((sum, data) => sum + data.length, 0);

    return {
      totalPatterns: this.dexPatterns.size,
      historicalDataPoints: totalDataPoints,
      averageConfidence: this.confidenceThreshold
    };
  }
}

