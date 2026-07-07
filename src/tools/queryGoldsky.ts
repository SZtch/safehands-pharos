import { z } from "zod";
import { type ToolResponse, ok, fail } from "../lib/toolResponse.js";
import { goldskyGraphql, goldskyStatus } from "../lib/goldsky.js";

export const queryGoldskySchema = z.object({
  query: z.string().describe("Read-only GraphQL query to execute against the configured Goldsky subgraph."),
  variables: z.record(z.any()).optional().describe("Optional variables for the GraphQL query."),
});

export type QueryGoldskyParams = z.infer<typeof queryGoldskySchema>;

/**
 * Executes a guarded read-only GraphQL query against the configured Goldsky subgraph.
 * SafeHands uses Goldsky as an index/query layer for on-chain attestation and
 * registry events. Writes still happen on-chain; Goldsky only makes them searchable.
 */
export async function handleQueryGoldsky(params: QueryGoldskyParams): Promise<ToolResponse<any>> {
  const status = goldskyStatus();
  if (!status.enabled || !status.configured) {
    return fail(
      "GOLDSKY_NOT_CONFIGURED",
      status.error || "GOLDSKY_SUBGRAPH_URL is not configured. Set it to the SafeHands Goldsky subgraph endpoint to enable indexed attestation/registry queries.",
      true,
      "query_goldsky_subgraph"
    );
  }

  try {
    const data = await goldskyGraphql(params.query, params.variables || {});
    return ok({
      endpointHost: status.endpointHost,
      data,
    });
  } catch (error) {
    return fail(
      "GOLDSKY_QUERY_FAILED",
      `Goldsky query failed: ${error instanceof Error ? error.message : String(error)}`,
      false,
      "query_goldsky_subgraph"
    );
  }
}
