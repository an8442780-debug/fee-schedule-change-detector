import { ExecutionResult } from "genlayer-js/types";

const JOURNAL_KEY = "fee-schedule-change-detector:pending-write";
let volatileWrite = null;

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
    if (status === "FINALIZED") return transaction;
    await new Promise((resolve) => setTimeout(resolve, Math.min(4000 + attempt * 150, 7000)));
  }
  throw new Error("The transaction is still pending; its hash has been retained for reconciliation.");
}

export function readPending() {
  try {
    const value = localStorage.getItem(JOURNAL_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export async function executeWrite({ client, contractAddress, functionName, args, readback, onUpdate }) {
  if (volatileWrite) throw new Error("A write is already being reconciled on this page.");
  if (!storageRoundTrip()) throw new Error("Browser recovery storage is unavailable; no transaction was sent.");
  const journal = { contractAddress, functionName, args, createdAt: new Date().toISOString() };
  volatileWrite = journal;
  let hash;
  try {
    hash = await client.writeContract({ address: contractAddress, functionName, args, value: BigInt(0) });
    volatileWrite = { ...journal, hash };
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(volatileWrite)); } catch { /* the volatile lock remains authoritative */ }
    const transaction = await waitForFinality(client, hash, onUpdate);
    const execution = executionName(transaction);
    const success = execution === ExecutionResult.FINISHED_WITH_RETURN || execution === "FINISHED_WITH_RETURN";
    if (!success) throw new Error(`GenLayer finalized the transaction with execution result ${execution || "UNKNOWN"}.`);
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

export function explorerUrl(client, hash) {
  const base = client?.chain?.blockExplorers?.default?.url;
  return base ? `${base.replace(/\/$/, "")}/tx/${hash}` : "";
}
