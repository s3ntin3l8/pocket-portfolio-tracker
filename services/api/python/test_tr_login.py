"""Unit tests for tr_login.py, the adapter between pytr's native v2 login and the runner.

pytr is replaced by a fake module, so these need no network and no pytr install: they pin
the constructor arguments, the stdout contract and the exit-code mapping.

Run: `python -m pytest services/api/python`.
"""

import io
import json
import sys
import types

import pytest

import tr_login


def install_fake_pytr(
    monkeypatch, *, initiate=None, complete=None, needs_authenticator=False, process_id="proc-123"
):
    """Register a fake `pytr.api.TradeRepublicApi`; returns the list of constructed instances."""
    instances = []

    class FakeApi:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self._process_id = process_id
            self.codes = []
            self.weblogin_needs_authenticator = needs_authenticator
            instances.append(self)

        def initiate_weblogin(self):
            if initiate:
                raise initiate

        def complete_weblogin(self, verify_code=None):
            self.codes.append(verify_code)
            outcome = complete.pop(0) if isinstance(complete, list) else complete
            if outcome:
                raise outcome

    pkg = types.ModuleType("pytr")
    api = types.ModuleType("pytr.api")
    api.TradeRepublicApi = FakeApi
    api.LOGIN_ERRORS = {
        "VALIDATION_CODE_INVALID": "That authenticator code is not correct.",
        "VALIDATION_CODE_ALREADY_USED": "That authenticator code was already used.",
    }
    pkg.api = api
    monkeypatch.setitem(sys.modules, "pytr", pkg)
    monkeypatch.setitem(sys.modules, "pytr.api", api)
    return instances


@pytest.fixture
def pair_env(monkeypatch):
    monkeypatch.setenv("TR_PHONE", "+4900000000")
    monkeypatch.setenv("TR_PIN", "1234")
    monkeypatch.delenv("TR_WAF_TOKEN", raising=False)

    def run(strategy="awswaf"):
        monkeypatch.setattr(
            sys, "argv", ["tr_login.py", "pair", "--cookies-file", "/tmp/c.txt", "--waf-strategy", strategy]
        )
        return tr_login.main()

    return run


def test_success_prints_one_json_line_and_uses_native_v2(monkeypatch, capsys, pair_env):
    instances = install_fake_pytr(monkeypatch)
    assert pair_env() == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert [json.loads(line) for line in out] == [{"processId": "proc-123", "status": "awaiting_approval"}]
    kwargs = instances[0].kwargs
    assert kwargs["use_v2_login"] is True
    assert kwargs["waf_token"] == "awswaf"
    assert kwargs["cookies_file"] == "/tmp/c.txt"
    assert kwargs["save_cookies"] is True


def test_token_strategy_passes_the_literal_token(monkeypatch, pair_env):
    instances = install_fake_pytr(monkeypatch)
    monkeypatch.setenv("TR_WAF_TOKEN", "tok-abc")
    assert pair_env("token") == 0
    assert instances[0].kwargs["waf_token"] == "tok-abc"


def test_token_strategy_without_token_fails(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch)
    assert pair_env("token") == 1
    assert "TR_WAF_TOKEN" in capsys.readouterr().err


def test_missing_credentials_fail(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch)
    monkeypatch.delenv("TR_PIN")
    assert pair_env() == 1
    assert "TR_PHONE and TR_PIN" in capsys.readouterr().err


def test_initiate_failure_exits_1_without_stdout(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch, initiate=RuntimeError("boom"))
    assert pair_env() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "boom" in captured.err


BAD_CODE = ValueError("That authenticator code is not correct.")


def feed_stdin(monkeypatch, text):
    monkeypatch.setattr(sys, "stdin", io.StringIO(text))


def stdout_lines(capsys):
    return [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]


def test_authenticator_account_announces_awaiting_code_and_submits_the_code(
    monkeypatch, capsys, pair_env
):
    instances = install_fake_pytr(monkeypatch, needs_authenticator=True)
    feed_stdin(monkeypatch, "123456\n")
    assert pair_env() == 0
    assert stdout_lines(capsys) == [{"processId": "proc-123", "status": "awaiting_code"}]
    assert instances[0].codes == ["123456"]


def test_wrong_code_reports_code_invalid_then_accepts_the_next(monkeypatch, capsys, pair_env):
    instances = install_fake_pytr(monkeypatch, needs_authenticator=True, complete=[BAD_CODE, None])
    feed_stdin(monkeypatch, "111111\n222222\n")
    assert pair_env() == 0
    assert stdout_lines(capsys)[1:] == [{"status": "code_invalid"}]
    assert instances[0].codes == ["111111", "222222"]


def test_already_used_code_is_retryable(monkeypatch, capsys, pair_env):
    used = ValueError("That authenticator code was already used.")
    install_fake_pytr(monkeypatch, needs_authenticator=True, complete=[used, None])
    feed_stdin(monkeypatch, "111111\n222222\n")
    assert pair_env() == 0
    assert {"status": "code_invalid"} in stdout_lines(capsys)


def test_three_wrong_codes_exit_3(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch, needs_authenticator=True, complete=[BAD_CODE] * 3)
    feed_stdin(monkeypatch, "1\n2\n3\n4\n")
    assert pair_env() == 3
    assert stdout_lines(capsys).count({"status": "code_invalid"}) == 3


def test_stdin_closing_before_a_code_exits_1(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch, needs_authenticator=True)
    feed_stdin(monkeypatch, "")
    assert pair_env() == 1
    assert "stdin closed" in capsys.readouterr().err


def test_authenticator_non_code_failure_exits_3(monkeypatch, pair_env):
    install_fake_pytr(monkeypatch, needs_authenticator=True, complete=ValueError("login rejected"))
    feed_stdin(monkeypatch, "123456\n")
    assert pair_env() == 3


def test_authenticator_timeout_exits_3(monkeypatch, pair_env):
    install_fake_pytr(monkeypatch, needs_authenticator=True, complete=TimeoutError("expired"))
    feed_stdin(monkeypatch, "123456\n")
    assert pair_env() == 3


@pytest.mark.parametrize("exc", [ValueError("rejected"), TimeoutError("expired")])
def test_not_approved_exits_3(monkeypatch, pair_env, exc):
    install_fake_pytr(monkeypatch, complete=exc)
    assert pair_env() == 3


def test_other_completion_error_exits_1(monkeypatch, pair_env):
    install_fake_pytr(monkeypatch, complete=RuntimeError("network"))
    assert pair_env() == 1


def test_missing_process_id_exits_1_without_stdout(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch, process_id=None)
    assert pair_env() == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "process id" in captured.err
