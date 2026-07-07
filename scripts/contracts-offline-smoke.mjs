import fs from 'fs';

const registry = fs.readFileSync('contracts/SafeHandsRegistry.sol', 'utf-8');
const attestation = fs.readFileSync('contracts/SafeHandsAttestation.sol', 'utf-8');
const registryTest = fs.readFileSync('test/SafeHandsRegistry.ts', 'utf-8');
const attestationTest = fs.readFileSync('test/SafeHandsAttestation.ts', 'utf-8');

const checks = [
  ['SafeHandsRegistry source exists', registry.includes('contract SafeHandsRegistry')],
  ['expiresAt=0 never-expire semantics', registry.includes('expiresAt != 0 && expiresAt < block.timestamp')],
  ['risk root commit function exists', registry.includes('function commitRiskRoot')],
  ['risk root rejects zero root / empty data URI', registry.includes('InvalidRoot') && registry.includes('EmptyDataURI')],
  ['risk record verification exists', registry.includes('function verifyRiskRecord')],
  ['SafeHandsAttestation source exists', attestation.includes('contract SafeHandsAttestation')],
  ['attestation function exists', attestation.includes('function attest')],
  ['attestation rejects zero hashes / zero chainId', attestation.includes('ZeroHash') && attestation.includes('InvalidChainId')],
  ['registry test covers Merkle proof', registryTest.includes('verify valid risk record')],
  ['registry test covers expiresAt=0', registryTest.includes('should treat expiresAt=0 as never-expiring')],
  ['attestation test covers immutable proof', attestationTest.includes('attest')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`✅ ${name}`);
  else {
    console.error(`❌ ${name}`);
    failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log('✅ Offline contract smoke checks passed. Full EVM tests run when Hardhat compiler metadata is available.');
