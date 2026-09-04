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

test("wallet display state renders only detected callable providers", () => {
  const empty = walletDisplayState([]);
  assert.equal(empty.options.length, 0);
  assert.equal(empty.emptyMessage, "No supported wallet detected");

  const okx = { uuid: "okx", provider, rdns: "com.okex.wallet", label: "OKX Wallet" };
  const metamask = { uuid: "metamask", provider: { request() {} }, rdns: "io.metamask", label: "MetaMask" };
  const one = walletDisplayState([okx]);
  assert.equal(one.options.length, 1);
  assert.equal(one.options[0], okx);
  assert.equal(one.emptyMessage, "");

  const multiple = walletDisplayState([okx, { uuid: "fake", provider: null }, { uuid: "invalid", provider: {} }, metamask]);
  assert.deepEqual(multiple.options, [okx, metamask]);
  assert.equal(multiple.options.length, 2);
  assert.equal(multiple.emptyMessage, "");
});

const studioChain = {
  id: 61999,
  name: "GenLayer Studio Network",
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  blockExplorers: { default: { url: "https://genlayer-explorer.vercel.app" } },
};

test("selected EIP-6963 provider switches directly without a MetaMask global", async () => {
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
  assert.deepEqual(calls.map(({ method }) => method), [
    "eth_chainId",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  assert.deepEqual(calls[2].params, [chainSwitchParams(studioChain)]);
});
