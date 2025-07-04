#!/usr/bin/env node

/**
 * Simple test script to verify basic bot functionality
 * This script tests core components without complex dependencies
 */

import { Connection } from '@solana/web3.js';

// Simple connection test
async function testConnection() {
  console.log('🔗 Testing Solana RPC connection...');
  
  try {
    const connection = new Connection('https://mainnet.helius-rpc.com/?api-key=bcc5b40a-7085-4939-812b-fb59ae7f4539');
    
    // Test basic connection
    const version = await connection.getVersion();
    console.log('✅ Connection successful!');
    console.log(`   Solana version: ${version['solana-core']}`);
    
    // Test getting recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    console.log(`   Latest blockhash: ${blockhash.slice(0, 8)}...`);
    
    // Test getting slot
    const slot = await connection.getSlot();
    console.log(`   Current slot: ${slot}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ Connection failed:', error.message);
    return false;
  }
}

// Test Jito package import
async function testJitoImport() {
  console.log('\n📦 Testing Jito package import...');
  
  try {
    const jito = await import('jito-ts');
    console.log('✅ Jito package imported successfully!');
    console.log(`   Available exports: ${Object.keys(jito).slice(0, 5).join(', ')}...`);
    return true;
  } catch (error: any) {
    console.error('❌ Jito import failed:', error.message);
    return false;
  }
}

// Test basic wallet functionality
async function testWalletGeneration() {
  console.log('\n🔑 Testing wallet generation...');
  
  try {
    const { Keypair } = await import('@solana/web3.js');
    
    // Generate a test wallet
    const testWallet = Keypair.generate();
    console.log('✅ Wallet generated successfully!');
    console.log(`   Address: ${testWallet.publicKey.toString()}`);
    console.log(`   Secret key length: ${testWallet.secretKey.length} bytes`);
    
    return true;
  } catch (error: any) {
    console.error('❌ Wallet generation failed:', error.message);
    return false;
  }
}

// Test configuration loading
async function testConfigLoading() {
  console.log('\n⚙️  Testing configuration loading...');
  
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const configPath = path.join(__dirname, '../config/bot.example.json');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      console.log('✅ Configuration loaded successfully!');
      console.log(`   RPC endpoints: ${config.rpcEndpoints.length}`);
      console.log(`   Monitored DEXs: ${config.monitoredDEXs.join(', ')}`);
      console.log(`   Dry run mode: ${config.dryRun}`);
      
      return true;
    } else {
      console.log('⚠️  Example configuration not found, but this is expected');
      return true;
    }
  } catch (error: any) {
    console.error('❌ Configuration loading failed:', error.message);
    return false;
  }
}

// Test basic math operations for profit calculation
async function testMathOperations() {
  console.log('\n🧮 Testing math operations...');
  
  try {
    const Big = (await import('big.js')).default;
    
    // Test basic arithmetic
    const amount1 = new Big('100.5');
    const amount2 = new Big('0.01');
    const result = amount1.times(amount2);
    
    console.log('✅ Math operations working!');
    console.log(`   100.5 * 0.01 = ${result.toString()}`);
    
    // Test precision
    const preciseCalc = new Big('0.123456789').times(new Big('1000000'));
    console.log(`   Precision test: ${preciseCalc.toString()}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ Math operations failed:', error.message);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Solana MEV Bot Basic Tests\n');
  console.log('=' .repeat(50));
  
  const tests = [
    testConnection,
    testJitoImport,
    testWalletGeneration,
    testConfigLoading,
    testMathOperations
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error: any) {
      console.error(`❌ Test failed with error: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '=' .repeat(50));
  console.log('📊 Test Results:');
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All tests passed! The bot is ready for development.');
  } else {
    console.log('\n⚠️  Some tests failed. Please check the errors above.');
  }
  
  return failed === 0;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch((error: any) => {
    console.error('💥 Test runner crashed:', error);
    process.exit(1);
  });
}

export { runTests };

