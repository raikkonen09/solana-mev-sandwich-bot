import { 
  Keypair, 
  Transaction, 
  PublicKey, 
  Connection,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount
} from '@solana/web3.js';
import { BundleTransaction } from '../types';
import { logger } from './logger';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface WalletConfig {
  privateKeyPath: string;
  encryptionKey?: string;
  backupPath?: string;
  autoBackup?: boolean;
}

export interface SigningResult {
  success: boolean;
  signedTransaction?: Transaction | VersionedTransaction;
  error?: string;
  signature?: string;
}

export class WalletManager {
  private wallet: Keypair;
  private config: WalletConfig;
  private encryptionKey?: Buffer;

  constructor(config: WalletConfig) {
    this.config = config;
    
    // Setup encryption if key provided
    if (config.encryptionKey) {
      this.encryptionKey = Buffer.from(config.encryptionKey, 'hex');
    }
    
    // Load wallet
    this.wallet = this.loadWallet();
    
    // Setup auto backup if enabled
    if (config.autoBackup && config.backupPath) {
      this.setupAutoBackup();
    }
    
    logger.info('Wallet manager initialized', {
      address: this.wallet.publicKey.toString(),
      encrypted: !!this.encryptionKey,
      autoBackup: config.autoBackup
    });
  }

  private loadWallet(): Keypair {
    try {
      if (!fs.existsSync(this.config.privateKeyPath)) {
        throw new Error(`Private key file not found: ${this.config.privateKeyPath}`);
      }

      let privateKeyData = fs.readFileSync(this.config.privateKeyPath, 'utf8');
      
      // Decrypt if encryption key is provided
      if (this.encryptionKey) {
        privateKeyData = this.decrypt(privateKeyData);
      }

      const privateKeyArray = JSON.parse(privateKeyData);
      
      if (!Array.isArray(privateKeyArray) || privateKeyArray.length !== 64) {
        throw new Error('Invalid private key format');
      }

      const keypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
      
      logger.info('Wallet loaded successfully', {
        address: keypair.publicKey.toString()
      });

      return keypair;
    } catch (error) {
      logger.error('Failed to load wallet', error);
      throw new Error(`Failed to load wallet: ${error.message}`);
    }
  }

