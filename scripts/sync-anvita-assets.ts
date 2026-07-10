// ─── Anvita hosted-skill asset generator ─────────────────────────────────
// Generates anvita/safehands/assets/{known-pharos,supported-assets,contracts,
// supported-protocols,networks}.json from the canonical ecosystem registry
// (src/data/ecosystemRegistry.data.ts) + src/lib/networks.ts, so the hosted
// skill can never drift from the TypeScript truth sources.
//
//   npx tsx scripts/sync-anvita-assets.ts          # rewrite the asset files
//   npx tsx scripts/sync-anvita-assets.ts --check  # CI drift check (exit 1 on diff)
//
// The builders are exported so test/anvita-asset-sync.test.ts can run the same
// drift check inside `npm test`. Presentation-only strings (notes, forbidden
// list, engine block) live in the templates below; every address/endpoint
// comes from the registry — nothing is invented here.
// ─────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ECOSYSTEM_REGISTRY_ITEMS } from "../src/data/ecosystemRegistry.data.js";
import type { EcosystemItem } from "../src/lib/ecosystemRegistry.js";
import { NETWORKS } from "../src/lib/networks.js";
import { PRICE_FEED_ALIASES } from "../src/lib/price/feedRegistry.js";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../anvita/safehands/assets");

function requireItem(id: string): EcosystemItem {
  const item = ECOSYSTEM_REGISTRY_ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`ecosystem registry item "${id}" is missing`);
  return item;
}

export function buildKnownPharos(): unknown {
  const infra = requireItem("infrastructure:pacific-mainnet:canonical-contracts");
  const canonicalContracts: Record<string, string> = {};
  for (const c of infra.contracts) canonicalContracts[c.address.toLowerCase()] = c.label;

  const canonicalTokens: Record<string, string> = {};
  for (const tokenId of ["token:pacific-mainnet:wpros", "token:pacific-mainnet:usdc", "token:pacific-mainnet:link", "token:pacific-mainnet:weth"]) {
    const token = requireItem(tokenId);
    const contract = token.contracts[0];
    if (!contract?.symbol) throw new Error(`token item "${tokenId}" has no symbol/contract`);
    canonicalTokens[contract.symbol] = contract.address.toLowerCase();
  }

  return {
    source: "https://docs.pharos.xyz/getting-started/canonical-contracts.md + token-registry.md",
    network: "pacific-mainnet",
    chainId: 1672,
    canonicalContracts,
    canonicalTokens,
  };
}

export function buildSupportedAssets(): unknown {
  const oracle = requireItem("oracle:pacific-mainnet:chainlink-push-feeds");
  const feeds: Record<string, unknown> = {};
  for (const c of oracle.contracts) {
    if (!c.symbol || !c.pair) throw new Error(`feed contract ${c.address} is missing symbol/pair`);
    feeds[c.symbol] = c.feedOnly
      ? { pair: c.pair, feedAddress: c.address, feedOnly: true, note: c.note ?? "" }
      : { pair: c.pair, feedAddress: c.address };
  }

  return {
    source: "Chainlink Push Engine Feeds on Pharos Pacific Mainnet (docs.pharos.xyz)",
    network: "pacific-mainnet",
    chainId: 1672,
    quote: "USD",
    provider: "chainlink-push",
    feedDecimalsDefault: 18,
    heartbeatSeconds: 3600,
    note: "Feed addresses are static config; prices are ALWAYS read live from the feed contracts via eth_call. Never hardcode a price — including stablecoins.",
    feeds,
    aliases: PRICE_FEED_ALIASES,
    aliasNotes: {
      PHAROS: "Pharos is the network/ecosystem; PROS is the token. Checking the PROS/USD price.",
      WPROS: "WPROS is wrapped PROS; priced via the PROS/USD feed.",
      WETH: "WETH is wrapped ETH; priced via the ETH/USD feed.",
    },
  };
}

export function buildContracts(): unknown {
  const safehands = requireItem("infrastructure:pacific-mainnet:safehands-contracts");
  const registry = safehands.contracts.find((c) => c.role === "registry");
  const attestation = safehands.contracts.find((c) => c.role === "attestation");
  if (!registry || !attestation) throw new Error("SafeHands registry/attestation contracts missing from ecosystem registry");

  return {
    network: "pacific-mainnet",
    chainId: 1672,
    note: "Deployed on Pharos pacific-mainnet (chainId 1672). Overridable via SAFEHANDS_REGISTRY_ADDRESS / SAFEHANDS_ATTESTATION_ADDRESS env vars.",
    contracts: {
      SafeHandsRegistry: {
        address: registry.address.toLowerCase(),
        addressEnv: "SAFEHANDS_REGISTRY_ADDRESS",
        abi: "abi/SafeHandsRegistry.json",
        approvedWriteMethods: ["commitRiskRoot"],
        readMethods: ["currentMerkleRoot", "currentDataURI", "isAuthorizedAgent", "isAuthorizedOperator", "owner", "verifyRiskRecord"],
        description: "Merkle-batched risk record registry. Operator commits batch roots; individual records are verified with Merkle proofs via verifyRiskRecord.",
        hostedUse: "read-only queries via safehands-engine.js",
      },
      SafeHandsAttestation: {
        address: attestation.address.toLowerCase(),
        addressEnv: "SAFEHANDS_ATTESTATION_ADDRESS",
        abi: "abi/SafeHandsAttestation.json",
        approvedWriteMethods: ["attest"],
        readMethods: ["isAttested", "isPreparedAttested", "getAttestation", "reputationOf", "attestationCountByAgent", "lastAttestationAt"],
        description: "Immutable attestations of SafeHands-verified broadcasts; powers the reputationOf trust signal.",
        hostedUse: "read-only queries via safehands-engine.js",
      },
    },
    writePolicy: {
      hostedWrites: false,
      note: "No signing in the hosted deployment. Publish/attest require the SafeHands operator backend (not included).",
    },
  };
}

