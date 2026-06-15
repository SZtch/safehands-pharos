import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

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
      url: configVariable("PHAROS_RPC_URL"),
      accounts: [configVariable("RISK_REGISTRY_OWNER_PRIVATE_KEY")],
    },
  },
});
