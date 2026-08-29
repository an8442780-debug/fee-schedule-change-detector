import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry } from "../src/wallets-core.js";

const provider = { request() {} };

test("deduplicates repeated EIP-6963 announcements by uuid and provider object", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.upsertAnnouncement({ uuid: "one", rdns: "io.metamask", provider, name: "MetaMask" }), true);
  assert.equal(registry.upsertAnnouncement({ uuid: "one", rdns: "io.metamask", provider, name: "MetaMask Updated" }), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].provider, provider);
});

test("legacy fallback is neutral and is replaced by the first supported announcement", () => {
  const registry = createProviderRegistry();
  const legacy = { request() {} };
  assert.equal(registry.addLegacy(legacy), true);
  assert.equal(registry.list()[0].label, "Injected wallet");
  assert.equal(registry.upsertAnnouncement({ uuid: "rabby", rdns: "io.rabby", provider, icon: "icon" }), true);
  assert.deepEqual(registry.list().map((item) => item.label), ["Rabby"]);
  assert.equal(registry.list()[0].provider, provider);
});

test("unknown identities and invalid providers are ignored", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.upsertAnnouncement({ uuid: "unknown", rdns: "evil.wallet", provider }), false);
  assert.equal(registry.upsertAnnouncement({ uuid: "bad", rdns: "io.rabby", provider: {} }), false);
  assert.equal(registry.list().length, 0);
});
