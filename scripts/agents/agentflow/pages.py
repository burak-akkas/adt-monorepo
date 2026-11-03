"""Publishing a directory into the gh-pages branch, retrying when another workflow pushed meanwhile
(production deploys, PR previews and QA screenshots all write to gh-pages, often at the same moment)."""

from __future__ import annotations

import filecmp
import os
import shutil
import subprocess
import tempfile
import time
from collections.abc import Callable

ATTEMPTS = 5


class PagesError(Exception):
    pass


def _git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False)


def _must(*args: str) -> None:
    p = _git(*args)
    if p.returncode != 0:
        raise PagesError(f"git {args[2] if args[:1] == ('-C',) else args[0]} failed: {p.stderr.strip()}")


def sync(src: str, dst: str, delete: bool) -> None:
    """Copies src's contents into dst (like `rsync -a src/ dst/`); with delete, removes what src lacks."""
    os.makedirs(dst, exist_ok=True)
    for root, dirs, files in os.walk(src):
        target = os.path.join(dst, os.path.relpath(root, src))
        os.makedirs(target, exist_ok=True)
        for name in files:
            a, b = os.path.join(root, name), os.path.join(target, name)
            if not os.path.exists(b) or not filecmp.cmp(a, b, shallow=False):
                shutil.copy2(a, b)
        if delete:
            for name in set(os.listdir(target)) - set(dirs) - set(files):
                path = os.path.join(target, name)
                shutil.rmtree(path) if os.path.isdir(path) and not os.path.islink(path) else os.unlink(path)


def publish(
    src: str,
    dest: str,
    message: str,
    replace: bool = False,
    *,
    repo: str = "",
    token: str = "",
    remote: str | None = None,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = lambda _: None,
) -> str:
    """Publishes `src` at `dest` ("." for the site root, e.g. "pr-12" for a preview). `replace` deletes
    what isn't in `src` (previews); never at the root, so previews and screenshots are kept."""
    remote = remote or f"https://x-access-token:{token}@github.com/{repo}.git"
    work = tempfile.mkdtemp(prefix="gh-pages-")
    _must("clone", "-q", "--depth", "1", "--branch", "gh-pages", remote, work)
    _must("-C", work, "config", "user.name", "github-actions[bot]")
    _must("-C", work, "config", "user.email", "41898283+github-actions[bot]@users.noreply.github.com")
    sync(src, os.path.join(work, dest), delete=replace and dest != ".")
    open(os.path.join(work, ".nojekyll"), "a").close()
    _must("-C", work, "add", "-A")
    if _git("-C", work, "diff", "--cached", "--quiet").returncode == 0:
        return "Nothing to publish"
    _must("-C", work, "commit", "-qm", message)
    for attempt in range(1, ATTEMPTS + 1):
        if _git("-C", work, "push", "-q", "origin", "gh-pages").returncode == 0:
            return f"Published {dest} (attempt {attempt})"
        log(f"Push rejected (attempt {attempt}), rebasing on the latest gh-pages")
        sleep(attempt * 3)
        _git("-C", work, "fetch", "-q", "--depth", "20", "origin", "gh-pages")
        _git("-C", work, "rebase", "-q", "origin/gh-pages")
    raise PagesError(f"Could not publish to gh-pages after {ATTEMPTS} attempts")
