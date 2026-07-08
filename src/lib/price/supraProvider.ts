// ─── Supra DORA Provider (placeholder) ─────────────────────────────────
// Supra DORA Pull Oracle is deployed on Pharos, but exact feed IDs / pull
// payload schema / timestamp semantics are not yet confirmed, so this provider
// is intentionally a stub. The PriceResolver treats it as an unavailable
// source; no price is ever fabricated.
// ────────────────────────────────────────────────────────────────────────

import type { PriceFeedConfig, PriceProvider, ProviderQuote } from "./types.js";

// Pacific Mainnet deployment (recorded for future Phase 2 wiring).
export const SUPRA_DORA_STORAGE_ADDRESS = "0x58e158c74DF7Ad6396C0dcbadc4878faC9e93d57" as const;
export const SUPRA_DORA_PULL_ADDRESS = "0x16f70cAD28dd621b0072B5A8a8c392970E87C3dD" as const;

export class SupraPullProvider implements PriceProvider {
  readonly kind = "supra-pull" as const;
  readonly label = "Supra DORA pull oracle on Pharos (not yet enabled)";

  async fetchQuote(_feed: PriceFeedConfig): Promise<ProviderQuote> {
    throw new Error(
      "SUPRA_PROVIDER_NOT_IMPLEMENTED: Supra DORA pull provider is a stub until feed IDs and payload schema are confirmed."
    );
  }
}
