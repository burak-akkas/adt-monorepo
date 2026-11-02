#!/usr/bin/env bash
# Creates (or updates) the agent state labels in a repository.
# Usage: scripts/setup-labels.sh owner/repo
set -euo pipefail

repo="${1:?usage: setup-labels.sh owner/repo}"

label() { gh label create "$1" --repo "$repo" --color "$2" --description "$3" --force; }

# Issue states
label "agent:start"           "ededed" "Ask the Analyst agent to pick up this issue"
label "agent:needs-info"      "fbca04" "Analyst is waiting for answers from a human"
label "agent:analyzed"        "c5def5" "Analysis done, Architect agent picks it up"
label "agent:design-review"   "d4c5f9" "Design waiting for human approval (apply agent:ready to approve)"
label "agent:ready"           "0e8a16" "Approved for implementation, Implementor agent picks it up"
label "agent:waiting"         "fef2c0" "Waits for in-flight work on the same files to merge first, then starts"
label "agent:in-progress"     "1d76db" "Implementor agent is working"
label "agent:pr-open"         "5319e7" "A PR is open for this issue"
label "agent:out-of-scope"    "cccccc" "Analyst judged this not actionable"
label "agent:split"           "bfdadc" "Split into sub-issues; closes when all are done"
label "agent:blocked"         "e4e669" "Sub-issue waiting for the sub-issues it depends on"

# PR states
label "agent:review"            "c2e0c6" "Ask the Reviewer agent to review this PR"
label "agent:changes-requested" "e99695" "Reviewer requested changes, Implementor agent fixes them"
label "agent:fixing"            "fbca04" "The Implementor agent is working on this PR now"
label "agent:qa"                "bfd4f2" "QA agent tests the PR preview in a browser"
label "agent:approved"          "0e8a16" "Approved; the merge gate admits it to the merge queue"
label "agent:queued"            "fef2c0" "In the merge queue; the Integrator merges queued PRs one at a time"
label "agent:integrating"       "1d76db" "The Integrator is updating, testing and merging this PR now"

# Both
label "agent:needs-decision"  "f9d0c4" "Team is stuck; the Lead agent decides"
label "agent:needs-human"     "b60205" "Escalated by the Lead; a human must decide"
label "agent:done"            "0e8a16" "Merged by the agent team"

# Risk recorded by the Architect (read by the merge gate)
label "risk:low"              "c2e0c6" "Architect: low risk"
label "risk:medium"           "fbca04" "Architect: medium risk"
label "risk:high"             "b60205" "Architect: high risk; a human merges"
