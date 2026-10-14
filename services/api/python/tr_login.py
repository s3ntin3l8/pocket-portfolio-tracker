#!/usr/bin/env python3
"""Vendored pytr entrypoint: Trade Republic web-login pairing (v2 push-approval).

Trade Republic deprecated the legacy ``/api/v1/auth/web/login`` (SMS-code) endpoint. The
current flow is ``/api/v2/auth/web/login``: the client posts phone+PIN with a device
fingerprint, Trade Republic sends a **push to the mobile app**, and the client polls the
login process until the user approves it. There is no SMS code.

pytr implements that flow natively (``use_v2_login=True``: ``initiate_weblogin`` +
``complete_weblogin``), including the request headers, the approval poll and the cookie
session save. This script is only a thin adapter between that API and the runner contract.

Contract (the Node runner in services/api/src/services/pytr/runner/core.ts depends on this):
  argv:  pair --cookies-file PATH --waf-strategy {awswaf|token}
  env:   TR_PHONE, TR_PIN, (when strategy == token) TR_WAF_TOKEN
  flow:
    1. mint the AWS-WAF token and POST /api/v2/auth/web/login → a push is sent to the app
    2. print ONE JSON line to stdout: {"processId": "...", "status": "awaiting_approval"}
    3. poll the login process until the user approves the push in the TR mobile app
    4. on approval pytr saves the cookie session to --cookies-file
  authenticator-app (TOTP) accounts:
    2. print {"processId": "...", "status": "awaiting_code"} instead
    3. read one 6-digit code per line from stdin and submit it; a wrong or already-used code
       prints {"status": "code_invalid"} and the next line is read (MAX_CODE_ATTEMPTS tries).
       After a valid code pytr still waits for the login to be confirmed in the TR app.
  exit:  0 approved; 3 rejected/expired/not approved or out of code attempts; 1 any other
         failure, including stdin closing before a code arrived (reason on stderr)

TR's private protocol (app version, platform, user agent) can change. pytr reads
PYTR_TR_APP_VERSION / PYTR_TR_PLATFORM / PYTR_TR_USER_AGENT, so a stale value can be fixed
by configuration instead of a code change.
"""

import argparse
import json
import os
import sys

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_NOT_APPROVED = 3
MAX_CODE_ATTEMPTS = 3


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    pair = sub.add_parser("pair")
    pair.add_argument("--cookies-file", required=True)
    pair.add_argument("--waf-strategy", default="awswaf")
    args = parser.parse_args()

    phone = os.environ.get("TR_PHONE")
    pin = os.environ.get("TR_PIN")
    if not phone or not pin:
        print("TR_PHONE and TR_PIN must be set", file=sys.stderr)
        return EXIT_FAILED

    try:
        from pytr.api import TradeRepublicApi
    except ImportError as exc:  # pragma: no cover - import guard
        print(f"pytr not installed: {exc}", file=sys.stderr)
        return EXIT_FAILED

    # 'token' = use the literal AWS-WAF token from the environment (break-glass paste);
    # otherwise pass the strategy string through ('awswaf') for pytr to mint.
    waf_token = args.waf_strategy
    if waf_token == "token":
        waf_token = os.environ.get("TR_WAF_TOKEN", "")
        if not waf_token:
            print("TR_WAF_TOKEN must be set for the token strategy", file=sys.stderr)
            return EXIT_FAILED

    tr = TradeRepublicApi(
        phone_no=phone,
        pin=pin,
        save_cookies=True,
        cookies_file=args.cookies_file,
        use_v2_login=True,
        waf_token=waf_token,
    )

    try:
        tr.initiate_weblogin()
    except Exception as exc:  # noqa: BLE001 - surface any failure to the runner
        print(f"initiate_weblogin failed: {exc}", file=sys.stderr)
        return EXIT_FAILED

    # pytr exposes the login process id only as `_process_id`. Fail fast if it is missing
    # (e.g. renamed upstream): the runner ignores a stdout line without a processId and
    # would otherwise wait out its whole pairing timeout.
    process_id = getattr(tr, "_process_id", None)
    if not process_id:
        print("pytr did not report a login process id", file=sys.stderr)
        return EXIT_FAILED

    if tr.weblogin_needs_authenticator:
        print(json.dumps({"processId": process_id, "status": "awaiting_code"}), flush=True)
        return _complete_with_code(tr)

    # Tell the runner the push has been sent; it flips the connection to 'awaiting_approval'.
    print(json.dumps({"processId": process_id, "status": "awaiting_approval"}), flush=True)
    return _finish(tr.complete_weblogin)


def _finish(complete) -> int:
    try:
        complete()
    except (ValueError, TimeoutError) as exc:
        # pytr raises ValueError for a rejected/gone/unexpected login process and
        # TimeoutError when it expires unapproved.
        print(f"login not approved: {exc}", file=sys.stderr)
        return EXIT_NOT_APPROVED
    except Exception as exc:  # noqa: BLE001
        print(f"complete_weblogin failed: {exc}", file=sys.stderr)
        return EXIT_FAILED
    return EXIT_OK


def _retryable_code_errors() -> set:
    """The messages pytr raises for a code Trade Republic refused (before any polling)."""
    errors = getattr(sys.modules.get("pytr.api"), "LOGIN_ERRORS", None) or {}
    return {
        errors[key]
        for key in ("VALIDATION_CODE_INVALID", "VALIDATION_CODE_ALREADY_USED")
        if key in errors
    }


def _complete_with_code(tr) -> int:
    """Authenticator-app login: read codes from stdin until one is accepted."""
    retryable = _retryable_code_errors()
    for _ in range(MAX_CODE_ATTEMPTS):
        line = sys.stdin.readline()
        if not line:
            print("stdin closed before an authenticator code arrived", file=sys.stderr)
            return EXIT_FAILED
        code = line.strip()
        try:
            tr.complete_weblogin(verify_code=code)
            return EXIT_OK
        except ValueError as exc:
            if str(exc) not in retryable:
                print(f"login not approved: {exc}", file=sys.stderr)
                return EXIT_NOT_APPROVED
            print(json.dumps({"status": "code_invalid"}), flush=True)
        except TimeoutError as exc:
            print(f"login not approved: {exc}", file=sys.stderr)
            return EXIT_NOT_APPROVED
        except Exception as exc:  # noqa: BLE001
            print(f"complete_weblogin failed: {exc}", file=sys.stderr)
            return EXIT_FAILED
    print("too many invalid authenticator codes", file=sys.stderr)
    return EXIT_NOT_APPROVED


if __name__ == "__main__":
    sys.exit(main())
