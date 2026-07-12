// ─── Production posture guards ─────────────────────────────────────────────
// Lightweight startup checks that fail-fast (fatal) or warn on unsafe public-
// hosting configuration. Active only when NODE_ENV=production, evaluated once at
// server boot. These NEVER remove capability — they protect the Mainnet Production
// Profile's zero-custody posture and durable state. Every check has an explicit
// override so intentional self-hosted setups are never blocked silently.
// ───────────────────────────────────────────────────────────────────────────

import { safeHandsStateDir } from "./persistentJsonStore.js";



export interface PostureIssue {
  level: "warn" | "fatal";
  code: string;
  message: string;
}

/**
 * Evaluate the production posture. Pure (reads env only, no side effects) so it is
 * unit-testable. Returns [] outside production. The caller logs/throws.
 */
export function evaluateProductionPosture(env: NodeJS.ProcessEnv = process.env): PostureIssue[] {
  const issues: PostureIssue[] = [];
  if (env.NODE_ENV !== "production") return issues;

  // 1) FATAL — custody landmine: managed execution enabled on a public host.
  const managed = env.WALLET_MODE === "managed-mainnet";
  const writeOn = env.WRITE_TOOLS_ENABLED === "true";
  const allowManagedPublic = env.SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC === "true";
  if (managed && writeOn && !allowManagedPublic) {
    issues.push({
      level: "fatal",
      code: "MANAGED_EXECUTION_ON_PUBLIC",
      message:
        "Refusing to start: WALLET_MODE=managed-mainnet + WRITE_TOOLS_ENABLED=true in production puts a signing key on the host (custody). The public zero-custody profile requires WALLET_MODE=none + WRITE_TOOLS_ENABLED=false. For an intentional self-hosted single-tenant deployment, set SAFEHANDS_ALLOW_MANAGED_ON_PUBLIC=true.",
    });
  }

  // 1b) FATAL — custody landmine: local x402 facilitator key in production.
  // The standalone x402 server (`npm run start:x402`) signs settlements with
  // X402_FACILITATOR_PRIVATE_KEY — a hot key on the host. The zero-custody
  // production path is the Guardian API `/paid/*` gate with an EXTERNAL
  // facilitator (X402_PAY_TO + X402_FACILITATOR_URL) and no local key.
  const localFacilitatorKey = Boolean(env.X402_FACILITATOR_PRIVATE_KEY);
  const allowLocalFacilitator = env.SAFEHANDS_ALLOW_LOCAL_FACILITATOR === "true";
  if (localFacilitatorKey && !allowLocalFacilitator) {
    issues.push({
      level: "fatal",
      code: "LOCAL_FACILITATOR_KEY_IN_PRODUCTION",
      message:
        "Refusing to start: X402_FACILITATOR_PRIVATE_KEY is set in production: the local x402 facilitator signs settlements with a hot key on the host (custody). The zero-custody profile serves paid endpoints through the Guardian API /paid/* gate with an external facilitator (X402_PAY_TO + X402_FACILITATOR_URL) and no local key. For an intentional dev/self-hosted single-tenant deployment, set SAFEHANDS_ALLOW_LOCAL_FACILITATOR=true.",
    });
  }

  // 2) WARN — ephemeral state dir → durability loss on restart.
  const stateDirSet = Boolean(env.SAFEHANDS_STATE_DIR || env.STATE_DIR);
  const dir = env.SAFEHANDS_STATE_DIR || env.STATE_DIR || safeHandsStateDir();
  const looksEphemeral = !stateDirSet || dir === ".safehands" || dir === "." || dir.startsWith("./") || dir.startsWith(".safehands");
  if (looksEphemeral) {
    issues.push({
      level: "warn",
      code: "EPHEMERAL_STATE_DIR",
      message:
        `SAFEHANDS_STATE_DIR resolves to "${dir}"; on an ephemeral host (e.g. Railway without a Volume) prepared transactions, the attestation queue, and the audit trail are LOST on restart. Mount a persistent Volume and set SAFEHANDS_STATE_DIR to its path (e.g. /data).`,
    });
  }

  // 3) WARN — x402 enabled + replay required but Upstash Redis not configured.
  // x402 counts as configured for EITHER profile: the zero-custody API gate
  // (X402_FACILITATOR_URL) or the standalone local facilitator (private key).
  const x402Configured = Boolean(env.X402_PAY_TO && (env.X402_FACILITATOR_URL || env.X402_FACILITATOR_PRIVATE_KEY));
  const replayRequired = env.SAFEHANDS_X402_REPLAY_REDIS_REQUIRED === "true";
  const upstash = Boolean(
    (env.UPSTASH_REDIS_REST_URL || env.SAFEHANDS_REDIS_REST_URL) &&
      (env.UPSTASH_REDIS_REST_TOKEN || env.SAFEHANDS_REDIS_REST_TOKEN),
  );
  if (x402Configured && replayRequired && !upstash) {
    issues.push({
      level: "warn",
      code: "X402_REPLAY_REDIS_MISSING",
      message:
        "x402 is configured and SAFEHANDS_X402_REPLAY_REDIS_REQUIRED=true, but Upstash Redis env (UPSTASH_REDIS_REST_URL/TOKEN) is missing. x402 replay protection will fail closed at runtime. Provision Upstash Redis or unset SAFEHANDS_X402_REPLAY_REDIS_REQUIRED.",
    });
  }

  // 4) WARN — CORS wildcard in production (advisory; fine for the public read tier).
  const cors = env.SAFEHANDS_CORS_ORIGIN || env.CORS_ORIGIN || env.SAFEHANDS_ALLOWED_ORIGINS;
  if (!cors || cors === "*") {
    issues.push({
      level: "warn",
      code: "CORS_WILDCARD",
      message:
        "CORS is wildcard (*) in production. Acceptable for the public read tier, but tighten CORS_ORIGIN / SAFEHANDS_CORS_ORIGIN for guarded/paid surfaces.",
    });
  }

  return issues;
}

/**
 * Apply the posture at server startup: log every issue, then throw if any are fatal.
 * Warnings never block boot; fatals refuse to start (fail-fast).
 */
export function assertProductionPosture(): void {
  const issues = evaluateProductionPosture();
  for (const i of issues) {
    const tag = i.level === "fatal" ? "❌ FATAL" : "⚠️  WARNING";
    console.error(`${tag} [SafeHands posture · ${i.code}] ${i.message}`);
  }
  const fatal = issues.filter((i) => i.level === "fatal");
  if (fatal.length > 0) {
    throw new Error(
      `SafeHands refused to start: ${fatal.length} fatal production-posture issue(s); see logs above. This protects the zero-custody Mainnet Production Profile.`,
    );
  }
}
