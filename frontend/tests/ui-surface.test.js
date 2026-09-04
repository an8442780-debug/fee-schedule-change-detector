import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("command palette lives outside the inert page shell", () => {
  const shellEnd = html.indexOf("\n    </div>\n\n    <!-- Wallet Dialog -->");
  const overlayRoot = html.indexOf('<div class="overlay-root" id="overlay-root">');
  const palette = html.indexOf('<div class="cmdk" id="cmdk"', overlayRoot);

  assert.notEqual(shellEnd, -1);
  assert.ok(overlayRoot > shellEnd);
  assert.ok(palette > overlayRoot);
  assert.match(html.slice(overlayRoot, palette), /overlay-root/);
});

test("public page copy does not expose implementation labels", () => {
  const prohibited = [
    "u256",
    "get_case",
    "TransactionHashVariant",
    "LATEST_FINAL",
    "genlayer-js",
    "gl.nondet.web.get",
    "gl.vm.run_nondet_unsafe",
    "textContent",
    "innerHTML",
    "EIP-6963",
    "provider discovery",
    "RPC endpoint",
    "gl.message.sender_address",
    "_require_owner",
    "create_case",
    "freeze_case",
    "retry_unresolved",
  ];

  for (const term of prohibited) {
    assert.equal(html.toLowerCase().includes(term.toLowerCase()), false, `found prohibited term: ${term}`);
  }
});

test("public page keeps IDs unique and local anchors resolvable", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  const anchors = [...html.matchAll(/\bhref="#([^"]+)"/g)].map((match) => match[1]);
  for (const anchor of anchors) {
    assert.ok(ids.includes(anchor), `missing local anchor target: ${anchor}`);
  }
});
