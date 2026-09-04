import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { chainIdNumber, createProviderRegistry, ensureProviderOnChain } from "./wallets-core.js";

const registry = createProviderRegistry();
const listeners = new Set();
let discoveryStarted = false;

function notify() {
  const options = registry.list();
  for (const listener of listeners) listener(options);
}

function legacyWallet(provider) {
  if (!provider || typeof provider.request !== "function") return "";
  const matches = [
    [provider.isMetaMask === true && provider.isRabby !== true, "io.metamask"],
    [provider.isOkxWallet === true || provider.isOKExWallet === true, "com.okex.wallet"],
    [provider.isRabby === true, "io.rabby"],
  ].filter(([match]) => match).map(([, rdns]) => rdns);
  return matches.length === 1 ? matches[0] : "";
}

function legacyCandidates() {
  const injected = window.ethereum;
  const providers = Array.isArray(injected?.providers) ? injected.providers : [];
  return [
    ...providers,
    injected,
    window.okxwallet?.ethereum ?? window.okxwallet,
    window.rabby,
  ];
}

function collectLegacy() {
  let changed = false;
  for (const provider of legacyCandidates()) {
    const rdns = legacyWallet(provider);
    if (rdns) changed = registry.addLegacy(provider, rdns) || changed;
  }
  if (changed) notify();
}

export function startWalletDiscovery() {
  if (discoveryStarted || typeof window === "undefined") return;
  discoveryStarted = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    if (registry.upsertAnnouncement(event.detail)) notify();
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  queueMicrotask(collectLegacy);
  setTimeout(collectLegacy, 300);
}

startWalletDiscovery();

export function subscribeWallets(listener) {
  startWalletDiscovery();
  listeners.add(listener);
  listener(registry.list());
  return () => listeners.delete(listener);
}

export function getWalletsSnapshot() {
  startWalletDiscovery();
  return registry.list();
}

export async function connectWallet(option, onInvalidated = () => {}) {
  if (!option?.provider || typeof option.provider.request !== "function") throw new Error("The selected wallet cannot be connected.");
  const accounts = await option.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error("The wallet returned no valid account.");
  const account = accounts[0];
  await ensureProviderOnChain(option.provider, studionet);
  const client = createClient({ chain: studionet, account, provider: option.provider });
  const onAccountsChanged = (nextAccounts) => {
    const active = Array.isArray(nextAccounts) ? String(nextAccounts[0] ?? "") : "";
    if (active.toLowerCase() !== account.toLowerCase()) onInvalidated("Wallet account changed. Reconnect before writing.", option.provider);
  };
  const onChainChanged = (chainId) => {
    if (chainIdNumber(chainId) !== studionet.id) onInvalidated("Wallet network changed. Reconnect on Studionet before writing.", option.provider);
  };
  const onDisconnect = () => onInvalidated("Wallet disconnected. Reconnect before writing.", option.provider);
  option.provider.on?.("accountsChanged", onAccountsChanged);
  option.provider.on?.("chainChanged", onChainChanged);
  option.provider.on?.("disconnect", onDisconnect);
  const dispose = () => {
    option.provider.removeListener?.("accountsChanged", onAccountsChanged);
    option.provider.removeListener?.("chainChanged", onChainChanged);
    option.provider.removeListener?.("disconnect", onDisconnect);
  };
  return { account, client, provider: option.provider, dispose };
}

export async function validateWalletForWrite(session) {
  if (!session?.provider || !session?.client) throw new Error("Connect a wallet before writing.");
  const [accounts, chainId, balance] = await Promise.all([
    session.provider.request({ method: "eth_accounts" }),
    session.provider.request({ method: "eth_chainId" }),
    session.client.getBalance({ address: session.account }),
  ]);
  const active = Array.isArray(accounts) ? String(accounts[0] ?? "") : "";
  if (active.toLowerCase() !== session.account.toLowerCase()) throw new Error("Wallet account changed. Reconnect before writing.");
  if (chainIdNumber(chainId) !== studionet.id) throw new Error("Wallet network changed. Reconnect on Studionet before writing.");
  let spendable;
  try {
    spendable = typeof balance === "bigint" ? balance : BigInt(balance);
  } catch {
    throw new Error("The wallet balance could not be verified.");
  }
  if (spendable <= 0n) throw new Error("The selected wallet has no spendable GEN.");
}
