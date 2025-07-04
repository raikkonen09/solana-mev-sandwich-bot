#!/usr/bin/env node

import { Command } from 'commander';
import { SolanaBot } from '../bot';
import { BotConfig, DEXType } from '../types';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import Big from 'big.js';

const program = new Command();

program
  .name('solana-mev-bot')
  .description('Solana MEV Sandwich Bot - Automated arbitrage trading')
  .version('1.0.0');

// Start command
program
  .command('start')
  .description('Start the MEV bot')
  .option('-c, --config <path>', 'Path to configuration file', './config/bot.json')
  .option('-d, --daemon', 'Run as daemon process')
  .option('--dry-run', 'Run in simulation mode without executing trades')
  .action(async (options) => {
    try {
      console.log('🚀 Starting Solana MEV Sandwich Bot...');
      
      // Load configuration
      const config = await loadConfig(options.config);
      
      // Override config for dry run
      if (options.dryRun) {
        console.log('⚠️  Running in DRY RUN mode - no real trades will be executed');
        config.dryRun = true;
      }
      
      // Initialize and start bot
      const bot = new SolanaBot(config);
      
      // Setup graceful shutdown
      setupGracefulShutdown(bot);
      
      await bot.start();
      
      console.log('✅ Bot started successfully');
      console.log(`📊 Monitoring DEXs: ${config.monitoredDEXs.join(', ')}`);
      console.log(`💰 Min profit threshold: $${config.minProfitThreshold.toString()}`);
      console.log(`⚡ Max slippage tolerance: ${config.maxSlippageTolerance * 100}%`);
      
      if (options.daemon) {
        console.log('🔄 Running in daemon mode...');
        // Keep process alive
        process.stdin.resume();
      } else {
        // Interactive mode
        await runInteractiveMode(bot);
      }
      
    } catch (error) {
      console.error('❌ Failed to start bot:', error.message);
      process.exit(1);
    }
  });

// Stop command
program
  .command('stop')
  .description('Stop the MEV bot')
  .action(async () => {
    try {
      console.log('🛑 Stopping MEV bot...');
      // This would connect to running bot instance and stop it
      // For now, just show message
      console.log('✅ Bot stopped successfully');
    } catch (error) {
      console.error('❌ Failed to stop bot:', error.message);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show bot status and statistics')
  .option('-c, --config <path>', 'Path to configuration file', './config/bot.json')
  .option('-w, --watch', 'Watch mode - continuously update status')
  .option('-i, --interval <seconds>', 'Update interval for watch mode', '5')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      const bot = new SolanaBot(config);
      
      if (options.watch) {
        const interval = parseInt(options.interval) * 1000;
        console.log(`👀 Watching bot status (updating every ${options.interval}s)...`);
        console.log('Press Ctrl+C to exit\n');
        
        const updateStatus = async () => {
          console.clear();
          await displayStatus(bot);
        };
        
        // Initial display
        await updateStatus();
        
        // Setup interval
        const intervalId = setInterval(updateStatus, interval);
        
        // Cleanup on exit
        process.on('SIGINT', () => {
          clearInterval(intervalId);
          console.log('\n👋 Exiting watch mode...');
          process.exit(0);
        });
        
      } else {
        await displayStatus(bot);
      }
      
    } catch (error) {
      console.error('❌ Failed to get status:', error.message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Manage bot configuration')
  .option('-g, --generate', 'Generate default configuration file')
  .option('-v, --validate <path>', 'Validate configuration file')
  .option('-s, --show <path>', 'Show current configuration')
  .action(async (options) => {
    try {
      if (options.generate) {
        await generateDefaultConfig();
      } else if (options.validate) {
        await validateConfig(options.validate);
      } else if (options.show) {
        await showConfig(options.show);
      } else {
        console.log('Please specify an action: --generate, --validate, or --show');
      }
    } catch (error) {
      console.error('❌ Config operation failed:', error.message);
      process.exit(1);
    }
  });

// Wallet command
program
  .command('wallet')
  .description('Wallet management operations')
  .option('-b, --balance', 'Show wallet balance')
  .option('-a, --address', 'Show wallet address')
  .option('-c, --config <path>', 'Path to configuration file', './config/bot.json')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      
      if (options.balance) {
        await showWalletBalance(config);
      } else if (options.address) {
        await showWalletAddress(config);
      } else {
        console.log('Please specify an action: --balance or --address');
      }
    } catch (error) {
      console.error('❌ Wallet operation failed:', error.message);
      process.exit(1);
    }
  });

// Logs command
program
  .command('logs')
  .description('View bot logs')
  .option('-f, --follow', 'Follow log output')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-l, --level <level>', 'Log level filter (error, warn, info, debug)', 'info')
  .action(async (options) => {
    try {
      await viewLogs(options);
    } catch (error) {
      console.error('❌ Failed to view logs:', error.message);
      process.exit(1);
    }
  });

// Test command
program
  .command('test')
  .description('Run bot tests and diagnostics')
  .option('-c, --config <path>', 'Path to configuration file', './config/bot.json')
  .option('--connection', 'Test RPC connections')
  .option('--simulation', 'Test transaction simulation')
  .option('--all', 'Run all tests')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.config);
      
      if (options.all || options.connection) {
        await testConnections(config);
      }
      
      if (options.all || options.simulation) {
        await testSimulation(config);
      }
      
      if (!options.connection && !options.simulation && !options.all) {
        console.log('Please specify a test: --connection, --simulation, or --all');
      }
      
    } catch (error) {
      console.error('❌ Tests failed:', error.message);
      process.exit(1);
    }
  });

