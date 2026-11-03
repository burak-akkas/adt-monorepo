#!/usr/bin/env python3
"""Parity tests for the migration of scripts/agents from bash to Python.

Each case builds a fake repository, runs the script as it was in bash (scripts/agents at PARITY_REF,
the last commit before the migration) and as it is now, on copies of the same state, and compares
what each did: labels, comments, issue states, created and closed issues, label events, stdout and
whether it failed. A migrated script must do exactly what its bash version did, except where a case
says otherwise (`differs`, with the reason).

Run: python3 scripts/sim/test_parity.py [name-filter]
Needs the reference commit in the checkout (CI fetches the whole history); skips without it.
"""
import sys
sys.dont_write_bytecode = True

import copy, json, os, re, subprocess, tempfile, traceback

import simlib
from issueflow import Flow, HUMAN
from simlib import BOT, REPO, run

REF = os.environ.get("PARITY_REF", "8325378")
CASES = []


def case(fn):
    CASES.append(fn)
    return fn


def reference_bin():
    """scripts/agents as of REF, extracted once."""
    d = os.path.join(tempfile.gettempdir(), "agentflow-parity-%s" % REF)
    if not os.path.isdir(os.path.join(d, "scripts/agents")):
        os.makedirs(d, exist_ok=True)
        archive = subprocess.run(["git", "-C", REPO, "archive", REF, "scripts/agents"], capture_output=True)
        if archive.returncode:
            return None
        subprocess.run(["tar", "-x", "-C", d], input=archive.stdout, check=True)
    return os.path.join(d, "scripts/agents")


STAMP = re.compile(r"`\d\d:\d\d`")
# Minutes an issue waited: bash read the simulator's virtual clock, Python the real one.
WAITED = re.compile(r"(waited |still waits \()\d+( minutes|m\))")
# Stall ages: the bash watchdog read the real clock (`date -u +%s`, which the fake date passes through).
AGES = re.compile(r"(for |No progress for |stalled )\d+(m\b| minutes)")


def norm(text):
    return AGES.sub(r"\1N\2", WAITED.sub(r"\1N\2", STAMP.sub("`HH:MM`", text)))


def outcome(st):
    """What a run did, comparable across implementations (no call logs, clocks or comment ids)."""
    items = {}
    for n, it in st["items"].items():
        ids = set(it.get("comments", []))
        items[n] = {"labels": it.get("labels", []), "state": it.get("state", "OPEN"), "state_reason": it.get("state_reason"),
                    "body": it.get("body"), "sub_issues": it.get("sub_issues", []),
                    "comments": [norm(c["body"]) for c in st["comments_all"] if c["id"] in ids]}
    return {"items": items, "events": st.get("events", []), "created": st.get("created_issues", []),
            "closed": st.get("closed_issues", []), "stdout": norm(st["_stdout"]).strip(),
            "failed": st["_rc"] != 0}


def compare(st, script, args=(), differs=(), **env):
    """Runs both versions; every part of the outcome must match except the keys in `differs`, where
    the Python version changes behaviour on purpose (the case checks the new behaviour itself)."""
    ref = reference_bin()
    if ref is None:
        raise Skip("reference commit %s is not in this checkout" % REF)
    old = run(copy.deepcopy(st), script=script, args=[str(a) for a in args], bin_dir=ref, **env)
    new = run(copy.deepcopy(st), script=script, args=[str(a) for a in args], **env)
    a, b = outcome(old), outcome(new)
    for k in differs:
        a.pop(k), b.pop(k)
    if a != b:
        diff = [k for k in a if a[k] != b[k]]
        detail = "\n".join("  %s:\n    bash:   %s\n    python: %s" % (k, json.dumps(a[k])[:1500], json.dumps(b[k])[:1500]) for k in diff)
        raise AssertionError("%s %s differs in %s\n%s\n  python stderr: %s" % (script, " ".join(map(str, args)), diff, detail, new["_stderr"][-800:]))
    return new


class Skip(Exception):
    pass


def flow(**vars_):
    f = Flow(**vars_)
    return f


# --- agent.sh transition ---------------------------------------------------------------------------------
@case
def transition_sets_clears_and_repeats_states():
    f = flow()
    f.issue(7, ["agent:ready", "agent:in-progress", "risk:high"])
    f.issue(8, ["agent:approved"])
    compare(f.st, "transition", [7, "agent:analyzed"])
    compare(f.st, "transition", [7])
    compare(f.st, "transition", [8, "agent:approved"])


