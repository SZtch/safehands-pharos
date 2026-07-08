import { spawnSync } from 'node:child_process';

// Strict mode: CI (or an explicit opt-in) must run the REAL Hardhat EVM tests.
// The offline grep smoke is a developer convenience for genuinely offline
// machines — it must NEVER stand in for real execution in CI, or a compile
// break / failing assertion would be masked as "passing".
const strict = process.env.CI === 'true' || process.env.CONTRACT_TESTS_STRICT === '1';

const contractTestFiles = [
  'test/contracts/SafeHandsRegistry.ts',
  'test/contracts/SafeHandsAttestation.ts',
];

const hardhat = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['hardhat', 'test', ...contractTestFiles], {
  stdio: 'inherit',
  env: { ...process.env, HARDHAT_DISABLE_TELEMETRY_PROMPT: 'true' },
});

if (hardhat.status === 0) process.exit(0);

if (strict) {
  console.error('\n❌ Hardhat EVM tests failed (or could not run) and strict mode is on (CI / CONTRACT_TESTS_STRICT=1).');
  console.error('   Refusing to fall back to offline grep smoke — that would report unverified contracts as passing.');
  process.exit(hardhat.status ?? 1);
}

console.warn('\n⚠️ Hardhat EVM tests did not complete. Falling back to offline contract smoke checks.');
console.warn('   Offline-dev convenience only. This does NOT execute the contracts — set CONTRACT_TESTS_STRICT=1 (or run in CI)');
console.warn('   to require the real EVM tests via `npm run test:contracts:hardhat`.\n');

const smoke = spawnSync(process.execPath, ['scripts/contracts-offline-smoke.mjs'], { stdio: 'inherit' });
process.exit(smoke.status ?? 1);
