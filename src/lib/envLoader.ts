// Synchronously load .env from cwd before any other module reads process.env.
// Must be imported as the very first import in index.ts so that wallet store,
// constants, and other modules that read env vars at module-init time see the values.
import { readFileSync } from "fs";
import { join } from "path";

try {
  const text = readFileSync(join(process.cwd(), ".env"), "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !process.env[m[1]]) {
      // Strip surrounding quotes if present
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {
  // No .env file — environment vars must be set externally (CI, shell, MCP host)
}