@case
def transition_escalates_issues_and_prs():
    f = flow()
    f.issue(7, ["agent:needs-decision"])
    f.issue(11, ["agent:pr-open"])
    f.st["items"]["101"] = {"kind": "pr", "head": simlib.sha(1), "labels": ["agent:review"], "comments": [], "state": "OPEN", "issue": 11}
    compare(f.st, "transition", [7, "agent:needs-human"], AGENT_ESCALATION_ASSIGNEE="owner")
    compare(f.st, "transition", [101, "agent:needs-human"])


@case
def transition_fails_on_a_failed_read():
    f = flow()
    f.issue(7, ["agent:review"])
    st = dict(f.st, fail_cmds=["issues/7/labels"])
    out = compare(st, "transition", [7, "agent:qa"])
    assert out["_rc"] != 0 and out["items"]["7"]["labels"] == ["agent:review"]


# --- agent.sh progress -----------------------------------------------------------------------------------
@case
def progress_creates_appends_and_follows_prs():
    f = flow()
    f.issue(7)
    f.issue(8)
    f.say(8, "<!-- agent:progress -->\nforged", user=HUMAN)
    f.say(8, "<!-- agent:progress -->\n### 📋 Agent progress\n- `10:00` earlier · [run](x)")
    f.st["items"]["101"] = {"kind": "pr", "head": simlib.sha(1), "labels": [], "comments": [], "state": "OPEN", "issue": 7}
    f.st["items"]["102"] = {"kind": "pr", "head": simlib.sha(2), "labels": [], "comments": [], "state": "OPEN"}
    compare(f.st, "progress", [7, "🛠 **Implementor**: opened #101"])
    compare(f.st, "progress", [8, "next line"])
    compare(f.st, "progress", ["--pr", 101, "🔍 **Reviewer** (on #101): approved"])
    compare(f.st, "progress", ["--pr", 102, "no linked issue"])


@case
def progress_never_fails_and_skips_the_line_when_it_cannot_read_the_comments():
    f = flow()
    f.issue(7)
    f.say(7, "<!-- agent:progress -->\n### 📋 Agent progress\n- `10:00` earlier · [run](x)")
    # Changed on purpose: bash posted a second progress comment when the read failed, splitting the log.
    out = compare(dict(f.st, fail_cmds=["issues/7/comments"]), "progress", [7, "line"], differs=["items"])
    assert out["_rc"] == 0 and len(out["items"]["7"]["comments"]) == 1


# --- agent.sh count-comments, agent.sh lead-budget, agent.sh split-mode --------------------------------------------------
@case
def comment_counts_and_the_lead_budget():
    f = flow()
    f.issue(7)
    for who in (BOT, HUMAN, BOT):
        f.say(7, "<!-- agent:lead -->\n## 🧭", user=who)
    compare(f.st, "count-comments", [7, "lead"])
    compare(f.st, "count-comments", [7, "architect"])
    compare(f.st, "lead-budget", [7])
    f.label(7, "agent:needs-human")
    f.say(7, "<!-- agent:lead -->")
    compare(f.st, "lead-budget", [7])


@case
def split_mode_depth_switch_and_requests():
    f = flow()
    f.issue(46)
    f.sub_issue(49, 46)
    f.sub_issue(60, 49)
    f.issue(70, body="<!-- agent:sub-issue parent=60 depends= -->")
    for n in (46, 49, 60, 70):
        compare(f.st, "split-mode", [n])
    compare(f.st, "split-mode", [49], AGENT_MAX_SPLIT_DEPTH=1)
    compare(f.st, "split-mode", [46], AGENT_SPLIT="false")
    f.say(46, "<!-- agent:architect -->")
    f.say(46, "<!-- agent:split-required -->", user=HUMAN)
    compare(f.st, "split-mode", [46])
    f.say(46, "<!-- agent:split-required -->")
    compare(f.st, "split-mode", [46])


