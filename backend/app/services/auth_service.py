"""
AuthService — single shared static password, gating access to whichever
routes actually need protecting (camera, relays, roof, location, config,
plugins, wifi). Deliberately NOT a per-user account system — this is a
single-household van, not a multi-tenant product, so one shared secret
matches the actual threat model: keep random internet strangers who
discover the public URL (subdomains are discoverable via Certificate
Transparency logs, regardless of how obscure the name is) from viewing
the camera, flipping a physical relay, driving the roof, or reading the
van's travel history.

Security posture (hardened):
- The gate FAILS CLOSED in production. If no password is configured and
  environment == production, gated routes refuse to serve unless the
  operator has explicitly opted into insecure mode (VANOS_ALLOW_INSECURE
  =1) for a trusted LAN-only deployment. This stops the previous
  fail-OPEN behaviour where a default install behind the Cloudflare
  tunnel exposed all hardware control with no credential.
- Tokens EXPIRE (TOKEN_TTL_SECONDS) and expired ones are pruned, so a
  lost phone doesn't retain access forever.
- /unlock is RATE-LIMITED (see register_unlock_failure) to blunt online
  brute-forcing of the shared password.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
import time
from typing import Any

from app.core.config import settings
from app.services.configuration_service import configuration_service

logger = logging.getLogger("vanos.auth_service")

# Never hardcoded/committed — same pattern as every other secret in this
# project: only ever read from an environment variable, set in the
# gitignored .env file.
_PASSWORD_ENV_VAR = "APP_ACCESS_PASSWORD"

# Issued tokens are valid for this long, then a device must re-enter the
# password. Long enough that day-to-day use never re-prompts, short
# enough that a lost/stolen phone loses access on its own.
TOKEN_TTL_SECONDS = 90 * 86400  # 90 days

# Unlock brute-force throttle: allow a small burst, then require a
# cooldown. In-memory and process-global (there's no per-user identity
# here, and behind the tunnel every request looks like loopback anyway),
# which is the right granularity for a single shared secret.
_UNLOCK_MAX_FAILURES = 5
_UNLOCK_WINDOW_SECONDS = 60.0


class AuthService:
    def __init__(self) -> None:
        # Timestamps of recent failed unlock attempts (global).
        self._recent_failures: list[float] = []

    def _get_password(self) -> str | None:
        return os.environ.get(_PASSWORD_ENV_VAR)

    def is_configured(self) -> bool:
        """True when a password has been set. When false, the gate is a
        no-op in development, but FAILS CLOSED in production unless
        insecure mode is explicitly allowed (see gate_blocks_unconfigured).
        """
        return bool(self._get_password())

    def insecure_allowed(self) -> bool:
        """Running with no password is only tolerated outside production,
        or when the operator has explicitly opted in for a trusted LAN."""
        return settings.environment != "production" or settings.allow_insecure

    def gate_blocks_unconfigured(self) -> bool:
        """True when there's no password AND we must fail closed anyway —
        i.e. production without an explicit insecure opt-in. Gated routes
        return 401/503 in this state rather than serving openly."""
        return not self.is_configured() and not self.insecure_allowed()

    def check_password(self, candidate: str) -> bool:
        expected = self._get_password()
        if not expected:
            return False
        # Constant-time comparison — a plain `==` leaks timing
        # information about how many leading characters matched.
        return hmac.compare_digest(candidate, expected)

    # --- unlock throttle -------------------------------------------------

    def _prune_failures(self, now: float) -> None:
        cutoff = now - _UNLOCK_WINDOW_SECONDS
        self._recent_failures = [t for t in self._recent_failures if t >= cutoff]

    def unlock_throttled(self) -> bool:
        """True when too many failed unlock attempts happened recently —
        the caller should refuse with 429 rather than checking the
        password again."""
        now = time.time()
        self._prune_failures(now)
        return len(self._recent_failures) >= _UNLOCK_MAX_FAILURES

    def register_unlock_failure(self) -> None:
        now = time.time()
        self._prune_failures(now)
        self._recent_failures.append(now)

    def register_unlock_success(self) -> None:
        self._recent_failures.clear()

    # --- tokens ----------------------------------------------------------

    def _prune_expired_tokens(self, tokens: dict[str, Any], now: float) -> dict[str, Any]:
        return {
            t: meta
            for t, meta in tokens.items()
            if isinstance(meta, dict) and (now - float(meta.get("issued_at", 0))) < TOKEN_TTL_SECONDS
        }

    def issue_token(self) -> str:
        now = time.time()
        token = secrets.token_urlsafe(32)
        tokens: dict[str, Any] = configuration_service.get("auth_tokens") or {}
        tokens = self._prune_expired_tokens(tokens, now)  # opportunistic cleanup
        tokens[token] = {"issued_at": now}
        configuration_service.set("auth_tokens", tokens)
        return token

    def verify_token(self, token: str | None) -> bool:
        if not self.is_configured():
            # No password configured. Fail OPEN only where that's allowed
            # (development, or explicit insecure opt-in); otherwise fail
            # CLOSED so an internet-exposed default install isn't wide open.
            return self.insecure_allowed()
        if not token:
            return False
        now = time.time()
        tokens: dict[str, Any] = configuration_service.get("auth_tokens") or {}
        meta = tokens.get(token)
        if not isinstance(meta, dict):
            return False
        if (now - float(meta.get("issued_at", 0))) >= TOKEN_TTL_SECONDS:
            # Expired — drop it so the store doesn't accumulate dead tokens.
            pruned = self._prune_expired_tokens(tokens, now)
            if len(pruned) != len(tokens):
                configuration_service.set("auth_tokens", pruned)
            return False
        return True

    def revoke_all_tokens(self) -> None:
        """Escape hatch — e.g. if a phone is lost/stolen. Forces every
        device to re-enter the password."""
        configuration_service.set("auth_tokens", {})


auth_service = AuthService()
