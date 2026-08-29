import json

from gltest.direct import deploy_contract


CONTRACT = "contracts/fee_schedule_change_detector.py"
URL_A = "https://example.invalid/fees-a"
URL_B = "https://example.invalid/fees-b"


def rows(amount="12.50", unit="day", currency="USD", code="BASE", date="2026-01-01"):
    return {
        "currency": currency,
        "rows": [
            {
                "code": code,
                "unit": unit,
                "currency": currency,
                "amount": amount,
                "effective_date": date,
            }
        ],
    }


def mock_sources(vm, first, second):
    vm.clear_mocks()
    vm.mock_web(r"example\.invalid/fees-a", {"status": 200, "body": json.dumps(first)})
    vm.mock_web(r"example\.invalid/fees-b", {"status": 200, "body": json.dumps(second)})


def create_frozen(vm, first, second):
    contract = deploy_contract(CONTRACT, vm)
    contract.create_case("case-1", URL_A, URL_B, "USD", 2)
    contract.freeze_case("case-1")
    mock_sources(vm, first, second)
    return contract


def test_create_freeze_and_formatting_normalize(direct_vm):
    direct_vm.check_pickling = True
    contract = create_frozen(direct_vm, rows("12.50", "day"), rows("12.5", " DAY "))

    assert contract.assess("case-1") == "SAME_SCHEDULE"
    assert direct_vm.run_validator() is True
    case = json.loads(contract.get_case("case-1"))
    assert case["state"] == "ASSESSED"
    assert case["old_rows"][0]["amount_scaled"] == 1250
    assert case["old_rows"][0]["unit"] == "day"


def test_amount_change(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows("13.00"))
    assert contract.assess("case-1") == "FEE_CHANGED"


def test_date_change(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows(date="2026-02-01"))
    assert contract.assess("case-1") == "DATE_CONFLICT"


def test_row_added(direct_vm):
    contract = create_frozen(direct_vm, rows(), {"currency": "USD", "rows": [
        {"code": "BASE", "unit": "day", "amount": "12.50", "effective_date": "2026-01-01"},
        {"code": "PREMIUM", "unit": "day", "amount": "2.00", "effective_date": "2026-01-01"},
    ]})
    assert contract.assess("case-1") == "ROW_ADDED"


def test_row_removed(direct_vm):
    contract = create_frozen(direct_vm, {
        "currency": "USD",
        "rows": [
            {"code": "BASE", "unit": "day", "amount": "12.50", "effective_date": "2026-01-01"},
            {"code": "PREMIUM", "unit": "day", "amount": "2.00", "effective_date": "2026-01-01"},
        ],
    }, rows())
    assert contract.assess("case-1") == "ROW_REMOVED"


def test_unit_change(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows(unit="hour"))
    assert contract.assess("case-1") == "UNIT_CHANGED"


def test_currency_change_is_consequential(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows(currency="EUR", amount="10.00"))
    assert contract.assess("case-1") == "CURRENCY_CHANGED"
    case = json.loads(contract.get_case("case-1"))
    assert case["outcome"] == "CURRENCY_CHANGED"


def test_invalid_precision_is_unresolved_without_assessment_mutation(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows("12.501"))
    assert contract.assess("case-1") == "UNRESOLVED"
    case = json.loads(contract.get_case("case-1"))
    assert case["state"] == "FROZEN"
    assert case["evidence_digest"] == ""


def test_upstream_rate_limit_is_unresolved_without_assessment_mutation(direct_vm):
    contract = deploy_contract(CONTRACT, direct_vm)
    contract.create_case("case-1", URL_A, URL_B, "USD", 2)
    contract.freeze_case("case-1")
    direct_vm.clear_mocks()
    direct_vm.mock_web(r"example\.invalid/fees-a", {"status": 429, "body": ""})
    direct_vm.mock_web(r"example\.invalid/fees-b", {"status": 200, "body": json.dumps(rows())})
    assert contract.assess("case-1") == "UNRESOLVED"
    assert json.loads(contract.get_case("case-1"))["state"] == "FROZEN"


def test_zero_scaled_amount(direct_vm):
    contract = create_frozen(direct_vm, rows("0.00"), rows("0"))
    assert contract.assess("case-1") == "SAME_SCHEDULE"


def test_u128_max_scaled_amount(direct_vm):
    maximum = (2**128) - 1
    max_text = f"{maximum // 100}.{maximum % 100:02d}"
    contract = create_frozen(direct_vm, rows(max_text), rows(max_text))
    assert contract.assess("case-1") == "SAME_SCHEDULE"
    assert json.loads(contract.get_case("case-1"))["old_amount"] == maximum


def test_duplicate_row_is_unresolved(direct_vm):
    contract = create_frozen(direct_vm, rows(), {"currency": "USD", "rows": [
        {"code": "BASE", "unit": "day", "amount": "12.50", "effective_date": "2026-01-01"},
        {"code": "BASE", "unit": "day", "amount": "12.50", "effective_date": "2026-01-01"},
    ]})
    assert contract.assess("case-1") == "UNRESOLVED"


def test_validator_rejects_changed_external_source(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows())
    assert contract.assess("case-1") == "SAME_SCHEDULE"
    mock_sources(direct_vm, rows(), rows("13.00"))
    assert direct_vm.run_validator() is False


def test_retry_is_bounded_and_counts_only_retry_attempts(direct_vm):
    contract = create_frozen(direct_vm, rows(), rows("12.501"))
    assert contract.assess("case-1") == "UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "UNRESOLVED"
    assert contract.retry_unresolved("case-1") == "UNRESOLVED"
    with direct_vm.expect_revert("not retryable"):
        contract.retry_unresolved("case-1")


def test_only_owner_can_freeze(direct_vm, direct_alice):
    contract = deploy_contract(CONTRACT, direct_vm)
    contract.create_case("case-1", URL_A, URL_B, "USD", 2)
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("case owner"):
            contract.freeze_case("case-1")