# --- agent.sh release-blocked, agent.sh subissues --------------------------------------------------------------
@case
def release_blocked_paths():
    f = flow()
    f.issue(54); f.issue(55); f.issue(56, state="CLOSED", reason="not_planned"); f.issue(57, state="CLOSED", reason="completed")
    f.issue(1, ["agent:blocked"]); f.say(1, "<!-- agent:waits-on 54,55 -->")
    f.issue(2, ["agent:blocked"]); f.say(2, "<!-- agent:waits-on 56 -->")
    f.issue(3, ["agent:blocked"])
    f.issue(4, ["agent:blocked"]); f.say(4, "<!-- agent:waits-on 57 -->")
    f.issue(5, ["agent:blocked"]); f.say(5, "<!-- agent:waits-on 57 -->", user=HUMAN)
    compare(f.st, "release-blocked")


def tree():
    f = flow()
    f.issue(46, ["agent:split"])
    f.sub_issue(47, 46, labels=["agent:analyzed"])
    f.sub_issue(48, 46, depends="47", labels=["agent:blocked"])
    f.sub_issue(49, 46, depends="47,48", labels=["agent:blocked"])
    f.say(46, "<!-- agent:split 47,48,49 -->")
    return f


@case
def subissues_unblock_close_and_drop():
    f = tree()
    f.close(47)
    compare(f.st, "subissues", [47])
    compare(f.st, "subissues", ["--sweep"])
    for n in (47, 48, 49):
        f.close(n)
    compare(f.st, "subissues", [49])
    f = tree()
    f.close(47, "not_planned")
    compare(f.st, "subissues", [47])
    f = tree()
    f.say(48, "<!-- agent:waits-on 54 -->")
    f.close(47)
    compare(f.st, "subissues", [47])


@case
def subissues_ignores_what_is_not_a_bot_sub_issue():
    f = flow()
    f.issue(5)
    f.issue(6, body="<!-- agent:sub-issue parent=5 depends= -->")
    f.issue(7, author=BOT)
    f.issue(46, ["agent:split"])
    for n in (5, 6, 7):
        compare(f.st, "subissues", [n])
    compare(f.st, "subissues", ["--sweep"])


# --- agent.sh split --------------------------------------------------------------------------------------
def plan_file(subtasks):
    fd, p = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as fh:
        json.dump({"decision": "split", "risk": "medium", "subtasks": subtasks}, fh)
    return p


PARTS = [{"title": "Data model", "summary": "Add the table.\nWith two lines.", "acceptance_criteria": ["a1", "a2"]},
         {"title": "UI", "summary": "Show it.", "acceptance_criteria": ["b1"], "depends_on": [1]},
         {"title": "Docs", "summary": "Write it down.", "acceptance_criteria": [], "depends_on": [1, 2]}]


@case
def split_creates_the_sub_issues():
    f = flow()
    f.issue(46, ["agent:analyzed"])
    compare(f.st, "split", [46, plan_file(PARTS)])
    f.sub_issue(49, 46, labels=["agent:analyzed"])
    compare(f.st, "split", [49, plan_file(PARTS[:2])])


@case
def split_rejects_bad_plans():
    f = flow()
    f.issue(46, ["agent:analyzed"])
    # Changed on purpose: the ::error:: line goes to stderr. On stdout the Architect workflow captured it
    # into a variable (split=$(agent.sh split …)), so it never reached the log.
    for bad in (PARTS[:1], PARTS * 2, [PARTS[1], PARTS[0]], [dict(PARTS[0], depends_on=[0]), PARTS[1]]):
        out = compare(f.st, "split", [46, plan_file(bad)], differs=["stdout"])
        assert out["_rc"] != 0 and not out.get("created_issues") and "::error::Split plan has" in out["_stderr"]
    out = compare(f.st, "split", [46, plan_file(PARTS)], differs=["stdout"], AGENT_MAX_SUBISSUES=2)
    assert "expected 2 to 2" in out["_stderr"]


# --- agent.sh url, agent.sh branch-head ------------------------------------------------------------------------
@case
def url_templates():
    st = simlib.new_state()
    compare(st, "url", ["preview", 12])
    compare(st, "url", ["production"])
    compare(st, "url", ["preview", 3], AGENT_PREVIEW_URL="https://pr-{pr}.{repo}.{owner}.example/")
    compare(st, "url", ["preview", 3], AGENT_PREVIEW_URL="none")
    compare(st, "url", ["preview", 3], AGENT_PREVIEW_URL="deployment")
    compare(st, "url", ["staging"])