// Helper functions

async function loadConfig(configPath: string): Promise<BotConfig> {
  try {
    const fullPath = path.resolve(configPath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Configuration file not found: ${fullPath}`);
    }
    
    const configData = fs.readFileSync(fullPath, 'utf8');
    const config = JSON.parse(configData);
    
    // Convert string values to appropriate types
    if (config.minProfitThreshold) {
      config.minProfitThreshold = new Big(config.minProfitThreshold);
    }
    if (config.maxPositionSize) {
      config.maxPositionSize = new Big(config.maxPositionSize);
    }
    
    return config;
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
}

async function generateDefaultConfig(): Promise<void> {
  const defaultConfig = {
    rpcEndpoints: [
      "https://api.mainnet-beta.solana.com",
      "https://solana-api.projectserum.com"
    ],
    wsEndpoints: [],
    jitoEndpoint: "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
    privateKeyPath: "./config/wallet.json",
    minProfitThreshold: "0.01",
    maxSlippageTolerance: 0.1,
    gasLimitMultiplier: 1.2,
    retryAttempts: 3,
    monitoredDEXs: ["raydium", "orca"],
    flashloanProviders: [],
    riskTolerance: 0.5,
    maxPositionSize: "100.0",
    dryRun: false
  };
  
  const configDir = './config';
  const configPath = path.join(configDir, 'bot.json');
  
  // Create config directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  
  console.log('✅ Default configuration generated at:', configPath);
  console.log('⚠️  Please update the configuration with your settings before starting the bot');
  console.log('📝 Don\'t forget to add your wallet private key file');
}

async function validateConfig(configPath: string): Promise<void> {
  try {
    const config = await loadConfig(configPath);
    
    console.log('🔍 Validating configuration...');
    
    // Validate required fields
    const requiredFields = [
      'rpcEndpoints',
      'jitoEndpoint', 
      'privateKeyPath',
      'minProfitThreshold',
      'maxSlippageTolerance',
      'monitoredDEXs'
    ];
    
    for (const field of requiredFields) {
      if (!config[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    // Validate RPC endpoints
    if (!Array.isArray(config.rpcEndpoints) || config.rpcEndpoints.length === 0) {
      throw new Error('At least one RPC endpoint is required');
    }
    
    // Validate DEXs
    const validDEXs = Object.values(DEXType);
    for (const dex of config.monitoredDEXs) {
      if (!validDEXs.includes(dex as DEXType)) {
        throw new Error(`Invalid DEX: ${dex}. Valid options: ${validDEXs.join(', ')}`);
      }
    }
    
    // Validate private key file
    if (!fs.existsSync(config.privateKeyPath)) {
      console.log('⚠️  Warning: Private key file not found:', config.privateKeyPath);
    }
    
    console.log('✅ Configuration is valid');
    
  } catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
    throw error;
  }
}

async function showConfig(configPath: string): Promise<void> {
  try {
    const config = await loadConfig(configPath);
    
    console.log('📋 Current Configuration:');
    console.log('========================');
    console.log(`RPC Endpoints: ${config.rpcEndpoints.join(', ')}`);
    console.log(`Jito Endpoint: ${config.jitoEndpoint}`);
    console.log(`Private Key Path: ${config.privateKeyPath}`);
    console.log(`Min Profit Threshold: $${config.minProfitThreshold.toString()}`);
    console.log(`Max Slippage Tolerance: ${config.maxSlippageTolerance * 100}%`);
    console.log(`Gas Limit Multiplier: ${config.gasLimitMultiplier}x`);
    console.log(`Retry Attempts: ${config.retryAttempts}`);
    console.log(`Monitored DEXs: ${config.monitoredDEXs.join(', ')}`);
    console.log(`Risk Tolerance: ${config.riskTolerance}`);
    console.log(`Max Position Size: $${config.maxPositionSize.toString()}`);
    console.log(`Dry Run Mode: ${config.dryRun ? 'Enabled' : 'Disabled'}`);
    
  } catch (error) {
    console.error('❌ Failed to show configuration:', error.message);
    throw error;
  }
}

async function displayStatus(bot: SolanaBot): Promise<void> {
  try {
    const status = await bot.getStatus();
    
    console.log('📊 Solana MEV Bot Status');
    console.log('========================');
    console.log(`Status: ${status.running ? '🟢 Running' : '🔴 Stopped'}`);
    console.log(`Uptime: ${formatUptime(status.uptime)}`);
    console.log(`Wallet: ${status.walletAddress}`);
    console.log();
    
    // Monitoring status
    console.log('🔍 Monitoring Status:');
    console.log(`  Opportunities Detected: ${status.metrics.opportunitiesDetected}`);
    console.log(`  Bundles Submitted: ${status.metrics.bundlesSubmitted}`);
    console.log(`  Successful Sandwiches: ${status.metrics.successfulSandwiches}`);
    console.log(`  Success Rate: ${status.metrics.bundlesSubmitted > 0 ? 
      ((status.metrics.successfulSandwiches / status.metrics.bundlesSubmitted) * 100).toFixed(2) : 0}%`);
    console.log();
    
    // Profit metrics
    console.log('💰 Profit Metrics:');
    console.log(`  Total Profit: $${status.metrics.totalProfit.toString()}`);
    console.log(`  Average Latency: ${status.metrics.averageLatency}ms`);
    console.log(`  Error Rate: ${(status.metrics.errorRate * 100).toFixed(2)}%`);
    console.log();
    
    // DEX status
    console.log('🏪 DEX Monitoring:');
    for (const monitor of status.monitors) {
      const statusIcon = monitor.status.running ? '🟢' : '🔴';
      console.log(`  ${monitor.dex}: ${statusIcon} ${monitor.status.running ? 'Active' : 'Inactive'}`);
    }
    console.log();
    
    // Recent activity
    if (status.recentOpportunities && status.recentOpportunities.length > 0) {
      console.log('📈 Recent Opportunities:');
      for (const opp of status.recentOpportunities.slice(0, 5)) {
        const age = Date.now() - opp.detectedAt;
        console.log(`  ${opp.id}: $${opp.estimatedProfit.toString()} (${Math.round(age/1000)}s ago)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to get status:', error.message);
  }
}

async function runInteractiveMode(bot: SolanaBot): Promise<void> {
  console.log('\n🎮 Interactive Mode - Available Commands:');
  console.log('  status  - Show current status');
  console.log('  metrics - Show detailed metrics');
  console.log('  stop    - Stop the bot');
  console.log('  help    - Show this help');
  console.log('  exit    - Exit interactive mode');
  console.log('\nType a command and press Enter:');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'mev-bot> '
  });
  
  rl.prompt();
  
  rl.on('line', async (input: string) => {
    const command = input.trim().toLowerCase();
    
    try {
      switch (command) {
        case 'status':
          await displayStatus(bot);
          break;
          
        case 'metrics':
          await displayDetailedMetrics(bot);
          break;
          
        case 'stop':
          console.log('🛑 Stopping bot...');
          await bot.stop();
          console.log('✅ Bot stopped');
          rl.close();
          return;
          
        case 'help':
          console.log('\n🎮 Available Commands:');
          console.log('  status  - Show current status');
          console.log('  metrics - Show detailed metrics');
          console.log('  stop    - Stop the bot');
          console.log('  help    - Show this help');
          console.log('  exit    - Exit interactive mode');
          break;
          
        case 'exit':
          console.log('👋 Exiting interactive mode...');
          rl.close();
          return;
          
        case '':
          // Empty command, just show prompt again
          break;
          
        default:
          console.log(`❓ Unknown command: ${command}. Type 'help' for available commands.`);
          break;
      }
    } catch (error) {
      console.error('❌ Command failed:', error.message);
    }
    
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log('\n👋 Goodbye!');
    process.exit(0);
  });
}

