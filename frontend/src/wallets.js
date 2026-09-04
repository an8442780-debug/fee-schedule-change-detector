import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createProviderRegistry } from "./wallets-core.js";

const registry = createProviderRegistry();
const listeners = new Set();

function chainIdNumber(value) {
  if (typeof value === "string") return value.toLowerCase().startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  return Number(value);
}

function notify() {
  for (const listener of listeners) listener(registry.list());
}

window.addEventListener("eip6963:announceProvider", (event) => {
  if (registry.upsertAnnouncement(event.detail)) notify();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function legacyCandidates() {
  const providers = Array.isArray(window.ethereum?.providers) ? window.ethereum.providers : [];
  const metamask = providers.find((provider) => provider?.isMetaMask && !provider?.isRabby)
    ?? (window.ethereum?.isMetaMask && !window.ethereum?.isRabby ? window.ethereum : null);
  const rabby = providers.find((provider) => provider?.isRabby)
    ?? window.rabby
    ?? null;
  const okx = window.okxwallet?.ethereum ?? window.okxwallet ?? null;
  return [
    [metamask, "io.metamask"],
    [okx, "com.okex.wallet"],
    [rabby, "io.rabby"],
  ];
}

setTimeout(() => {
  let changed = false;
  for (const [provider, rdns] of legacyCandidates()) {
    changed = registry.addLegacy(provider, rdns) || changed;
  }
  if (changed) notify();
}, 300);

export function subscribeWallets(listener) {
  listeners.add(listener);
  listener(registry.list());
  return () => listeners.delete(listener);
}

export async function connectWallet(option, onInvalidated = () => {}) {
  const accounts = await option.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(accounts[0])) throw new Error("The wallet returned no valid account.");
  const account = accounts[0];
  const client = createClient({ chain: studionet, account, provider: option.provider });
  await client.connect("studionet");
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
