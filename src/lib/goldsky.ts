import { createPublicClient, defineChain, http, isAddress, parseAbi } from "viem";
import { fetchWithTimeoutAndRetry } from "./http.js";
import { getActiveNetwork, resolveRpcUrl } from "./networks.js";

export interface GoldskyConfigStatus {
  enabled: boolean;
  configured: boolean;
  endpointHost: string | null;
  maxQueryLength: number;
  timeoutMs: number;
  allowedHosts: string[];
  error?: string;
}

export interface IndexedAttestationRecord {
  id?: string;
  txHash?: string;
  preparedTransactionHash?: string;
  chainId?: string | number;
  actionType?: string;
  policyHash?: string;
  metadataHash?: string;
  agent?: string;
  attester?: string;
  blockNumber?: string | number;
  blockTimestamp?: string | number;
  transactionHash?: string;
  raw: Record<string, unknown>;
}

export interface GoldskyLookupResult<T> {
  source: "goldsky";
  configured: boolean;
  indexed: boolean;
  entity: string | null;
  endpointHost: string | null;
  record: T | null;
  triedEntities: string[];
  errors: string[];
}

export interface OnchainAttestationLookup {
  source: "contract";
  configured: boolean;
  onchainVerified: boolean;
  address: string | null;
  record: Record<string, unknown> | null;
  error?: string;
}

export interface IndexedRiskRootRecord {
  id?: string;
  root?: string;
  dataURI?: string;
  operator?: string;
  blockNumber?: string | number;
  blockTimestamp?: string | number;
  transactionHash?: string;
  raw: Record<string, unknown>;
}

const ATTESTATION_ABI = parseAbi([
  "function isAttested(bytes32 txHash) view returns (bool)",
  "function getAttestation(bytes32 txHash) view returns ((bytes32 preparedTransactionHash, bytes32 txHash, uint256 chainId, bytes32 actionType, bytes32 policyHash, bytes32 metadataHash, address agent, address attester, uint64 timestamp))",
  "function reputationOf(address agent) view returns (uint256 verifiedCount, uint64 lastAt)",
]);

function boolEnv(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "true" || raw === "1" || raw.toLowerCase() === "yes";
}

