# Verification — Fee Schedule Change Detector

This document records reproducible source, deployment and live proof evidence for the current release. The current Vercel release contains the completed wallet, validation, transaction-recovery and authoritative-readback implementation, and the mandatory Vercel E2E is complete on the exact release.

## Exact release binding

| Item | Verified value |
|---|---|
| Frontend correction revision | `d7b9235dc2f8c278fa5a6ee37b3f012cb62ed04e` |
| Frontend HTML SHA-256 | `A66A3883A06C004F30D0399F899E55211571A59CB161B43001B28EFBF5B45358` |
| Frontend app SHA-256 | `EC0CDF4A8BD701DF3F884FC5086EF4DA889BC7E4B48511C3D9F4A55DE3E9C425` |
| Wallet registry SHA-256 | `AC5F5E5B6D71899FF4DB8CBD87CBF7BC7B7A7F765F5176920653455D6F1569EF` |
| Wallet adapter SHA-256 | `2008F07B02DCFA4150A7DD45A9533CBC8DAD282C7DEDD25EE940D15675095EE0` |
| Wallet core/runtime regression test SHA-256 | `95DAFABD0C2D7508D7EB8A302DD2A874278D65C983B738E47886A136F30DB840` |
| Transaction runtime regression test SHA-256 | `67C185A487BE068164F336473AA50D2959404A4E888C3D4F43ED34D2F30BD4E7` |
| Transaction runtime adapter SHA-256 | `3A29FD249FF90879A09D715A0CA8F0DB188552429A586DEB1E90A7B0A1432112` |
| Frontend UI regression test SHA-256 | `4E1345210C456FDEFEEF9E825921FAEB3F73B100EBA4FC9DE6E014454076330C` |
| Wallet icon assets | `frontend/public/wallets/{okx,metamask,rabby}.svg`; canonical local `<img>` sources |
| Frontend case-state SHA-256 | `F355D7D4CD1BAAB6C4328435D9B7A51278ED08DC5F68099CDBC875F84FF2663B` |
| Frontend case-state regression test SHA-256 | `0946D81BB38A1C026A8035E189EE8C11B411720DB710EAFB47002A18F1882266` |
| Frontend stylesheet SHA-256 | `76FC1A046039B143B9DF0DE06A0BAE3953CE7CE56FE95827BC584D8252A70C8E` |
| Frontend tokens SHA-256 | `1AD0889CBC3F6DF03A015109ED6B58674DFCCF4D2FEACD798655C3BCDE389BB4` |
| Deployed contract source revision | `76b26933e089715ea3398e49cb403831028cb196` |
| Contract source SHA-256 | `8082AC55D11B62197E87652A4B3CA63C99D83201D33FAA6B1F8E43DDC62F75D1` |
| Network | Studionet |
| Contract | [`0x5263Cd2311DB403F927C101018C12DcBAf41D8A0`](https://explorer-studio.genlayer.com/address/0x5263Cd2311DB403F927C101018C12DcBAf41D8A0) |
| Deployment transaction | [`0xa9118a38de5d7700290c24dc3c2d9b7f4e5ea59168cc428b9e8c8c559986fabf`](https://explorer-studio.genlayer.com/tx/0xa9118a38de5d7700290c24dc3c2d9b7f4e5ea59168cc428b9e8c8c559986fabf) |
| Deployed frontend release source | [`d33e32e688e990257f408c1adbd56f67b2a6ee43`](https://github.com/an8442780-debug/fee-schedule-change-detector/commit/d33e32e688e990257f408c1adbd56f67b2a6ee43) |
| Vercel release target | [fee-schedule-change-detector.vercel.app](https://fee-schedule-change-detector.vercel.app) — current release `READY`; HTTP 200 |
| Vercel deployment | [`dpl_4HLip3KttLCmi65qVL5wCARgfQdY`](https://vercel.com/an8442780-debug/fee-schedule-change-detector/4HLip3KttLCmi65qVL5wCARgfQdY); built from source commit `d33e32e688e990257f408c1adbd56f67b2a6ee43`; public app URL is the Vercel release target above |
| Vercel project | [an8442780-debug/fee-schedule-change-detector](https://vercel.com/an8442780-debug/fee-schedule-change-detector) |

## Automated verification

```text
gltest tests/test_contract.py -q -p no:cacheprovider       PASS — 19 passed
genvm-lint check contracts/fee_schedule_change_detector.py --json  PASS
genvm-lint schema contracts/fee_schedule_change_detector.py       PASS — 5 methods
genvm-lint typecheck contracts/fee_schedule_change_detector.py     PASS
cd frontend
npm test                                                     PASS — 29 passed
node --check src/app.js                                     PASS
node --check src/case-state.js                              PASS
npm run build                                                PASS
git diff --check                                             PASS
```

The production build has only the documented Vite minified chunk-size warning. The contract uses five public methods: four writes and one view. The wallet correction tests cover nested EIP-6963 announcements, canonical wallet aliasing, exact zero/one/all detected cardinality, legacy replacement isolation, invalid/conflicting identities, direct selected-provider chain switching including unknown-chain add-and-retry, and the no-RPC chooser-opening boundary without the SDK's MetaMask-only connection handshake. The transaction regression tests cover the SDK runtime's `result_name` field, release the recovery lock after an explicitly verified finalized agreed rollback, and retain the journal when execution metadata is absent or unknown.

## Studionet live proof matrix

Every write below was finalized on the deployed contract with leader execution `SUCCESS` and consensus history `Accepted PENDING → PROPOSING → COMMITTING → REVEALING → ACCEPTED`. The read rows are authoritative `get_case` responses from the Finalized view.

| Case | Method | Transaction / readback | Observed result | Status |
|---|---|---|---|---|
| `e2e-fee-20260903-01` | `create_case` | [`0xa11ed53709abd8c082e76323848b12a6424e8188d12a4bdd7e9fe510f2159f45`](https://explorer-studio.genlayer.com/tx/0xa11ed53709abd8c082e76323848b12a6424e8188d12a4bdd7e9fe510f2159f45) | `FINALIZED`; case `DRAFT`, USD scale 2 | `PASS` |
| `e2e-fee-20260903-01` | `freeze_case` | [`0x0e79417f7b3d2808b7779f9661db61de4bf88e1fdc452ee0e67f3ba7e6842f55`](https://explorer-studio.genlayer.com/tx/0x0e79417f7b3d2808b7779f9661db61de4bf88e1fdc452ee0e67f3ba7e6842f55) | `FINALIZED`; `DRAFT → FROZEN`, output `null` | `PASS` |
| `e2e-fee-20260903-01` | `assess` | [`0x143732b2573ef3c4e24794b2fff56d48876dadf992fa2ca1dd02f4b6fe4bb989`](https://explorer-studio.genlayer.com/tx/0x143732b2573ef3c4e24794b2fff56d48876dadf992fa2ca1dd02f4b6fe4bb989) | `FINALIZED`; `FEE_CHANGED`; USD rows `1250 → 1300`, dates `2026-01-01` | `PASS` |
| `e2e-fee-20260903-01` | `get_case` | Finalized response | `ASSESSED`; `FEE_CHANGED`; one old/new row; digest `f9b43c5389d1af37544490679581c7fde4fee65de2f65886305bb4a81ef4bdbe`; retry `0` | `PASS` |
| `e2e-fee-unresolved-20260903-01` | `create_case` | [`0x9d54e7a2908fb9f6068afa1733badf7115f5312b7d577330398d67a81795fa65`](https://explorer-studio.genlayer.com/tx/0x9d54e7a2908fb9f6068afa1733badf7115f5312b7d577330398d67a81795fa65) | `FINALIZED`; valid old fixture plus HTTP 503 source retained | `PASS` |
| `e2e-fee-unresolved-20260903-01` | `freeze_case` | [`0x234cc98c44f5b60f1c6b330d0691f56d8f547ccf3f1197293872500e1494c3c8`](https://explorer-studio.genlayer.com/tx/0x234cc98c44f5b60f1c6b330d0691f56d8f547ccf3f1197293872500e1494c3c8) | `FINALIZED`; case frozen | `PASS` |
| `e2e-fee-unresolved-20260903-01` | `assess` | [`0x15f961baa4941e3df198523edaa3c163759b21e80ffad4d87142c044cc1c0a7f`](https://explorer-studio.genlayer.com/tx/0x15f961baa4941e3df198523edaa3c163759b21e80ffad4d87142c044cc1c0a7f) | `FINALIZED`; `UNRESOLVED`; upstream unavailable; no assessment mutation | `PASS` |
| `e2e-fee-unresolved-20260903-01` | `retry_unresolved` | [`0xe36292be7ca06cc27be83812758a2501445475fd4d515895568e33b3d475a481`](https://explorer-studio.genlayer.com/tx/0xe36292be7ca06cc27be83812758a2501445475fd4d515895568e33b3d475a481) | `FINALIZED`; `UNRESOLVED`; exactly one retry | `PASS` |
| `e2e-fee-unresolved-20260903-01` | `get_case` | Finalized response | `FROZEN`; `UNRESOLVED`; empty rows/digest; retry `1`; HTTP 503 URL retained | `PASS` |

## Vercel E2E status

This public verification record is documentation-only over the deployed frontend source commit `d33e32e688e990257f408c1adbd56f67b2a6ee43`. The Vercel production alias is `READY` at `https://fee-schedule-change-detector.vercel.app`, deployment `dpl_4HLip3KttLCmi65qVL5wCARgfQdY`. The retained Chrome run used detected OKX Wallet account `0x5Be59b33326772376a01e96e525D6D18FC821113` on Studionet and completed the valid change journey plus the bounded fail-closed retry journey.

| Case / action | Transaction | Finalized result / authoritative readback | Status |
|---|---|---|---|
| `e2e-vercel-fee-20260904-01` / `create_case` | [`0x81391368b949d21cb11a3c1b8c1c288a959ede348da3cf4e9a571adbe607bcfe`](https://genlayer-explorer.vercel.app/tx/0x81391368b949d21cb11a3c1b8c1c288a959ede348da3cf4e9a571adbe607bcfe) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `DRAFT`, `UNRESOLVED`, USD scale 2, retry 0 | `PASS` |
| Same case / `freeze_case` | [`0x55eddaea89a5d2518a1439cb8fa74f5b22d69791b7f87e9faa95befc5ff401dc`](https://genlayer-explorer.vercel.app/tx/0x55eddaea89a5d2518a1439cb8fa74f5b22d69791b7f87e9faa95befc5ff401dc) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `FROZEN`, `UNRESOLVED`, retry 0 | `PASS` |
| Same case / `assess` | [`0x3573240f44335c26cbf476bca8554bafbff025d5558105a97271e1c82c696d1e`](https://genlayer-explorer.vercel.app/tx/0x3573240f44335c26cbf476bca8554bafbff025d5558105a97271e1c82c696d1e) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `ASSESSED`, `FEE_CHANGED`, USD 12.50/1250 → 13.00/1300, one old/new row, digest `f9b43c5389d1af37544490679581c7fde4fee65de2f65886305bb4a81ef4bdbe` | `PASS` |
| `e2e-vercel-fee-unresolved-20260904-01` / `create_case` | [`0xf3119f6482f15787bc446adebe8cd1477e74024d26c3b81fd2278e2dfab0490a`](https://genlayer-explorer.vercel.app/tx/0xf3119f6482f15787bc446adebe8cd1477e74024d26c3b81fd2278e2dfab0490a) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `DRAFT`, `UNRESOLVED`, exact HTTP 503 URL retained | `PASS` |
| Same unresolved case / `freeze_case` | [`0x096186b279922b4e2470cab977e30b6b95c3d53b903a95e2bee580b0d164f1f4`](https://genlayer-explorer.vercel.app/tx/0x096186b279922b4e2470cab977e30b6b95c3d53b903a95e2bee580b0d164f1f4) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `FROZEN`, `UNRESOLVED`, retry 0 | `PASS` |
| Same unresolved case / `assess` | [`0x2ebbbc76327b1ffc28481c15df64972287ea2e5f0856b975c8c7ad1983a68699`](https://genlayer-explorer.vercel.app/tx/0x2ebbbc76327b1ffc28481c15df64972287ea2e5f0856b975c8c7ad1983a68699) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `FROZEN`, `UNRESOLVED`, retry remains 0, empty rows/digest, `UPSTREAM_UNAVAILABLE` | `PASS` |
| Same unresolved case / `retry_unresolved` exactly once | [`0x5af0f9860462cd0ed26693ea5341b5d307bae5ce0a59dff53a1c49cdc8da02d4`](https://genlayer-explorer.vercel.app/tx/0x5af0f9860462cd0ed26693ea5341b5d307bae5ce0a59dff53a1c49cdc8da02d4) | `FINALIZED`, `MAJORITY_AGREE`, leader `SUCCESS`; `FROZEN`, `UNRESOLVED`, `retry_count=1`, exact HTTP 503 URL retained | `PASS` |

The valid case was reloaded, reconnected and read back with `TransactionHashVariant.LATEST_FINAL`; the visible result remained `FEE_CHANGED`. The live run produced no stale `Contract execution failed: UNKNOWN` toast.

## Lifecycle and recovery

The contract is intentionally frozen and has no upgrade mechanism. Pending frontend writes retain their transaction hash for reconciliation; a source, network or contract reset requires a new deployment and a fresh proof run.
