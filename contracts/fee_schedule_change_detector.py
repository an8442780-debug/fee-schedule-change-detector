# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import datetime
import hashlib
import json
from dataclasses import dataclass

from genlayer import *


MAX_AMOUNT = (2**128) - 1
MAX_ROWS = 128
MAX_RESPONSE_BYTES = 64 * 1024
MAX_CODE_LENGTH = 64
MAX_UNIT_LENGTH = 32
MAX_DATE_LENGTH = 10
MAX_CURRENCY_CODE_LENGTH = 3
MAX_RETRIES = 3
MAX_SCALE = 6
CURRENCY_SCALES = {
    "AUD": 2,
    "CAD": 2,
    "CHF": 2,
    "CNY": 2,
    "EUR": 2,
    "GBP": 2,
    "INR": 2,
    "JPY": 0,
    "KRW": 0,
    "USD": 2,
}


@allow_storage
@dataclass
class FeeRow:
    service_code: str
    unit: str
    currency: str
    amount_scaled: u256
    effective_date: str


@allow_storage
@dataclass
class FeeCase:
    owner: Address
    url_a: str
    url_b: str
    currency: str
    scale: u8
    state: str
    outcome: str
    old_amount: u256
    new_amount: u256
    old_date: str
    new_date: str
    evidence_digest: str
    retry_count: u8
    old_rows: DynArray[FeeRow]
    new_rows: DynArray[FeeRow]


def _is_ascii_digits(value: str) -> bool:
    return bool(value) and all("0" <= char <= "9" for char in value)


def _normalise_currency(value) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip().upper()
    return value if len(value) == MAX_CURRENCY_CODE_LENGTH and value in CURRENCY_SCALES else None


def _parse_scaled_amount(value, scale: int) -> int | None:
    if not isinstance(value, str) or not 1 <= len(value) <= 80:
        return None
    whole, dot, fraction = value.strip().partition(".")
    if not _is_ascii_digits(whole):
        return None
    if dot and not _is_ascii_digits(fraction):
        return None
    if len(fraction) > scale:
        return None
    scaled = int(whole) * (10**scale)
    if fraction:
        scaled += int(fraction.ljust(scale, "0"))
    return scaled if 0 <= scaled <= MAX_AMOUNT else None


def _normalise_date(value) -> str | None:
    if not isinstance(value, str):
        return None
    if len(value) > MAX_DATE_LENGTH:
        return None
    value = value.strip()
    if len(value) != MAX_DATE_LENGTH:
        return None
    try:
        parsed = datetime.date.fromisoformat(value)
    except ValueError:
        return None
    return parsed.isoformat()


