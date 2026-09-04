import { ExecutionResult, TransactionResult, TransactionStatus } from "genlayer-js/types";

const JOURNAL_KEY = "fee-schedule-change-detector:pending-write";
let volatileWrite = null;

function isHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value ?? ""));
}

function storageRoundTrip() {
  const probeKey = `${JOURNAL_KEY}:probe`;
  try {
    const previous = localStorage.getItem(probeKey);
    localStorage.setItem(probeKey, "ok");
    if (localStorage.getItem(probeKey) !== "ok") return false;
    localStorage.removeItem(probeKey);
    if (previous !== null) localStorage.setItem(probeKey, previous);
    return true;
  } catch {
    return false;
  }
}

function executionName(transaction) {
  if (transaction?.txExecutionResultName) return String(transaction.txExecutionResultName);
  const leader = transaction?.consensus_data?.leader_receipt?.find((receipt) => receipt?.mode === "leader");
  if (leader?.execution_result === "SUCCESS" && leader?.result?.status === "return") return "FINISHED_WITH_RETURN";
  return "";
}

async function waitForFinality(client, hash, onUpdate) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const transaction = await client.getTransaction({ hash });
    const status = String(transaction?.statusName ?? transaction?.status ?? "").toUpperCase();
    onUpdate({ hash, status: status || "ACCEPTED", attempt: attempt + 1 });
    if (status === TransactionStatus.FINALIZED) return transaction;
    await new Promise((resolve) => setTimeout(resolve, Math.min(4000 + attempt * 150, 7000)));
  }
  throw new Error("The transaction is still pending; its hash has been retained for reconciliation.");
}

function assertSuccessfulTransaction(transaction) {
  const status = String(transaction?.statusName ?? transaction?.status ?? "").toUpperCase();
  if (status !== TransactionStatus.FINALIZED) throw new Error("The transaction did not reach FINALIZED.");
  const consensus = String(transaction?.resultName ?? transaction?.result_name ?? "").toUpperCase();
  if (consensus !== TransactionResult.MAJORITY_AGREE) throw new Error("Consensus failed: " + (consensus || "UNKNOWN") + ".");
  const execution = executionName(transaction);
  if (execution !== ExecutionResult.FINISHED_WITH_RETURN) throw new Error("Contract execution failed: " + (execution || "UNKNOWN") + ".");
}

function isTerminalExecutionFailure(transaction) {
  const status = String(transaction?.statusName ?? transaction?.status ?? "").toUpperCase();
  const consensus = String(transaction?.resultName ?? transaction?.result_name ?? "").toUpperCase();
  return status === TransactionStatus.FINALIZED
    && consensus === TransactionResult.MAJORITY_AGREE
    && executionName(transaction) !== ExecutionResult.FINISHED_WITH_RETURN;
}

export function readPending() {
  try {
    const value = localStorage.getItem(JOURNAL_KEY);
    const pending = value ? JSON.parse(value) : null;
    if (!pending || typeof pending !== "object" || !isHash(pending.hash) || typeof pending.contractAddress !== "string" || typeof pending.functionName !== "string" || !Array.isArray(pending.args)) return null;
    return pending;
  } catch {
    return null;
  }
}

export async function executeWrite({ client, contractAddress, functionName, args, readback, onUpdate, recoveryData }) {
  if (volatileWrite) throw new Error("A write is already being reconciled on this page.");
  if (readPending()) throw new Error("A previous transaction is still pending reconciliation.");
  if (!storageRoundTrip()) throw new Error("Browser recovery storage is unavailable; no transaction was sent.");
  const journal = { contractAddress, functionName, args, recoveryData, createdAt: new Date().toISOString() };
  volatileWrite = journal;
  let hash;
  try {
    const submittedHash = await client.writeContract({ address: contractAddress, functionName, args, value: BigInt(0) });
    if (!isHash(submittedHash)) throw new Error("The wallet returned an invalid transaction hash.");
    hash = submittedHash;
    volatileWrite = { ...journal, hash };
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(volatileWrite)); } catch { /* the volatile lock remains authoritative */ }
    const transaction = await waitForFinality(client, hash, onUpdate);
    assertSuccessfulTransaction(transaction);
    const state = await readback();
    if (!state) throw new Error("Finality succeeded but authoritative case readback did not confirm the write.");
    try { localStorage.removeItem(JOURNAL_KEY); } catch { /* retain in-memory result for the current page */ }
    volatileWrite = null;
    return { hash, transaction, state };
  } catch (error) {
    if (!hash) volatileWrite = null;
    throw error;
  }
}

export async function reconcilePending({ client, readback, onUpdate }) {
  if (volatileWrite) throw new Error("A write is already being reconciled on this page.");
  const pending = readPending();
  if (!pending) return null;
  volatileWrite = pending;
  let releaseOnFailure = false;
  try {
    const transaction = await waitForFinality(client, pending.hash, onUpdate);
    try {
      assertSuccessfulTransaction(transaction);
    } catch (error) {
      if (!isTerminalExecutionFailure(transaction)) throw error;
      try { localStorage.removeItem(JOURNAL_KEY); } catch { /* retain the hash in the rendered transaction panel */ }
      volatileWrite = null;
      releaseOnFailure = true;
      throw new Error(`${error.message} The finalized transaction did not mutate contract state; its hash remains available above.`);
    }
    const state = await readback(pending);
    if (!state) throw new Error("Finality succeeded but authoritative case readback did not confirm the write.");
    try { localStorage.removeItem(JOURNAL_KEY); } catch { throw new Error("Transaction reconciled, but recovery cleanup failed."); }
    volatileWrite = null;
    return { hash: pending.hash, transaction, state };
  } catch (error) {
    if (!releaseOnFailure) volatileWrite = pending;
    throw error;
  }
}

export function explorerUrl(client, hash) {
  const base = client?.chain?.blockExplorers?.default?.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : "";
}
