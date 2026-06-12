import type { Account } from "viem";
export type SignerMode = "none" | "env" | "managed-testnet" | "external-signer" | "x402-env";
export type SignerPurpose = "write" | "x402";
export interface SignerResult {
    account: Account;
    address: `0x${string}`;
    mode: SignerMode;
}
export interface SignerFailure {
    error: {
        code: string;
        message: string;
    };
}
export type GetSignerResult = SignerResult | SignerFailure;
export declare function isSignerFailure(r: GetSignerResult): r is SignerFailure;
/**
 * Get a signer for write/payment operations.
 * Priority for x402: managed wallet > X402_SIGNER_PRIVATE_KEY > PRIVATE_KEY fallback.
 * Priority for writes: managed wallet > PRIVATE_KEY fallback.
 */
export declare function getSigner(agentId?: string, options?: {
    purpose?: SignerPurpose;
}): Promise<GetSignerResult>;
//# sourceMappingURL=index.d.ts.map