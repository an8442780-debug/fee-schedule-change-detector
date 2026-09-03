import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { connectWallet, subscribeWallets, validateWalletForWrite } from "./wallets.js";
import { executeWrite, explorerUrl, readPending, reconcilePending } from "./transactions.js";
import { caseReadbackMatches, createdCaseReadbackMatches, rowCounts } from "./case-state.js";
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

function invalidateSession(message, provider) {
  if (!session || session.provider !== provider) return;
  session.dispose?.();
  session = null;
  $("connect-wallet").textContent = "Connect wallet";
  showToast(message, true);
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
  const counts = rowCounts(caseData);
  resultPanel.replaceChildren();

  const top = document.createElement("div");
  top.className = "result-top";
  const outcomeText = String(caseData.outcome ?? "UNKNOWN");
  const outcome = document.createElement("span");
  outcome.className = "outcome";
  const outcomeClass = outcomeText.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (outcomeClass) outcome.classList.add("outcome-" + outcomeClass);
  outcome.textContent = outcomeText;
  const state = document.createElement("span");
  state.className = "muted";
  state.textContent = String(caseData.state ?? "UNKNOWN");
  top.append(outcome, state);

  const facts = document.createElement("dl");
  facts.className = "case-facts";
  appendFact(facts, "Case", caseData.case_id);
  appendFact(facts, "Old rows", counts.old);
  appendFact(facts, "New rows", counts.new);
  appendFact(facts, "Evidence digest", caseData.evidence_digest || "Not assessed", "mono");
  resultPanel.append(top, facts);
}

function appendFact(list, label, value, className = "") {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const definition = document.createElement("dd");
  if (className) definition.className = className;
  definition.textContent = String(value ?? "");
  row.append(term, definition);
  list.append(row);
}

function renderWallets(options) {
  walletOptions.replaceChildren();
  if (!options.length) {
    const message = document.createElement("p");
    message.className = "muted empty-state";
    message.textContent = "No compatible browser wallet was detected. Install a supported wallet, then reload.";
    walletOptions.append(message);
    return;
  }
  for (const option of options) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.type = "button";
    const icon = document.createElement("span");
    icon.className = "wallet-icon";
    const iconUrl = typeof option.icon === "string" ? option.icon.trim() : "";
    if (iconUrl.startsWith("https://") || iconUrl.startsWith("data:image/")) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      image.width = 28;
      image.height = 28;
      icon.append(image);
    } else {
      icon.textContent = "◈";
    }
    const details = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = String(option.label ?? "Injected wallet");
    const kind = document.createElement("small");
    kind.textContent = option.legacy ? "Browser wallet" : "Available wallet";
    details.append(label, kind);
    button.append(icon, details);
    button.addEventListener("click", async () => {
      walletError.hidden = true;
      try {
        const previous = session;
        session = await connectWallet(option, invalidateSession);
        previous?.dispose?.();
        dialog.close();
        shell.inert = false;
        $("connect-wallet").textContent = `Connected · ${session.account.slice(0, 6)}…${session.account.slice(-4)}`;
        showToast("Wallet connected to Studionet.");
        await reconcileExistingWrite();
      } catch (error) {
        const message = classifyError(error);
        if (dialog.open) walletError.textContent = message;
        else showToast(message, true);
        if (dialog.open) walletError.hidden = false;
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

async function reconcileExistingWrite() {
  const pending = readPending();
  if (!pending) return;
  if (pending.contractAddress !== contractAddress) throw new Error("A previous transaction belongs to a different contract. Reconcile it before writing.");
  const recovery = pending.recoveryData;
  const caseId = recovery?.caseId;
  const actions = new Set(["create", "freeze", "assess", "retry"]);
  if (!actions.has(recovery?.action) || typeof caseId !== "string" || pending.args[0] !== caseId) {
    renderPending(resultPanel, { hash: pending.hash, status: "PENDING" });
    throw new Error("A previous transaction needs manual reconciliation before another write.");
  }
  const result = await reconcilePending({
    client: session.client,
    onUpdate: updateTransaction,
    readback: async () => {
      const state = await readCase(caseId);
      if (recovery.action === "create") return createdCaseReadbackMatches(caseId, state);
      return caseReadbackMatches(recovery.action, caseId, recovery.before, state);
    },
  });
  if (result) {
    appendTransactionDetails(result.hash, explorerUrl(session.client, result.hash));
    showToast("Previous transaction reconciled.");
  }
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
    await validateWalletForWrite(session);
    const result = await executeWrite({ client: session.client, contractAddress: requireAddress(), functionName: "create_case", args, readback: async () => createdCaseReadbackMatches(caseId, await readCase(caseId)), recoveryData: { action: "create", caseId }, onUpdate: updateTransaction });
    showToast(`Created. Transaction ${result.hash.slice(0, 10)}… finalized.`);
    appendTransactionDetails(result.hash, explorerUrl(session.client, result.hash));
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
    const before = await readCase(caseId);
    await validateWalletForWrite(session);
    const result = await executeWrite({ client: session.client, contractAddress: requireAddress(), functionName, args: [caseId], readback: async () => caseReadbackMatches(action, caseId, before, await readCase(caseId)), recoveryData: { action, caseId, before }, onUpdate: updateTransaction });
    showToast(`${functionName} finalized and read back. ${explorerUrl(session.client, result.hash) ? "Explorer link is available in the transaction details." : ""}`);
    appendTransactionDetails(result.hash, explorerUrl(session.client, result.hash));
  } catch (error) { showToast(classifyError(error), true); }
});

function createTransactionDetails(hash, explorer) {
  const details = document.createElement("div");
  details.className = "transaction-details";
  const label = document.createElement("p");
  label.className = "muted";
  label.textContent = "Transaction hash";
  const value = document.createElement("code");
  value.className = "transaction-hash mono";
  value.textContent = String(hash ?? "");
  const actions = document.createElement("div");
  actions.className = "transaction-actions";
  const copy = document.createElement("button");
  copy.className = "button button-quiet";
  copy.type = "button";
  copy.textContent = "Copy hash";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(String(hash ?? ""));
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy hash"; }, 2000);
    } catch {
      showToast("Copy is unavailable. Select the hash manually.", true);
    }
  });
  actions.append(copy);
  if (typeof explorer === "string" && explorer.startsWith("https://")) {
    const link = document.createElement("a");
    link.className = "button button-quiet";
    link.href = explorer;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open explorer";
    actions.append(link);
  }
  details.append(label, value, actions);
  return details;
}

function appendTransactionDetails(hash, explorer) {
  resultPanel.append(createTransactionDetails(hash, explorer));
}

function renderPending(panel, { hash, status, attempt }) {
  panel.replaceChildren();
  const pending = document.createElement("div");
  pending.className = "pending";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const content = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = "Verifying " + String(status ?? "ACCEPTED");
  const details = document.createElement("p");
  details.className = "muted";
  details.textContent = "Transaction " + String(hash ?? "") + " · checking status";
  content.append(heading, details);
  pending.append(spinner, content);
  panel.append(pending, createTransactionDetails(hash));
}

function updateTransaction({ hash, status, attempt }) {
  renderPending(resultPanel, { hash, status, attempt });
}

if (!contractAddress) showToast("Demo shell ready. Configure VITE_CONTRACT_ADDRESS for live reads and writes.", true);
const pendingWrite = readPending();
if (pendingWrite) {
  renderPending(resultPanel, { hash: pendingWrite.hash, status: "PENDING" });
  showToast("A previous transaction is awaiting reconciliation. Connect the same wallet to continue.", true);
}
