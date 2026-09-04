const SUPPORTED = new Map([
  ["com.okex.wallet", "OKX Wallet"],
  ["io.metamask", "MetaMask"],
  ["io.rabby", "Rabby"],
]);

function validProvider(provider) {
  return provider && typeof provider.request === "function";
}

export function chainIdNumber(value) {
  if (typeof value === "string") return value.toLowerCase().startsWith("0x") ? Number.parseInt(value, 16) : Number(value);
  return Number(value);
}

export function chainSwitchParams(chain) {
  const params = {
    chainId: `0x${Number(chain.id).toString(16)}`,
    chainName: String(chain.name),
    rpcUrls: [String(chain.rpcUrls.default.http[0])],
    nativeCurrency: {
      name: String(chain.nativeCurrency.name),
      symbol: String(chain.nativeCurrency.symbol),
      decimals: Number(chain.nativeCurrency.decimals),
    },
  };
  const explorer = chain.blockExplorers?.default?.url;
  if (explorer) params.blockExplorerUrls = [String(explorer)];
  return params;
}

export function isUnknownChainError(error) {
  const code = Number(error?.code ?? error?.data?.originalError?.code ?? error?.error?.code);
  return code === 4902 || /unknown chain|unrecognized chain|chain not added/i.test(formatWalletError(error));
}

export async function ensureProviderOnChain(provider, chain) {
  if (!validProvider(provider)) throw new Error("The selected wallet cannot be connected.");
  const expectedChainId = Number(chain.id);
  const params = chainSwitchParams(chain);
  const currentChainId = chainIdNumber(await provider.request({ method: "eth_chainId" }));
  if (currentChainId === expectedChainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [params] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: params.chainId }] });
  }
  const finalChainId = chainIdNumber(await provider.request({ method: "eth_chainId" }));
  if (finalChainId !== expectedChainId) throw new Error(`Wallet could not connect to ${String(chain.name)}.`);
}

export function formatWalletError(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    return String(error.message ?? error.shortMessage ?? error.reason ?? error.error?.message ?? "Wallet connection could not be completed.");
  }
  return String(error ?? "Wallet connection could not be completed.");
}

export function supportedWallets() {
  return [...SUPPORTED.entries()].map(([rdns, label]) => ({ rdns, label }));
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
    addLegacy(provider, rdns) {
      if (!validProvider(provider) || !SUPPORTED.has(rdns) || byProvider.has(provider)) return false;
      const option = { uuid: `legacy-${rdns}`, provider, rdns, label: SUPPORTED.get(rdns), icon: "", legacy: true };
      byUuid.set(option.uuid, option);
      byProvider.set(provider, option);
      return true;
    },
    list() {
      return [...byUuid.values()];
    },
  };
}
