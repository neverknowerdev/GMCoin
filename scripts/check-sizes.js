const fs = require('fs');
const path = require('path');

function checkContractSizes() {
  const artifactsDir = path.join(__dirname, '..', 'artifacts', 'contracts');
  const results = [];

  function processDir(dir, prefix = '') {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.includes('.dbg')) {
        processDir(filePath, path.join(prefix, file));
      } else if (file.endsWith('.json') && !file.includes('.dbg')) {
        try {
          const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const bytecode = artifact.deployedBytecode || '0x';
          const size = Math.floor((bytecode.length - 2) / 2); // Remove 0x and divide by 2
          
          const contractName = file.replace('.json', '');
          const fullPath = prefix ? `${prefix}/${contractName}` : contractName;
          
          results.push({
            name: fullPath,
            size: size,
            exceeds: size > 24576
          });
        } catch (e) {
          // Skip if can't parse
        }
      }
    }
  }
  
  processDir(artifactsDir);
  
  // Sort by size descending
  results.sort((a, b) => b.size - a.size);
  
  console.log('\nContract Sizes:');
  console.log('================');
  
  for (const result of results) {
    const status = result.exceeds ? '❌ EXCEEDS LIMIT' : '✅';
    console.log(`${status} ${result.name}: ${result.size} bytes`);
  }
  
  const oversized = results.filter(r => r.exceeds);
  if (oversized.length > 0) {
    console.log('\n⚠️  Contracts exceeding 24576 bytes limit:');
    for (const contract of oversized) {
      console.log(`   - ${contract.name}: ${contract.size} bytes (${contract.size - 24576} bytes over)`);
    }
  } else {
    console.log('\n✅ All contracts are within size limits!');
  }
}

checkContractSizes();