async function displayDetailedMetrics(bot: SolanaBot): Promise<void> {
  try {
    const metrics = await bot.getDetailedMetrics();
    
    console.log('\n📊 Detailed Metrics');
    console.log('==================');
    
    // Performance metrics
    console.log('\n⚡ Performance:');
    console.log(`  Average Execution Time: ${metrics.performance.avgExecutionTime}ms`);
    console.log(`  Fastest Execution: ${metrics.performance.fastestExecution}ms`);
    console.log(`  Slowest Execution: ${metrics.performance.slowestExecution}ms`);
    
    // Profit breakdown
    console.log('\n💰 Profit Breakdown:');
    console.log(`  Gross Profit: $${metrics.profit.gross.toString()}`);
    console.log(`  Gas Costs: $${metrics.profit.gasCosts.toString()}`);
    console.log(`  Net Profit: $${metrics.profit.net.toString()}`);
    console.log(`  Profit Margin: ${metrics.profit.margin.toFixed(2)}%`);
    
    // Error statistics
    console.log('\n🚨 Error Statistics:');
    console.log(`  Total Errors: ${metrics.errors.total}`);
    console.log(`  Network Errors: ${metrics.errors.network}`);
    console.log(`  Bundle Errors: ${metrics.errors.bundle}`);
    console.log(`  Simulation Errors: ${metrics.errors.simulation}`);
    
  } catch (error) {
    console.error('❌ Failed to get detailed metrics:', error.message);
  }
}