@case
def branch_heads():
    st = simlib.new_state(branches={"agent/issue-49": simlib.sha(0x49)})
    compare(st, "branch-head", ["agent/issue-49"])
    compare(st, "branch-head", ["agent/issue-50"])


# --- review and approvals ---------------------------------------------------------------------------
from simlib import approval, bot_comment, files, make_state, queued, sha  # noqa: E402
from test_scenarios import in_flight, own_changes_state, two_queued  # noqa: E402


@case
def approvals_are_read_and_written():
    st = make_state({101: {"head": sha(0xa1), "labels": ["agent:qa"], "comments": [
        approval(sha(0xa1), "reviewer"), bot_comment("<!-- agent:qa -->\n**Verdict:** pass\n"),
        {"body": "<!-- agent:qa -->\n<!-- agent:approved-sha %s -->" % sha(0xbb), "user": {"id": 1}}]}})
    compare(st, "approved-sha", [101])
    compare(st, "approve", [101, sha(0xa1), "qa"])
    compare(st, "approve", [101, sha(0xa1), "lead"])
    compare(make_state({101: {"head": sha(0xa1)}}), "approved-sha", [101])


@case
def qa_passed_cases():
    s = sha(0xa1)
    for comments in ([approval(s)], [approval(s), bot_comment("<!-- agent:qa -->\n**Verdict:** fail")],
                     [bot_comment("<!-- agent:qa -->\n**Verdict:** fail"), bot_comment("<!-- agent:lead -->\n<!-- agent:approved-sha %s -->" % s)],
                     [approval(s, "reviewer"), bot_comment("<!-- agent:integrator -->\n<!-- agent:approved-sha %s -->" % s)],
                     [dict(approval(s), user={"id": 1})], []):
        compare(make_state({101: {"head": s, "comments": comments}}), "qa-passed", [101, s])
    st0, appr, res1, res2 = own_changes_state()
    st0["items"]["101"]["comments"] = []
    for head in (res1, res2):
        st = copy.deepcopy(st0)
        c = dict(approval(appr), id=len(st["comments_all"]) + 1, created_at="2020-01-01T00:00:01Z")
        st["comments_all"].append(c); st["items"]["101"]["comments"].append(c["id"])
        compare(st, "qa-passed", [101, head])


@case
def own_diffs_and_same_own_changes():
    st0, appr, res1, res2 = own_changes_state()
    for s in (appr, res1, res2):
        compare(st0, "own-diff", ["sandbox", s])
    for head in (res1, res2, appr):
        compare(st0, "same-own-changes", [101, head])
    st0["shas"][res1]["files"] = [{"filename": "img.png", "status": "modified", "changes": 0},
                                  {"filename": "b.ts", "status": "renamed", "changes": 0, "previous_filename": "a.ts"}]
    compare(st0, "own-diff", ["sandbox", res1])
    compare(st0, "same-own-changes", [101, res1])
    st0["shas"][res1]["files"] = [{"filename": "b.ts", "status": "renamed", "changes": 0, "previous_filename": "a.ts"}]
    compare(st0, "own-diff", ["sandbox", res1])


@case
def clean_base_updates():
    appr, upd = sha(0xa1), sha(0xa2)
    good = {"parents": [{"sha": appr}, {"sha": sha(0xb0)}], "author": {"id": BOT}, "committer": {"login": "web-flow"}, "commit": {"verification": {"verified": True}}}
    for commit in (good, dict(good, author={"id": 1}), dict(good, committer={"login": "x"}), dict(good, parents=[{"sha": appr}]),
                   dict(good, commit={"verification": {"verified": False}})):
        st = make_state({101: {"head": upd, "comments": [approval(appr)], "extra_shas": {upd: {"base_version": 0, "files": [], "commit": commit}}}})
        compare(st, "clean-base-update", [101, upd])
    compare(make_state({101: {"head": upd}}), "clean-base-update", [101, upd])


