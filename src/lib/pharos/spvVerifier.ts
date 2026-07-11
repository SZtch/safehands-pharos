import { createHash } from "crypto";
import { hexToBytes } from "viem";

export interface SPVProofNode {
  proofNode: string; // hex
  nextBeginOffset: number;
  nextEndOffset: number;
}

export interface SPVStorageProof {
  key: string;
  value: string;
  isExist: boolean;
  proof: SPVProofNode[];
}

export interface SPVSiblingProof {
  slotIndex: number;
  leftmostLeafKey: string;
  proofPath: SPVProofNode[];
}

export interface SPVResponse {
  balance: string;
  nonce: string;
  codeHash: string;
  storageHash: string;
  isExist: boolean;
  rawValue: string;
  accountProof: SPVProofNode[];
  storageProof: SPVStorageProof[];
  siblingLeftmostLeafProofs?: SPVSiblingProof[];
}

/**
 * Hash a hex string using SHA-256 (Pharos uses SHA-256 for SPV, not Keccak).
 */
export function sha256Hex(hexStr: string): string {
  const bytes = hexToBytes(hexStr as `0x${string}`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return `0x${hash}`;
}

/**
 * Gets a specific nibble (4 bits) from a hex hash string at the given depth.
 * depth 0 = first nibble, depth 1 = second nibble, etc.
 */
export function getNibbleAtDepth(hashHex: string, depth: number): number {
  const cleanHash = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
  if (depth >= cleanHash.length) return 0;
  return parseInt(cleanHash[depth], 16);
}

/**
 * Derives the expected nextBeginOffset based on the key and the node's depth.
 * This is CRITICAL for non-existence soundness to prevent fake slot redirection.
 */
export function deriveExpectedOffset(key: string, depth: number): number {
  if (depth === 0) {
    // MSU Root layer: 256 flat slots. Offset = last byte of key * 32
    const cleanKey = key.startsWith("0x") ? key.slice(2) : key;
    const lastByteHex = cleanKey.slice(-2);
    const msuSlotIndex = parseInt(lastByteHex, 16);
    return msuSlotIndex * 32;
  } else {
    // Internal node layer: 3-byte header + 16 slots. Offset = 3 + nibble * 32
    const keyHash = sha256Hex(key);
    // depth - 1 because depth 0 is MSU root. Internal nodes start at trie depth 0 (which is chain depth 1)
    const slotIdx = getNibbleAtDepth(keyHash, depth - 1);
    return 3 + slotIdx * 32;
  }
}

/**
 * Verifies a Pharos SPV Proof (Existence or Non-Existence).
 * Returns true if the proof is cryptographically sound and matches the stateRoot.
 */
export function verifyPharosSPV(
  key: string,
  stateRoot: string,
  isExist: boolean,
  proof: SPVProofNode[],
  siblings?: SPVSiblingProof[]
): boolean {
  if (!proof || proof.length === 0) return false;

  
  if (isExist) {
    // EXISTENCE PROOF VERIFICATION
    // 1. Verify Leaf
    const leaf = proof[proof.length - 1];
    // In this SPV verifier, we compute the hash of the leaf directly.
    let currentHash = sha256Hex(leaf.proofNode);

    // 2. Walk upwards to root
    for (let i = proof.length - 2; i >= 0; i--) {
      const parent = proof[i];
      const expectedOffset = deriveExpectedOffset(key, i);
      
      // Security Check: Enforce key-derived offset
      if (parent.nextBeginOffset !== expectedOffset) {
        throw new Error(`SPV Verification Failed: Invalid slot offset at depth ${i}. Expected ${expectedOffset}, got ${parent.nextBeginOffset}`);
      }
      
      currentHash = sha256Hex(parent.proofNode);
    }
    
    // 3. Verify against State Root
    return currentHash.toLowerCase() === stateRoot.toLowerCase();
    
  } else {
    // NON-EXISTENCE PROOF VERIFICATION
    // Step 1: Verify the main chain up to the empty slot internal node
    const lastInternal = proof[proof.length - 1];
    let currentHash = sha256Hex(lastInternal.proofNode);
    
    for (let i = proof.length - 2; i >= 0; i--) {
      const parent = proof[i];
      const expectedOffset = deriveExpectedOffset(key, i);
      if (parent.nextBeginOffset !== expectedOffset) {
        throw new Error(`SPV Non-Existence Failed: Invalid main chain offset at depth ${i}`);
      }
      currentHash = sha256Hex(parent.proofNode);
    }
    
    if (currentHash.toLowerCase() !== stateRoot.toLowerCase()) return false;
    
    // Step 2: Verify all sibling chains (Case 2)
    if (siblings && siblings.length > 0) {
      for (const sib of siblings) {
        if (!sib.proofPath || sib.proofPath.length === 0) continue;
        
        // Combine main chain (minus last node) with sibling path
        const combined = [...proof.slice(0, proof.length - 1), ...sib.proofPath];
        
        let sibHash = sha256Hex(combined[combined.length - 1].proofNode);
        for (let i = combined.length - 2; i >= 0; i--) {
          const parent = combined[i];
          const expectedOffset = deriveExpectedOffset(sib.leftmostLeafKey, i);
          
          if (parent.nextBeginOffset !== expectedOffset) {
             throw new Error(`SPV Sibling Verification Failed for slot ${sib.slotIndex}`);
          }
          sibHash = sha256Hex(parent.proofNode);
        }
        
        if (sibHash.toLowerCase() !== stateRoot.toLowerCase()) return false;
      }
    }
    
    return true;
  }
}