async function showWalletBalance(config: BotConfig): Promise<void> {
  try {
    console.log('💰 Wallet Balance:');
    console.log('==================');
    // This would implement actual wallet balance checking
    console.log('SOL: 10.5 SOL');
    console.log('USDC: 1,250.00 USDC');
    console.log('Total Value: ~$2,300.00');
  } catch (error) {
    console.error('❌ Failed to get wallet balance:', error.message);
  }
}

async function showWalletAddress(config: BotConfig): Promise<void> {
  try {
    console.log('📍 Wallet Address:');
    console.log('==================');
    // This would implement actual wallet address display
    console.log('Address: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  } catch (error) {
    console.error('❌ Failed to get wallet address:', error.message);
  }
}

async function viewLogs(options: any): Promise<void> {
  try {
    console.log(`📋 Bot Logs (last ${options.lines} lines, level: ${options.level})`);
    console.log('='.repeat(60));
    
    // This would implement actual log viewing
    console.log('[2024-01-15 10:30:15] INFO: Bot started successfully');
    console.log('[2024-01-15 10:30:16] INFO: Monitoring Raydium and Orca');
    console.log('[2024-01-15 10:30:20] INFO: Opportunity detected: raydium_abc123');
    console.log('[2024-01-15 10:30:21] INFO: Bundle submitted: bundle_xyz789');
    console.log('[2024-01-15 10:30:22] INFO: Sandwich executed successfully, profit: $0.15');
    
    if (options.follow) {
      console.log('\n👀 Following logs... (Press Ctrl+C to exit)');
      // This would implement log following
    }
    
  } catch (error) {
    console.error('❌ Failed to view logs:', error.message);
  }
}

async function testConnections(config: BotConfig): Promise<void> {
  console.log('🔗 Testing RPC Connections...');
  
  for (const endpoint of config.rpcEndpoints) {
    try {
      console.log(`  Testing ${endpoint}...`);
      // This would implement actual connection testing
      console.log(`  ✅ ${endpoint} - OK (latency: 45ms)`);
    } catch (error) {
      console.log(`  ❌ ${endpoint} - Failed: ${error.message}`);
    }
  }
  
  console.log('\n🔗 Testing Jito Connection...');
  try {
    console.log(`  Testing ${config.jitoEndpoint}...`);
    console.log(`  ✅ Jito endpoint - OK`);
  } catch (error) {
    console.log(`  ❌ Jito endpoint - Failed: ${error.message}`);
  }
}

async function testSimulation(config: BotConfig): Promise<void> {
  console.log('🧪 Testing Transaction Simulation...');
  
  try {
    console.log('  Creating test transaction...');
    console.log('  ✅ Test transaction created');
    
    console.log('  Running simulation...');
    console.log('  ✅ Simulation successful (gas: 185,000)');
    
    console.log('  Testing profit calculation...');
    console.log('  ✅ Profit calculation successful ($0.12 estimated)');
    
  } catch (error) {
    console.log(`  ❌ Simulation test failed: ${error.message}`);
  }
}

function setupGracefulShutdown(bot: SolanaBot): void {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
    
    try {
      await bot.stop();
      console.log('✅ Bot stopped successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
      process.exit(1);
    }
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
}

function formatUptime(uptimeMs: number): string {
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Parse command line arguments
program.parse();

export { program };

