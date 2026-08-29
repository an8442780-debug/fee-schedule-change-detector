import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { connectWallet, subscribeWallets } from "./wallets.js";
import { executeWrite, explorerUrl } from "./transactions.js";
import "./style.css";

const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() ?? "";
const readClient = createClient({ chain: studionet });
let session = null;
let lastCase = null;
let unsubscribeWallets = null;

const $ = (id) => document.getElementById(id);
const dialog = $("wallet-dialog");
const shell = $("app-shell");
const walletOptions = $("wallet-options");
const walletError = $("wallet-error");
const toast = $("toast");
const resultPanel = $("result-panel");

function showToast(message, error = false) {
  toast.textContent = message;
  toast.dataset.error = error ? "true" : "false";
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 6000);
}

function requireAddress() {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) throw new Error("Set VITE_CONTRACT_ADDRESS before using the live contract.");
  return contractAddress;
}

async function readCase(caseId) {
  requireAddress();
  const value = await readClient.readContract({ address: contractAddress, functionName: "get_case", args: [caseId] });
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  lastCase = parsed;
  renderCase(parsed);
  return parsed;
}

function renderCase(caseData) {
  const rows = [...(caseData.old_rows ?? []), ...(caseData.new_rows ?? [])];
  resultPanel.innerHTML = `<div class="result-top"><span class="outcome outcome-${String(caseData.outcome).toLowerCase()}">${caseData.outcome}</span><span class="muted">${caseData.state}</span></div><dl class="case-facts"><div><dt>Case</dt><dd>${caseData.case_id}</dd></div><div><dt>Rows</dt><dd>${rows.length / 2}</dd></div><div><dt>Evidence digest</dt><dd class="mono">${caseData.evidence_digest || "Not assessed"}</dd></div></dl>`;
}

function renderWallets(options) {
  walletOptions.replaceChildren();
  if (!options.length) {
    walletOptions.innerHTML = `<p class="muted empty-state">No supported injected wallet was detected. Install MetaMask, OKX Wallet, or Rabby, then reload.</p>`;
    return;
  }
  for (const option of options) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.type = "button";
    button.innerHTML = `<span class="wallet-icon">${option.icon ? `<img src="${option.icon}" alt="" width="28" height="28">` : "◈"}</span><span><strong>${option.label}</strong><small>${option.legacy ? "Legacy injected provider" : "Detected with EIP-6963"}</small></span>`;
    button.addEventListener("click", async () => {
      walletError.hidden = true;
      try {
        session = await connectWallet(option);
        dialog.close();
        shell.inert = false;
        $("connect-wallet").textContent = `Connected · ${session.account.slice(0, 6)}…${session.account.slice(-4)}`;
        showToast("Wallet connected to Studionet.");
      } catch (error) {
        walletError.textContent = classifyError(error);
        walletError.hidden = false;
      }
    });
    walletOptions.append(button);
  }
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/user rejected|rejected|denied|4001/i.test(message)) return "Wallet request rejected. Choose a provider again when ready.";
  if (/chain|network/i.test(message)) return "The selected wallet could not switch to Studionet.";
  if (/429|rate limit|busy|timeout/i.test(message)) return "Studionet is temporarily unavailable. The original transaction hash, if any, remains available for reconciliation.";
  return message;
}

$("connect-wallet").addEventListener("click", () => {
  walletError.hidden = true;
  renderWallets([]);
  dialog.showModal();
  shell.inert = true;
  if (!unsubscribeWallets) unsubscribeWallets = subscribeWallets(renderWallets);
});
$("close-wallet").addEventListener("click", () => { dialog.close(); shell.inert = false; });
dialog.addEventListener("cancel", () => { shell.inert = false; });
dialog.addEventListener("close", () => { shell.inert = false; $("connect-wallet").focus(); });
dialog.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const focusable = [...dialog.querySelectorAll("button:not([disabled])")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

$("case-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session) return showToast("Connect a wallet before creating a case.", true);
  const form = new FormData(event.currentTarget);
  const caseId = String(form.get("caseId")).trim();
  const args = [caseId, String(form.get("urlA")).trim(), String(form.get("urlB")).trim(), String(form.get("currency")).trim().toUpperCase(), Number(form.get("scale"))];
  try {
    const result = await executeWrite({ client: session.client, contractAddress: requireAddress(), functionName: "create_case", args, readback: () => readCase(caseId), onUpdate: updateTransaction });
    showToast(`Created. Transaction ${result.hash.slice(0, 10)}… finalized.`);
    $("action-form").elements.actionCaseId.value = caseId;
  } catch (error) { showToast(classifyError(error), true); }
});

$("action-form").addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const caseId = String(new FormData(event.currentTarget).get("actionCaseId")).trim();
  if (!caseId) return showToast("Enter a case ID first.", true);
  if (action === "read") return readCase(caseId).catch((error) => showToast(classifyError(error), true));
  if (!session) return showToast("Connect a wallet before sending a transaction.", true);
  const functionName = action === "freeze" ? "freeze_case" : action === "assess" ? "assess" : "retry_unresolved";
  try {
    const result = await executeWrite({ client: session.client, contractAddress: requireAddress(), functionName, args: [caseId], readback: async () => { const state = await readCase(caseId); return action === "assess" && state.outcome === "UNRESOLVED" ? state.state === "FROZEN" : Boolean(state); }, onUpdate: updateTransaction });
    showToast(`${functionName} finalized and read back. ${explorerUrl(session.client, result.hash) ? "Explorer link is available in the transaction details." : ""}`);
  } catch (error) { showToast(classifyError(error), true); }
});

function updateTransaction({ hash, status, attempt }) {
  resultPanel.innerHTML = `<div class="pending"><span class="spinner" aria-hidden="true"></span><div><strong>Verifying ${status}</strong><p class="muted">Transaction <span class="mono">${hash}</span> · bounded check ${attempt}/60</p></div></div>`;
}

if (!contractAddress) showToast("Demo shell ready. Configure VITE_CONTRACT_ADDRESS for live reads and writes.", true);
