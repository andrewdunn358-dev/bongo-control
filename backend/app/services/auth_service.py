"""
AuthService — single shared static password, gating access to whichever
routes actually need protecting (camera now; relay control later, once
that exists). Deliberately NOT a per-user account system - this is a
single-household van, not a multi-tenant product, so one shared secret
matches the actual threat model: keep random internet strangers who
discover the public URL (subdomains are discoverable via Certificate
Transparency logs, regardless of how obscure the name is) from viewing
the camera or - once built - flipping a physical relay in the van.

Honest about what this does and doesn't protect against: a lost/stolen
phone that already completed the unlock has standing access forever
(the whole point of "don't ask again"), and a single static password
has no rate-limiting or brute-force protection here. Reasonable for
this threat model; worth revisiting if this project's stakes change.

Tokens are opaque random strings, persisted via ConfigurationService
(not just in-memory) - a backend restart should not silently log
everyone out and force re-entering the password, which would
contradict the entire point of this feature.
"""

from __future__ import annotations

import hmac
import os
import secrets
import time
from typing import Any

from app.services.configuration_service import configuration_service

# Never hardcoded/committed - same pattern as every other secret in this
# project (Cloudflare tunnel token, Tapo/webcam credentials): only ever
# read from an environment variable, set in the gitignored .env file.
_PASSWORD_ENV_VAR = "APP_ACCESS_PASSWORD"


class AuthService:
    def _get_password(self) -> str | None:
        return os.environ.get(_PASSWORD_ENV_VAR)

    def is_configured(self) -> bool:
        """If no password is set at all, the gate is a no-op - lets the
        app keep working exactly as it did before this feature existed
        for anyone who hasn't set APP_ACCESS_PASSWORD, rather than
        locking everyone out with a password nobody knows.
        """
        return bool(self._get_password())

    def check_password(self, candidate: str) -> bool:
        expected = self._get_password()
        if not expected:
            return False
        # Constant-time comparison - a plain `==` leaks timing
        # information about how many leading characters matched, which
        # is a real (if minor) side-channel for a password check.
        return hmac.compare_digest(candidate, expected)

    def issue_token(self) -> str:
        token = secrets.token_urlsafe(32)
        tokens: dict[str, Any] = configuration_service.get("auth_tokens") or {}
        tokens[token] = {"issued_at": time.time()}
        configuration_service.set("auth_tokens", tokens)
        return token

    def verify_token(self, token: str | None) -> bool:
        if not self.is_configured():
            # No password configured at all - the gate doesn't apply,
            # regardless of whether a token was ever provided. This
            # check must come BEFORE the "no token" check below, or
            # this no-op case would never actually apply.
            return True
        if not token:
            return False
        tokens: dict[str, Any] = configuration_service.get("auth_tokens") or {}
        return token in tokens

    def revoke_all_tokens(self) -> None:
        """Escape hatch - e.g. if a phone is lost/stolen, changing the
        password env var alone doesn't invalidate previously-issued
        tokens (they're independent of the password once issued). This
        forces every device to re-enter the password.
        """
        configuration_service.set("auth_tokens", {})


auth_service = AuthService()
