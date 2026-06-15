// ─── SafeHands Deterministic Hackathon Demo ────────────────────────────
// Non-destructive demo for judges and reviewers. It uses offline/sample-safe
// paths and a local HTTP server only when explicitly allowed in-process.
// No real transaction is broadcast.
// ────────────────────────────────────────────────────────────────────────

import express from "express";
import type { Server } from "node:http";

import { handleSafeHandsWalletHealth } from "./tools/safehandsWalletHealth.js";
import { handleSafeHandsPreflightCheck } from "./tools/safehandsPreflightCheck.js";
import { handleTokenRegistryStatus } from "./tools/tokenRegistryStatus.js";
import { handleSafeHandsX402Preflight } from "./tools/safehandsX402Preflight.js";
import { handleX402PayAndFetch } from "./tools/x402PayAndFetch.js";
import { handleSendPayment } from "./tools/sendPayment.js";
import { handleExplainRisk } from "./tools/explainRisk.js";
import { CHAIN_ID, PHAROS_ENVIRONMENT, USDC_ADDRESS } from "./lib/constants.js";

const RECIPIENT = "0x0000000000000000000000000000000000000001";

function section(title: string) {
  console.log(`\n${"═".repeat(78)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(78));
}

function print(label: string, value: unknown) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

function setEnv(key: string, value: string | undefined): () => void {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

async function withLocalX402DemoServer<T>(handler: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.get("/supported", (_req, res) => {
    res.json({
      ok: true,
      demo: true,
      paymentRequired: false,
      endpoints: ["/supported", "/paid"],
      network: `eip155:${CHAIN_ID}`,
    });
  });
  app.get("/paid", (_req, res) => {
    res.status(402).json({
      error: "Payment Required",
      demo: true,
      price: "0.001",
      asset: USDC_ADDRESS,
      network: `eip155:${CHAIN_ID}`,
    });
  });

  const server: Server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Failed to open local demo server");
    return await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    if ("closeAllConnections" in server) (server as any).closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

export async function runDemo() {
  const restoreWalletMode = setEnv("WALLET_MODE", process.env.WALLET_MODE || "none");
  const restoreWrite = setEnv("WRITE_TOOLS_ENABLED", "false");
  const restorePrivateKey = setEnv("PRIVATE_KEY", undefined);
  const restoreX402Signer = setEnv("X402_SIGNER_PRIVATE_KEY", undefined);

  try {
    console.log("\n🛡️  SafeHands-Pharos Deterministic Demo");
    console.log(`   Environment: ${PHAROS_ENVIRONMENT}`);
    console.log(`   Chain ID: ${CHAIN_ID}`);
    console.log("   Mode: non-destructive demo, no real transactions broadcast");

    section("1. Wallet Health");
    print("safehands_wallet_health", await handleSafeHandsWalletHealth({}));

    section("2. Safe Payment Preflight: ALLOW");
    print(
      "safehands_preflight_check",
      await handleSafeHandsPreflightCheck({
        actionType: "send_payment",
        chainId: CHAIN_ID,
        isMainnet: false,
        amount: "0.001",
        amountUnit: "PHRS",
        recipient: RECIPIENT,
      })
    );

    section("3. Unlimited Approval Preflight: BLOCK");
    const blockedApproval = await handleSafeHandsPreflightCheck({
      actionType: "approve_token",
      chainId: CHAIN_ID,
      isMainnet: false,
      approvalAmount: "max",
      approvalToken: "USDC",
      spender: RECIPIENT,
    });
    print("safehands_preflight_check", blockedApproval);

    section("4. Token Registry Status");
    print("token_registry_status", await handleTokenRegistryStatus({ tokenAddress: USDC_ADDRESS }));

    section("5. x402 Preflight Without Private Key");
    await withLocalX402DemoServer(async (baseUrl) => {
      const restoreLocal = setEnv("ALLOW_LOCAL_X402_FETCH", "true");
      try {
        print(
          "safehands_x402_preflight",
          await handleSafeHandsX402Preflight({
            url: `${baseUrl}/paid`,
            paymentAmountUsdc: "0.001",
            probeEndpoint: false,
          })
        );
      } finally {
        restoreLocal();
      }
    });

    section("6. x402 /supported Free Endpoint Without Private Key");
    await withLocalX402DemoServer(async (baseUrl) => {
      const restoreLocal = setEnv("ALLOW_LOCAL_X402_FETCH", "true");
      try {
        print("x402_pay_and_fetch free endpoint", await handleX402PayAndFetch({ url: `${baseUrl}/supported` }));
      } finally {
        restoreLocal();
      }
    });

    section("7. x402 Paid Endpoint Without Signer");
    await withLocalX402DemoServer(async (baseUrl) => {
      const restoreLocal = setEnv("ALLOW_LOCAL_X402_FETCH", "true");
      try {
        print("x402_pay_and_fetch paid endpoint", await handleX402PayAndFetch({ url: `${baseUrl}/paid`, maxPaymentUsdc: "0.001" }));
      } finally {
        restoreLocal();
      }
    });

    section("8. SSRF_BLOCKED");
    const restoreLocalBlocked = setEnv("ALLOW_LOCAL_X402_FETCH", undefined);
    try {
      print("safehands_x402_preflight localhost blocked", await handleSafeHandsX402Preflight({ url: "http://127.0.0.1:4021/supported" }));
    } finally {
      restoreLocalBlocked();
    }

    section("9. WRITE_TOOLS_DISABLED");
    print("send_payment guarded", await handleSendPayment({ toAddress: RECIPIENT, amount: "0.001" }));

    section("10. Human-Readable Risk Explanation");
    print(
      "explain_risk",
      await handleExplainRisk({
        decision: "BLOCK",
        riskLevel: "HIGH",
        reasons: ["Unlimited approval requested"],
        requiredActions: ["Use a limited approval amount before approving a spender"],
      })
    );

    section("Demo Complete");
    console.log("SafeHands demonstrated wallet health, ALLOW/BLOCK policy, token registry, x402 safety, SSRF blocking, write-tool guardrails, and explainable risk output.");
  } finally {
    restoreWalletMode();
    restoreWrite();
    restorePrivateKey();
    restoreX402Signer();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch((err) => {
    console.error("Demo error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
