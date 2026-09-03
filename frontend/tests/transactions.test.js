import test from "node:test";
import assert from "node:assert/strict";
import { executeWrite, readPending } from "../src/transactions.js";

const HASH = "0x" + "a".repeat(64);
const CONTRACT = "0x" + "b".repeat(40);
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

function clientWith(transaction) {
  return {
    chain: { blockExplorers: { default: { url: "https://explorer.example" } } },
    writeContract: async () => HASH,
    getTransaction: async () => transaction,
  };
}

test("write success requires finalized agreement, execution success and readback", async () => {
  const updates = [];
  const result = await executeWrite({
    client: clientWith({
      statusName: "FINALIZED",
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    }),
    contractAddress: CONTRACT,
    functionName: "freeze_case",
    args: ["case-1"],
    readback: async () => true,
    onUpdate: (update) => updates.push(update),
  });
  assert.equal(result.hash, HASH);
  assert.equal(updates[0].status, "FINALIZED");
  assert.equal(readPending(), null);
});

test("a pending journal blocks a second submission", async () => {
  storage.set("fee-schedule-change-detector:pending-write", JSON.stringify({
    contractAddress: CONTRACT,
    functionName: "freeze_case",
    args: ["case-1"],
    hash: HASH,
  }));
  let submitted = false;
  await assert.rejects(
    executeWrite({
      client: {
        writeContract: async () => { submitted = true; return HASH; },
      },
      contractAddress: CONTRACT,
      functionName: "freeze_case",
      args: ["case-1"],
      readback: async () => true,
      onUpdate: () => {},
    }),
    /pending reconciliation/i,
  );
  assert.equal(submitted, false);
  storage.clear();
});

test("consensus disagreement is not a successful write", async () => {
  await assert.rejects(
    executeWrite({
      client: clientWith({
        statusName: "FINALIZED",
        resultName: "MAJORITY_DISAGREE",
        txExecutionResultName: "FINISHED_WITH_RETURN",
      }),
      contractAddress: CONTRACT,
      functionName: "assess",
      args: ["case-1"],
      readback: async () => true,
      onUpdate: () => {},
    }),
    /Consensus failed/i,
  );
  assert.equal(readPending()?.hash, HASH);
});
