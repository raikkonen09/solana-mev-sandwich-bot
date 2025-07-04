#!/usr/bin/env node

/**
 * Wallet generation script for Solana MEV Bot
 * Generates a new wallet and saves it to the config directory
 */

const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateWallet() {
  console.log('🔑 Generating new Solana wallet...');
  
  // Generate new keypair
  const wallet = Keypair.generate();
  
  // Convert to array format for JSON storage
  const secretKeyArray = Array.from(wallet.secretKey);
  
  console.log('✅ Wallet generated successfully!');
  console.log(`   Address: ${wallet.publicKey.toString()}`);
  console.log(`   Secret key length: ${wallet.secretKey.length} bytes`);
  
  return {
    publicKey: wallet.publicKey.toString(),
    secretKey: secretKeyArray
  };
}

function saveWallet(walletData, outputPath, encrypt = false) {
  console.log(`💾 Saving wallet to ${outputPath}...`);
  
  // Ensure config directory exists
  const configDir = path.dirname(outputPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    console.log(`   Created directory: ${configDir}`);
  }
  
  let dataToSave = JSON.stringify(walletData.secretKey, null, 2);
  
  if (encrypt) {
    // Simple encryption (for demo purposes - use proper encryption in production)
    const encryptionKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-cbc', encryptionKey);
    
    let encrypted = cipher.update(dataToSave, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    dataToSave = JSON.stringify({
      encrypted: true,
      data: encrypted,
      iv: iv.toString('hex')
    }, null, 2);
    
    // Save encryption key separately
    const keyPath = outputPath.replace('.json', '.key');
    fs.writeFileSync(keyPath, encryptionKey.toString('hex'));
    console.log(`   Encryption key saved to: ${keyPath}`);
    console.log('   ⚠️  Keep the .key file secure and separate from the wallet file!');
  }
  
  fs.writeFileSync(outputPath, dataToSave);
  
  // Set restrictive permissions
  fs.chmodSync(outputPath, 0o600);
  
  console.log('✅ Wallet saved successfully!');
  console.log(`   File: ${outputPath}`);
  console.log(`   Permissions: 600 (owner read/write only)`);
  
  return outputPath;
}

function displayInstructions(walletData, walletPath) {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 WALLET SETUP COMPLETE');
  console.log('='.repeat(60));
  
  console.log('\n📋 Wallet Information:');
  console.log(`   Address: ${walletData.publicKey}`);
  console.log(`   File: ${walletPath}`);
  
  console.log('\n⚠️  IMPORTANT SECURITY NOTES:');
  console.log('   • This wallet controls real funds - keep it secure!');
  console.log('   • Never share your private key or wallet file');
  console.log('   • Make secure backups of your wallet file');
  console.log('   • Consider using a hardware wallet for large amounts');
  
  console.log('\n💰 Next Steps:');
  console.log('   1. Fund this wallet with SOL for gas fees');
  console.log('   2. Update your bot configuration to use this wallet');
  console.log('   3. Test with small amounts first');
  console.log('   4. Enable dry-run mode for initial testing');
  
  console.log('\n🔗 Useful Commands:');
  console.log(`   • Check balance: solana balance ${walletData.publicKey}`);
  console.log(`   • Send SOL: solana transfer ${walletData.publicKey} <amount>`);
  console.log('   • View on explorer: https://explorer.solana.com/address/' + walletData.publicKey);
  
  console.log('\n📖 Documentation:');
  console.log('   • Bot setup: README.md');
  console.log('   • Configuration: docs/');
  console.log('   • Troubleshooting: docs/TROUBLESHOOTING.md');
}

function main() {
  console.log('🚀 Solana MEV Bot - Wallet Generator');
  console.log('=====================================\n');
  
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const outputPath = args[0] || path.join(__dirname, '../config/wallet.json');
    const encrypt = args.includes('--encrypt');
    
    console.log(`Output path: ${outputPath}`);
    console.log(`Encryption: ${encrypt ? 'enabled' : 'disabled'}`);
    console.log('');
    
    // Generate wallet
    const walletData = generateWallet();
    
    // Save wallet
    const savedPath = saveWallet(walletData, outputPath, encrypt);
    
    // Display instructions
    displayInstructions(walletData, savedPath);
    
    console.log('\n✨ Wallet generation completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error generating wallet:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Solana MEV Bot - Wallet Generator');
  console.log('');
  console.log('Usage:');
  console.log('  node generate-wallet.js [output-path] [options]');
  console.log('');
  console.log('Arguments:');
  console.log('  output-path    Path to save the wallet file (default: ../config/wallet.json)');
  console.log('');
  console.log('Options:');
  console.log('  --encrypt      Encrypt the wallet file (saves key separately)');
  console.log('  --help, -h     Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node generate-wallet.js');
  console.log('  node generate-wallet.js ./my-wallet.json');
  console.log('  node generate-wallet.js ./secure-wallet.json --encrypt');
  process.exit(0);
}

// Run the main function
if (require.main === module) {
  main();
}

module.exports = { generateWallet, saveWallet };

