const SUPPORTED = new Map([
  ["io.metamask", "MetaMask"],
  ["com.okex.wallet", "OKX Wallet"],
  ["io.rabby", "Rabby"],
]);

function validProvider(provider) {
  return provider && typeof provider.request === "function";
}

export function formatWalletError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    return String(error.message ?? error.shortMessage ?? error.reason ?? error.error?.message ?? "Wallet connection could not be completed.");
  }
  return String(error ?? "Wallet connection could not be completed.");
}

export function createProviderRegistry() {
  const byUuid = new Map();
  const byProvider = new Map();

  function removeLegacy() {
    for (const [uuid, option] of byUuid) {
      if (option.legacy) {
        byUuid.delete(uuid);
        byProvider.delete(option.provider);
      }
    }
  }

  return {
    upsertAnnouncement(info) {
      const provider = info?.provider;
      const rdns = info?.rdns;
      if (!validProvider(provider) || !SUPPORTED.has(rdns) || typeof info?.uuid !== "string") return false;
      removeLegacy();
      const previous = byUuid.get(info.uuid) ?? byProvider.get(provider);
      if (previous && previous.uuid !== info.uuid) byUuid.delete(previous.uuid);
      const option = {
        uuid: info.uuid,
        provider,
        rdns,
        label: SUPPORTED.get(rdns),
        icon: typeof info.icon === "string" ? info.icon : "",
        legacy: false,
      };
      byUuid.set(info.uuid, option);
      byProvider.set(provider, option);
      return true;
    },
    addLegacy(provider) {
      if (!validProvider(provider) || byUuid.size > 0) return false;
      const option = { uuid: "legacy-injected", provider, rdns: "", label: "Detected wallet", icon: "", legacy: true };
      byUuid.set(option.uuid, option);
      byProvider.set(provider, option);
      return true;
    },
    list() {
      return [...byUuid.values()];
    },
  };
}
