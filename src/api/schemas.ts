// ─── SafeHands API — Request Schemas (read-only) ──────────────
// Zod schemas validating API input. Addresses, calldata, tx hashes, values,
// and network names are validated before any analyzer runs. Invalid input
// throws a ZodError which the server maps to a safe 400 response. No schema
// here enables execution, signing, or payment — these only shape read input.
// ────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { isAddress } from "viem";
import { isNetworkName } from "../lib/networks.js";

// ── Reusable field validators ──────────────────────────────────────────

export const addressSchema = z
  .string()
  .refine((v) => isAddress(v), { message: "Must be a valid EVM address (0x + 40 hex)." });

/** Calldata: 0x followed by an even number of hex chars (may be empty 0x). */
export const hexDataSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, "Must be 0x-prefixed even-length hex calldata.");

export const txHashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 0x-prefixed 32-byte transaction hash.");

/** Value in wei: a non-negative decimal string or 0x-prefixed hex string. */
export const valueSchema = z
  .string()
  .regex(/^(0x[0-9a-fA-F]+|[0-9]+)$/, "Must be a decimal or 0x-hex wei value string.");

export const networkNameSchema = z
  .string()
  .refine((v) => isNetworkName(v), { message: "Unknown network. Use pacific-mainnet or pacific-mainnet." });

export const chainIdSchema = z.number().int().positive();

// ── Endpoint request schemas ───────────────────────────────────────────

/** Universal SafeHands check — every field optional; the router decides. */
export const guardianCheckSchema = z.object({
  network: networkNameSchema.optional(),
  chainId: chainIdSchema.optional(),
  to: addressSchema.optional(),
  data: hexDataSchema.optional(),
  value: valueSchema.optional(),
  txHash: txHashSchema.optional(),
  policy: z.string().optional(),
  actor: z.string().optional(),
  inputType: z.enum(["tx", "contract", "approval", "safe", "x402", "call"]).optional(),
  /** Optional ecosystem provider hint (e.g. "LayerZero") — evidence only. */
  provider: z.string().optional(),
  /** Optional ecosystem category hint (e.g. "cross_chain") — evidence only. */
  ecosystemCategory: z.string().optional(),
});
export type GuardianCheckInput = z.infer<typeof guardianCheckSchema>;

export const analyzeTxSchema = z.object({
  txHash: txHashSchema,
  network: networkNameSchema.optional(),
  chainId: chainIdSchema.optional(),
});
export type AnalyzeTxInput = z.infer<typeof analyzeTxSchema>;

export const analyzeContractSchema = z.object({
  address: addressSchema,
  network: networkNameSchema.optional(),
  chainId: chainIdSchema.optional(),
});
export type AnalyzeContractInput = z.infer<typeof analyzeContractSchema>;

export const analyzeApprovalSchema = z.object({
  data: hexDataSchema,
  token: addressSchema.optional(),
});
export type AnalyzeApprovalInput = z.infer<typeof analyzeApprovalSchema>;

export const analyzeSafeSchema = z.object({
  data: hexDataSchema,
});
export type AnalyzeSafeInput = z.infer<typeof analyzeSafeSchema>;

export const analyzeX402Schema = z.object({
  url: z.string().min(1, "url is required."),
  paymentAmountUsdc: z.string().optional(),
  paymentTokenAddress: addressSchema.optional(),
  payTo: addressSchema.optional(),
  agentId: z.string().optional(),
  chainId: chainIdSchema.optional(),
});
export type AnalyzeX402Input = z.infer<typeof analyzeX402Schema>;

export const broadcastSignedSchema = z.object({
  rawSignedTransaction: z.string().regex(/^0x([0-9a-fA-F]{2})+$/, "Must be 0x-prefixed hex transaction data."),
  preparedTransactionId: z.string().uuid("Must be a valid UUID."),
  preparedTransactionHash: txHashSchema, // 32 bytes hex
});
export type BroadcastSignedInput = z.infer<typeof broadcastSignedSchema>;