def _normalise_snapshot(response) -> dict:
    if response.status != 200 or response.body is None:
        return {"ok": False, "reason": "UPSTREAM_UNAVAILABLE"}
    if not isinstance(response.body, (bytes, bytearray)) or len(response.body) > MAX_RESPONSE_BYTES:
        return {"ok": False, "reason": "INVALID_SOURCE"}
    try:
        payload = json.loads(response.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {"ok": False, "reason": "INVALID_SOURCE"}
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return {"ok": False, "reason": "INVALID_SOURCE"}
    source_currency = _normalise_currency(payload.get("currency"))
    rows = []
    seen = set()
    if not 0 < len(payload["rows"]) <= MAX_ROWS:
        return {"ok": False, "reason": "INVALID_SOURCE"}
    for raw_row in payload["rows"]:
        if not isinstance(raw_row, dict):
            return {"ok": False, "reason": "INVALID_SOURCE"}
        code = raw_row.get("code")
        unit = raw_row.get("unit")
        row_currency = _normalise_currency(raw_row.get("currency", source_currency))
        if (
            not isinstance(code, str)
            or not isinstance(unit, str)
            or len(code) > MAX_CODE_LENGTH
            or len(unit) > MAX_UNIT_LENGTH
        ):
            return {"ok": False, "reason": "INVALID_SOURCE"}
        code = code.strip().upper()
        unit = unit.strip().lower()
        if not code or not unit or "|" in code or "|" in unit:
            return {"ok": False, "reason": "INVALID_SOURCE"}
        key = code + "|" + unit
        if key in seen or row_currency is None:
            return {"ok": False, "reason": "INVALID_SOURCE"}
        amount_scale = CURRENCY_SCALES[row_currency]
        amount_scaled = _parse_scaled_amount(raw_row.get("amount"), amount_scale)
        effective_date = _normalise_date(raw_row.get("effective_date"))
        if amount_scaled is None or effective_date is None:
            return {"ok": False, "reason": "INVALID_SOURCE"}
        seen.add(key)
        rows.append(
            {
                "service_code": code,
                "unit": unit,
                "currency": row_currency,
                "amount_scaled": amount_scaled,
                "effective_date": effective_date,
            }
        )
    if source_currency is None or any(row["currency"] != source_currency for row in rows):
        return {"ok": False, "reason": "INVALID_SOURCE"}
    rows.sort(key=lambda row: (row["service_code"], row["unit"]))
    return {"ok": True, "currency": source_currency, "rows": rows}


def _fetch_bundle(url_a: str, url_b: str) -> str:
    first = _normalise_snapshot(gl.nondet.web.get(url_a))
    second = _normalise_snapshot(gl.nondet.web.get(url_b))
    return json.dumps({"a": first, "b": second}, sort_keys=True, separators=(",", ":"))


def _row_key(row: dict) -> str:
    return row["service_code"] + "|" + row["unit"]


def _primary_value(rows: list[dict], field: str):
    return rows[0][field] if len(rows) == 1 else 0 if field == "amount_scaled" else ""


def _analyse(bundle: dict, policy_currency: str) -> dict:
    first = bundle.get("a", {})
    second = bundle.get("b", {})
    if not first.get("ok") or not second.get("ok"):
        return {"outcome": "UNRESOLVED"}
    first_currency = first["currency"]
    second_currency = second["currency"]
    if first_currency != second_currency:
        return {"outcome": "CURRENCY_CHANGED"}
    if first_currency != policy_currency:
        return {"outcome": "UNRESOLVED"}
    old_rows = first["rows"]
    new_rows = second["rows"]
    old_by_key = {_row_key(row): row for row in old_rows}
    new_by_key = {_row_key(row): row for row in new_rows}
    old_codes = {}
    new_codes = {}
    for row in old_rows:
        old_codes.setdefault(row["service_code"], set()).add(row["unit"])
    for row in new_rows:
        new_codes.setdefault(row["service_code"], set()).add(row["unit"])
    for code in set(old_codes).intersection(new_codes):
        if old_codes[code] != new_codes[code]:
            return {"outcome": "UNIT_CHANGED"}
    added = sorted(set(new_by_key) - set(old_by_key))
    removed = sorted(set(old_by_key) - set(new_by_key))
    if added:
        return {"outcome": "ROW_ADDED"}
    if removed:
        return {"outcome": "ROW_REMOVED"}
    for key in sorted(old_by_key):
        if old_by_key[key]["currency"] != new_by_key[key]["currency"]:
            return {"outcome": "CURRENCY_CHANGED"}
    for key in sorted(old_by_key):
        if old_by_key[key]["amount_scaled"] != new_by_key[key]["amount_scaled"]:
            return {"outcome": "FEE_CHANGED"}
    for key in sorted(old_by_key):
        if old_by_key[key]["effective_date"] != new_by_key[key]["effective_date"]:
            return {"outcome": "DATE_CONFLICT"}
    return {"outcome": "SAME_SCHEDULE"}


def _bundle_digest(bundle: dict) -> str:
    encoded = json.dumps(bundle, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _stored_row_dict(row: FeeRow) -> dict:
    return {
        "service_code": row.service_code,
        "unit": row.unit,
        "currency": row.currency,
        "amount_scaled": row.amount_scaled,
        "effective_date": row.effective_date,
    }


class FeeScheduleChangeDetector(gl.Contract):
    cases: TreeMap[str, FeeCase]

    def __init__(self):
        self.cases = gl.storage.inmem_allocate(TreeMap[str, FeeCase])

    def _require_case(self, case_id: str) -> FeeCase:
        if case_id not in self.cases:
            raise gl.vm.UserError("Unknown case")
        return self.cases[case_id]

    def _require_owner(self, case: FeeCase):
        if gl.message.sender_address != case.owner:
            raise gl.vm.UserError("Only the case owner may perform this action")

    @gl.public.write
    def create_case(
        self, case_id: str, url_a: str, url_b: str, currency: str, scale: u8
    ) -> None:
        normalised_currency = _normalise_currency(currency)
        if not isinstance(case_id, str) or not 1 <= len(case_id) <= 64:
            raise gl.vm.UserError("Invalid case id")
        if case_id in self.cases:
            raise gl.vm.UserError("Case id already exists")
        if (
            not isinstance(url_a, str)
            or not isinstance(url_b, str)
            or url_a == url_b
            or not url_a.startswith("https://")
            or not url_b.startswith("https://")
            or len(url_a) > 256
            or len(url_b) > 256
        ):
            raise gl.vm.UserError("Sources must be distinct HTTPS URLs")
        if (
            normalised_currency is None
            or scale > MAX_SCALE
            or CURRENCY_SCALES[normalised_currency] != scale
        ):
            raise gl.vm.UserError("Unsupported currency or scale")
        self.cases[case_id] = FeeCase(
            owner=gl.message.sender_address,
            url_a=url_a,
            url_b=url_b,
            currency=normalised_currency,
            scale=scale,
            state="DRAFT",
            outcome="UNRESOLVED",
            old_amount=u256(0),
            new_amount=u256(0),
            old_date="",
            new_date="",
            evidence_digest="",
            retry_count=u8(0),
            old_rows=[],
            new_rows=[],
        )

    @gl.public.write
    def freeze_case(self, case_id: str) -> None:
        case = self._require_case(case_id)
        self._require_owner(case)
        if case.state != "DRAFT":
            raise gl.vm.UserError("Case is already frozen or assessed")
        case.state = "FROZEN"

    def _assess(self, case_id: str) -> str:
        case = self._require_case(case_id)
        if case.state != "FROZEN":
            raise gl.vm.UserError("Case must be frozen")
        url_a, url_b, currency = case.url_a, case.url_b, case.currency

        def leader_fn() -> str:
            return _fetch_bundle(url_a, url_b)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return leader_result.calldata == _fetch_bundle(url_a, url_b)

        agreed_bundle = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        bundle = json.loads(agreed_bundle)
        analysis = _analyse(bundle, currency)
        outcome = analysis["outcome"]
        if outcome == "UNRESOLVED":
            return outcome
        old_rows = bundle["a"]["rows"]
        new_rows = bundle["b"]["rows"]
        for row in old_rows:
            case.old_rows.append(FeeRow(**row))
        for row in new_rows:
            case.new_rows.append(FeeRow(**row))
        case.old_amount = u256(_primary_value(old_rows, "amount_scaled"))
        case.new_amount = u256(_primary_value(new_rows, "amount_scaled"))
        case.old_date = _primary_value(old_rows, "effective_date")
        case.new_date = _primary_value(new_rows, "effective_date")
        case.evidence_digest = _bundle_digest(bundle)
        case.outcome = outcome
        case.state = "ASSESSED"
        return outcome

    @gl.public.write
    def assess(self, case_id: str) -> str:
        return self._assess(case_id)

    @gl.public.write
    def retry_unresolved(self, case_id: str) -> str:
        case = self._require_case(case_id)
        if case.state != "FROZEN" or case.retry_count >= MAX_RETRIES:
            raise gl.vm.UserError("Case is not retryable")
        case.retry_count = u8(case.retry_count + 1)
        return self._assess(case_id)

    @gl.public.view
    def get_case(self, case_id: str) -> str:
        case = self._require_case(case_id)
        return json.dumps(
            {
                "case_id": case_id,
                "owner": str(case.owner),
                "url_a": case.url_a,
                "url_b": case.url_b,
                "currency": case.currency,
                "scale": case.scale,
                "state": case.state,
                "outcome": case.outcome,
                "old_amount": case.old_amount,
                "new_amount": case.new_amount,
                "old_date": case.old_date,
                "new_date": case.new_date,
                "evidence_digest": case.evidence_digest,
                "retry_count": case.retry_count,
                "old_rows": [_stored_row_dict(row) for row in case.old_rows],
                "new_rows": [_stored_row_dict(row) for row in case.new_rows],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
