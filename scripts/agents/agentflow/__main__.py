"""Entry point: `python3 -I scripts/agents/agentflow <command> [args]` (what the .sh wrappers run).
-I keeps the environment's PYTHON* variables and user site-packages out, so only this code runs."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agentflow.cli import main

raise SystemExit(main(sys.argv[1:]))
