import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createProviderRegistry } from "./wallets-core.js";

const registry = createProviderRegistry();
const listeners = new Set();

function notify() {
  for (const listener of listeners) listener(registry.list());
}

window.addEventListener("eip6963:announceProvider", (event) => {
  if (registry.upsertAnnouncement(event.detail)) notify();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
setTimeout(() => {
  if (registry.addLegacy(window.ethereum)) notify();
}, 300);

export function subscribeWallets(listener) {
  listeners.add(listener);
  listener(registry.list());
  return () => listeners.delete(listener);
}

export async function connectWallet(option) {
  const accounts = await option.provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !accounts[0]) throw new Error("The wallet returned no account.");
  const account = accounts[0];
  const client = createClient({ chain: studionet, account, provider: option.provider });
  await client.connect("studionet");
  return { account, client, provider: option.provider };
}
