// pytr subprocess error taxonomy. Extracted from runner.ts so the low-level process helpers
// (process.ts) can throw them without a circular import back through the runner. Re-exported
// from runner.ts, so existing `from "./runner.js"` imports keep working.

export class PytrUnavailableError extends Error {
  constructor(message = "pytr is not available") {
    super(message);
    this.name = "PytrUnavailableError";
  }
}

// Thrown when the saved session can no longer be resumed (re-pairing required).
export class PytrAuthError extends Error {
  constructor(message = "trade republic session expired") {
    super(message);
    this.name = "PytrAuthError";
  }
}

// Thrown when the v2 app-push login is rejected or expires unapproved (exit code 3).
export class PytrApprovalError extends Error {
  constructor(message = "login was not approved") {
    super(message);
    this.name = "PytrApprovalError";
  }
}

// Thrown when the account signs in with an authenticator app (TOTP) code, which pairing cannot
// collect yet (exit code 4).
export class PytrAuthenticatorRequiredError extends Error {
  constructor(message = "authenticator-app login is not supported") {
    super(message);
    this.name = "PytrAuthenticatorRequiredError";
  }
}

export class PytrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PytrError";
  }
}