@case
def pr_path_rules():
    st = make_state({101: {"head": sha(0xa1), "files": files("+x", name="backend/a.py")}})
    for spec in ("", "CI", " Backend CI @ backend/|shared/ , Frontend CI@web/, Lint ,", "Docs@docs/"):
        compare(st, "pr-paths", ["required", 101], AGENT_REQUIRED_CHECKS=spec)
    for prefixes in ("web/| backend/", "web/", "  "):
        compare(st, "pr-paths", ["touches", 101, prefixes])
    compare(dict(st, fail_cmds=["pulls/101/files"]), "pr-paths", ["touches", 101, "web/"])
    compare(dict(st, fail_cmds=["pulls/101/files"]), "pr-paths", ["required", 101], AGENT_REQUIRED_CHECKS="CI@backend/")


@case
def pr_still_current_paths():
    a, b = sha(0xa1), sha(0xa2)
    for pr in ({"head": a, "labels": [], "state": "MERGED"}, {"head": a, "labels": [], "draft": True}, {"head": b, "labels": []},
               {"head": a, "labels": ["agent:needs-decision"]}, {"head": a, "labels": ["agent:needs-human"]},
               {"head": a, "labels": ["agent:review"]}, {"head": a, "labels": ["agent:review"], "conflict": True}):
        compare(make_state({101: dict(pr, issue=11)}), "pr-still-current", [101, a])
    compare(make_state({101: {"head": a, "labels": ["agent:review"], "issue": 11}}), "pr-still-current", [101, a, "agent:qa"])
    compare(make_state({101: {"head": a, "comments": [approval(a)], "issue": 11}}), "pr-still-current", [101, a])
    compare(make_state({101: {"head": b, "comments": [approval(a)], "issue": 11}}), "pr-still-current", [101, b])


# --- the merge queue and conflict avoidance --------------------------------------------------------------
@case
def queue_order_and_tidy():
    st = make_state({
        105: {"head": sha(0xe1), "comments": [queued()]}, 104: {"head": sha(0xd1), "comments": [queued()]},
        106: {"head": sha(0xf1), "labels": ["agent:integrating"], "comments": [queued()]}, 107: {"head": sha(0xf2), "labels": ["agent:review"]},
        108: {"head": sha(0xf3), "draft": True, "comments": [queued()]}, 109: {"head": sha(0xf4)},
        110: {"head": sha(0xf5), "labels": ["agent:queued"], "state": "MERGED"}, 111: {"head": sha(0xf6), "labels": ["agent:approved"], "state": "CLOSED"},
    })
    compare(st, "queue")
    compare(st, "queue-tidy")
    compare(two_queued(), "queue")


@case
def conflicts_after_a_merge():
    st = make_state({
        101: {"head": sha(0xa1), "conflict": True, "issue": 11}, 102: {"head": sha(0xb1), "labels": [], "issue": 12},
        103: {"head": sha(0xc1), "labels": ["agent:fixing"], "conflict": True}, 104: {"head": sha(0xd1), "labels": [], "conflict": True},
        105: {"head": sha(0xe1), "labels": [], "conflict": True, "branch": "human/x"},
    })
    st["active_runs"] = [{"workflow": "agent-implementor.yml", "status": "queued", "name": "Agent · Implementor", "displayTitle": "T104"}]
    compare(st, "sweep-conflicts", [100, "sandbox"])


