"""Time, behind an interface so tests (and the simulator) control it."""

from __future__ import annotations

import subprocess
import time
from typing import Protocol


class Clock(Protocol):
    def now(self) -> float:
        """Seconds since the epoch."""
        ...

    def sleep(self, seconds: float) -> None: ...


class SystemClock:
    """The real time, read with `date +%s` and waited with `sleep`, as the bash scripts did, so the
    simulator's virtual clock on PATH (scripts/sim/fakegh: `date` moves a minute per call, `sleep` returns
    at once) drives the Python code too, and a 30-minute wait takes 30 polls instead of 30 minutes."""

    def now(self) -> float:
        try:
            return float(subprocess.run(["date", "+%s"], capture_output=True, text=True, check=False).stdout.strip())
        except (OSError, ValueError):
            return time.time()

    def sleep(self, seconds: float) -> None:
        try:
            subprocess.run(["sleep", str(seconds)], check=False)
        except OSError:
            time.sleep(seconds)
