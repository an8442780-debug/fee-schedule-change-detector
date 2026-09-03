import test from "node:test";
import assert from "node:assert/strict";
import { caseReadbackMatches, createdCaseReadbackMatches, rowCounts } from "../src/case-state.js";

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