@case
def overlap_and_release_waiting():
    from test_scenarios import add_issue
    st = in_flight()
    add_issue(st, 201, ["agent:analyzed"], ["src/a.ts", "package-lock.json", "src/new.ts", "src/c.ts"])
    compare(st, "overlap", [201])
    compare(st, "overlap", [201], AGENT_CONFLICT_IGNORE="src/*")
    st = in_flight()
    add_issue(st, 201, ["agent:analyzed"])
    compare(st, "overlap", [201])
    st = make_state({101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts"), "state": "MERGED"}})
    add_issue(st, 201, ["agent:waiting"], ["src/a.ts"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 202, ["agent:waiting"], ["src/a.ts", "src/b.ts"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 203, ["agent:waiting"], ["src/z.ts"], label_at="2020-01-01T00:00:00Z")
    # Changed on purpose: bash ended the list of numbers with a space ("still waits (5m): #201 ", and
    # "Expect conflicts with #201 ." in the comment).
    out = compare(st, "release-waiting", differs=["stdout"], AGENT_CONFLICT_WAIT_MINUTES=10**9)
    assert re.search(r"^#202 still waits \(\d+m\): #201$", out["_stdout"], re.M), out["_stdout"]
    out = compare(st, "release-waiting", differs=["items", "stdout"], AGENT_CONFLICT_WAIT_MINUTES=1)
    assert any("Expect conflicts with #201. Starting" in b for b in [c["body"] for c in out["comments_all"]]), out["_stdout"]


# --- the merge queue itself and operations ------------------------------------------------------------------
@case
def integrating_one_pr():
    from test_scenarios import two_queued
    st = two_queued()
    compare(st, "integrate", [101])
    compare(two_queued(check_plan=["fail", "pass"]), "integrate", [101])
    compare(two_queued(check_plan=["hang"]), "integrate", [101], AGENT_INTEGRATOR_CHECKS_MINUTES=3)
    compare(two_queued(check_plan=["none"]), "integrate", [101], AGENT_INTEGRATOR_CHECKS_MINUTES=3)
    compare(make_state({101: {"head": sha(0xa1), "conflict": True, "comments": [approval(sha(0xa1)), queued()]}}), "integrate", [101])
    compare(make_state({101: {"head": sha(0xa2), "comments": [approval(sha(0xa1)), queued()]}}), "integrate", [101])
    compare(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, base_version=2), "integrate", [101])
    compare(make_state({101: {"head": sha(0xa1), "merge_fails": 1, "comments": [approval(sha(0xa1)), queued()]}}), "integrate", [101])
    compare(make_state({101: {"head": sha(0xa1), "labels": ["agent:review"]}}), "integrate", [101])
    compare(make_state({101: {"head": sha(0xa1), "draft": True, "comments": [approval(sha(0xa1)), queued()]}}), "integrate", [101])
    # Changed since: a high-risk PR, or one touching protected paths, is no longer sent to a human on
    # arrival. The queue tests it and then hands it over (tests/test_integrator.py HumanMergesTest).
    compare(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, base_version=1, workflow_version=1), "integrate", [101])


@case
def watchdog_passes():
    from test_scenarios import add_issue
    st = make_state({104: {"head": sha(0xd1), "comments": [queued()]}, 105: {"head": sha(0xe1), "labels": [], "branch": "agent/issue-5"}})
    add_issue(st, 7, ["agent:ready"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 8, ["agent:in-progress"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 9, ["agent:needs-decision"], label_at="2020-01-01T00:00:00Z")
    for _ in range(2):
        c = dict(bot_comment("<!-- agent:watchdog -->"), id=len(st["comments_all"]) + 1, created_at="2020-01-01T00:00:09Z")
        st["comments_all"].append(c)
        st["items"]["9"]["comments"].append(c["id"])
    compare(st, "watchdog", AGENT_WATCHDOG_MINUTES=10, AGENT_AUTO_MERGE="true")
    compare(st, "watchdog", AGENT_WATCHDOG_MINUTES=10**8)
    st["active_runs"] = [{"workflow": "agent-implementor.yml", "status": "in_progress", "name": "Agent · Implementor", "displayTitle": "T7"},
                         {"workflow": "agent-integrator.yml", "status": "queued", "name": "Agent · Integrator", "displayTitle": "x"}]
    compare(st, "watchdog", AGENT_WATCHDOG_MINUTES=10, AGENT_AUTO_MERGE="true")


@case
def production_checks():
    from test_scenarios import HEAD, PROD
    sites = lambda body: json.dumps({PROD: body} if body else {})  # noqa: E731
    env = dict(AGENT_PRODUCTION_CHECK_URL=PROD, AGENT_PRODUCTION_CHECK_MINUTES="1", AGENT_ESCALATION_ASSIGNEE="human")
    st = make_state({})
    compare(st, "production-check", [HEAD, "sandbox"], FAKE_CURL_SITES=sites("up " + HEAD), **env)
    compare(st, "production-check", [sha(0x99), "sandbox"], FAKE_CURL_SITES=sites(""), **env)
    out = run(copy.deepcopy(st), script="production-check", args=[HEAD, "sandbox"], FAKE_CURL_SITES=sites(""), **env)
    failing = {k: v for k, v in out.items() if not k.startswith("_")}
    compare(failing, "production-check", [HEAD, "sandbox"], FAKE_CURL_SITES=sites("old"), **env)
    compare(failing, "production-check", [HEAD, "sandbox"], FAKE_CURL_SITES=sites("up " + HEAD), **env)


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
