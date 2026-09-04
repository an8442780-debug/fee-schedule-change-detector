# Fee Schedule Change Detector

Fee Schedule Change Detector compares two public fee-schedule snapshots and records a validator-backed result on GenLayer instead of silently choosing one source.

- Public documentation and verification: [docs/VERIFICATION.md](docs/VERIFICATION.md)
- Deployed frontend release source: [`d33e32e688e990257f408c1adbd56f67b2a6ee43`](https://github.com/an8442780-debug/fee-schedule-change-detector/commit/d33e32e688e990257f408c1adbd56f67b2a6ee43)
- Vercel production release: [fee-schedule-change-detector.vercel.app](https://fee-schedule-change-detector.vercel.app) — `READY` at deployment [`dpl_4HLip3KttLCmi65qVL5wCARgfQdY`](https://vercel.com/an8442780-debug/fee-schedule-change-detector/4HLip3KttLCmi65qVL5wCARgfQdY)
- Vercel project: [fee-schedule-change-detector](https://vercel.com/an8442780-debug/fee-schedule-change-detector)
- Studionet contract: [`0x5263Cd2311DB403F927C101018C12DcBAf41D8A0`](https://explorer-studio.genlayer.com/address/0x5263Cd2311DB403F927C101018C12DcBAf41D8A0)
- Deployment transaction: [`0xa9118a38de5d7700290c24dc3c2d9b7f4e5ea59168cc428b9e8c8c559986fabf`](https://explorer-studio.genlayer.com/tx/0xa9118a38de5d7700290c24dc3c2d9b7f4e5ea59168cc428b9e8c8c559986fabf)
- The deployed frontend release includes detected-wallet selection, input validation, SDK transaction-result compatibility and terminal-failure recovery.
- Deployed contract source revision: `76b26933e089715ea3398e49cb403831028cb196`

## Trust problem

Public fees can change between a publisher's older and newer pages. A reviewer needs to know which rows changed, whether the two sources describe the same currency and unit, and whether an upstream failure was mistaken for agreement.

## Why GenLayer is essential

The contract uses GenLayer's nondeterministic web access to fetch both sources. A leader normalizes the snapshots into bounded rows, while a validator independently fetches and re-derives the same bundle. Only an agreed result is persisted. Upstream failure, malformed data or validator disagreement stays `UNRESOLVED` instead of becoming a guessed fee decision.

## How it works

1. Connect a supported browser wallet on Studionet and create a case with two distinct HTTPS URLs, a currency and its fixed minor-unit scale.
2. Freeze the case so its evidence window cannot be changed.
3. Assess the frozen sources. The contract compares canonical `(service_code, unit)` rows and records `SAME_SCHEDULE`, `FEE_CHANGED`, `DATE_CONFLICT`, `CURRENCY_CHANGED`, `UNIT_CHANGED`, `ROW_ADDED`, or `ROW_REMOVED`.
4. If a source is unavailable, the case remains frozen and `UNRESOLVED`. The owner may use the bounded retry path when appropriate.
5. Read the finalized case. The app shows the authoritative currency, scale, dates, amounts, rows and evidence digest only after chain finality and readback.

## Architecture

- `contracts/fee_schedule_change_detector.py` is the Intelligent Contract. It stores cases in a `TreeMap`, validates inputs, fetches sources during nondeterministic assessment, and persists only agreed normalized evidence.
- `frontend/` is a Vite application. It provides the wallet picker, public workflow controls, transaction lifecycle display, recovery journal and authoritative case readback.
- There is no backend. The chain is the source of truth for case state and results; the two HTTPS sources are read only during the contract's nondeterministic assessment.

## Intelligent Contract

The case owner is the address that creates the case. The contract state machine is `DRAFT → FROZEN → ASSESSED`; an unresolved assessment remains `FROZEN` and can be retried up to the bounded contract limit. Only the freeze action is owner-guarded; assessment and retry are public writes once a case is frozen.

The public methods are:

- `create_case(case_id, url_a, url_b, currency, scale)`
- `freeze_case(case_id)`
- `assess(case_id)`
- `retry_unresolved(case_id)`
- `get_case(case_id)`

Amounts are parsed from decimal strings into scaled integers. The contract rejects unsupported currencies, excess precision, duplicate row identities, invalid dates, malformed responses, oversized responses and non-HTTPS sources. It never uses floating-point money values.

## Transaction lifecycle

The frontend starts disconnected, checks the wallet account, Studionet network and spendable balance, then submits one write per user action. It retains the real transaction hash in a recovery journal, waits for `FINALIZED`, checks semantic execution and majority agreement, and performs one authoritative `get_case` readback bound to `TransactionHashVariant.LATEST_FINAL`. A successful UI result is not shown from submission or a spinner alone.

## Run locally

Prerequisites: Python with the GenLayer test tools, Node.js, npm and a browser wallet configured for Studionet.

```text
copy .env.example frontend\.env.development.local
```

Set `VITE_CONTRACT_ADDRESS` in `frontend/.env.development.local` to the deployed Studionet address, then run:

```text
cd frontend
npm ci
npm run dev
```

The contract source and frontend are independent of a local backend. Use the public contract and live app links above for the deployed instance.

## Tests and verification

```text
gltest tests/test_contract.py -q -p no:cacheprovider
genvm-lint check contracts/fee_schedule_change_detector.py --json
genvm-lint schema contracts/fee_schedule_change_detector.py
genvm-lint typecheck contracts/fee_schedule_change_detector.py
cd frontend
npm test
node --check src/app.js
node --check src/case-state.js
npm run build
```

The verified current results are 19 contract tests and 29 frontend tests passed, with lint, schema, typecheck, syntax and production build passing. The detailed deployed proof matrix is in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Deployment

The live contract runs on Studionet at the address linked above. Its deployed source is bound to SHA-256 `8082AC55D11B62197E87652A4B3CA63C99D83201D33FAA6B1F8E43DDC62F75D1`. The lifecycle is intentionally frozen and has no upgrade mechanism; a source or network reset requires a separately deployed instance and a fresh evidence run.

The frontend production build uses the public `VITE_CONTRACT_ADDRESS` variable. The currently live Vercel release is `READY` from source commit `d33e32e688e990257f408c1adbd56f67b2a6ee43` and returned HTTP 200. The mandatory judge-perspective Vercel E2E passed on the exact release: valid `FEE_CHANGED` readback for USD 12.50 → 13.00 and the bounded HTTP 503 `UNRESOLVED` path with one retry.

## Security and trust boundaries

- Only HTTPS sources with bounded lengths are accepted.
- Only the case owner can freeze a case; assessment and retry are public writes after freezing.
- User-controlled and fetched source fields are treated as data, not instructions.
- Normalization is deterministic and validator re-derivation is required before state mutation.
- The frontend uses `textContent` for authoritative result fields and does not render fetched source content as HTML.
- Pending hashes are retained so an uncertain write is reconciled instead of duplicated.

## Known limitations

The result describes the two public snapshots returned during assessment; it does not guarantee that either source is legally or economically correct. A source outage or disagreement intentionally produces `UNRESOLVED`. The contract also enforces bounded response, row, field and retry limits, and the public app requires a wallet with Studionet GEN for writes.
