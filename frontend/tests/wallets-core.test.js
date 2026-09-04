import test from "node:test";
import assert from "node:assert/strict";
import {
  chainSwitchParams,
  createProviderRegistry,
  ensureProviderOnChain,
  formatWalletError,
  supportedWallets,
  walletDisplayState,
} from "../src/wallets-core.js";

const callable = () => ({ request() {} });
const announcement = (uuid, rdns, provider, icon = "https://wallet.example/icon.svg") => ({
  info: { uuid, rdns, name: "untrusted name", icon },
  provider,
});

test("accepts nested EIP-6963 announcements and deduplicates by uuid/provider", () => {
  const registry = createProviderRegistry();
  const provider = callable();
  assert.equal(registry.upsertAnnouncement(announcement("one", "io.metamask", provider)), true);
  assert.equal(registry.upsertAnnouncement(announcement("one", "io.metamask", provider)), true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.list()[0].provider, provider);
  assert.equal(registry.list()[0].label, "MetaMask");
  assert.equal(registry.list()[0].icon, "/wallets/metamask.svg");
});

test("supports each canonical wallet and the OKX rdns alias", () => {
  const registry = createProviderRegistry();
  assert.equal(registry.upsertAnnouncement(announcement("okx", "com.okx.wallet", callable())), true);
  assert.equal(registry.upsertAnnouncement(announcement("mm", "io.metamask", callable())), true);
  assert.equal(registry.upsertAnnouncement(announcement("rabby", "io.rabby", callable())), true);
  assert.deepEqual(registry.list().map(({ label }) => label), ["OKX Wallet", "MetaMask", "Rabby"]);
});

test("preserves different legacy wallets and replaces only the matching legacy wallet", () => {
  const registry = createProviderRegistry();
  const legacyMetaMask = callable();
  const legacyOkx = callable();
  const announcedMetaMask = callable();
  assert.equal(registry.addLegacy(legacyMetaMask, "io.metamask"), true);
  assert.equal(registry.addLegacy(legacyOkx, "com.okex.wallet"), true);
  assert.deepEqual(registry.list().map(({ label }) => label), ["OKX Wallet", "MetaMask"]);
  assert.equal(registry.upsertAnnouncement(announcement("mm", "io.metamask", announcedMetaMask)), true);
  assert.equal(registry.list().length, 2);
  assert.equal(registry.list().find(({ label }) => label === "MetaMask").provider, announcedMetaMask);
  assert.equal(registry.list().find(({ label }) => label === "OKX Wallet").provider, legacyOkx);
});

test("rejects unknown, malformed, conflicting, and provider-null announcements", () => {
  const registry = createProviderRegistry();
  const provider = callable();
  assert.equal(registry.upsertAnnouncement({ info: { uuid: "unknown", rdns: "evil.wallet" }, provider }), false);
  assert.equal(registry.upsertAnnouncement({ info: { uuid: "bad", rdns: "io.rabby" }, provider: {} }), false);
  assert.equal(registry.upsertAnnouncement({ info: { uuid: "bad", rdns: "io.rabby" }, provider: null }), false);
  assert.equal(registry.upsertAnnouncement(announcement("one", "io.rabby", provider)), true);
  assert.equal(registry.upsertAnnouncement(announcement("one", "io.rabby", callable())), false);
  assert.equal(registry.upsertAnnouncement(announcement("two", "io.metamask", provider)), false);
  assert.equal(registry.list().length, 1);
});

test("supported metadata is canonical and not a detected-wallet render list", () => {
  assert.deepEqual(supportedWallets(), [
    { rdns: "com.okex.wallet", label: "OKX Wallet", icon: "/wallets/okx.svg" },
    { rdns: "io.metamask", label: "MetaMask", icon: "/wallets/metamask.svg" },
    { rdns: "io.rabby", label: "Rabby", icon: "/wallets/rabby.svg" },
  ]);
});

test("wallet display cardinality is exactly zero, one, or the detected set", () => {
  const empty = walletDisplayState([]);
  assert.equal(empty.options.length, 0);
  assert.equal(empty.emptyMessage, "No supported wallet detected");

  const options = [
    { uuid: "okx", provider: callable(), label: "OKX Wallet", icon: "/wallets/okx.svg" },
    { uuid: "mm", provider: callable(), label: "MetaMask", icon: "/wallets/metamask.svg" },
    { uuid: "rabby", provider: callable(), label: "Rabby", icon: "/wallets/rabby.svg" },
  ];
  for (let count = 1; count <= 3; count += 1) {
    const state = walletDisplayState(options.slice(0, count));
    assert.equal(state.options.length, count);
    assert.equal(state.emptyMessage, "");
  }
  const filtered = walletDisplayState([options[0], { provider: null }, { provider: {} }]);
  assert.deepEqual(filtered.options, [options[0]]);
});

test("wallet errors expose a useful message instead of object coercion", () => {
  assert.equal(formatWalletError({ message: "User rejected the request." }), "User rejected the request.");
  assert.notEqual(formatWalletError({ code: 4001 }), "[object Object]");
});

const studioChain = {
  id: 61999,
  name: "GenLayer Studio Network",
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  blockExplorers: { default: { url: "https://genlayer-explorer.vercel.app" } },
};

test("selected provider switches directly without a global wallet", async () => {
  let currentChain = "0x1";
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_chainId") return currentChain;
      if (request.method === "wallet_switchEthereumChain") {
        currentChain = request.params[0].chainId;
        return null;
      }
      throw new Error(`Unexpected method ${request.method}`);
    },
  };
  await ensureProviderOnChain(provider, studioChain);
  assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "wallet_switchEthereumChain", "eth_chainId"]);
  assert.deepEqual(calls[1].params, [{ chainId: "0xf22f" }]);
});

test("unknown chain is added and switched on the selected provider", async () => {
  let currentChain = "0x1";
  let switchAttempts = 0;
  const calls = [];
  const provider = {
    async request(request) {
      calls.push(request);
      if (request.method === "eth_chainId") return currentChain;
      if (request.method === "wallet_switchEthereumChain") {
        switchAttempts += 1;
        if (switchAttempts === 1) throw { code: 4902, message: "Unrecognized chain" };
        currentChain = request.params[0].chainId;
        return null;
      }
      if (request.method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected method ${request.method}`);
    },
  };
  await ensureProviderOnChain(provider, studioChain);
  assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain", "eth_chainId"]);
  assert.deepEqual(calls[2].params, [chainSwitchParams(studioChain)]);
});
