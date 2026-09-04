const SUPPORTED = Object.freeze([
  Object.freeze({ id: "okx", rdns: Object.freeze(["com.okex.wallet", "com.okx.wallet"]), label: "OKX Wallet", icon: "/wallets/okx.svg" }),
  Object.freeze({ id: "metamask", rdns: Object.freeze(["io.metamask"]), label: "MetaMask", icon: "/wallets/metamask.svg" }),
  Object.freeze({ id: "rabby", rdns: Object.freeze(["io.rabby"]), label: "Rabby", icon: "/wallets/rabby.svg" }),
]);

const BY_RDNS = new Map(SUPPORTED.flatMap((wallet) => wallet.rdns.map((rdns) => [rdns, wallet])));

function validProvider(provider) {
  return provider && typeof provider.request === "function";
}

export function legacyWalletRdns(provider) {
  if (!validProvider(provider)) return "";
  const compatibilityMetaMaskFlag = provider.isMetaMask === true && typeof provider._metamask?.isUnlocked !== "function";
  if (compatibilityMetaMaskFlag) return "";
  const matches = [
    [provider.isMetaMask === true && provider.isRabby !== true, "io.metamask"],
    [provider.isOkxWallet === true || provider.isOKExWallet === true, "com.okex.wallet"],
    [provider.isRabby === true, "io.rabby"],
  ].filter(([match]) => match).map(([, rdns]) => rdns);
  return matches.length === 1 ? matches[0] : "";
}

function walletForRdns(rdns) {
  return typeof rdns === "string" ? BY_RDNS.get(rdns.trim().toLowerCase()) : undefined;
}

function optionFor(wallet, provider, { legacy = false, uuid = "" } = {}) {
  return {
    uuid,
    walletId: wallet.id,
    provider,
    rdns: wallet.rdns[0],
    label: wallet.label,
    icon: wallet.icon,
    legacy,
  };
}

export function walletDisplayState(options) {
  const detected = Array.isArray(options)
    ? options.filter((option) => validProvider(option?.provider) && typeof option.label === "string" && typeof option.icon === "string")
    : [];
  return {
    options: detected,
    emptyMessage: detected.length ? "" : "No supported wallet detected",
  };
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
  return SUPPORTED.map((wallet) => ({ rdns: wallet.rdns[0], label: wallet.label, icon: wallet.icon }));
}

export function createProviderRegistry() {
  const byWallet = new Map();
  const byUuid = new Map();
  const byProvider = new Map();

  function remove(option) {
    if (!option) return;
    byWallet.delete(option.walletId);
    byUuid.delete(option.uuid);
    byProvider.delete(option.provider);
  }

  function replace(option) {
    remove(byWallet.get(option.walletId));
    remove(byUuid.get(option.uuid));
    const bound = byProvider.get(option.provider);
    if (bound) remove(bound);
    byWallet.set(option.walletId, option);
    byUuid.set(option.uuid, option);
    byProvider.set(option.provider, option);
  }

  return {
    upsertAnnouncement(detail) {
      const info = detail?.info;
      const provider = detail?.provider;
      const wallet = walletForRdns(info?.rdns);
      if (!wallet || !validProvider(provider) || typeof info?.uuid !== "string" || !info.uuid.trim()) return false;
      const sameUuid = byUuid.get(info.uuid);
      if (sameUuid && sameUuid.provider !== provider) return false;
      const bound = byProvider.get(provider);
      if (bound && bound.walletId !== wallet.id) return false;
      replace(optionFor(wallet, provider, { uuid: info.uuid.trim() }));
      return true;
    },
    addLegacy(provider, rdns) {
      const wallet = walletForRdns(rdns);
      if (!wallet || !validProvider(provider) || byProvider.has(provider)) return false;
      if (byWallet.has(wallet.id)) return false;
      replace(optionFor(wallet, provider, { legacy: true, uuid: `legacy-${wallet.id}` }));
      return true;
    },
    list() {
      return SUPPORTED.map((wallet) => byWallet.get(wallet.id)).filter(Boolean);
    },
  };
}
