#!/usr/bin/env node

/**
 * Simple Test Suite for Solana MEV Bot
 * Validates basic functionality and connectivity
 */

import { Connection } from '@solana/web3.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export async function runBasicTests(): Promise<void> {
  console.log('🚀 Starting Solana MEV Bot Basic Tests');
  console.log('=' .repeat(50));
  
  let testsPassed = 0;
  let testsTotal = 0;
  
  // Test 1: Configuration Loading
  testsTotal++;
  console.log('\n📋 Testing configuration loading...');
  try {
    const configPath = join(__dirname, '../config/bot.example.json');
    
    if (!existsSync(configPath)) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    
    if (!config.rpcEndpoints || !Array.isArray(config.rpcEndpoints)) {
      throw new Error('Invalid configuration: missing rpcEndpoints');
    }
    
    console.log('✅ Configuration loaded successfully');
    console.log(`   RPC Endpoints: ${config.rpcEndpoints.length}`);
    console.log(`   Dry Run Mode: ${config.dryRun}`);
    testsPassed++;
    
  } catch (error: any) {
    console.log('❌ Configuration test failed:', error.message);
  }
  
  // Test 2: Solana RPC Connection
  testsTotal++;
  console.log('\n🔗 Testing Solana RPC connection...');
  try {
    const config = JSON.parse(readFileSync(join(__dirname, '../config/bot.example.json'), 'utf8'));
    const connection = new Connection(config.rpcEndpoints[0], 'confirmed');
    
    const version = await connection.getVersion();
    const slot = await connection.getSlot();
    const blockhash = await connection.getLatestBlockhash();
    
    console.log('✅ Connection successful!');
    console.log(`   Solana version: ${version['solana-core']}`);
    console.log(`   Latest blockhash: ${blockhash.blockhash.slice(0, 8)}...`);
    console.log(`   Current slot: ${slot}`);
    testsPassed++;
    
  } catch (error: any) {
    console.log('❌ Connection test failed:', error.message);
  }
  
  // Test 3: Package Dependencies
  testsTotal++;
  console.log('\n📦 Testing package dependencies...');
  try {
    // Test Jito package
    const jito = await import('jito-ts');
    console.log('✅ Jito package imported successfully!');
    console.log(`   Available exports: ${Object.keys(jito).slice(0, 5).join(', ')}...`);
    
    // Test Big.js
    const Big = (await import('big.js')).default;
    const testNumber = new Big('123.456');
    console.log(`✅ Big.js working: ${testNumber.toString()}`);
    
    // Test Commander
    await import('commander');
    console.log('✅ Commander.js imported successfully');
    
    testsPassed++;
    
  } catch (error: any) {
    console.log('❌ Package dependency test failed:', error.message);
  }
  
  // Test 4: Wallet Generation
  testsTotal++;
  console.log('\n🔑 Testing wallet generation...');
  try {
    const { Keypair } = await import('@solana/web3.js');
    const wallet = Keypair.generate();
    
    console.log('✅ Wallet generated successfully!');
    console.log(`   Address: ${wallet.publicKey.toString()}`);
    console.log(`   Secret key length: ${wallet.secretKey.length} bytes`);
    testsPassed++;
    
  } catch (error: any) {
    console.log('❌ Wallet generation test failed:', error.message);
  }
  
  // Test 5: Math Operations
  testsTotal++;
  console.log('\n🧮 Testing math operations...');
  try {
    const Big = (await import('big.js')).default;
    
    const amount = new Big('10.5');
    const slippage = new Big('0.05');
    const profit = amount.times(slippage);
    
    console.log('✅ Math operations working!');
    console.log(`   Amount: ${amount.toString()} SOL`);
    console.log(`   Slippage: ${slippage.toString()} (5%)`);
    console.log(`   Calculated profit: ${profit.toString()} SOL`);
    testsPassed++;
    
  } catch (error: any) {
    console.log('❌ Math operations test failed:', error.message);
  }
  
  // Test Results
  console.log('\n' + '=' .repeat(50));
  console.log('📊 TEST RESULTS');
  console.log('=' .repeat(50));
  console.log(`Tests passed: ${testsPassed}/${testsTotal}`);
  console.log(`Success rate: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`);
  
  if (testsPassed === testsTotal) {
    console.log('✅ All tests passed! The bot is ready for use.');
  } else {
    console.log('⚠️  Some tests failed. Please check the configuration and dependencies.');
  }
  
  console.log('\n🎯 Next Steps:');
  console.log('   1. Run dry-run: npm run dry-run');
  console.log('   2. Run optimized dry-run: npm run optimized-dry-run');
  console.log('   3. Generate wallet: npm run generate-wallet');
  console.log('   4. Configure settings: edit config/bot.json');
  console.log('   5. Start bot: npm run start:dry-run');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runBasicTests().then(() => {
    console.log('\n🎉 Basic tests completed!');
    process.exit(0);
  }).catch((error: any) => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  });
}

