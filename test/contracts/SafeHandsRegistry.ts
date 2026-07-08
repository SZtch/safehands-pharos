import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, encodeAbiParameters, parseAbiParameters, getAddress, toFunctionSelector } from "viem";
import { MerkleTree } from "merkletreejs";

async function rejectsWithError(promise: Promise<unknown>, errorName: string): Promise<void> {
  const selector = toFunctionSelector(`${errorName}()`);
  await assert.rejects(promise, (err: unknown) => {
    const msg = String(err);
    return msg.includes(errorName) || msg.includes(selector);
  });
}

async function deployFixture() {
  const { viem } = await network.create();
  const registry = await viem.deployContract("SafeHandsRegistry");
  const [ownerWallet, operatorWallet, userWallet] = await viem.getWalletClients();
  await registry.write.setOperator([operatorWallet.account.address, true]);
  return { registry, ownerWallet, operatorWallet, userWallet };
}

describe("SafeHandsRegistry (L2 Merkle Batching)", async function () {
  
  describe("Governance", async function () {
    it("should allow owner to set operator", async function () {
      const { registry, userWallet } = await deployFixture();
      await registry.write.setOperator([userWallet.account.address, true]);
      assert.equal(await registry.read.isAuthorizedOperator([userWallet.account.address]), true);
    });

    it("should prevent non-owner from setting operator", async function () {
      const { registry, operatorWallet, userWallet } = await deployFixture();
      await rejectsWithError(
        registry.write.setOperator([userWallet.account.address, true], { account: operatorWallet.account }),
        "OwnableUnauthorizedAccount"
      );
    });

    it("transfers ownership in two steps (Ownable2Step)", async function () {
      const { registry, ownerWallet, userWallet } = await deployFixture();

      // Step 1: current owner nominates — ownership does NOT move yet.
      await registry.write.transferOwnership([userWallet.account.address]);
      assert.equal(
        (await registry.read.owner()).toLowerCase(),
        ownerWallet.account.address.toLowerCase()
      );
      assert.equal(
        (await registry.read.pendingOwner()).toLowerCase(),
        userWallet.account.address.toLowerCase()
      );

      // A mistyped/uncontrolled nominee can never accept → owner stays put. Here the
      // real nominee accepts, completing the handoff.
      await registry.write.acceptOwnership({ account: userWallet.account });
      assert.equal(
        (await registry.read.owner()).toLowerCase(),
        userWallet.account.address.toLowerCase()
      );
    });

    it("only the pending owner can accept ownership", async function () {
      const { registry, operatorWallet, userWallet } = await deployFixture();
      await registry.write.transferOwnership([userWallet.account.address]);
      await rejectsWithError(
        registry.write.acceptOwnership({ account: operatorWallet.account }),
        "OwnableUnauthorizedAccount"
      );
    });

    it("renounceOwnership is disabled (registry must keep an owner)", async function () {
      const { registry } = await deployFixture();
      await rejectsWithError(registry.write.renounceOwnership(), "RenounceDisabled");
    });
  });

  describe("L2 Merkle Batching", async function () {
    it("should allow operator to commit merkle root", async function () {
      const { registry, operatorWallet } = await deployFixture();
      const root = "0x" + "1".repeat(64) as `0x${string}`;
      const uri = "ipfs://QmTest";
      
      await registry.write.commitRiskRoot([root, uri], { account: operatorWallet.account });
      
      assert.equal(await registry.read.currentMerkleRoot(), root);
      assert.equal(await registry.read.currentDataURI(), uri);
    });

    it("should prevent non-operator from committing root", async function () {
      const { registry, userWallet } = await deployFixture();
      const root = "0x" + "1".repeat(64) as `0x${string}`;
      await rejectsWithError(
        registry.write.commitRiskRoot([root, "ipfs://"], { account: userWallet.account }),
        "NotOperator"
      );
    });

    it("should reject zero root and empty data URI", async function () {
      const { registry, operatorWallet } = await deployFixture();
      const root = "0x" + "1".repeat(64) as `0x${string}`;
      await rejectsWithError(
        registry.write.commitRiskRoot(["0x" + "0".repeat(64) as `0x${string}`, "ipfs://data"], { account: operatorWallet.account }),
        "InvalidRoot"
      );
      await rejectsWithError(
        registry.write.commitRiskRoot([root, ""], { account: operatorWallet.account }),
        "EmptyDataURI"
      );
    });

    it("should verify valid risk record using merkle proof", async function () {
      const { registry, operatorWallet, userWallet } = await deployFixture();
      
      const target = getAddress(userWallet.account.address);
      const actionHash = keccak256(new TextEncoder().encode("action"));
      const score = 85;
      const level = 2; // HIGH
      const recommendation = 2; // BLOCK
      const policyVersionHash = keccak256(new TextEncoder().encode("v1"));
      const evidenceHash = keccak256(new TextEncoder().encode("evidence"));
      const expiresAt = 4000000000n;

      const leafAbi = parseAbiParameters("address, bytes32, uint8, uint8, uint8, bytes32, bytes32, uint64");
      
      const leafData = encodeAbiParameters(leafAbi, [
        target, actionHash, score, level, recommendation, policyVersionHash, evidenceHash, expiresAt
      ]);
      
      const firstHash = keccak256(leafData);
      const leafForTree = keccak256(firstHash);

      const tree = new MerkleTree([leafForTree], keccak256, { sortPairs: true });
      const root = tree.getHexRoot() as `0x${string}`;
      const proof = tree.getHexProof(leafForTree) as `0x${string}`[];

      await registry.write.commitRiskRoot([root, "ipfs://data"], { account: operatorWallet.account });

      const isValid = await registry.read.verifyRiskRecord([
        target, actionHash, score, level, recommendation, policyVersionHash, evidenceHash, expiresAt, proof
      ]);

      assert.equal(isValid, true);
    });

    it("should treat expiresAt=0 as never-expiring", async function () {
      const { registry, operatorWallet, userWallet } = await deployFixture();

      const target = getAddress(userWallet.account.address);
      const actionHash = keccak256(new TextEncoder().encode("action-never-expire"));
      const score = 50;
      const level = 1;
      const recommendation = 1;
      const policyVersionHash = keccak256(new TextEncoder().encode("v1"));
      const evidenceHash = keccak256(new TextEncoder().encode("evidence"));
      const expiresAt = 0n;

      const leafAbi = parseAbiParameters("address, bytes32, uint8, uint8, uint8, bytes32, bytes32, uint64");
      const leafData = encodeAbiParameters(leafAbi, [
        target, actionHash, score, level, recommendation, policyVersionHash, evidenceHash, expiresAt
      ]);

      const leafForTree = keccak256(keccak256(leafData));
      const tree = new MerkleTree([leafForTree], keccak256, { sortPairs: true });
      const root = tree.getHexRoot() as `0x${string}`;
      const proof = tree.getHexProof(leafForTree) as `0x${string}`[];

      await registry.write.commitRiskRoot([root, "ipfs://never-expire"], { account: operatorWallet.account });

      const isValid = await registry.read.verifyRiskRecord([
        target, actionHash, score, level, recommendation, policyVersionHash, evidenceHash, expiresAt, proof
      ]);

      assert.equal(isValid, true);
    });

    it("should reject invalid merkle proof for altered record", async function () {
      const { registry, operatorWallet, userWallet } = await deployFixture();

      const target = getAddress(userWallet.account.address);
      const actionHash = keccak256(new TextEncoder().encode("action"));
      const score = 85;
      const level = 2;
      const recommendation = 2;
      const policyVersionHash = keccak256(new TextEncoder().encode("v1"));
      const evidenceHash = keccak256(new TextEncoder().encode("evidence"));
      const expiresAt = 4000000000n;

      const leafAbi = parseAbiParameters("address, bytes32, uint8, uint8, uint8, bytes32, bytes32, uint64");
      const leafData = encodeAbiParameters(leafAbi, [
        target, actionHash, score, level, recommendation, policyVersionHash, evidenceHash, expiresAt
      ]);
      
      const leafForTree = keccak256(keccak256(leafData));
      const tree = new MerkleTree([leafForTree], keccak256, { sortPairs: true });
      const root = tree.getHexRoot() as `0x${string}`;
      const proof = tree.getHexProof(leafForTree) as `0x${string}`[];

      await registry.write.commitRiskRoot([root, "ipfs://data"], { account: operatorWallet.account });

      const isInvalidAltered = await registry.read.verifyRiskRecord([
        target, actionHash, 100, level, recommendation, policyVersionHash, evidenceHash, expiresAt, proof
      ]);

      assert.equal(isInvalidAltered, false);
    });
  });
});
