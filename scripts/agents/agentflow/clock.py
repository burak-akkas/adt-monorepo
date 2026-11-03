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
    """The real time. Sleeps by running `sleep`, as the bash scripts did, so the simulator's
    instant `sleep` on PATH (scripts/sim/fakegh) applies to the Python code too."""

    def now(self) -> float:
        return time.time()

    def sleep(self, seconds: float) -> None:
        try:
            subprocess.run(["sleep", str(seconds)], check=False)
        except OSError:
            time.sleep(seconds)