function maxQueryLength(): number {
  const raw = Number(process.env.GOLDSKY_MAX_QUERY_LENGTH || 8_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 8_000;
}

function timeoutMs(): number {
  const raw = Number(process.env.GOLDSKY_TIMEOUT_MS || 10_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 10_000;
}

function configuredEndpoint(): string | null {
  return process.env.GOLDSKY_SUBGRAPH_URL?.trim() || null;
}

function allowedHosts(): string[] {
  return (process.env.GOLDSKY_ALLOWED_HOSTS || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function endpointHost(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

function validateEndpoint(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "GOLDSKY_SUBGRAPH_URL is not a valid URL.";
  }

  if (url.protocol !== "https:" && !boolEnv("GOLDSKY_ALLOW_INSECURE_HTTP", false)) {
    return "GOLDSKY_SUBGRAPH_URL must use https:// unless GOLDSKY_ALLOW_INSECURE_HTTP=true is set for local development.";
  }

  const host = url.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privateHost && !boolEnv("GOLDSKY_ALLOW_PRIVATE_HOSTS", false)) {
    return "GOLDSKY_SUBGRAPH_URL points to a private/local host. Set GOLDSKY_ALLOW_PRIVATE_HOSTS=true only for local development.";
  }

  const hosts = allowedHosts();
  if (hosts.length > 0 && !hosts.includes(url.host.toLowerCase()) && !hosts.includes(host)) {
    return `GOLDSKY_SUBGRAPH_URL host ${url.host} is not in GOLDSKY_ALLOWED_HOSTS.`;
  }

  return null;
}

export function goldskyStatus(): GoldskyConfigStatus {
  const endpoint = configuredEndpoint();
  const enabled = boolEnv("GOLDSKY_ENABLED", Boolean(endpoint));
  const error = endpoint ? validateEndpoint(endpoint) ?? undefined : undefined;
  return {
    enabled,
    configured: Boolean(endpoint) && !error,
    endpointHost: endpointHost(endpoint),
    maxQueryLength: maxQueryLength(),
    timeoutMs: timeoutMs(),
    allowedHosts: allowedHosts(),
    error,
  };
}

function isReadOnlyGraphql(query: string): string | null {
  if (query.length > maxQueryLength()) {
    return `GraphQL query exceeds GOLDSKY_MAX_QUERY_LENGTH (${maxQueryLength()}).`;
  }
  const withoutComments = query.replace(/#[^\n\r]*/g, " ").trim().toLowerCase();
  if (/^mutation\b/.test(withoutComments) || /\bmutation\b/.test(withoutComments)) {
    return "Goldsky queries are read-only. mutation is not allowed.";
  }
  if (/^subscription\b/.test(withoutComments) || /\bsubscription\b/.test(withoutComments)) {
    return "Goldsky queries are read-only. subscription is not allowed.";
  }
  return null;
}

export async function goldskyGraphql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const endpoint = configuredEndpoint();
  if (!endpoint) throw new Error("GOLDSKY_SUBGRAPH_URL is not configured.");
  const endpointError = validateEndpoint(endpoint);
  if (endpointError) throw new Error(endpointError);
  const queryError = isReadOnlyGraphql(query);
  if (queryError) throw new Error(queryError);

  const response = await fetchWithTimeoutAndRetry(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    timeoutMs: timeoutMs(),
    retries: 1,
    retryDelayMs: 250,
  });

  const body = await response.json().catch(async () => ({ errors: [{ message: await response.text().catch(() => "Non-JSON response") }] }));
  if (!response.ok) {
    throw new Error(`Goldsky returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new Error(body.errors.map((e: any) => e?.message || String(e)).join("; "));
  }
  return body.data as T;
}

function bytes32Regex(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function entityListFromEnv(envName: string, defaults: string[]): string[] {
  const configured = (process.env[envName] || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return [...configured, ...defaults].filter((v, i, arr) => arr.indexOf(v) === i);
}

function normalizeAttestation(raw: any): IndexedAttestationRecord {
  return {
    id: raw.id,
    txHash: raw.txHash,
    preparedTransactionHash: raw.preparedTransactionHash,
    chainId: raw.chainId,
    actionType: raw.actionType,
    policyHash: raw.policyHash,
    metadataHash: raw.metadataHash,
    agent: raw.agent,
    attester: raw.attester,
    blockNumber: raw.blockNumber,
    blockTimestamp: raw.blockTimestamp ?? raw.timestamp,
    transactionHash: raw.transactionHash,
    raw,
  };
}

function normalizeRiskRoot(raw: any): IndexedRiskRootRecord {
  return {
    id: raw.id,
    root: raw.root,
    dataURI: raw.dataURI ?? raw.dataUri,
    operator: raw.operator,
    blockNumber: raw.blockNumber,
    blockTimestamp: raw.blockTimestamp ?? raw.timestamp,
    transactionHash: raw.transactionHash,
    raw,
  };
}

export async function lookupAttestationInGoldsky(txHash: string): Promise<GoldskyLookupResult<IndexedAttestationRecord>> {
  const status = goldskyStatus();
  const base: GoldskyLookupResult<IndexedAttestationRecord> = {
    source: "goldsky",
    configured: status.configured,
    indexed: false,
    entity: null,
    endpointHost: status.endpointHost,
    record: null,
    triedEntities: [],
    errors: [],
  };
  if (!status.enabled) return { ...base, errors: ["Goldsky is disabled (GOLDSKY_ENABLED=false)."] };
  if (!status.configured) return { ...base, errors: [status.error || "GOLDSKY_SUBGRAPH_URL is not configured."] };
  if (!bytes32Regex(txHash)) return { ...base, errors: ["txHash must be a 32-byte 0x-prefixed hex string."] };

  const entities = entityListFromEnv("GOLDSKY_ATTESTATION_ENTITIES", ["safeHandsAttesteds", "attestations"]);
  const hashField = process.env.GOLDSKY_ATTESTATION_TX_HASH_FIELD || "txHash";

  for (const entity of entities) {
    base.triedEntities.push(entity);
    const query = `query SafeHandsAttestationByTxHash($txHash: Bytes!) {\n  ${entity}(first: 1, where: { ${hashField}: $txHash }) {\n    id\n    txHash\n    preparedTransactionHash\n    chainId\n    actionType\n    policyHash\n    metadataHash\n    attester\n    blockNumber\n    blockTimestamp\n    transactionHash\n  }\n}`;
    try {
      const data = await goldskyGraphql<Record<string, any[]>>(query, { txHash: txHash.toLowerCase() });
      const first = data?.[entity]?.[0];
      if (first) {
        return { ...base, indexed: true, entity, record: normalizeAttestation(first) };
      }
    } catch (err) {
      base.errors.push(`${entity}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return base;
}

export async function lookupLatestRiskRootInGoldsky(): Promise<GoldskyLookupResult<IndexedRiskRootRecord>> {
  const status = goldskyStatus();
  const base: GoldskyLookupResult<IndexedRiskRootRecord> = {
    source: "goldsky",
    configured: status.configured,
    indexed: false,
    entity: null,
    endpointHost: status.endpointHost,
    record: null,
    triedEntities: [],
    errors: [],
  };
  if (!status.enabled) return { ...base, errors: ["Goldsky is disabled (GOLDSKY_ENABLED=false)."] };
  if (!status.configured) return { ...base, errors: [status.error || "GOLDSKY_SUBGRAPH_URL is not configured."] };

  const entities = entityListFromEnv("GOLDSKY_RISK_ROOT_ENTITIES", ["riskRootCommitteds", "safeHandsRiskRootCommitteds"]);
  for (const entity of entities) {
    base.triedEntities.push(entity);
    const query = `query SafeHandsLatestRiskRoot {\n  ${entity}(first: 1, orderBy: blockNumber, orderDirection: desc) {\n    id\n    root\n    dataURI\n    operator\n    blockNumber\n    blockTimestamp\n    transactionHash\n  }\n}`;
    try {
      const data = await goldskyGraphql<Record<string, any[]>>(query);
      const first = data?.[entity]?.[0];
      if (first) {
        return { ...base, indexed: true, entity, record: normalizeRiskRoot(first) };
      }
    } catch (err) {
      base.errors.push(`${entity}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return base;
}

function attestationAddress(): `0x${string}` | null {
  const raw = process.env.SAFEHANDS_ATTESTATION_ADDRESS || process.env.SAFEHANDS_RISK_REGISTRY_ADDRESS || "";
  return isAddress(raw) ? (raw as `0x${string}`) : null;
}

function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

export async function lookupAttestationOnchain(txHash: string): Promise<OnchainAttestationLookup> {
  const address = attestationAddress();
  if (!address) return { source: "contract", configured: false, onchainVerified: false, address: null, record: null, error: "SAFEHANDS_ATTESTATION_ADDRESS is not configured." };
  if (!bytes32Regex(txHash)) return { source: "contract", configured: true, onchainVerified: false, address, record: null, error: "txHash must be a 32-byte 0x-prefixed hex string." };

  try {
    const network = getActiveNetwork();
    const rpcUrl = resolveRpcUrl(network);
    const chain = defineChain({
      id: network.chainId,
      name: network.label,
      nativeCurrency: { name: network.nativeToken, symbol: network.nativeToken, decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
      testnet: !network.isMainnet,
    });
    const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 10_000 }) });
    const attested = await client.readContract({ address, abi: ATTESTATION_ABI, functionName: "isAttested", args: [txHash as `0x${string}`] }) as boolean;
    if (!attested) return { source: "contract", configured: true, onchainVerified: false, address, record: null };
    const record = await client.readContract({ address, abi: ATTESTATION_ABI, functionName: "getAttestation", args: [txHash as `0x${string}`] });
    return { source: "contract", configured: true, onchainVerified: true, address, record: toJsonSafe(record) as Record<string, unknown> };
  } catch (err) {
    return { source: "contract", configured: true, onchainVerified: false, address, record: null, error: err instanceof Error ? err.message : String(err) };
  }
}
