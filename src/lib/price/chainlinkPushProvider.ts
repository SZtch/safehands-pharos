// ─── Chainlink Push Engine Provider ────────────────────────────────────
// Reads latestAnswer/latestTimestamp live from Chainlink Push Engine feed
// contracts on Pharos via viem eth_call.
// ────────────────────────────────────────────────────────────────────────

import { parseAbi } from "viem";
import { publicClient } from "../pharosClient.js";
import type { ContractReader, PriceFeedConfig, PriceProvider, ProviderQuote } from "./types.js";

export const CHAINLINK_PUSH_FEED_ABI = parseAbi([
  "function latestAnswer() view returns (int256)",
  "function latestTimestamp() view returns (uint256)",
  // Declared for verification tooling only — never called per price request;
  // feed identity is static registry config.
  "function getFeedId() view returns (bytes32)",
]);

export class ChainlinkPushProvider implements PriceProvider {
  readonly kind = "chainlink-push" as const;
  readonly label = "Chainlink Push Engine feed on Pharos";
  private readonly reader: ContractReader;

  constructor(reader?: ContractReader) {
    this.reader = reader ?? (publicClient as unknown as ContractReader);
  }

  async fetchQuote(feed: PriceFeedConfig): Promise<ProviderQuote> {
    // Sequential on purpose: the public Pharos RPC rate-limits parallel eth_call bursts.
    const answer = (await this.reader.readContract({
      address: feed.feedAddress,
      abi: CHAINLINK_PUSH_FEED_ABI,
      functionName: "latestAnswer",
    })) as bigint;
    const updatedAt = (await this.reader.readContract({
      address: feed.feedAddress,
      abi: CHAINLINK_PUSH_FEED_ABI,
      functionName: "latestTimestamp",
    })) as bigint;
    return { answer, updatedAtUnix: Number(updatedAt) };
  }
}
