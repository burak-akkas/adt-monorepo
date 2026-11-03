#!/usr/bin/env python3
"""Parity tests for moving the workflows' inline bash into agentflow commands.

Each case runs a workflow step as it was (the workflow files at STEP_REF, the last commit with the
logic inline) and as it is now (one `agent.sh <command>` line), on copies of the same fake repository,
with the same step environment and event values, and compares what each did: labels, comments, issue
states, label events, the step's outputs (GITHUB_OUTPUT), its summary and stdout.

Run: python3 scripts/sim/test_step_parity.py [name-filter]
"""
import sys
sys.dont_write_bytecode = True

import copy, json, os, subprocess, traceback

import yaml

import simlib
from simlib import BOT, REPO, approval, bot_comment, files, make_state, queued, run, sha, subst
from test_parity import Skip, norm, outcome

STEP_REF = os.environ.get("STEP_REF", "ad57a91")
CASES = []


def case(fn):
    CASES.append(fn)
    return fn


_old = {}


def old_steps(wf, job):
    if (wf, job) not in _old:
        p = subprocess.run(["git", "-C", REPO, "show", f"{STEP_REF}:.github/workflows/{wf}"], capture_output=True, text=True)
        if p.returncode:
            raise Skip(f"{STEP_REF} is not in this checkout")
        _old[(wf, job)] = {s.get("name"): s for s in yaml.safe_load(p.stdout)["jobs"][job]["steps"]}
    return _old[(wf, job)]


PRE = "mkdir -p .git/info .agent-out .agent-trusted\nln -sfn {r}/scripts scripts\nln -sfn {r}/scripts .agent-trusted/scripts\n".format(r=REPO)


def step_outcome(st):
    o = outcome(st)
    o["outputs"] = {k: norm(v) for k, v in st["_outputs"].items()}
    o["summary"] = norm(st["_summary"]).strip()
    return o


def compare(st, wf, job, name, ctx=None, differs=(), **env):
    """ctx: values for the step's ${{ }} expressions (as the sim gives them); env: the step's environment."""
    old = old_steps(wf, job)[name]["run"]
    new = simlib.steps(wf, job)[name]["run"]
    a = step_outcome(run(copy.deepcopy(st), shell=PRE + subst(old, ctx or {}), **env))
    r = run(copy.deepcopy(st), shell=PRE + subst(new, ctx or {}), **env)
    b = step_outcome(r)
    for k in differs:
        a.pop(k), b.pop(k)
    if a != b:
        diff = [k for k in a if a[k] != b[k]]
        detail = "\n".join("  %s:\n    old: %s\n    new: %s" % (k, json.dumps(a[k])[:1200], json.dumps(b[k])[:1200]) for k in diff)
        raise AssertionError("%s / %s differs in %s\n%s\n  new stderr: %s" % (wf, name, diff, detail, r["_stderr"][-600:]))
    return r


def issue(st, n, labels=(), comments=(), author=1, body=""):
    it = {"kind": "issue", "labels": list(labels), "comments": [], "state": "OPEN", "head": None, "author": author, "body": body}
    st["items"][str(n)] = it
    for c in comments:
        st["clock"] += 1
        c = dict(c, id=len(st["comments_all"]) + 1, created_at="2020-01-01T00:%02d:%02dZ" % divmod(st["clock"], 60))
        st["comments_all"].append(c)
        it["comments"].append(c["id"])
    return st


def handoff(role, extra=""):
    return bot_comment(f"<!-- agent:{role} -->\n## {role}\n{extra}")


# --- the Analyst -----------------------------------------------------------------------------------
@case
def analyst_apply():
    for decision, before, autonomy in (("analyzed", 0, ""), ("needs-info", 0, ""), ("needs-info", 0, "full"), ("out-of-scope", 0, ""),
                                       ("analyzed", 1, ""), ("error", 0, "")):
        st = issue(make_state({}), 7, ["agent:start"], [handoff("analyst")])
        compare(st, "agent-analyst.yml", "analyst", "Apply state transition", {"github.event.issue.number": "7"},
                OUT=json.dumps({"decision": decision}), N=7, BEFORE=before, AUTONOMY=autonomy)


