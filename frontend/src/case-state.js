import { TransactionHashVariant } from "genlayer-js/types";

const RESOLVED_OUTCOMES = new Set([
  "SAME_SCHEDULE",
  "FEE_CHANGED",
  "DATE_CONFLICT",
  "CURRENCY_CHANGED",
  "UNIT_CHANGED",
  "ROW_ADDED",
  "ROW_REMOVED",
]);

function hasCaseIdentity(caseData, caseId) {
  return Boolean(caseData) && caseData.case_id === caseId;
}

function isRetryCount(value) {
  return Number.isInteger(value) && value >= 0;
}

export function createdCaseReadbackMatches(caseId, after) {
  return hasCaseIdentity(after, caseId)
    && after.state === "DRAFT"
    && after.outcome === "UNRESOLVED"
    && after.retry_count === 0;
}

export function caseReadbackMatches(action, caseId, before, after) {
  if (
    !hasCaseIdentity(before, caseId)
    || !hasCaseIdentity(after, caseId)
    || !isRetryCount(before.retry_count)
    || !isRetryCount(after.retry_count)
  ) {
    return false;
  }

  if (action === "freeze") {
    return before.state === "DRAFT"
      && after.state === "FROZEN"
      && before.outcome === "UNRESOLVED"
      && after.outcome === "UNRESOLVED"
      && after.retry_count === before.retry_count;
  }

  if (action === "assess") {
    if (
      before.state !== "FROZEN"
      || before.outcome !== "UNRESOLVED"
      || after.retry_count !== before.retry_count
    ) {
      return false;
    }
    return (after.state === "FROZEN" && after.outcome === "UNRESOLVED")
      || (after.state === "ASSESSED" && RESOLVED_OUTCOMES.has(after.outcome));
  }

  if (action === "retry") {
    if (
      before.state !== "FROZEN"
      || before.outcome !== "UNRESOLVED"
      || after.retry_count !== before.retry_count + 1
    ) {
      return false;
    }
    return (after.state === "FROZEN" && after.outcome === "UNRESOLVED")
      || (after.state === "ASSESSED" && RESOLVED_OUTCOMES.has(after.outcome));
  }

  return false;
}

export function rowCounts(caseData) {
  return {
    old: Array.isArray(caseData?.old_rows) ? caseData.old_rows.length : 0,
    new: Array.isArray(caseData?.new_rows) ? caseData.new_rows.length : 0,
  };
}

export function authoritativeCaseReadRequest(contractAddress, caseId) {
  return {
    address: contractAddress,
    functionName: "get_case",
    args: [caseId],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  };
}

export function formatScaledAmount(value, scale) {
  const raw = Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === "string" && /^\d+$/.test(value)
      ? value
      : "";
  if (!raw || !Number.isInteger(scale) || scale < 0 || scale > 6) return "Unavailable";
  if (scale === 0) return raw;
  const padded = raw.padStart(scale + 1, "0");
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

export function formatRowEvidence(row, scale) {
  if (!row || typeof row !== "object") return "Unavailable";
  return [
    String(row.service_code ?? "UNKNOWN"),
    String(row.unit ?? "UNKNOWN"),
    `${formatScaledAmount(row.amount_scaled, scale)} ${String(row.currency ?? "UNKNOWN")}`,
    `effective ${String(row.effective_date ?? "UNKNOWN")}`,
  ].join(" · ");
}
