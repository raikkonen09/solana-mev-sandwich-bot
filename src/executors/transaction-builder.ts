import { 
  Connection, 
  Transaction, 
  TransactionInstruction, 
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { TokenInfo, DEXType } from '../types';
import { logger } from '../utils/logger';
import Big from 'big.js';

export class TransactionBuilder {
  // DEX Program IDs
  private readonly RAYDIUM_AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
  private readonly ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
  private readonly PHOENIX_PROGRAM_ID = new PublicKey('PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY');

  constructor() {}

  async createSwapTransaction(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    dex: DEXType,
    userPublicKey: PublicKey,
    slippageTolerance: number
  ): Promise<Transaction> {
    try {
      logger.debug('Creating swap transaction', {
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        amountIn: amountIn.toString(),
        dex,
        slippageTolerance
      });

      const transaction = new Transaction();

      // Create swap instruction based on DEX
      const swapInstruction = await this.createSwapInstruction(
        tokenIn,
        tokenOut,
        amountIn,
        dex,
        userPublicKey,
        slippageTolerance
      );

      transaction.add(swapInstruction);

      // Add compute budget instruction for complex swaps
      if (dex === DEXType.ORCA) {
        const computeBudgetInstruction = await this.createComputeBudgetInstruction(400000);
        transaction.add(computeBudgetInstruction);
      }

      logger.debug('Swap transaction created', {
        instructionCount: transaction.instructions.length
      });

      return transaction;
    } catch (error) {
      logger.error('Error creating swap transaction', error);
      throw error;
    }
  }

  async createSwapInstruction(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    dex: DEXType,
    userPublicKey: PublicKey,
    slippageTolerance: number
  ): Promise<TransactionInstruction> {
    try {
      switch (dex) {
        case DEXType.RAYDIUM:
          return await this.createRaydiumSwapInstruction(
            tokenIn, tokenOut, amountIn, userPublicKey, slippageTolerance
          );
        case DEXType.ORCA:
          return await this.createOrcaSwapInstruction(
            tokenIn, tokenOut, amountIn, userPublicKey, slippageTolerance
          );
        case DEXType.PHOENIX:
          return await this.createPhoenixSwapInstruction(
            tokenIn, tokenOut, amountIn, userPublicKey, slippageTolerance
          );
        default:
          throw new Error(`Unsupported DEX: ${dex}`);
      }
    } catch (error) {
      logger.error('Error creating swap instruction', error);
      throw error;
    }
  }

  private async createRaydiumSwapInstruction(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    userPublicKey: PublicKey,
    slippageTolerance: number
  ): Promise<TransactionInstruction> {
    try {
      // Calculate minimum amount out based on slippage tolerance
      const minimumAmountOut = await this.calculateMinimumAmountOut(
        tokenIn, tokenOut, amountIn, slippageTolerance
      );

      // Find Raydium pool for this token pair
      const poolAddress = await this.findRaydiumPool(tokenIn, tokenOut);

      // Create Raydium swap instruction
      const instruction = new TransactionInstruction({
        keys: [
          // Token program
          { pubkey: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), isSigner: false, isWritable: false },
          // AMM ID
          { pubkey: poolAddress, isSigner: false, isWritable: true },
          // AMM authority
          { pubkey: await this.deriveRaydiumAuthority(poolAddress), isSigner: false, isWritable: false },
          // AMM open orders
          { pubkey: await this.deriveRaydiumOpenOrders(poolAddress), isSigner: false, isWritable: true },
          // AMM target orders
          { pubkey: await this.deriveRaydiumTargetOrders(poolAddress), isSigner: false, isWritable: true },
          // Pool coin token account
          { pubkey: await this.deriveRaydiumCoinVault(poolAddress), isSigner: false, isWritable: true },
          // Pool pc token account
          { pubkey: await this.deriveRaydiumPcVault(poolAddress), isSigner: false, isWritable: true },
          // Serum program ID
          { pubkey: new PublicKey('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'), isSigner: false, isWritable: false },
          // Serum market
          { pubkey: await this.deriveRaydiumSerumMarket(poolAddress), isSigner: false, isWritable: true },
          // Serum bids
          { pubkey: await this.deriveSerumBids(poolAddress), isSigner: false, isWritable: true },
          // Serum asks
          { pubkey: await this.deriveSerumAsks(poolAddress), isSigner: false, isWritable: true },
          // Serum event queue
          { pubkey: await this.deriveSerumEventQueue(poolAddress), isSigner: false, isWritable: true },
          // Serum coin vault
          { pubkey: await this.deriveSerumCoinVault(poolAddress), isSigner: false, isWritable: true },
          // Serum pc vault
          { pubkey: await this.deriveSerumPcVault(poolAddress), isSigner: false, isWritable: true },
          // Serum vault signer
          { pubkey: await this.deriveSerumVaultSigner(poolAddress), isSigner: false, isWritable: false },
          // User source token account
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenIn.mint), isSigner: false, isWritable: true },
          // User destination token account
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenOut.mint), isSigner: false, isWritable: true },
          // User wallet
          { pubkey: userPublicKey, isSigner: true, isWritable: false }
        ],
        programId: this.RAYDIUM_AMM_PROGRAM_ID,
        data: this.encodeRaydiumSwapData(amountIn, minimumAmountOut)
      });

      logger.debug('Raydium swap instruction created', {
        poolAddress: poolAddress.toString(),
        amountIn: amountIn.toString(),
        minimumAmountOut: minimumAmountOut.toString()
      });

      return instruction;
    } catch (error) {
      logger.error('Error creating Raydium swap instruction', error);
      throw error;
    }
  }

  private async createOrcaSwapInstruction(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    userPublicKey: PublicKey,
    slippageTolerance: number
  ): Promise<TransactionInstruction> {
    try {
      // Calculate minimum amount out
      const minimumAmountOut = await this.calculateMinimumAmountOut(
        tokenIn, tokenOut, amountIn, slippageTolerance
      );

      // Find Orca whirlpool for this token pair
      const whirlpoolAddress = await this.findOrcaWhirlpool(tokenIn, tokenOut);

      // Create Orca swap instruction
      const instruction = new TransactionInstruction({
        keys: [
          // Token program
          { pubkey: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), isSigner: false, isWritable: false },
          // Token program 2022 (if needed)
          { pubkey: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'), isSigner: false, isWritable: false },
          // Memo program
          { pubkey: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), isSigner: false, isWritable: false },
          // Whirlpool
          { pubkey: whirlpoolAddress, isSigner: false, isWritable: true },
          // User token account A
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenIn.mint), isSigner: false, isWritable: true },
          // User token account B
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenOut.mint), isSigner: false, isWritable: true },
          // Token vault A
          { pubkey: await this.deriveOrcaTokenVaultA(whirlpoolAddress), isSigner: false, isWritable: true },
          // Token vault B
          { pubkey: await this.deriveOrcaTokenVaultB(whirlpoolAddress), isSigner: false, isWritable: true },
          // Tick array 0
          { pubkey: await this.deriveOrcaTickArray(whirlpoolAddress, 0), isSigner: false, isWritable: true },
          // Tick array 1
          { pubkey: await this.deriveOrcaTickArray(whirlpoolAddress, 1), isSigner: false, isWritable: true },
          // Tick array 2
          { pubkey: await this.deriveOrcaTickArray(whirlpoolAddress, 2), isSigner: false, isWritable: true },
          // Oracle
          { pubkey: await this.deriveOrcaOracle(whirlpoolAddress), isSigner: false, isWritable: false },
          // User wallet
          { pubkey: userPublicKey, isSigner: true, isWritable: false }
        ],
        programId: this.ORCA_WHIRLPOOL_PROGRAM_ID,
        data: this.encodeOrcaSwapData(amountIn, minimumAmountOut, tokenIn.mint.equals(tokenIn.mint))
      });

      logger.debug('Orca swap instruction created', {
        whirlpoolAddress: whirlpoolAddress.toString(),
        amountIn: amountIn.toString(),
        minimumAmountOut: minimumAmountOut.toString()
      });

      return instruction;
    } catch (error) {
      logger.error('Error creating Orca swap instruction', error);
      throw error;
    }
  }

  private async createPhoenixSwapInstruction(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    userPublicKey: PublicKey,
    slippageTolerance: number
  ): Promise<TransactionInstruction> {
    try {
      // Calculate minimum amount out
      const minimumAmountOut = await this.calculateMinimumAmountOut(
        tokenIn, tokenOut, amountIn, slippageTolerance
      );

      // Find Phoenix market for this token pair
      const marketAddress = await this.findPhoenixMarket(tokenIn, tokenOut);

      // Create Phoenix swap instruction
      const instruction = new TransactionInstruction({
        keys: [
          // Phoenix program
          { pubkey: this.PHOENIX_PROGRAM_ID, isSigner: false, isWritable: false },
          // Log authority
          { pubkey: await this.derivePhoenixLogAuthority(), isSigner: false, isWritable: false },
          // Market
          { pubkey: marketAddress, isSigner: false, isWritable: true },
          // User
          { pubkey: userPublicKey, isSigner: true, isWritable: false },
          // Base account
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenIn.mint), isSigner: false, isWritable: true },
          // Quote account
          { pubkey: await this.deriveUserTokenAccount(userPublicKey, tokenOut.mint), isSigner: false, isWritable: true },
          // Base vault
          { pubkey: await this.derivePhoenixBaseVault(marketAddress), isSigner: false, isWritable: true },
          // Quote vault
          { pubkey: await this.derivePhoenixQuoteVault(marketAddress), isSigner: false, isWritable: true },
          // Token program
          { pubkey: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), isSigner: false, isWritable: false }
        ],
        programId: this.PHOENIX_PROGRAM_ID,
        data: this.encodePhoenixSwapData(amountIn, minimumAmountOut)
      });

      logger.debug('Phoenix swap instruction created', {
        marketAddress: marketAddress.toString(),
        amountIn: amountIn.toString(),
        minimumAmountOut: minimumAmountOut.toString()
      });

      return instruction;
    } catch (error) {
      logger.error('Error creating Phoenix swap instruction', error);
      throw error;
    }
  }

  private async calculateMinimumAmountOut(
    tokenIn: TokenInfo,
    tokenOut: TokenInfo,
    amountIn: Big,
    slippageTolerance: number
  ): Promise<Big> {
    try {
      // This would integrate with price oracles or DEX APIs to get current price
      // For now, use a simplified calculation
      const exchangeRate = await this.getExchangeRate(tokenIn, tokenOut);
      const expectedAmountOut = amountIn.mul(exchangeRate);
      const minimumAmountOut = expectedAmountOut.mul(1 - slippageTolerance);

      logger.debug('Calculated minimum amount out', {
        amountIn: amountIn.toString(),
        exchangeRate: exchangeRate.toString(),
        expectedAmountOut: expectedAmountOut.toString(),
        minimumAmountOut: minimumAmountOut.toString(),
        slippageTolerance
      });

      return minimumAmountOut;
    } catch (error) {
      logger.error('Error calculating minimum amount out', error);
      // Return a conservative estimate
      return amountIn.mul(0.95); // 5% slippage fallback
    }
  }

  private async getExchangeRate(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<Big> {
    // This would fetch real exchange rates from price oracles
    // For now, return placeholder rates
    if (tokenIn.symbol === 'SOL' && tokenOut.symbol === 'USDC') {
      return new Big('100'); // 1 SOL = 100 USDC
    } else if (tokenIn.symbol === 'USDC' && tokenOut.symbol === 'SOL') {
      return new Big('0.01'); // 1 USDC = 0.01 SOL
    }
    return new Big('1'); // 1:1 fallback
  }

  // Raydium helper methods
  private async findRaydiumPool(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<PublicKey> {
    // This would query Raydium's pool registry
    // For now, return a placeholder pool address
    return new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2');
  }

  private async deriveRaydiumAuthority(poolAddress: PublicKey): Promise<PublicKey> {
    const [authority] = await PublicKey.findProgramAddress(
      [poolAddress.toBuffer()],
      this.RAYDIUM_AMM_PROGRAM_ID
    );
    return authority;
  }

  private async deriveRaydiumOpenOrders(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive open orders account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveRaydiumTargetOrders(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive target orders account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveRaydiumCoinVault(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive coin vault account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveRaydiumPcVault(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive PC vault account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveRaydiumSerumMarket(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum market account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumBids(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum bids account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumAsks(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum asks account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumEventQueue(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum event queue account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumCoinVault(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum coin vault account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumPcVault(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum PC vault account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveSerumVaultSigner(poolAddress: PublicKey): Promise<PublicKey> {
    // Derive Serum vault signer account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  // Orca helper methods
  private async findOrcaWhirlpool(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<PublicKey> {
    // This would query Orca's whirlpool registry
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveOrcaTokenVaultA(whirlpoolAddress: PublicKey): Promise<PublicKey> {
    // Derive token vault A
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveOrcaTokenVaultB(whirlpoolAddress: PublicKey): Promise<PublicKey> {
    // Derive token vault B
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveOrcaTickArray(whirlpoolAddress: PublicKey, index: number): Promise<PublicKey> {
    // Derive tick array account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async deriveOrcaOracle(whirlpoolAddress: PublicKey): Promise<PublicKey> {
    // Derive oracle account
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  // Phoenix helper methods
  private async findPhoenixMarket(tokenIn: TokenInfo, tokenOut: TokenInfo): Promise<PublicKey> {
    // This would query Phoenix's market registry
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async derivePhoenixLogAuthority(): Promise<PublicKey> {
    // Derive log authority
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async derivePhoenixBaseVault(marketAddress: PublicKey): Promise<PublicKey> {
    // Derive base vault
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  private async derivePhoenixQuoteVault(marketAddress: PublicKey): Promise<PublicKey> {
    // Derive quote vault
    return new PublicKey('11111111111111111111111111111111'); // Placeholder
  }

  // Common helper methods
  private async deriveUserTokenAccount(userPublicKey: PublicKey, mint: PublicKey): Promise<PublicKey> {
    // Derive associated token account
    const [tokenAccount] = await PublicKey.findProgramAddress(
      [
        userPublicKey.toBuffer(),
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
        mint.toBuffer()
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return tokenAccount;
  }

  private async createComputeBudgetInstruction(computeUnits: number): Promise<TransactionInstruction> {
    // Create compute budget instruction
    return new TransactionInstruction({
      keys: [],
      programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
      data: Buffer.from([0, ...this.serializeU32(computeUnits)])
    });
  }

  // Data encoding methods
  private encodeRaydiumSwapData(amountIn: Big, minimumAmountOut: Big): Buffer {
    // Encode Raydium swap instruction data
    const data = Buffer.alloc(17);
    data.writeUInt8(9, 0); // Swap instruction discriminator
    data.writeBigUInt64LE(BigInt(amountIn.toString()), 1);
    data.writeBigUInt64LE(BigInt(minimumAmountOut.toString()), 9);
    return data;
  }

  private encodeOrcaSwapData(amountIn: Big, minimumAmountOut: Big, aToB: boolean): Buffer {
    // Encode Orca swap instruction data
    const data = Buffer.alloc(25);
    data.writeUInt8(162, 0); // Swap instruction discriminator
    data.writeBigUInt64LE(BigInt(amountIn.toString()), 1);
    data.writeBigUInt64LE(BigInt(minimumAmountOut.toString()), 9);
    data.writeUInt8(aToB ? 1 : 0, 17);
    return data;
  }

  private encodePhoenixSwapData(amountIn: Big, minimumAmountOut: Big): Buffer {
    // Encode Phoenix swap instruction data
    const data = Buffer.alloc(17);
    data.writeUInt8(1, 0); // Swap instruction discriminator
    data.writeBigUInt64LE(BigInt(amountIn.toString()), 1);
    data.writeBigUInt64LE(BigInt(minimumAmountOut.toString()), 9);
    return data;
  }

  private serializeU32(value: number): number[] {
    const bytes: number[] = [];
    bytes.push(value & 0xFF);
    bytes.push((value >> 8) & 0xFF);
    bytes.push((value >> 16) & 0xFF);
    bytes.push((value >> 24) & 0xFF);
    return bytes;
  }
}