# --- the Architect ---------------------------------------------------------------------------------
ARCH_ENV = dict(REQUIRE_APPROVAL="", AGENT_MAX_SUBISSUES="5", MAX_FILES="20", AVOID_CONFLICTS="", AGENT_CONFLICT_IGNORE="")


@case
def architect_split_mode_and_count():
    st = issue(make_state({}), 7, ["agent:analyzed"], [handoff("architect"), bot_comment("<!-- agent:split-required -->")])
    ctx = {"github.event.issue.number": "7"}
    compare(st, "agent-architect.yml", "architect", "Count handoff comments", ctx)
    for env in ({}, {"AGENT_SPLIT": "false"}):
        compare(st, "agent-architect.yml", "architect", "Split mode", ctx, N=7, MAX=5, AGENT_MAX_SPLIT_DEPTH=2, **env)
    st = issue(make_state({}), 7, ["agent:analyzed"])
    compare(st, "agent-architect.yml", "architect", "Split mode", ctx, N=7, MAX=5, AGENT_MAX_SPLIT_DEPTH=2)


@case
def architect_apply():
    ctx = {"github.event.issue.number": "7"}
    few, many = [f"src/f{i}.ts" for i in range(3)], [f"src/f{i}.ts" for i in range(25)]
    plan = [{"title": "A", "summary": "a", "acceptance_criteria": ["x"]}, {"title": "B", "summary": "b", "acceptance_criteria": [], "depends_on": [1]}]
    for out, mode, extra in (
        ({"decision": "ready", "risk": "low", "files": few}, "allowed", {}),
        ({"decision": "ready", "risk": "high", "files": few}, "allowed", {}),
        ({"decision": "needs-human", "risk": "medium", "files": few}, "allowed", {}),
        ({"decision": "ready", "risk": "medium", "files": many}, "allowed", {}),
        ({"decision": "ready", "risk": "medium", "files": many}, "not-allowed", {}),
        ({"decision": "ready", "risk": "medium", "files": few}, "required", {}),
        ({"decision": "split", "risk": "medium", "subtasks": plan}, "allowed", {}),
        ({"decision": "split", "risk": "medium", "subtasks": plan}, "not-allowed", {}),
        ({"decision": "ready", "risk": "low", "files": few}, "allowed", {"REQUIRE_APPROVAL": "true"}),
        ({"risk": "low"}, "allowed", {}),
    ):
        st = issue(make_state({}), 7, ["agent:analyzed", "risk:medium"], [handoff("architect")])
        compare(st, "agent-architect.yml", "architect", "Apply state transition", ctx, OUT=json.dumps(out), N=7, BEFORE=0,
                SPLIT_MODE=mode, **{**ARCH_ENV, **extra})
    st = issue(make_state({}), 7, ["agent:analyzed"], [handoff("architect")])
    compare(st, "agent-architect.yml", "architect", "Apply state transition", ctx, OUT=json.dumps({"decision": "ready", "risk": "low", "files": few}),
            N=7, BEFORE=1, SPLIT_MODE="allowed", **ARCH_ENV)
    # Changed on purpose: a split plan the Architect got wrong is an ::error:: annotation in the step log now. Before, the
    # split script printed it to its stderr, so it was plain text in the log.
    st = issue(make_state({}), 7, ["agent:analyzed", "risk:medium"], [handoff("architect")])
    r = compare(st, "agent-architect.yml", "architect", "Apply state transition", ctx, differs=["stdout"],
                OUT=json.dumps({"decision": "split", "risk": "medium", "subtasks": plan[:1]}), N=7, BEFORE=0, SPLIT_MODE="allowed", **ARCH_ENV)
    assert "::error::Split plan has 1 subtasks; expected 2 to 5" in r["_stdout"], r["_stdout"]