  private encrypt(data: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not provided');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', this.encryptionKey);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  private decrypt(encryptedData: string): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not provided');
    }

    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      // Data might not be encrypted, try parsing directly
      return encryptedData;
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipher('aes-256-cbc', this.encryptionKey);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  private setupAutoBackup(): void {
    if (!this.config.backupPath) return;

    // Create backup directory if it doesn't exist
    const backupDir = path.dirname(this.config.backupPath);
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Create initial backup
    this.createBackup();

    // Setup periodic backups (daily)
    setInterval(() => {
      try {
        this.createBackup();
      } catch (error) {
        logger.error('Auto backup failed', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  private createBackup(): void {
    try {
      if (!this.config.backupPath) return;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `wallet-backup-${timestamp}.json`;
      const backupPath = path.join(path.dirname(this.config.backupPath), backupFileName);

      // Read original wallet file
      const walletData = fs.readFileSync(this.config.privateKeyPath, 'utf8');
      
      // Create backup with metadata
      const backupData = {
        timestamp: new Date().toISOString(),
        address: this.wallet.publicKey.toString(),
        encrypted: !!this.encryptionKey,
        data: walletData
      };

      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
      
      logger.info('Wallet backup created', {
        backupPath,
        address: this.wallet.publicKey.toString()
      });

      // Clean up old backups (keep last 30)
      this.cleanupOldBackups();
    } catch (error) {
      logger.error('Failed to create wallet backup', error);
    }
  }

  private cleanupOldBackups(): void {
    try {
      if (!this.config.backupPath) return;

      const backupDir = path.dirname(this.config.backupPath);
      const files = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('wallet-backup-') && file.endsWith('.json'))
        .map(file => ({
          name: file,
          path: path.join(backupDir, file),
          stat: fs.statSync(path.join(backupDir, file))
        }))
        .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());

      // Keep only the latest 30 backups
      const filesToDelete = files.slice(30);
      
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        logger.debug('Old backup deleted', { file: file.name });
      }

      if (filesToDelete.length > 0) {
        logger.info('Cleaned up old backups', { deleted: filesToDelete.length });
      }
    } catch (error) {
      logger.error('Failed to cleanup old backups', error);
    }
  }

  async signTransaction(transaction: Transaction): Promise<SigningResult> {
    try {
      logger.debug('Signing transaction', {
        instructionCount: transaction.instructions.length,
        feePayer: transaction.feePayer?.toString()
      });

      // Validate transaction before signing
      const validation = await this.validateTransaction(transaction);
      if (!validation.valid) {
        return {
          success: false,
          error: `Transaction validation failed: ${validation.error}`
        };
      }

      // Set fee payer if not set
      if (!transaction.feePayer) {
        transaction.feePayer = this.wallet.publicKey;
      }

      // Sign the transaction
      transaction.sign(this.wallet);

      // Verify signature
      const isValid = transaction.verifySignatures();
      if (!isValid) {
        return {
          success: false,
          error: 'Transaction signature verification failed'
        };
      }

      logger.debug('Transaction signed successfully', {
        signature: transaction.signature?.toString('hex').slice(0, 16) + '...'
      });

      return {
        success: true,
        signedTransaction: transaction,
        signature: transaction.signature?.toString('hex')
      };
    } catch (error) {
      logger.error('Failed to sign transaction', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async signVersionedTransaction(transaction: VersionedTransaction): Promise<SigningResult> {
    try {
      logger.debug('Signing versioned transaction');

      // Sign the versioned transaction
      transaction.sign([this.wallet]);

      logger.debug('Versioned transaction signed successfully');

      return {
        success: true,
        signedTransaction: transaction
      };
    } catch (error) {
      logger.error('Failed to sign versioned transaction', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async signBundleTransactions(bundleTransactions: BundleTransaction[]): Promise<BundleTransaction[]> {
    try {
      logger.info('Signing bundle transactions', {
        count: bundleTransactions.length
      });

      const signedBundle: BundleTransaction[] = [];

      for (const bundleTx of bundleTransactions) {
        const signingResult = await this.signTransaction(bundleTx.transaction);
        
        if (!signingResult.success) {
          throw new Error(`Failed to sign ${bundleTx.type} transaction: ${signingResult.error}`);
        }

        signedBundle.push({
          ...bundleTx,
          transaction: signingResult.signedTransaction as Transaction
        });

        logger.debug('Bundle transaction signed', {
          type: bundleTx.type,
          signature: signingResult.signature?.slice(0, 16) + '...'
        });
      }

      logger.info('All bundle transactions signed successfully', {
        count: signedBundle.length
      });

      return signedBundle;
    } catch (error) {
      logger.error('Failed to sign bundle transactions', error);
      throw error;
    }
  }

  private async validateTransaction(transaction: Transaction): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check if transaction has instructions
      if (!transaction.instructions || transaction.instructions.length === 0) {
        return { valid: false, error: 'Transaction has no instructions' };
      }

      // Check if fee payer is set or can be set
      if (!transaction.feePayer && !this.wallet.publicKey) {
        return { valid: false, error: 'No fee payer specified' };
      }

      // Check if recent blockhash is set
      if (!transaction.recentBlockhash) {
        return { valid: false, error: 'No recent blockhash set' };
      }

      // Validate instruction accounts
      for (let i = 0; i < transaction.instructions.length; i++) {
        const instruction = transaction.instructions[i];
        
        if (!instruction.programId) {
          return { valid: false, error: `Instruction ${i} has no program ID` };
        }

        if (!instruction.keys) {
          return { valid: false, error: `Instruction ${i} has no account keys` };
        }
      }

      // Check transaction size
      const serialized = transaction.serialize({ requireAllSignatures: false });
      if (serialized.length > 1232) { // Solana transaction size limit
        return { valid: false, error: 'Transaction too large' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async createVersionedTransaction(
    instructions: any[],
    connection: Connection,
    lookupTables?: AddressLookupTableAccount[]
  ): Promise<VersionedTransaction> {
    try {
      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();

      // Create transaction message
      const messageV0 = new TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: blockhash,
        instructions
      }).compileToV0Message(lookupTables);

      // Create versioned transaction
      const transaction = new VersionedTransaction(messageV0);

      logger.debug('Versioned transaction created', {
        instructionCount: instructions.length,
        lookupTables: lookupTables?.length || 0
      });

      return transaction;
    } catch (error) {
      logger.error('Failed to create versioned transaction', error);
      throw error;
    }
  }

  async estimateTransactionFee(
    transaction: Transaction,
    connection: Connection
  ): Promise<number> {
    try {
      // Simulate transaction to get fee estimate
      const simulation = await connection.simulateTransaction(transaction, {
        commitment: 'confirmed',
        sigVerify: false
      });

      if (simulation.value.err) {
        throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}`);
      }

      // Base fee (5000 lamports) + compute unit fee
      const baseFee = 5000;
      const computeUnits = simulation.value.unitsConsumed || 200000;
      const computeFee = computeUnits * 0.000001; // Micro-lamports per compute unit

      const totalFee = baseFee + computeFee;

      logger.debug('Transaction fee estimated', {
        baseFee,
        computeUnits,
        computeFee,
        totalFee
      });

      return totalFee;
    } catch (error) {
      logger.error('Failed to estimate transaction fee', error);
      return 10000; // Default fallback fee
    }
  }

  getPublicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  getAddress(): string {
    return this.wallet.publicKey.toString();
  }

  async getBalance(connection: Connection): Promise<number> {
    try {
      const balance = await connection.getBalance(this.wallet.publicKey);
      
      logger.debug('Wallet balance retrieved', {
        address: this.wallet.publicKey.toString(),
        balance,
        sol: balance / 1e9
      });

      return balance;
    } catch (error) {
      logger.error('Failed to get wallet balance', error);
      throw error;
    }
  }

  async getTokenBalance(
    connection: Connection,
    tokenMint: PublicKey
  ): Promise<number> {
    try {
      // Get associated token account
      const { getAssociatedTokenAddress } = await import('@solana/spl-token');
      const tokenAccount = await getAssociatedTokenAddress(
        tokenMint,
        this.wallet.publicKey
      );

      // Get token balance
      const balance = await connection.getTokenAccountBalance(tokenAccount);
      
      logger.debug('Token balance retrieved', {
        address: this.wallet.publicKey.toString(),
        tokenMint: tokenMint.toString(),
        balance: balance.value.amount
      });

      return parseInt(balance.value.amount);
    } catch (error) {
      logger.debug('Failed to get token balance (account may not exist)', {
        tokenMint: tokenMint.toString(),
        error: error.message
      });
      return 0;
    }
  }

  async hasMinimumBalance(
    connection: Connection,
    minimumSol: number
  ): Promise<boolean> {
    try {
      const balance = await this.getBalance(connection);
      const minimumLamports = minimumSol * 1e9;
      
      const hasMinimum = balance >= minimumLamports;
      
      logger.debug('Minimum balance check', {
        currentBalance: balance,
        minimumRequired: minimumLamports,
        hasMinimum
      });

      return hasMinimum;
    } catch (error) {
      logger.error('Failed to check minimum balance', error);
      return false;
    }
  }

  exportWallet(outputPath: string, encrypt: boolean = true): void {
    try {
      const walletData = Array.from(this.wallet.secretKey);
      let dataToWrite = JSON.stringify(walletData, null, 2);

      if (encrypt && this.encryptionKey) {
        dataToWrite = this.encrypt(dataToWrite);
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(outputPath, dataToWrite);

      logger.info('Wallet exported', {
        outputPath,
        encrypted: encrypt && !!this.encryptionKey,
        address: this.wallet.publicKey.toString()
      });
    } catch (error) {
      logger.error('Failed to export wallet', error);
      throw error;
    }
  }

  static generateNewWallet(): Keypair {
    const newWallet = Keypair.generate();
    
    logger.info('New wallet generated', {
      address: newWallet.publicKey.toString()
    });

    return newWallet;
  }

  static saveWallet(
    wallet: Keypair,
    filePath: string,
    encryptionKey?: string
  ): void {
    try {
      const walletData = Array.from(wallet.secretKey);
      let dataToWrite = JSON.stringify(walletData, null, 2);

      if (encryptionKey) {
        const key = Buffer.from(encryptionKey, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher('aes-256-cbc', key);
        
        let encrypted = cipher.update(dataToWrite, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        dataToWrite = iv.toString('hex') + ':' + encrypted;
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, dataToWrite);

      logger.info('Wallet saved', {
        filePath,
        encrypted: !!encryptionKey,
        address: wallet.publicKey.toString()
      });
    } catch (error) {
      logger.error('Failed to save wallet', error);
      throw error;
    }
  }

  getStatus(): any {
    return {
      address: this.wallet.publicKey.toString(),
      encrypted: !!this.encryptionKey,
      autoBackup: this.config.autoBackup,
      backupPath: this.config.backupPath,
      privateKeyPath: this.config.privateKeyPath
    };
  }
}

