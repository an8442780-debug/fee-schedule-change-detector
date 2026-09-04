import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { connectWallet, subscribeWallets, validateWalletForWrite } from "./wallets.js";
import { executeWrite, explorerUrl, readPending, reconcilePending } from "./transactions.js";
import { formatWalletError, walletDisplayState } from "./wallets-core.js";
import {
  authoritativeCaseReadRequest,
  caseReadbackMatches,
  createCaseInputError,
  createdCaseReadbackMatches,
  formatActionSuccess,
  formatRowEvidence,
  formatScaledAmount,
  rowCounts,
} from "./case-state.js";
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

const WALLET_ICON_MARKUP = Object.freeze({
  "com.okex.wallet": '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" fill="#111827"/><path fill="#fff" d="M10 10h8v8h-8zM22 10h8v8h-8zM10 22h8v8h-8zM22 22h8v8h-8z"/></svg>',
  "io.metamask": '<svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#e17726" d="M20 3 5 13l3 17 8 6 4-6 4 6 8-6 3-17L20 3Z"/><path fill="#f5841f" d="m20 3-8 13 8 5 8-5-8-13Z"/><path fill="#c0ad9e" d="m8 30 8 6 4-6-4-5-8 5Zm24 0-8 6-4-6 4-5 8 5Z"/><path fill="#763d16" d="m12 16 8 5-4 4-7-2 3-7Zm16 0-8 5 4 4 7-2-3-7Z"/></svg>',
  "io.rabby": '<svg viewBox="0 0 40 40" aria-hidden="true"><path fill="#7185ff" d="M11 14c-1-6 1-10 4-11 3 2 4 6 4 10h2c0-4 1-8 4-10 3 1 5 5 4 11 3 2 5 5 5 9 0 7-6 12-15 12S5 30 5 23c0-4 2-7 6-9Z"/><circle cx="16" cy="23" r="2" fill="#fff"/><circle cx="26" cy="23" r="2" fill="#fff"/><path fill="#fff" d="M17 29c2 1 4 1 6 0-1 3-5 3-6 0Z"/></svg>',
});

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
  const value = await readClient.readContract(authoritativeCaseReadRequest(contractAddress, caseId));
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  lastCase = parsed;
  renderCase(parsed);
  return parsed;
}

function renderCase(caseData) {
  const counts = rowCounts(caseData);
  const currency = String(caseData.currency ?? "UNKNOWN");
  const assessed = caseData.outcome !== "UNRESOLVED";
  const oldAmount = assessed ? formatScaledAmount(caseData.old_amount, caseData.scale) : "Not assessed";
  const newAmount = assessed ? formatScaledAmount(caseData.new_amount, caseData.scale) : "Not assessed";
  const oldScaled = assessed ? String(caseData.old_amount ?? "") : "Not assessed";
  const newScaled = assessed ? String(caseData.new_amount ?? "") : "Not assessed";
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
  appendFact(facts, "Currency", currency);
  appendFact(facts, "Scale", caseData.scale);
  appendFact(facts, "Old amount", `${oldAmount} ${currency} (scaled ${oldScaled})`);
  appendFact(facts, "New amount", `${newAmount} ${currency} (scaled ${newScaled})`);
  appendFact(facts, "Amount change", `${oldAmount} ${currency} → ${newAmount} ${currency}`);
  appendFact(facts, "Old date", caseData.old_date || "Not assessed");
  appendFact(facts, "New date", caseData.new_date || "Not assessed");
  appendFact(facts, "Old rows", counts.old);
  appendFact(facts, "New rows", counts.new);
  appendRows(facts, "Old row", caseData.old_rows, caseData.scale);
  appendRows(facts, "New row", caseData.new_rows, caseData.scale);
  appendFact(facts, "Evidence digest", caseData.evidence_digest || "Not assessed", "mono");
  resultPanel.append(top, facts);
}

