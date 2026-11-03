"""GitHub App installation tokens that stay valid for at least another 15 minutes.

Installation tokens expire after an hour, and an Integrator run can take longer (a long queue, slow CI,
a QA hold). Long-running steps ask for a token before using gh: the cached one while it is younger
than 45 minutes, otherwise a new one minted from the App's private key, limited to this repository
like the one the workflow starts with.

The RS256 signature comes from `openssl` (Python's standard library can't sign RSA), the API calls
from `curl` (so the simulator's fake curl answers them).
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from collections.abc import Mapping

from agentflow.clock import Clock

MAX_AGE = 45 * 60


class TokenError(Exception):
    pass


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _run(args: list[str], env: Mapping[str, str], stdin: bytes | None = None) -> bytes:
    p = subprocess.run(args, input=stdin, capture_output=True, env=dict(env), check=False)
    if p.returncode != 0:
        raise TokenError(f"{args[0]} failed: {p.stderr.decode(errors='replace').strip()}")
    return p.stdout


def _jwt(app_id: str, key: str, now: int, env: Mapping[str, str]) -> str:
    header = _b64url(b'{"alg":"RS256","typ":"JWT"}')
    payload = _b64url(json.dumps({"iat": now - 60, "exp": now + 540, "iss": app_id}, separators=(",", ":")).encode())
    fd, path = tempfile.mkstemp(prefix="agent-app-key-")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(key.rstrip("\n") + "\n")
        signature = _run(["openssl", "dgst", "-sha256", "-sign", path], env, f"{header}.{payload}".encode())
    finally:
        os.unlink(path)
    return f"{header}.{payload}.{_b64url(signature)}"


def app_token(env: Mapping[str, str], clock: Clock) -> str:
    """A token for gh. Without AGENT_APP_ID or AGENT_APP_PRIVATE_KEY, GH_TOKEN unchanged (e.g. in the
    simulator). Cache: AGENT_TOKEN_CACHE (default $RUNNER_TEMP/agent-app-token), "<minted-at> <token>"."""
    app_id, key = env.get("AGENT_APP_ID", ""), env.get("AGENT_APP_PRIVATE_KEY", "")
    if not app_id or not key:
        return env.get("GH_TOKEN", "")
    repo = env.get("GITHUB_REPOSITORY", "")
    if not repo:
        raise TokenError("GITHUB_REPOSITORY must be set")
    cache = env.get("AGENT_TOKEN_CACHE") or os.path.join(env.get("RUNNER_TEMP") or "/tmp", "agent-app-token")
    now = int(clock.now())
    try:
        with open(cache, encoding="utf-8") as f:
            minted, _, cached = f.readline().strip().partition(" ")
        if cached and now - int(minted) < MAX_AGE:
            return cached
    except (OSError, ValueError):
        pass

    jwt = _jwt(app_id, key, now, env)
    api = env.get("GITHUB_API_URL") or "https://api.github.com"
    headers = ["-H", f"Authorization: Bearer {jwt}", "-H", "Accept: application/vnd.github+json"]
    installation = json.loads(_run(["curl", "-fsS", *headers, f"{api}/repos/{repo}/installation"], env))["id"]
    body = json.dumps({"repositories": [repo.split("/", 1)[-1]]}, separators=(",", ":"))
    token = json.loads(_run(["curl", "-fsS", "-X", "POST", *headers, "-d", body, f"{api}/app/installations/{installation}/access_tokens"], env)).get("token")
    if not token:
        raise TokenError("GitHub returned no token")
    fd = os.open(cache, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(f"{now} {token}\n")
    return str(token)
