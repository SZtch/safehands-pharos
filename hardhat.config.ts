import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.20",
        settings: {
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    pharosAtlantic: {
      type: "http",
      chainType: "l1",
      url: process.env.PHAROS_RPC_URL || "https://rpc.pharos.xyz",
      accounts: process.env.RISK_REGISTRY_OWNER_PRIVATE_KEY ? [process.env.RISK_REGISTRY_OWNER_PRIVATE_KEY] : [],
    },
    // Pharos Pacific Mainnet (1672) — the public RPC URL is not a secret; only the
    // deployer key is read from a config variable (keystore/env), never committed.
    pharosPacific: {
      type: "http",
      chainType: "l1",
      url: "https://rpc.pharos.xyz",
      chainId: 1672,
      accounts: process.env.PHAROS_DEPLOYER_PRIVATE_KEY ? [process.env.PHAROS_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
});
