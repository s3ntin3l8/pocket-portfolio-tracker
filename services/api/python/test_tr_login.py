"""Unit tests for tr_login.py, the adapter between pytr's native v2 login and the runner.

pytr is replaced by a fake module, so these need no network and no pytr install: they pin
the constructor arguments, the stdout contract and the exit-code mapping.

Run: `python -m pytest services/api/python`.
"""

import json
import sys
import types

import pytest

import tr_login


def install_fake_pytr(monkeypatch, *, initiate=None, complete=None, needs_authenticator=False):
    """Register a fake `pytr.api.TradeRepublicApi`; returns the list of constructed instances."""
    instances = []

    class FakeApi:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self._process_id = "proc-123"
            self.weblogin_needs_authenticator = needs_authenticator
            instances.append(self)

        def initiate_weblogin(self):
            if initiate:
                raise initiate

        def complete_weblogin(self):
            if complete:
                raise complete

    pkg = types.ModuleType("pytr")
    api = types.ModuleType("pytr.api")
    api.TradeRepublicApi = FakeApi
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


def test_authenticator_required_exits_4_without_stdout(monkeypatch, capsys, pair_env):
    install_fake_pytr(monkeypatch, needs_authenticator=True)
    assert pair_env() == 4
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "authenticator" in captured.err


@pytest.mark.parametrize("exc", [ValueError("rejected"), TimeoutError("expired")])
def test_not_approved_exits_3(monkeypatch, pair_env, exc):
    install_fake_pytr(monkeypatch, complete=exc)
    assert pair_env() == 3


def test_other_completion_error_exits_1(monkeypatch, pair_env):
    install_fake_pytr(monkeypatch, complete=RuntimeError("network"))
    assert pair_env() == 1
