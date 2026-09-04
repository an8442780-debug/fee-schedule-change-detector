import test from "node:test";
import assert from "node:assert/strict";
import {
  authoritativeCaseReadRequest,
  caseReadbackMatches,
  createCaseInputError,
  createdCaseReadbackMatches,
  formatActionSuccess,
  formatRowEvidence,
  formatScaledAmount,
  rowCounts,
} from "../src/case-state.js";

const frozenUnresolved = {
  case_id: "case-1",
  state: "FROZEN",
  outcome: "UNRESOLVED",
  retry_count: 0,
};

test("created readback requires the intended draft case", () => {
  assert.equal(createdCaseReadbackMatches("case-1", {
    case_id: "case-1",
    state: "DRAFT",
    outcome: "UNRESOLVED",
    retry_count: 0,
  }), true);
  assert.equal(createdCaseReadbackMatches("case-1", {
    case_id: "case-1",
    state: "ASSESSED",
    outcome: "SAME_SCHEDULE",
    retry_count: 0,
  }), false);
});

test("empty create input is rejected before any write", () => {
  assert.equal(createCaseInputError({}), "Enter a case ID and both source URLs before creating a case.");
  assert.equal(createCaseInputError({ caseId: "case-1", urlA: "https://a.example", urlB: "https://b.example" }), "");
});

test("freeze readback requires the state transition and preserves retry count", () => {
  const after = { ...frozenUnresolved, state: "FROZEN" };
  assert.equal(caseReadbackMatches("freeze", "case-1", {
    ...frozenUnresolved,
    state: "DRAFT",
  }, after), true);
  assert.equal(caseReadbackMatches("freeze", "case-1", {
    ...frozenUnresolved,
    state: "DRAFT",
  }, { ...after, retry_count: 1 }), false);
});

test("assess readback accepts resolved or unchanged unresolved outcomes only", () => {
  assert.equal(caseReadbackMatches("assess", "case-1", frozenUnresolved, {
    ...frozenUnresolved,
    state: "ASSESSED",
    outcome: "FEE_CHANGED",
  }), true);
  assert.equal(caseReadbackMatches("assess", "case-1", frozenUnresolved, frozenUnresolved), true);
  assert.equal(caseReadbackMatches("assess", "case-1", frozenUnresolved, {
    ...frozenUnresolved,
    state: "ASSESSED",
    outcome: "UNRESOLVED",
  }), false);
});

test("retry readback requires exactly one retry and the intended transition", () => {
  assert.equal(caseReadbackMatches("retry", "case-1", frozenUnresolved, {
    ...frozenUnresolved,
    retry_count: 1,
  }), true);
  assert.equal(caseReadbackMatches("retry", "case-1", frozenUnresolved, {
    ...frozenUnresolved,
    state: "ASSESSED",
    outcome: "SAME_SCHEDULE",
    retry_count: 1,
  }), true);
  assert.equal(caseReadbackMatches("retry", "case-1", frozenUnresolved, frozenUnresolved), false);
});

test("row counts remain separate for unequal old and new snapshots", () => {
  assert.deepEqual(rowCounts({
    old_rows: [{}, {}],
    new_rows: [{}],
  }), { old: 2, new: 1 });
});

test("authoritative amounts and rows render without floating-point conversion", () => {
  assert.equal(formatScaledAmount(1250, 2), "12.50");
  assert.equal(formatScaledAmount("1300", 2), "13.00");
  assert.equal(formatRowEvidence({
    service_code: "BASE",
    unit: "day",
    amount_scaled: 1300,
    currency: "USD",
    effective_date: "2026-01-01",
  }, 2), "BASE · day · 13.00 USD · effective 2026-01-01");
});

test("success toasts use user-facing labels for every action", () => {
  const messages = ["freeze", "assess", "retry"].map((action) => formatActionSuccess(action, true));
  assert.deepEqual(messages, [
    "Freeze case finalized and read back. Explorer link is available in the transaction details.",
    "Assess case finalized and read back. Explorer link is available in the transaction details.",
    "Retry unresolved case finalized and read back. Explorer link is available in the transaction details.",
  ]);
  for (const message of messages) {
    assert.doesNotMatch(message, /freeze_case|retry_unresolved/);
  }
});

test("get_case read requests explicitly use the latest finalized variant", () => {
  assert.deepEqual(authoritativeCaseReadRequest("0xcontract", "case-1"), {
    address: "0xcontract",
    functionName: "get_case",
    args: ["case-1"],
    transactionHashVariant: "latest-final",
  });
});