export function buildSupportedProtocols(): unknown {
  const providerIds: Record<string, string> = {
    goldsky: "provider:pacific-mainnet:goldsky",
    executionHistory: "provider:pacific-mainnet:execution-history",
    poolInfo: "provider:pacific-mainnet:pool-info",
    vaultStatus: "provider:pacific-mainnet:vault-status",
  };
  const providerKinds: Record<string, string> = {
    goldsky: "graphql-subgraph",
    executionHistory: "json-indexer",
    poolInfo: "json-api",
    vaultStatus: "json-api",
  };

  const providers: Record<string, unknown> = {};
  for (const [key, id] of Object.entries(providerIds)) {
    const item = requireItem(id);
    const provider = item.providers[0];
    if (!provider) throw new Error(`provider item "${id}" has no provider entry`);
    providers[key] = {
      endpoint: provider.endpoint,
      providerStatus: provider.status,
      kind: providerKinds[key],
      note: provider.note ?? "",
    };
  }

  const protocols: Record<string, unknown> = {};
  for (const [key, id] of [
    ["stargate", "protocol:pacific-mainnet:stargate"],
    ["faroswap", "protocol:pacific-mainnet:faroswap"],
    ["stpros-premint", "protocol:pacific-mainnet:stpros-premint"],
  ] as const) {
    const item = requireItem(id);
    protocols[key] = {
      verificationStatus: item.verificationStatus.toLowerCase(),
      note: item.notes,
    };
  }

  return {
    network: "pacific-mainnet",
    chainId: 1672,
    note: "Optional public data providers for enrichment. An endpoint may ONLY be configured here if it is public, verified, requires NO API key / pass-key / auth header / cookie, and resolves over DNS. When an endpoint is null, the matching engine command returns a structured *_NOT_CONFIGURED error instead of inventing data.",
    forbidden: [
      "DODO API keys or any keyed quote API",
      "FaroSwap pass-key or internal frontend endpoints",
      "GraphQL hosts that do not resolve over public DNS (e.g. backend.faroswap.xyz/graphql at the time of writing)",
      "Scraping websites or block explorers",
      "Treating any DEX/pool/route quote as a canonical price — canonical pricing is Chainlink Push feeds only (see supported-assets.json)",
    ],
    providers,
    protocols,
  };
}

export function buildNetworks(): unknown {
  const pacific = NETWORKS["pacific-mainnet"];
  const atlantic = NETWORKS["atlantic-testnet"];
  const stripSlash = (u: string) => u.replace(/\/+$/, "");

  return {
    default: "pacific-mainnet",
    networks: {
      "pacific-mainnet": {
        name: pacific.name,
        label: pacific.label,
        chainId: pacific.chainId,
        nativeToken: pacific.nativeToken,
        rpcUrl: pacific.defaultRpcUrl,
        rpcEnvOverride: "PHAROS_RPC_URL",
        explorerUrl: stripSlash(pacific.explorerUrl),
        explorerTxPath: "/tx/",
        isMainnet: pacific.isMainnet,
        supportedBySkill: true,
      },
      "atlantic-testnet": {
        name: atlantic.name,
        label: atlantic.label,
        chainId: atlantic.chainId,
        nativeToken: atlantic.nativeToken,
        explorerUrl: stripSlash(atlantic.explorerUrl),
        isMainnet: atlantic.isMainnet,
        supportedBySkill: false,
        note: "Listed for identification only. This Skill is mainnet-locked; reject requests targeting this chain.",
      },
    },
    engine: {
      script: "scripts/safehands-engine.js",
      rpcEnvOverride: "PHAROS_RPC_URL",
      mode: "fully-hosted read-only",
    },
  };
}

export const GENERATED_ASSETS: Record<string, () => unknown> = {
  "known-pharos.json": buildKnownPharos,
  "supported-assets.json": buildSupportedAssets,
  "contracts.json": buildContracts,
  "supported-protocols.json": buildSupportedProtocols,
  "networks.json": buildNetworks,
};

export function renderAsset(name: string): string {
  const builder = GENERATED_ASSETS[name];
  if (!builder) throw new Error(`unknown asset "${name}"`);
  return `${JSON.stringify(builder(), null, 2)}\n`;
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  let drift = 0;

  for (const name of Object.keys(GENERATED_ASSETS)) {
    const filePath = path.join(ASSETS_DIR, name);
    const generated = renderAsset(name);
    let current: string | null = null;
    try {
      current = readFileSync(filePath, "utf8");
    } catch {
      current = null;
    }

    if (generated === current) {
      console.log(`  ok       ${name}`);
      continue;
    }

    if (checkMode) {
      console.error(`  DRIFT    ${name} — regenerate with: npx tsx scripts/sync-anvita-assets.ts`);
      drift++;
    } else {
      writeFileSync(filePath, generated);
      console.log(`  wrote    ${name}`);
    }
  }

  if (drift > 0) process.exit(1);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
