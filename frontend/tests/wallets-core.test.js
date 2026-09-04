import test from "node:test";
import assert from "node:assert/strict";
import { createProviderRegistry, formatWalletError, supportedWallets } from "../src/wallets-core.js";

const provider = { request() {} };

test("deduplicates repeated EIP-6963 announcements by uuid and provider object", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.upsertAnnouncement({ uuid: "one", rdns: "io.metamask", provider, name: "MetaMask" }), true);
  assert.equal(registry.upsertAnnouncement({ uuid: "one", rdns: "io.metamask", provider, name: "MetaMask Updated" }), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].provider, provider);
});

test("identified legacy wallets use canonical names and are replaced by announcements", () => {
  const registry = createProviderRegistry();
  const legacy = { request() {} };
  assert.equal(registry.addLegacy(legacy, "io.metamask"), true);
  assert.equal(registry.list()[0].label, "MetaMask");
  assert.equal(registry.upsertAnnouncement({ uuid: "rabby", rdns: "io.rabby", provider, icon: "icon" }), true);
  assert.deepEqual(registry.list().map((item) => item.label), ["Rabby"]);
  assert.equal(registry.list()[0].provider, provider);
});

test("unknown identities and invalid providers are ignored", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.upsertAnnouncement({ uuid: "unknown", rdns: "evil.wallet", provider }), false);
  assert.equal(registry.upsertAnnouncement({ uuid: "bad", rdns: "io.rabby", provider: {} }), false);
  assert.equal(registry.addLegacy(provider, "evil.wallet"), false);
  assert.equal(registry.addLegacy(provider), false);
  assert.equal(registry.list().length, 0);
});

test("supported wallet placeholders keep the complete canonical set", () => {
  assert.deepEqual(supportedWallets(), [
    { rdns: "com.okex.wallet", label: "OKX Wallet" },
    { rdns: "io.metamask", label: "MetaMask" },
    { rdns: "io.rabby", label: "Rabby" },
  ]);
});

test("wallet errors expose a useful message instead of object coercion", () => {
  assert.equal(formatWalletError({ message: "User rejected the request." }), "User rejected the request.");
  assert.notEqual(formatWalletError({ code: 4001 }), "[object Object]");
});