function appendRows(list, label, rows, scale) {
  if (!Array.isArray(rows) || rows.length === 0) {
    appendFact(list, label, "None");
    return;
  }
  rows.forEach((row, index) => appendFact(list, `${label} ${index + 1}`, formatRowEvidence(row, scale), "mono"));
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
  const displayState = walletDisplayState(options);
  const displayOptions = displayState.options;
  if (!displayOptions.length) {
    const empty = document.createElement("div");
    empty.className = "wallet-empty";
    const heading = document.createElement("strong");
    heading.textContent = displayState.emptyMessage;
    const message = document.createElement("p");
    message.textContent = "Install or enable a supported browser wallet, then reload this page.";
    empty.append(heading, message);
    walletOptions.append(empty);
    return;
  }
  for (const option of displayOptions) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.type = "button";
    button.setAttribute("aria-label", `Connect with ${option.label}`);
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
    } else if (WALLET_ICON_MARKUP[option.rdns]) {
      icon.innerHTML = WALLET_ICON_MARKUP[option.rdns];
    }
    const details = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = option.label;
    const kind = document.createElement("small");
    kind.textContent = "Ready to connect";
    details.append(label, kind);
    button.append(icon, details);
    button.addEventListener("click", async () => {
      walletError.hidden = true;
      try {
        const previous = session;
        session = await connectWallet(option, invalidateSession);
        previous?.dispose?.();
        dialog.close();
        if (!cmdk || !cmdk.classList.contains("is-open")) {
          shell.inert = false;
        }
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
  const message = formatWalletError(error);
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
  if (cmdk && cmdk.classList.contains("is-open")) {
    closeCmdk(false);
  }
  walletError.hidden = true;
  renderWallets([]);
  dialog.showModal();
  shell.inert = true;
  if (!unsubscribeWallets) unsubscribeWallets = subscribeWallets(renderWallets);
});
$("close-wallet").addEventListener("click", () => {
  dialog.close();
  if (!cmdk || !cmdk.classList.contains("is-open")) {
    shell.inert = false;
  }
});
dialog.addEventListener("cancel", () => {
  if (!cmdk || !cmdk.classList.contains("is-open")) {
    shell.inert = false;
  }
});
dialog.addEventListener("close", () => {
  if (!cmdk || !cmdk.classList.contains("is-open")) {
    shell.inert = false;
  }
  $("connect-wallet").focus();
});
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
  const inputError = createCaseInputError({ caseId, urlA: args[1], urlB: args[2] });
  if (inputError) return showToast(inputError, true);
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
    const explorer = explorerUrl(session.client, result.hash);
    showToast(formatActionSuccess(action, Boolean(explorer)));
    appendTransactionDetails(result.hash, explorer);
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

/* --- N13 Command / Jump Palette Wiring --- */
const cmdk = $("cmdk");
const searchpill = $("searchpill");
const cmdkBackdrop = $("cmdk-backdrop");
const cmdkInput = $("cmdk-input");
const cmdkListbox = $("cmdk-listbox");
const cmdkItems = () => (cmdkListbox ? [...cmdkListbox.querySelectorAll(".cmdk__item:not([hidden])")] : []);

function isDialogOpen() {
  return Boolean(dialog && dialog.open);
}

function isCmdkOpen() {
  return Boolean(cmdk && cmdk.classList.contains("is-open"));
}

function openCmdk() {
  if (!cmdk || isDialogOpen()) return;
  cmdk.inert = false;
  cmdk.classList.add("is-open");
  cmdk.setAttribute("aria-hidden", "false");
  searchpill?.setAttribute("aria-expanded", "true");
  shell.inert = true;
  if (cmdkInput) {
    cmdkInput.value = "";
    filterCmdk("");
    selectCmdkItem(0);
    cmdkInput.focus();
  }
}

function closeCmdk(restoreFocus = true) {
  if (!cmdk || !cmdk.classList.contains("is-open")) return;
  cmdk.classList.remove("is-open");
  cmdk.setAttribute("aria-hidden", "true");
  cmdk.inert = true;
  searchpill?.setAttribute("aria-expanded", "false");
  if (!isDialogOpen()) {
    shell.inert = false;
  }
  if (restoreFocus && searchpill && !isDialogOpen()) {
    searchpill.focus();
  }
}

function selectCmdkItem(index) {
  const items = cmdkItems();
  if (!items.length) return;
  const boundedIndex = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((item, idx) => {
    const isSelected = idx === boundedIndex;
    item.classList.toggle("is-active", isSelected);
    item.setAttribute("aria-selected", isSelected ? "true" : "false");
    if (isSelected) {
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

function getSelectedCmdkIndex() {
  const items = cmdkItems();
  return items.findIndex((item) => item.getAttribute("aria-selected") === "true");
}

function jumpToTarget(targetId) {
  const target = $(targetId);
  closeCmdk(false);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  const focusable = target.querySelector("input, button, a, [tabindex]");
  if (focusable) {
    focusable.focus({ preventScroll: true });
  } else {
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }
  updateTimelineNav(targetId);
}

function updateTimelineNav(targetId) {
  const steps = document.querySelectorAll(".timeline-step");
  steps.forEach((step) => {
    const href = step.getAttribute("href") || "";
    step.classList.toggle("is-active", href === `#${targetId}`);
  });
}

function filterCmdk(query) {
  if (!cmdkListbox) return;
  const q = query.trim().toLowerCase();
  const allItems = [...cmdkListbox.querySelectorAll(".cmdk__item")];
  let hasMatches = false;

  allItems.forEach((item) => {
    const text = (item.textContent || "").toLowerCase();
    const match = !q || text.includes(q);
    item.hidden = !match;
    if (match) hasMatches = true;
  });

  const groups = [...cmdkListbox.querySelectorAll(".cmdk__group")];
  groups.forEach((group) => {
    let next = group.nextElementSibling;
    let groupHasVisible = false;
    while (next && !next.classList.contains("cmdk__group")) {
      if (next.classList.contains("cmdk__item") && !next.hidden) {
        groupHasVisible = true;
        break;
      }
      next = next.nextElementSibling;
    }
    group.hidden = !groupHasVisible;
  });

  let emptyMsg = cmdkListbox.querySelector(".cmdk__empty");
  if (!hasMatches) {
    if (!emptyMsg) {
      emptyMsg = document.createElement("p");
      emptyMsg.className = "cmdk__empty";
      emptyMsg.textContent = "No matching stage or documentation section found.";
      cmdkListbox.append(emptyMsg);
    }
    emptyMsg.hidden = false;
  } else if (emptyMsg) {
    emptyMsg.hidden = true;
  }

  const visible = cmdkItems();
  if (visible.length > 0) {
    const currentIndex = getSelectedCmdkIndex();
    selectCmdkItem(currentIndex >= 0 ? currentIndex : 0);
  }
}

if (searchpill) {
  searchpill.addEventListener("click", () => {
    if (isDialogOpen()) return;
    openCmdk();
  });
}

if (cmdkBackdrop) {
  cmdkBackdrop.addEventListener("click", () => closeCmdk());
}

const escHint = $("cmdk-esc-hint");
if (escHint) {
  escHint.addEventListener("click", () => closeCmdk());
}

if (cmdkInput) {
  cmdkInput.addEventListener("input", (e) => {
    filterCmdk(e.target.value);
  });
}

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (isDialogOpen()) return;
    if (isCmdkOpen()) {
      closeCmdk();
    } else {
      openCmdk();
    }
    return;
  }

  if (!isCmdkOpen()) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeCmdk();
    return;
  }

  const items = cmdkItems();

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const currentIndex = getSelectedCmdkIndex();
    const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
    selectCmdkItem(nextIndex);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const currentIndex = getSelectedCmdkIndex();
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
    selectCmdkItem(prevIndex);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    const currentIndex = getSelectedCmdkIndex();
    if (currentIndex >= 0 && items[currentIndex]) {
      const targetId = items[currentIndex].dataset.target;
      if (targetId) jumpToTarget(targetId);
    }
    return;
  }

  if (event.key === "Tab") {
    const focusable = [cmdkInput, escHint, ...items].filter(Boolean);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

if (cmdkListbox) {
  cmdkListbox.addEventListener("click", (event) => {
    const item = event.target.closest(".cmdk__item");
    if (!item) return;
    const targetId = item.dataset.target;
    if (targetId) jumpToTarget(targetId);
  });
}

document.querySelectorAll(".timeline-step").forEach((step) => {
  step.addEventListener("click", (event) => {
    event.preventDefault();
    const href = step.getAttribute("href");
    if (!href || !href.startsWith("#")) return;
    const targetId = href.slice(1);
    jumpToTarget(targetId);
  });
});

$("field-case-id")?.addEventListener("input", (e) => {
  const actionCaseInput = $("action-case-id");
  if (actionCaseInput && !actionCaseInput.value) {
    actionCaseInput.placeholder = e.target.value || "2026-transport-fees";
  }
});
