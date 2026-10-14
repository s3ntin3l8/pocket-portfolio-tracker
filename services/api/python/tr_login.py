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
  exit:  0 approved; 3 rejected/expired/not approved; 4 the account needs an authenticator-app
         (TOTP) code, which pairing cannot collect yet (nothing is printed to stdout);
         1 any other failure (a human-readable reason is written to stderr)

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
EXIT_AUTHENTICATOR_REQUIRED = 4


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

    if tr.weblogin_needs_authenticator:
        print(
            "this account uses an authenticator app (TOTP) login, which is not supported yet",
            file=sys.stderr,
        )
        return EXIT_AUTHENTICATOR_REQUIRED

    # pytr exposes the login process id only as `_process_id`. Fail fast if it is missing
    # (e.g. renamed upstream): the runner ignores a stdout line without a processId and
    # would otherwise wait out its whole pairing timeout.
    process_id = getattr(tr, "_process_id", None)
    if not process_id:
        print("pytr did not report a login process id", file=sys.stderr)
        return EXIT_FAILED

    # Tell the runner the push has been sent; it flips the connection to 'awaiting_approval'.
    print(json.dumps({"processId": process_id, "status": "awaiting_approval"}), flush=True)

    try:
        tr.complete_weblogin()
    except (ValueError, TimeoutError) as exc:
        # pytr raises ValueError for a rejected/gone/unexpected login process and
        # TimeoutError when it expires unapproved.
        print(f"login not approved: {exc}", file=sys.stderr)
        return EXIT_NOT_APPROVED
    except Exception as exc:  # noqa: BLE001
        print(f"complete_weblogin failed: {exc}", file=sys.stderr)
        return EXIT_FAILED

    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