@case
def architect_waits_for_overlapping_work():
    from test_scenarios import add_issue
    st = make_state({101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts")}})
    add_issue(st, 7, ["agent:analyzed"])
    st = issue(st, 7, ["agent:analyzed"], [handoff("architect")])
    compare(st, "agent-architect.yml", "architect", "Apply state transition", {"github.event.issue.number": "7"},
            OUT=json.dumps({"decision": "ready", "risk": "low", "files": ["src/a.ts", "src/b.ts"]}), N=7, BEFORE=0, SPLIT_MODE="allowed",
            **{**ARCH_ENV, "AVOID_CONFLICTS": "true"})


# --- the Implementor -------------------------------------------------------------------------------
@case
def implementor_apply():
    ctx = {"github.event.issue.number": "7"}
    base = dict(N=7, BRANCH="agent/issue-7", MAX_CONTINUATIONS=3)
    for out, branches, before in (
        ({"status": "pr-opened", "pr_number": 107}, {}, ""),
        (None, {"agent/issue-7": sha(0xc1)}, ""),
        ({"status": "progress", "reason": "step 2"}, {"agent/issue-7": sha(0xc2)}, sha(0xc1)),
        ({"status": "progress"}, {"agent/issue-7": sha(0xc1)}, sha(0xc1)),
        ({"status": "blocked", "reason": "stuck"}, {"agent/issue-7": sha(0xc2)}, sha(0xc1)),
        ({"status": "waiting", "waiting_on": [54, 7, 101], "reason": "needs #54"}, {}, ""),
        ({"status": "waiting", "waiting_on": [55]}, {}, ""),
    ):
        st = make_state({101: {"head": sha(0xa1), "labels": []}}, branches=branches)
        st = issue(st, 7, ["agent:in-progress"], [handoff("architect")])
        issue(st, 54)
        issue(st, 55)
        st["items"]["55"]["state"] = "CLOSED"
        if out and out.get("status") == "pr-opened":
            st["items"]["107"] = {"kind": "pr", "head": sha(0xd1), "labels": [], "comments": [], "state": "OPEN", "branch": "agent/issue-7", "issue": 7}
            st["shas"][sha(0xd1)] = {"base_version": 0, "files": files("+x"), "commit": {}}
        compare(st, "agent-implementor.yml", "implement", "Apply state transition", ctx, OUT=json.dumps(out) if out else "", BEFORE=before, **base)
    st = make_state({}, branches={"agent/issue-7": sha(0xc4)})
    st = issue(st, 7, ["agent:in-progress"], [handoff("architect")] + [bot_comment("<!-- agent:continue -->")] * 3)
    compare(st, "agent-implementor.yml", "implement", "Apply state transition", ctx, OUT="", BEFORE=sha(0xc3), **base)


@case
def implementor_fix_apply():
    for status, labels in (("pushed", ["agent:fixing"]), ("pushed", ["agent:review"]), ("no-change", ["agent:fixing"]), (None, ["agent:fixing"])):
        st = make_state({101: {"head": sha(0xa1), "labels": labels, "issue": 11}})
        out = json.dumps({"status": status, "reason": "x"}) if status else ""
        compare(st, "agent-implementor.yml", "fix", "Apply state transition", {"github.event.pull_request.number": "101"}, OUT=out, PR=101)


# --- the Reviewer ----------------------------------------------------------------------------------
REVIEW_ENV = dict(PR=101, QA="", QA_ON_BASE_UPDATE="", SKIP_SAME="", MAX_ROUNDS=3)


@case
def reviewer_loop_guard():
    from test_scenarios import own_changes_state
    a = sha(0xa1)
    for comments, action in (([], "opened"), ([handoff("reviewer", "**Verdict:** request-changes")] * 3, "synchronize"),
                             ([handoff("reviewer", "**Verdict:** request-changes")] * 3 + [bot_comment("<!-- agent:lead -->")], "synchronize"),
                             ([approval(a, "reviewer")], "synchronize")):
        st = make_state({101: {"head": a, "labels": ["agent:review"], "comments": comments, "issue": 11}})
        compare(st, "agent-reviewer.yml", "review", "Loop guard", {"github.event.action": action, "github.event.pull_request.head.sha": a}, **REVIEW_ENV)
    st0, appr, res1, res2 = own_changes_state()
    for head, extra in ((res1, {"SKIP_SAME": "true"}), (res1, {"SKIP_SAME": "true", "QA": "true", "QA_ON_BASE_UPDATE": "true"}), (res2, {"SKIP_SAME": "true"}),
                        (res1, {})):
        st = copy.deepcopy(st0)
        st["items"]["101"]["head"] = head
        compare(st, "agent-reviewer.yml", "review", "Loop guard", {"github.event.action": "synchronize", "github.event.pull_request.head.sha": head},
                **{**REVIEW_ENV, **extra})
    upd = sha(0xa9)
    commit = {"parents": [{"sha": a}, {"sha": sha(0xb0)}], "author": {"id": BOT}, "committer": {"login": "web-flow"}, "commit": {"verification": {"verified": True}}}
    for extra in ({}, {"QA": "true", "QA_ON_BASE_UPDATE": "true"}, {"QA": "true"}):
        st = make_state({101: {"head": upd, "labels": [], "comments": [approval(a, "reviewer")], "extra_shas": {upd: {"base_version": 0, "files": [], "commit": commit}}}})
        compare(st, "agent-reviewer.yml", "review", "Loop guard", {"github.event.action": "synchronize", "github.event.pull_request.head.sha": upd},
                **{**REVIEW_ENV, **extra})


@case
def reviewer_apply():
    a = sha(0xa1)
    for verdict, extra, prior in (("approve", {}, []), ("approve", {"QA": "true"}, []), ("approve", {"QA_IN_QUEUE": "true"}, []),
                                  ("request-changes", {}, []), ("needs-human", {}, []), ("error", {}, []),
                                  ("error", {}, [bot_comment(f"<!-- agent:reviewer-retry {a} -->")]),
                                  ("approve", {"QA": "true", "QA_PATHS": "web/"}, [])):
        st = make_state({101: {"head": a, "labels": ["agent:review"], "issue": 11, "files": files("+x", name="api/a.ts"),
                               "comments": prior + [handoff("reviewer", f"**Verdict:** {verdict}")]}})
        compare(st, "agent-reviewer.yml", "review", "Apply state transition",
                {"github.event.pull_request.head.sha": a, "steps.guard.outputs.total": "0", "steps.guard.outputs.round": "1"},
                OUT=json.dumps({"verdict": verdict}), PR=101, **{"QA": "", "QA_IN_QUEUE": "", "QA_PATHS": "", **extra})
    st = make_state({101: {"head": sha(0xa2), "labels": ["agent:review"], "comments": [handoff("reviewer")]}})
    compare(st, "agent-reviewer.yml", "review", "Apply state transition",
            {"github.event.pull_request.head.sha": a, "steps.guard.outputs.total": "0", "steps.guard.outputs.round": "2"},
            OUT=json.dumps({"verdict": "approve"}), PR=101, QA="", QA_IN_QUEUE="", QA_PATHS="")


# --- QA ----------------------------------------------------------------------------------------------
QA_ENV = dict(PR=101, MAX_ROUNDS=3, URL_TEMPLATE="https://{owner}.github.io/{repo}/pr-{pr}/", LOCAL="", LOCAL_URL="http://localhost:3000/")


@case
def qa_round_guard():
    a = sha(0xa1)
    for labels, comments, extra in ((["agent:qa"], [], {}), (["agent:qa"], [handoff("qa", "**Verdict:** fail")] * 3, {}), (["agent:review"], [], {}),
                                    (["agent:qa"], [], {"LOCAL": "true"})):
        st = make_state({101: {"head": a, "labels": labels, "comments": comments, "issue": 11}})
        compare(st, "agent-qa.yml", "qa", "Round guard", {}, HEAD_SHA=a, **{**QA_ENV, **extra})


@case
def qa_waits_for_checks():
    a = sha(0xa1)
    for plan in (["pass"], ["fail"], ["slow:2"]):
        st = make_state({101: {"head": a, "labels": ["agent:qa"]}}, check_plan=plan)
        compare(st, "agent-qa.yml", "qa", "Wait for required checks", {}, PR=101, HEAD_SHA=a, AGENT_REQUIRED_CHECKS="CI")
    st = make_state({101: {"head": a, "labels": ["agent:qa"], "files": files("+x", name="docs/a.md")}})
    compare(st, "agent-qa.yml", "qa", "Wait for required checks", {}, PR=101, HEAD_SHA=a, AGENT_REQUIRED_CHECKS="CI@web/")


@case
def qa_waits_for_the_preview():
    a = sha(0xa1)
    st = make_state({101: {"head": a, "labels": ["agent:qa"]}},
                    deployments=[{"id": 1, "sha": a, "environment": "Preview", "state": "success", "url": "https://pr.example"},
                                 {"id": 2, "sha": a, "environment": "Production", "state": "success", "url": "https://prod.example"}])
    for envname in ("", "Preview", "Staging"):
        compare(st, "agent-qa.yml", "qa", "Wait for the preview of this commit", {}, PR=101, HEAD_SHA=a, URL="deployment", ENVIRONMENT=envname)
    for body in (a, "other"):
        compare(st, "agent-qa.yml", "qa", "Wait for the preview of this commit", {}, PR=101, HEAD_SHA=a, URL="https://pv.example/pr-101/",
                ENVIRONMENT="", FAKE_CURL_SITES=json.dumps({"https://pv.example/pr-101/version.txt": body + "\n"}))


@case
def qa_apply():
    a = sha(0xa1)
    ctx = {"steps.guard.outputs.total": "0", "steps.guard.outputs.round": "1", "steps.e2e.outputs.exit": "0"}
    for out, extra in (({"verdict": "pass"}, {}), ({"verdict": "fail"}, {}), ({"verdict": "needs-human"}, {}), (None, {}),
                       ({"verdict": "pass"}, {"CI_RESULT": "fail", "CI_FAILED": "[CI](x)"}), ({"verdict": "pass"}, {"READY": ""}),
                       ({"verdict": "pass"}, {"READY": "", "LOCAL": "true"})):
        st = make_state({101: {"head": a, "labels": ["agent:qa"], "issue": 11, "comments": [handoff("qa")]}})
        env = {**QA_ENV, "HEAD_SHA": a, "OUT": json.dumps(out) if out else "", "READY": "true", "CI_RESULT": "pass", "CI_FAILED": "", "URL": "https://x/", **extra}
        compare(st, "agent-qa.yml", "qa", "Apply state transition", ctx, **env)
    for e2e in ("none", "1"):
        st = make_state({101: {"head": a, "labels": ["agent:qa"], "issue": 11, "comments": [handoff("qa")]}})
        compare(st, "agent-qa.yml", "qa", "Apply state transition", dict(ctx, **{"steps.e2e.outputs.exit": e2e}),
                **{**QA_ENV, "HEAD_SHA": a, "OUT": json.dumps({"verdict": "fail"}), "READY": "true", "CI_RESULT": "pass", "CI_FAILED": "", "URL": "u"})


# --- the Lead ------------------------------------------------------------------------------------------
@case
def lead_steps():
    for comments, kind in (([], "issue"), ([bot_comment("<!-- agent:lead -->")] * 3, "issue"), ([], "pr")):
        st = issue(make_state({}), 7, ["agent:needs-decision"], comments)
        compare(st, "agent-lead.yml", "lead", "Decision budget", {}, N=7, KIND=kind, MAX_DECISIONS=3, BIN=os.path.join(REPO, "scripts/agents"))
    for action, kind, split in (("implement", "issue", "allowed"), ("split", "issue", "allowed"), ("split", "issue", "not-allowed"),
                                ("redesign", "issue", "allowed"), ("restart-analysis", "issue", "allowed"), ("escalate", "issue", "allowed"),
                                ("close", "issue", "allowed"), ("nonsense", "issue", "allowed")):
        st = issue(make_state({}), 7, ["agent:needs-decision"], [bot_comment("<!-- agent:lead -->")])
        compare(st, "agent-lead.yml", "lead", "Apply decision", {}, N=7, KIND=kind, TOTAL=0, SPLIT=split,
                OUT=json.dumps({"action": action, "rationale": "r"}), BIN=os.path.join(REPO, "scripts/agents"))
    for action in ("fix", "re-review", "qa", "close", "approve"):
        st = make_state({101: {"head": sha(0xa1), "labels": ["agent:needs-decision"], "comments": [bot_comment("<!-- agent:lead -->")], "issue": 11}})
        compare(st, "agent-lead.yml", "lead", "Apply decision", {"github.event.pull_request.head.sha": sha(0xa1)}, N=101, KIND="pr", TOTAL=0, SPLIT="",
                OUT=json.dumps({"action": action, "rationale": "r"}), BIN=os.path.join(REPO, "scripts/agents"))


# --- the merge gate and the Integrator's drain ---------------------------------------------------------------
GATE = dict(PR=101, HIGH_RISK_OK="", PROTECTED=".github/,scripts/,templates/", BASE="sandbox")


@case
def merge_gate():
    a, b = sha(0xa1), sha(0xa2)
    for pr, sender, extra in (({"head": a, "comments": [approval(a)]}, "Bot", {}), ({"head": b, "comments": [approval(a)]}, "Bot", {}),
                              ({"head": b, "comments": []}, "User", {}), ({"head": a, "state": "MERGED", "comments": [approval(a)]}, "Bot", {}),
                              ({"head": a, "comments": [approval(a)], "files": files("+x", name="scripts/x.sh")}, "Bot", {}),
                              ({"head": a, "comments": [approval(a)], "high": True}, "Bot", {}),
                              ({"head": a, "comments": [approval(a)], "high": True}, "Bot", {"HIGH_RISK_OK": "true"})):
        pr = dict(pr, labels=["agent:approved"], issue=11)
        high = pr.pop("high", False)
        st = make_state({101: pr, 102: {"head": sha(0xb1), "comments": [queued()]}})
        if high:
            st["items"]["11"]["labels"].append("risk:high")
        env = {**GATE, "HEAD_SHA": pr["head"], "SENDER_TYPE": sender, "SENDER": "someone", **extra}
        compare(st, "agent-merge.yml", "merge", "Risk gate", {}, **env)
        compare(st, "agent-merge.yml", "merge", "Join the merge queue", {}, **env)
    st = make_state({101: {"head": a, "labels": ["agent:approved"], "comments": [approval(a), bot_comment(f"<!-- agent:integrator-hold {a} -->")]}})
    compare(st, "agent-merge.yml", "merge", "Join the merge queue", {}, **{**GATE, "HEAD_SHA": a, "SENDER_TYPE": "Bot", "SENDER": "x"})


@case
def draining_the_queue():
    from test_scenarios import two_queued
    for st, extra in ((two_queued(), {}), (two_queued(check_plan=["fail", "pass"]), {}), (make_state({}), {}), (two_queued(), {"DRAIN_MINUTES": "0"})):
        compare(st, "agent-integrator.yml", "integrate", "Merge the queue, one PR at a time", {}, **{"DRAIN_MINUTES": "100", **extra})


@case
def denied_tools_are_reported():
    import tempfile
    d = tempfile.mkdtemp()
    log = os.path.join(d, "execution.json")
    with open(log, "w") as f:
        json.dump([{"type": "assistant"}, {"type": "result", "permission_denials": [{"tool_name": "Bash", "tool_input": {"command": "rm -rf /" + "x" * 400}}]}], f)
    empty = os.path.join(d, "empty.json")
    with open(empty, "w") as f:
        json.dump([{"type": "result"}], f)
    for wf, job in (("agent-analyst.yml", "analyst"), ("agent-reviewer.yml", "review"), ("agent-implementor.yml", "fix")):
        for path in (log, empty, os.path.join(d, "missing.json")):
            compare(make_state({}), wf, job, "Report denied tools", {"steps.agent.outputs.execution_file": path})


# --- QA on the runner ------------------------------------------------------------------------------------
@case
def qa_finds_the_baseline():
    from test_scenarios import HEAD
    for local, template, site in (("http://localhost:3001/ (local)", "https://prod.example/", None), ("", "none", None),
                                  ("", "https://{owner}.example/{repo}/", None), ("", "https://prod.example/", HEAD),
                                  ("", "https://prod.example/", "c" * 40), ("", "https://prod.example/", "")):
        sites = {} if site is None else {"https://prod.example/": "ok", "https://prod.example/version.txt": site}
        compare(make_state({}), "agent-qa.yml", "qa", "Find the baseline", {}, LOCAL_BASELINE=local, BASELINE_TEMPLATE=template, BASE="sandbox",
                FAKE_CURL_SITES=json.dumps(sites))


@case
def qa_runs_e2e_and_sets_up():
    for setup, command in (("touch ran", "npx playwright test"), ("none", "x"), ("touch ran", "none")):
        r = compare(make_state({}), "agent-qa.yml", "qa", "E2E setup", {}, E2E_SETUP=setup, E2E_COMMAND=command)
    for command in ("none", "echo suite ran; exit 3", "echo green"):
        compare(make_state({}), "agent-qa.yml", "qa", "Run e2e suite", {}, E2E_COMMAND=command, E2E_BASE_URL="http://x/", CI="true")


@case
def qa_starts_without_a_command():
    compare(make_state({}), "agent-qa.yml", "qa", "Start the app locally", {}, START="", URL="http://localhost:3000/")


@case
def qa_links_screenshots():
    shots = "mkdir -p .agent-out/screenshots && touch .agent-out/screenshots/b.png .agent-out/screenshots/a.png .agent-out/screenshots/c.jpg\n"
    out = json.dumps({"screenshots": [{"file": ".agent-out/screenshots/a.png", "caption": "The board"}]})
    st = make_state({101: {"head": sha(0xa1), "labels": ["agent:qa"]}})
    old = old_steps("agent-qa.yml", "qa")["Link screenshots"]["run"]
    new = simlib.steps("agent-qa.yml", "qa")["Link screenshots"]["run"]
    ctx = {"steps.guard.outputs.round": "2"}
    env = dict(PR=101, OUT=out, LINK="https://github.com/o/r/actions/runs/1/artifacts/9")
    a = step_outcome(run(copy.deepcopy(st), shell=PRE + shots + subst(old, ctx), **env))
    b = step_outcome(run(copy.deepcopy(st), shell=PRE + shots + subst(new, ctx), **env))
    assert a == b, (a, b)
    compare(st, "agent-qa.yml", "qa", "Link screenshots", ctx, **env)   # no screenshots


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    failed = skipped = 0
    for c in CASES:
        if only not in c.__name__:
            continue
        try:
            c()
            print("PASS", c.__name__)
        except Skip as e:
            skipped += 1
            print("SKIP", c.__name__, "-", e)
        except Exception:
            failed += 1
            print("FAIL", c.__name__)
            traceback.print_exc(limit=2)
    print("\n%d failed, %d skipped" % (failed, skipped))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
