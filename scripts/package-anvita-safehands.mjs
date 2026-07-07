#!/usr/bin/env node
/**
 * package-anvita-safehands.mjs
 * Builds dist/safehands.zip for Anvita Flow upload.
 *
 * Anvita packaging rules enforced here:
 *  - zip top-level MUST be the folder `safehands/` itself
 *  - SKILL.md (uppercase) must sit at the folder root
 *  - frontmatter `name:` must equal the folder name exactly
 *
 * Usage:  node scripts/package-anvita-safehands.mjs
 * Requires: `zip` CLI (Ubuntu/WSL: sudo apt-get install zip) — falls back to `tar -a`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, "anvita", "safehands");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "safehands.zip");

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// ── preflight ────────────────────────────────────────────────────────────
if (!existsSync(PKG_DIR)) die(`missing package dir: ${PKG_DIR}`);
const skillPath = path.join(PKG_DIR, "SKILL.md");
if (!existsSync(skillPath)) die("SKILL.md (uppercase) not found at package root");

const fm = readFileSync(skillPath, "utf8");
if (!fm.startsWith("---")) die("SKILL.md must begin with --- frontmatter");
const nameMatch = fm.match(/^name:\s*(\S+)\s*$/m);
if (!nameMatch) die("frontmatter has no `name:` field");
if (nameMatch[1] !== "safehands")
  die(`frontmatter name "${nameMatch[1]}" != folder name "safehands"`);
if (!/^description:\s*\S/m.test(fm)) die("frontmatter has no `description:` field");

for (const req of ["references", "assets", "scripts"]) {
  if (!existsSync(path.join(PKG_DIR, req))) die(`missing ${req}/ directory`);
}
console.log("✓ preflight passed (SKILL.md, frontmatter name match, subdirs)");

// ── zip (top-level folder = safehands/) ─────────────────────────
mkdirSync(DIST, { recursive: true });
rmSync(OUT, { force: true });
const anvitaDir = path.join(ROOT, "anvita");
try {
  execFileSync("zip", ["-r", OUT, "safehands", "-x", "*.DS_Store"], {
    cwd: anvitaDir, stdio: "inherit",
  });
} catch {
  console.log("zip CLI unavailable — falling back to tar");
  execFileSync("tar", ["-a", "-c", "-f", OUT, "-C", anvitaDir, "safehands"], {
    stdio: "inherit",
  });
}

// ── verify structure ─────────────────────────────────────────────────────
let listing = "";
try { listing = execFileSync("unzip", ["-l", OUT], { encoding: "utf8" }); }
catch { listing = execFileSync("tar", ["-t", "-f", OUT], { encoding: "utf8" }); }
if (!/safehands\/SKILL\.md/.test(listing))
  die("zip verify failed: safehands/SKILL.md not at top level — do NOT upload");
console.log(listing.split("\n").filter(l => l.includes("safehands/")).slice(0, 6).join("\n"));
console.log(`✓ built ${OUT} with correct top-level folder`);
