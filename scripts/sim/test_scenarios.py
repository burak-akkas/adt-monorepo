#!/usr/bin/env python3
"""Deterministic scenario tests for the merge queue and the scripts around it.

Each test sets up a fake repository, runs the real script or workflow step against the fake gh, and
checks the outcome. Run: python3 scripts/sim/test_scenarios.py [name-filter]
"""
import sys
sys.dont_write_bytecode = True   # keep __pycache__ out of the repository

import json, os, sys, tempfile, time, traceback

from simlib import (approval, bodies, bot_comment, files, labels, make_state, queued, run, sha, steps, subst, workflow)

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def two_queued(**extra):
    return make_state({
        101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1)), queued()]},
        102: {"head": sha(0xb1), "issue": 12, "comments": [approval(sha(0xb1)), queued()]},
    }, **extra)


def updates_of(st, n):
    return [e for e in st["events"] if e[0] == "synchronize" and e[1] == str(n) and e[3] == "update"]


# --- the queue -------------------------------------------------------------------------------
@test
def two_prs_merge_in_order_and_the_second_is_updated_once():
    st = run(two_queued())
    assert st.get("merged") == [101, 102], st["_summary"]
    assert len(updates_of(st, 102)) == 1
    assert any("agent:approved-sha %s" % st["items"]["102"]["head"] in b for b in bodies(st, 102))
    assert labels(st, 101) == labels(st, 102) == labels(st, 11) == ["agent:done"]
    assert all(a["up_to_date"] and a["green"] and a["approved"] and a["by_integrator"] for a in st["merge_audit"])
    assert not st.get("violations")


@test
def queue_order_follows_the_admission_comment():
    st = run(make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1))]},          # no admission comment: last
        102: {"head": sha(0xb1), "comments": [approval(sha(0xb1)), queued()]},
    }))
    assert st.get("merged") == [102, 101]


@test
def queue_sh_lists_integrating_first_then_oldest():
    st = run(make_state({
        105: {"head": sha(0xe1), "comments": [queued()]},
        104: {"head": sha(0xd1), "comments": [queued()]},
        106: {"head": sha(0xf1), "labels": ["agent:integrating"], "comments": [queued()]},
        107: {"head": sha(0xf2), "labels": ["agent:review"]},
        108: {"head": sha(0xf3), "draft": True, "comments": [queued()]},
    }), script="queue")
    assert st["_stdout"].split("\n")[:3] == ["106 integrating", "105 queued", "104 queued"], st["_stdout"]
    assert "108" not in st["_stdout"]


@test
def red_checks_on_the_combined_code_go_to_the_implementor():
    st = run(two_queued(check_plan=["pass", "fail"]))
    assert st.get("merged") == [101]
    assert labels(st, 102) == ["agent:changes-requested"]
    b = "\n".join(bodies(st, 102))
    assert "<!-- agent:merge -->" in b and "<!-- agent:integration-failed -->" in b and "combined code" in b


@test
def conflict_goes_to_the_implementor_without_counting():
    st = run(make_state({101: {"head": sha(0xa1), "conflict": True, "comments": [approval(sha(0xa1)), queued()]}}))
    assert labels(st, 101) == ["agent:changes-requested"]
    assert not any("integration-failed" in b for b in bodies(st, 101))


@test
def head_moved_after_approval_goes_back_to_review():
    st = run(make_state({101: {"head": sha(0xa2), "comments": [approval(sha(0xa1)), queued()]}}))
    assert labels(st, 101) == ["agent:review"] and not st.get("merged")


@test
def unapproved_pr_labeled_queued_by_hand_is_not_merged():
    st = run(make_state({101: {"head": sha(0xa1)}}))
    assert not st.get("merged") and labels(st, 101) == ["agent:review"]


@test
def third_failed_attempt_goes_to_the_lead_and_a_lead_decision_resets():
    fails = [bot_comment("<!-- agent:integration-failed -->")] * 2
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1))] + fails + [queued()]}},
                        checks={sha(0xa1): "fail"}))
    assert labels(st, 101) == ["agent:needs-decision"]
    st = run(make_state({101: {"head": sha(0xa1), "comments": fails + [bot_comment("<!-- agent:lead -->"), approval(sha(0xa1)), queued()]}},
                        checks={sha(0xa1): "fail"}))
    assert labels(st, 101) == ["agent:changes-requested"]


@test
def checks_that_never_finish_send_the_pr_to_the_back_once_per_run():
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, checks={sha(0xa1): "hang"}))
    assert labels(st, 101) == ["agent:queued"] and "#101: requeued" in st["_summary"]
    assert st["_summary"].count("#101:") == 1
    assert ["labeled", "101", "agent:queued"] in st["events"]   # starts the next run


@test
def required_check_that_never_reports_goes_straight_to_a_human():
    # Found by the matrix: retrying a misconfigured AGENT_REQUIRED_CHECKS cost ~38 reviews and 60 Lead runs per PR.
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, checks={sha(0xa1): "none"}))
    assert labels(st, 101) == ["agent:needs-human"] and "AGENT_REQUIRED_CHECKS" in bodies(st, 101)[-1]


@test
def slow_checks_are_waited_for():
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, checks={sha(0xa1): "slow:12"}))
    assert st.get("merged") == [101]


@test
def failed_merge_goes_to_the_back_of_the_queue():
    st = run(make_state({101: {"head": sha(0xa1), "merge_fails": 1, "comments": [approval(sha(0xa1)), queued()]}}))
    assert labels(st, 101) == ["agent:queued"] and "requeued" in st["_summary"]


@test
def merge_that_succeeds_but_gh_reports_an_error_counts_as_merged():
    # Regression: the merged PR used to loop again and be sent to the Implementor as conflicting.
    st = run(make_state({
        101: {"head": sha(0xa1), "merge_error_after": True, "comments": [approval(sha(0xa1)), queued()]},
        102: {"head": sha(0xb1), "comments": [approval(sha(0xb1)), queued()]},
    }))
    assert st.get("merged") == [101, 102] and labels(st, 101) == ["agent:done"], (labels(st, 101), bodies(st, 101)[-1])


@test
def a_crashed_pr_in_integrating_is_picked_first():
    st = run(make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]},
        102: {"head": sha(0xb1), "labels": ["agent:integrating"], "comments": [approval(sha(0xb1)), queued()]},
    }))
    assert st.get("merged") == [102, 101]


@test
def merging_makes_a_queued_pr_conflict_and_the_sweep_sends_it_back():
    st = make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]},
        103: {"head": sha(0xc1), "comments": [approval(sha(0xc1)), queued()]},
    })
    # the merge of 101 makes 103 conflict; the sweep after the merge finds it
    st["hooks"] = [{"match": "pr merge 101", "pr": 103, "labels": ["agent:queued"]}]
    st["conflict_after_merge"] = {"101": [103]}
    st = run(st)
    assert st.get("merged") == [101], st["_summary"]
    assert labels(st, 103) == ["agent:changes-requested"]
    assert any("leaves the merge queue" in b for b in bodies(st, 103))


@test
def the_sweep_leaves_a_pr_alone_while_the_implementor_works_on_it():
    # Found in the live test (#134): a second merge flagged the PR again while the Implementor was
    # already resolving the first conflict (its first step removes agent:changes-requested). The
    # second run found nothing to do and went to the Lead.
    st = make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]},
        103: {"head": sha(0xc1), "labels": [], "branch": "agent/issue-3"},
    })
    st["conflict_after_merge"] = {"101": [103]}
    st["active_runs"] = [{"workflow": "agent-implementor.yml", "status": "in_progress", "name": "Agent · Implementor", "displayTitle": "T103"}]
    st = run(st)
    assert st.get("merged") == [101] and labels(st, 103) == [] and not bodies(st, 103), (labels(st, 103), bodies(st, 103))
    # The run can also start while the sweep is busy with other PRs (found by the matrix): it is
    # checked right before flagging, not once up front.
    st2 = make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]},
        102: {"head": sha(0xb1), "labels": [], "branch": "agent/issue-2"},
        103: {"head": sha(0xc1), "labels": [], "branch": "agent/issue-3"},
    })
    st2["conflict_after_merge"] = {"101": [102, 103]}
    st2["hooks"] = [{"match": "pr view 102 -R o/r --json mergeable", "pr": 103, "labels": []}]
    st2["run_hooks"] = {"pr view 102 -R o/r --json mergeable": [{"workflow": "agent-implementor.yml", "status": "in_progress", "name": "Agent · Implementor", "displayTitle": "T103"}]}
    st2 = run(st2)
    assert labels(st2, 102) == ["agent:changes-requested"] and labels(st2, 103) == [], (labels(st2, 102), labels(st2, 103))
    st["active_runs"] = []   # without a run working on it, it is flagged as before
    st["items"]["103"]["conflict"] = True
    st = run(st, script="sweep-conflicts", args=["101", "sandbox"])
    assert labels(st, 103) == ["agent:changes-requested"]


@test
def draft_leaves_the_queue():
    st = run(make_state({101: {"head": sha(0xa1), "draft": True, "comments": [approval(sha(0xa1)), queued()]}}),
             script="integrate", args=["101"])
    assert labels(st, 101) == [] and st["_stdout"].strip().endswith("result=left")


@test
def removed_label_and_closed_pr_are_left_alone():
    st = run(make_state({101: {"head": sha(0xa1), "labels": [], "comments": [approval(sha(0xa1)), queued()]}}),
             script="integrate", args=["101"])
    assert st["_stdout"].strip() == "result=left" and labels(st, 101) == []
    st = run(make_state({101: {"head": sha(0xa1), "state": "CLOSED", "comments": [approval(sha(0xa1)), queued()]}}),
             script="integrate", args=["101"])
    assert st["_stdout"].strip() == "result=left"


@test
def human_merge_during_checks_means_update_again_then_merge():
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, bump_base_on_checks=1))
    assert st.get("merged") == [101] and len(updates_of(st, 101)) == 1
    assert st["merge_audit"][0]["up_to_date"]


@test
def base_that_keeps_moving_requeues_instead_of_looping():
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}}, bump_base_on_checks=9))
    assert labels(st, 101) == ["agent:queued"] and "kept moving" in bodies(st, 101)[-1]


@test
def pr_turned_into_a_draft_while_merging_leaves_the_queue():
    # Found by the matrix: the merge must not happen, and it's not a failed attempt.
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}})
    st["hooks"] = [{"match": "pr checks 101", "pr": 101, "draft": True}]
    st = run(st)
    assert not st.get("merged") and labels(st, 101) == [], (labels(st, 101), st["_stderr"][-800:])
    assert not any("integration-failed" in b for b in bodies(st, 101)) and "draft" in bodies(st, 101)[-1]
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}})
    st["hooks"] = [{"match": "pr merge 101", "pr": 101, "draft": True}]   # right before the merge call
    st = run(st)
    assert not st.get("merged") and labels(st, 101) == [] and not st.get("violations")


@test
def an_api_error_right_after_the_merge_still_ends_done():
    # Found by the matrix: the error handler requeued the merged PR (or handed it to the Lead).
    st = make_state({101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1)), queued()]}})
    st["fail_cmds"] = ["issues/101/labels -f labels[]=agent:done"]
    st = run(st)
    assert st.get("merged") == [101] and labels(st, 101) == ["agent:done"], labels(st, 101)
    assert not any("integration-failed" in b for b in bodies(st, 101))


@test
def queue_labels_on_closed_prs_are_tidied():
    # Found by the matrix: an Integrator run killed right after a merge, or a late approval.
    st = make_state({
        101: {"head": sha(0xa1), "state": "MERGED", "labels": ["agent:integrating"]},
        102: {"head": sha(0xb1), "state": "MERGED", "labels": ["agent:queued"]},
        103: {"head": sha(0xc1), "state": "CLOSED", "labels": ["agent:approved"]},
        104: {"head": sha(0xd1), "labels": ["agent:queued"]},
    })
    st = run(st, script="queue-tidy")
    assert labels(st, 101) == labels(st, 102) == ["agent:done"] and labels(st, 103) == [] and labels(st, 104) == ["agent:queued"]


@test
def merge_gate_ignores_a_late_approval_of_a_merged_pr():
    risk = steps("agent-merge.yml", "merge")["Risk gate"]["run"]
    st0 = make_state({101: {"head": sha(0xa1), "state": "MERGED", "labels": ["agent:done", "agent:approved"]}})
    st = run(st0, shell=risk, PR=101, HEAD_SHA=sha(0xa1), SENDER_TYPE="User", SENDER="human", PROTECTED=".github/")
    assert st["_outputs"].get("stop") == "true" and "agent:queued" not in labels(st, 101)


@test
def a_human_merge_right_before_the_merge_is_the_documented_race():
    # GitHub's merge API doesn't check freshness without a branch rule, so a human merging by hand
    # between the Integrator's last check and its merge lands an untested combination. Documented
    # limitation (README: make the queue a hard rule with a ruleset); the audit names it.
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}})
    st["hooks"] = [{"match": "pr merge 101", "pr": 101, "human_merge": True}]
    st = run(st)
    assert st.get("merged") == [101]
    assert [v["kind"] for v in st["violations"]] == ["human-merge-race"]


@test
def base_with_workflow_changes_goes_straight_to_a_human():
    # Found by the matrix: the Implementor can't push workflow changes either, so sending it there cost
    # ~4 Lead runs per PR before a human was asked anyway.
    st = run(make_state({101: {"head": sha(0xa1), "bv": 0, "comments": [approval(sha(0xa1)), queued()]}},
                        base_version=1, workflow_version=1))
    assert labels(st, 101) == ["agent:needs-human"] and "workflow files" in bodies(st, 101)[-1], (labels(st, 101), bodies(st, 101)[-1])
    assert "refusing to allow a GitHub App" in bodies(st, 101)[-1]   # the exact error is passed on
    # a real conflict still goes to the Implementor
    st = run(make_state({101: {"head": sha(0xa1), "bv": 0, "conflict": True, "comments": [approval(sha(0xa1)), queued()]}}, base_version=1))
    assert labels(st, 101) == ["agent:changes-requested"]


@test
def someone_pushes_while_the_checks_run():
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}})
    st["hooks"] = [{"match": "pr checks 101", "pr": 101, "push": sha(0xa9)}]
    st = run(st)
    assert not st.get("merged") and st["items"]["101"]["head"] == sha(0xa9)
    assert "#101: left" in st["_summary"], st["_summary"]
    assert not any("integration-failed" in b for b in bodies(st, 101))   # not a failed attempt


@test
def unexpected_api_error_requeues_once():
    # Regression: the ERR trap ran inside $(...) and the main shell carried on with its output.
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]}})
    st["fail_cmds"] = ["compare/" + sha(0xa1) + "...sandbox"]
    st = run(st)
    assert labels(st, 101) == ["agent:queued"]
    assert sum("integration-failed" in b for b in bodies(st, 101)) == 1
    assert "integer expression" not in st["_stderr"]


@test
def qa_hold_times_out_and_the_queue_moves_on():
    st = run(two_queued(), AGENT_QA_ON_BASE_UPDATE="true", AGENT_INTEGRATOR_QA_MINUTES=0)
    assert st.get("merged") == [101] and labels(st, 102) == ["agent:qa"]
    assert any("agent:integrator-hold" in b for b in bodies(st, 102))


@test
def qa_hold_continues_when_qa_passes():
    st = two_queued()
    # QA (another run) passes while the queue holds; the merge gate hands the PR back as agent:integrating
    st["hooks"] = [{"match": "pr view 102", "pr": 102, "if_label": "agent:qa", "labels": ["agent:integrating"], "approve_head": True}]
    st = run(st, AGENT_QA_ON_BASE_UPDATE="true")
    assert st.get("merged") == [101, 102], st["_stderr"][-2000:]


# --- QA once, at the front of the queue (AGENT_QA_IN_QUEUE, the default with QA on) --------------
def qa_passes(n):
    """QA (another run) passes while the queue holds: the merge gate hands the PR back as agent:integrating."""
    return {"match": "pr view %d" % n, "pr": n, "if_label": "agent:qa", "labels": ["agent:integrating"], "approve_head": True}


def holds(st, n):
    return [b for b in bodies(st, n) if "<!-- agent:integrator-hold" in b]


@test
def qa_in_queue_tests_the_combined_commit_once_after_the_checks():
    st = make_state({
        101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1), "reviewer"), queued()]},
        102: {"head": sha(0xb1), "issue": 12, "comments": [approval(sha(0xb1), "reviewer"), queued()]},
    })
    st["hooks"] = [qa_passes(101), qa_passes(102)]
    st = run(st, AGENT_QA_IN_QUEUE="true")
    assert st.get("merged") == [101, 102], st["_stderr"][-2000:]
    assert len(holds(st, 101)) == len(holds(st, 102)) == 1
    head102 = st["items"]["102"]["head"]
    assert head102 != sha(0xb1) and "integrator-hold %s" % head102 in holds(st, 102)[0]   # QA tested the updated commit
    assert "required checks passed" in holds(st, 102)[0]
    assert all(a["qa_tested"] for a in st["merge_audit"]), st["merge_audit"]
    assert not st.get("violations")


@test
def qa_in_queue_skips_changes_qa_already_passed():
    # QA passed 0xb1 (e.g. the Lead sent it to QA, or before an update): the update keeps its own changes.
    st = run(two_queued(), AGENT_QA_IN_QUEUE="true")
    assert st.get("merged") == [101, 102] and not holds(st, 101) and not holds(st, 102)
    assert all(a["qa_tested"] for a in st["merge_audit"])


@test
def qa_in_queue_tests_again_only_when_own_changes_changed():
    old, new = sha(0xa1), sha(0xa2)
    st = make_state({101: {"head": new, "comments": [approval(old), approval(new, "reviewer"), queued()],
                           "extra_shas": {old: {"base_version": 0, "files": files("+v1"), "commit": {}}}}})
    st["shas"][new]["files"] = files("+v2")
    st["hooks"] = [qa_passes(101)]
    st = run(st, AGENT_QA_IN_QUEUE="true")
    assert st.get("merged") == [101] and len(holds(st, 101)) == 1


@test
def qa_failing_at_the_front_frees_the_queue():
    st = make_state({
        101: {"head": sha(0xa1), "comments": [approval(sha(0xa1), "reviewer"), queued()]},
        102: {"head": sha(0xb1), "comments": [approval(sha(0xb1), "reviewer"), queued()]},
    })
    st["hooks"] = [{"match": "pr view 101", "pr": 101, "if_label": "agent:qa", "labels": ["agent:changes-requested"]}, qa_passes(102)]
    st = run(st, AGENT_QA_IN_QUEUE="true")
    assert st.get("merged") == [102] and labels(st, 101) == ["agent:changes-requested"]
    assert not any("integration-failed" in b for b in bodies(st, 101))   # a QA defect isn't a failed merge attempt


@test
def qa_in_queue_respects_lead_and_human_approvals():
    fail = bot_comment("<!-- agent:qa -->\n**Verdict:** fail")
    for over in (approval(sha(0xa1), "lead"), bot_comment("<!-- agent:queued -->\n<!-- agent:approved-sha %s -->" % sha(0xa1))):
        st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1), "reviewer"), fail, over, queued()]}}),
                 AGENT_QA_IN_QUEUE="true")
        assert st.get("merged") == [101] and not holds(st, 101), st["_stderr"][-1500:]
    # a failed QA report after the approval: QA again
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), fail, queued()]}})
    st["hooks"] = [qa_passes(101)]
    st = run(st, AGENT_QA_IN_QUEUE="true")
    assert st.get("merged") == [101] and len(holds(st, 101)) == 1


@test
def a_left_over_integrating_label_is_no_qa_pass():
    # Found by the matrix (API errors): a failed label read in agent.sh transition left agent:integrating next
    # to agent:qa, and the hold took it for QA's pass and merged untested code.
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1), "reviewer"), queued()]}})
    st["hooks"] = [{"match": "pr view 101", "pr": 101, "if_label": "agent:qa", "labels": ["agent:integrating", "agent:qa"]}]
    st = run(st, AGENT_QA_IN_QUEUE="true", AGENT_INTEGRATOR_QA_MINUTES=5)
    assert not st.get("merged") and "no QA pass" in st["_stderr"], st["_stderr"][-1500:]


@test
def transition_fails_instead_of_keeping_the_old_state():
    st = make_state({101: {"head": sha(0xa1), "labels": ["agent:integrating"]}}, fail_cmds=["issues/101/labels"])
    st = run(st, script="transition", args=["101", "agent:qa"])
    assert st["_rc"] != 0 and labels(st, 101) == ["agent:integrating"]


@test
def qa_passed_sh_reads_only_the_bot_and_the_latest_verdict():
    s = sha(0xa1)
    stranger = {"body": "<!-- agent:qa -->\n**Verdict:** pass\n<!-- agent:approved-sha %s -->" % s, "user": {"id": 1}}
    st0 = make_state({101: {"head": s, "comments": [stranger]}})
    assert run(st0, script="qa-passed", args=["101", s])["_rc"] == 1
    st0 = make_state({101: {"head": s, "comments": [approval(s)]}})
    assert run(st0, script="qa-passed", args=["101", s])["_stdout"].strip() == s
    # a reviewer approval or an Integrator update record approvals, but they aren't QA
    st0 = make_state({101: {"head": s, "comments": [approval(s, "reviewer"), bot_comment("<!-- agent:integrator -->\n<!-- agent:approved-sha %s -->" % s)]}})
    assert run(st0, script="qa-passed", args=["101", s])["_rc"] == 1


@test
def a_reviewer_run_without_a_review_is_retried_once_then_goes_to_the_lead():
    # Seen live (#168): the Reviewer returned "approve" without posting its review.
    apply = steps("agent-reviewer.yml", "review")["Apply state transition"]["run"]
    ctx = {"github.event.pull_request.head.sha": sha(0xa1), "steps.guard.outputs.total": 0, "steps.guard.outputs.round": 1}
    st0 = make_state({101: {"head": sha(0xa1), "labels": []}})
    st = run(st0, shell=subst(apply, ctx), PR=101, OUT='{"verdict": "approve"}', QA="", QA_IN_QUEUE="true")
    assert st["_rc"] == 0 and labels(st, 101) == ["agent:review"] and "Retrying once" in bodies(st, 101)[-1], st["_stderr"]
    st = run(dict(st, events=[]), shell=subst(apply, ctx), PR=101, OUT='{"verdict": "approve"}', QA="", QA_IN_QUEUE="true")
    assert labels(st, 101) == ["agent:needs-decision"] and "Handing to the Lead" in bodies(st, 101)[-1]


@test
def reviewer_approval_goes_to_the_queue_or_to_qa_by_stage():
    apply = steps("agent-reviewer.yml", "review")["Apply state transition"]["run"]
    ctx = {"github.event.pull_request.head.sha": sha(0xa1), "steps.guard.outputs.total": 0, "steps.guard.outputs.round": 1}
    st0 = make_state({101: {"head": sha(0xa1), "labels": [], "comments": [bot_comment("<!-- agent:reviewer -->\n**Verdict:** approve")]}})
    out = '{"verdict": "approve"}'
    st = run(st0, shell=subst(apply, ctx), PR=101, OUT=out, QA="", QA_IN_QUEUE="true")
    assert labels(st, 101) == ["agent:approved"] and "agent:approved-sha %s" % sha(0xa1) in bodies(st, 101)[-1], st["_stderr"]
    assert st["_rc"] == 0
    st = run(st0, shell=subst(apply, ctx), PR=101, OUT=out, QA="true", QA_IN_QUEUE="")
    assert labels(st, 101) == ["agent:qa"] and st["_rc"] == 0
    # QA off. Regression: the step failed (bash -e) when the message's last $( ) test was false.
    st = run(st0, shell=subst(apply, ctx), PR=101, OUT=out, QA="", QA_IN_QUEUE="")
    assert labels(st, 101) == ["agent:approved"] and st["_rc"] == 0, st["_stderr"]


@test
def drain_budget_hands_the_rest_to_a_fresh_run():
    st = make_state({n: {"head": sha(0x100 + n), "comments": [approval(sha(0x100 + n)), queued()]} for n in (101, 102, 103)})
    st = run(st, DRAIN_MINUTES=0)
    assert not st.get("merged") and "handed #101" in st["_summary"] and ["labeled", "101", "agent:queued"] in st["events"]


@test
def risk_raised_after_approval_stops_the_merge():
    st = make_state({101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1)), queued()]}})
    st["items"]["11"]["labels"].append("risk:high")
    st = run(st)
    assert not st.get("merged") and labels(st, 101) == ["agent:needs-human"] and "high risk" in bodies(st, 101)[-1]
    st = make_state({101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1)), queued()]}})
    st["items"]["11"]["labels"].append("risk:high")
    assert run(st, AGENT_AUTO_MERGE_HIGH_RISK="true").get("merged") == [101]   # allowed explicitly


@test
def app_token_is_reused_while_young_and_renewed_before_it_expires():
    import base64, json as js, subprocess as sp
    d = tempfile.mkdtemp()
    key, pub, cache, curl_log = (os.path.join(d, x) for x in ("key.pem", "pub.pem", "cache", "curl.log"))
    sp.run(["openssl", "genrsa", "-out", key, "2048"], check=True, capture_output=True)
    sp.run(["openssl", "rsa", "-in", key, "-pubout", "-out", pub], check=True, capture_output=True)
    env = dict(AGENT_APP_ID="123", AGENT_APP_PRIVATE_KEY=open(key).read(), AGENT_TOKEN_CACHE=cache, FAKE_CURL_LOG=curl_log)
    tok = lambda: run(make_state({}), script="app-token", FAKE_DATE_FILE="", **env)["_stdout"]
    open(cache, "w").write("%d ghs_start\n" % (__import__("time").time() - 60))
    assert tok() == "ghs_start" and not os.path.exists(curl_log)          # young: reused, no API call
    open(cache, "w").write("%d ghs_start\n" % (__import__("time").time() - 3000))
    assert tok() == "ghs_fresh2"                                           # 50 minutes old: renewed
    assert tok() == "ghs_fresh2"                                           # and the new one is cached
    reqs = [js.loads(l) for l in open(curl_log)]
    assert [r["url"].split("/")[-1] for r in reqs] == ["installation", "access_tokens"]
    assert js.loads(reqs[1]["body"]) == {"repositories": ["r"]}            # only this repository
    jwt = reqs[0]["auth"].split("Bearer ")[1]
    h, p_, sig = jwt.split(".")
    pad = lambda x: x + "=" * (-len(x) % 4)
    claims = js.loads(base64.urlsafe_b64decode(pad(p_)))
    assert claims["iss"] == "123" and claims["exp"] - claims["iat"] <= 600
    open(os.path.join(d, "sig"), "wb").write(base64.urlsafe_b64decode(pad(sig)))
    ok = sp.run(["openssl", "dgst", "-sha256", "-verify", pub, "-signature", os.path.join(d, "sig")],
                input=("%s.%s" % (h, p_)).encode(), capture_output=True)
    assert ok.returncode == 0, ok.stdout + ok.stderr                      # signed with the App's key
    assert run(make_state({}), script="app-token", GH_TOKEN="ghs_env")["_stdout"] == "ghs_env"   # no key: unchanged


# --- same own changes, and the guard -----------------------------------------------------------
def own_changes_state():
    appr, res1, res2 = sha(0xa1), sha(0xa2), sha(0xa3)
    st = make_state({101: {"head": res1, "labels": [], "comments": [approval(appr)],
                           "extra_shas": {appr: {"base_version": 0, "files": files("-old", "+new"), "commit": {}},
                                          res2: {"base_version": 1, "files": files("-old", "+new", "+extra"), "commit": {}}}}})
    st["shas"][res1]["files"] = [dict(files("-old", "+new")[0], patch="@@ -5,3 +5,3 @@\n other ctx\n-old\n+new")]
    return st, appr, res1, res2


@test
def same_own_changes_ignores_context_and_catches_new_edits():
    st0, appr, res1, res2 = own_changes_state()
    st = run(st0, script="same-own-changes", args=["101", res1])
    assert st["_rc"] == 0 and st["_stdout"].strip() == appr
    out = os.path.join(tempfile.mkdtemp(), "i.diff")
    st = run(st0, script="same-own-changes", args=["101", res2, out])
    assert st["_rc"] == 1 and "+extra" in open(out).read()
    st0["shas"][res1]["files"] = [{"filename": "img.png", "status": "modified", "changes": 0}]
    assert run(st0, script="same-own-changes", args=["101", res1])["_rc"] == 1   # binary: can't compare


@test
def pr_still_current_in_the_queue():
    st = run(make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1))]}}), script="pr-still-current", args=["101", sha(0xa1)])
    assert "skip=PR is in the merge queue" in st["_stdout"]
    st = run(make_state({101: {"head": sha(0xa2), "comments": [approval(sha(0xa1))]}}), script="pr-still-current", args=["101", sha(0xa2)])
    assert st["_stdout"].strip() == "" and labels(st, 101) == []   # someone else's push: out of the queue, reviewed


@test
def reviewer_skips_review_when_own_edits_are_unchanged():
    st0, appr, res1, _ = own_changes_state()
    guard = subst(steps("agent-reviewer.yml", "review")["Loop guard"]["run"],
                  {"github.event.action": "synchronize", "github.event.pull_request.head.sha": res1})
    st = run(st0, shell=guard, PR=101, QA="true", QA_ON_BASE_UPDATE="", SKIP_SAME="true", MAX_ROUNDS=3)
    assert st["_rc"] == 0 and st["_outputs"].get("stop") == "true" and labels(st, 101) == ["agent:approved"], st["_stderr"]
    assert "agent:approved-sha %s" % res1 in bodies(st, 101)[-1]
    st = run(st0, shell=guard, PR=101, QA="true", QA_ON_BASE_UPDATE="", SKIP_SAME="", MAX_ROUNDS=3)
    assert st["_outputs"].get("stop") != "true"   # without the variable: a full review


@test
def reviewer_gets_the_interdiff_when_own_edits_changed():
    st0, appr, _, res2 = own_changes_state()
    st0["items"]["101"]["head"] = res2
    guard = subst(steps("agent-reviewer.yml", "review")["Loop guard"]["run"],
                  {"github.event.action": "synchronize", "github.event.pull_request.head.sha": res2})
    st = run(st0, shell=guard, PR=101, QA="true", QA_ON_BASE_UPDATE="", SKIP_SAME="true", MAX_ROUNDS=3)
    assert st["_outputs"].get("interdiff") == ".agent-out/interdiff.diff" and st["_outputs"].get("approved") == appr


@test
def reviewer_skips_a_push_of_an_already_approved_commit():
    # Regression: with the QA hold, the Integrator's update reached the Reviewer after the PR moved to agent:qa.
    st0 = make_state({101: {"head": sha(0xa2), "labels": ["agent:qa"], "comments": [approval(sha(0xa2))]}})
    guard = subst(steps("agent-reviewer.yml", "review")["Loop guard"]["run"],
                  {"github.event.action": "synchronize", "github.event.pull_request.head.sha": sha(0xa2)})
    st = run(st0, shell=guard, PR=101, QA="true", QA_ON_BASE_UPDATE="true", SKIP_SAME="", MAX_ROUNDS=3)
    assert st["_outputs"].get("stop") == "true" and labels(st, 101) == ["agent:qa"]


# --- merge gate --------------------------------------------------------------------------------
@test
def merge_gate_queues_with_position_and_records_human_approvals():
    join = steps("agent-merge.yml", "merge")["Join the merge queue"]["run"]
    st0 = make_state({104: {"head": sha(0xd1), "comments": [queued()]}, 101: {"head": sha(0xa1), "labels": ["agent:approved"]}})
    st = run(st0, shell=join, PR=101, HEAD_SHA=sha(0xa1), SENDER_TYPE="User", SENDER="human", BASE="sandbox")
    assert labels(st, 101) == ["agent:queued"]
    b = bodies(st, 101)[-1]
    assert "position 2" in b and "<!-- agent:queued -->" in b and "agent:approved-sha %s" % sha(0xa1) in b


@test
def merge_gate_hands_a_held_pr_back_to_the_integrator():
    join = steps("agent-merge.yml", "merge")["Join the merge queue"]["run"]
    st0 = make_state({101: {"head": sha(0xa1), "labels": ["agent:approved"],
                            "comments": [bot_comment("<!-- agent:integrator-hold %s -->" % sha(0xa1))]}})
    st = run(st0, shell=join, PR=101, HEAD_SHA=sha(0xa1), SENDER_TYPE="Bot", SENDER="bot", BASE="sandbox")
    assert labels(st, 101) == ["agent:integrating"] and len(bodies(st, 101)) == 1


# --- watchdog ----------------------------------------------------------------------------------
@test
def watchdog_restarts_an_idle_queue_and_leaves_a_busy_one_alone():
    st0 = make_state({104: {"head": sha(0xd1), "comments": [queued()]}, 105: {"head": sha(0xe1), "comments": [queued()]}})
    st = run(st0, script="watchdog", AGENT_AUTO_MERGE="true", AGENT_WATCHDOG_MINUTES=10)
    assert ["labeled", "104", "agent:queued"] in st["events"] and "restarting it at #104" in st["_stdout"]
    st0["active_runs"] = [{"workflow": "agent-integrator.yml", "status": "in_progress", "name": "Agent · Integrator", "displayTitle": "T104"}]
    st = run(st0, script="watchdog", AGENT_AUTO_MERGE="true", AGENT_WATCHDOG_MINUTES=10)
    assert not st["events"] and "an Integrator run is active" in st["_stdout"]
    st = run(make_state({104: {"head": sha(0xd1), "comments": [queued()]}}), script="watchdog", AGENT_AUTO_MERGE="", AGENT_WATCHDOG_MINUTES=10)
    assert not st["events"]   # merging switched off: queued PRs wait quietly


# --- conflict avoidance (agent.sh overlap, agent.sh release-waiting) --------------------------------------------
def add_issue(st, n, labels, planned=None, label_at=None):
    it = {"kind": "issue", "labels": list(labels), "comments": [], "state": "OPEN", "head": None}
    if label_at:
        it["label_at"] = {l: label_at for l in labels}
    st["items"][str(n)] = it
    if planned is not None:
        st["clock"] += 1
        c = dict(bot_comment("<!-- agent:files %s -->\n📁 Planned files" % __import__("json").dumps(planned)),
                 id=len(st["comments_all"]) + 1, created_at="2020-01-01T00:00:%02dZ" % (st["clock"] % 60))
        st["comments_all"].append(c)
        it["comments"].append(c["id"])


def in_flight():
    st = make_state({
        101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts")},
        102: {"head": sha(0xb1), "labels": ["agent:needs-human"], "branch": "agent/issue-2", "files": files("+x", name="src/a.ts")},
        103: {"head": sha(0xc1), "labels": [], "draft": True, "branch": "agent/issue-3", "files": files("+x", name="src/a.ts")},
        104: {"head": sha(0xd1), "labels": [], "branch": "agent/issue-201", "files": files("+x", name="src/a.ts")},   # its own PR
        105: {"head": sha(0xe1), "labels": [], "branch": "agent/issue-5", "files": files("+x", name="package-lock.json")},
        106: {"head": sha(0xf1), "labels": [], "branch": "human/tweak", "files": files("+x", name="src/a.ts")},          # not an agent PR
    })
    add_issue(st, 202, ["agent:ready"], ["src/b.ts"])
    add_issue(st, 203, ["agent:in-progress"], ["src/a.ts", "src/c.ts"])
    add_issue(st, 204, ["agent:analyzed"], ["src/a.ts"])   # not started: doesn't count
    return st


@test
def overlap_finds_in_flight_work_on_the_same_files():
    st = in_flight()
    add_issue(st, 201, ["agent:analyzed"], ["src/a.ts", "package-lock.json", "src/new.ts"])
    out = run(st, script="overlap", args=["201"])
    assert out["_rc"] == 0 and out["_stdout"].strip().split("\n") == ["#101 src/a.ts", "#203 src/a.ts"], out["_stdout"] + out["_stderr"]
    st = in_flight()
    add_issue(st, 201, ["agent:analyzed"])   # no planned files: overlaps nothing
    assert run(st, script="overlap", args=["201"])["_stdout"].strip() == ""
    st = in_flight()
    add_issue(st, 201, ["agent:analyzed"], ["src/a.ts"])
    st["fail_cmds"] = ["pulls/101/files"]
    assert run(st, script="overlap", args=["201"])["_rc"] != 0   # an error is never "no overlap"


@test
def waiting_issues_start_one_by_one_when_the_overlap_is_gone():
    st = make_state({101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts"),
                           "state": "MERGED"}})
    add_issue(st, 201, ["agent:waiting"], ["src/a.ts"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 202, ["agent:waiting"], ["src/a.ts", "src/b.ts"], label_at="2020-01-01T00:00:00Z")
    add_issue(st, 203, ["agent:waiting"], ["src/z.ts"], label_at="2020-01-01T00:00:00Z")
    st = run(st, script="release-waiting", AGENT_CONFLICT_WAIT_MINUTES=10**9)
    # #101 merged: #201 starts; #202 overlaps #201 now, so it keeps waiting; #203 never overlapped.
    assert labels(st, 201) == ["agent:ready"] and labels(st, 202) == ["agent:waiting"] and labels(st, 203) == ["agent:ready"], st["_stdout"]
    assert "nothing in flight" in "\n".join(bodies(st, 201))
    # Waited too long: starts anyway, and says what it will likely conflict with.
    st = run(st, script="release-waiting", AGENT_CONFLICT_WAIT_MINUTES=1)
    b = next(b for b in bodies(st, 202) if "Conflict avoidance:" in b)
    assert labels(st, 202) == ["agent:ready"] and "starts anyway" in b and "#201" in b


@test
def the_architect_records_planned_files_and_waits_on_overlap():
    import json as js, simlib
    apply = "ln -s %s/scripts scripts\n" % simlib.REPO + steps("agent-architect.yml", "architect")["Apply state transition"]["run"]
    def design(**env):
        st = make_state({101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts")}})
        add_issue(st, 201, ["agent:analyzed"])
        st["items"]["201"]["comments"].append(len(st["comments_all"]) + 1)
        st["comments_all"].append(dict(bot_comment("<!-- agent:architect -->\n## 🏛 Architect"), id=len(st["comments_all"]) + 1))
        out = js.dumps({"decision": "ready", "risk": "low", "files": ["./src/a.ts", "src/b.ts"]})
        return run(st, shell=apply, N=201, OUT=out, BEFORE=0, REQUIRE_APPROVAL="", SPLIT_MODE="allowed", **env)
    st = design(AVOID_CONFLICTS="true")
    assert st["_rc"] == 0 and sorted(labels(st, 201)) == ["agent:waiting", "risk:low"], (labels(st, 201), st["_stderr"][-800:])
    b = "\n".join(bodies(st, 201))
    assert '<!-- agent:files ["src/a.ts","src/b.ts"] -->' in b and "#101: src/a.ts" in b
    st = design(AVOID_CONFLICTS="")   # AGENT_AVOID_CONFLICTS=false
    assert sorted(labels(st, 201)) == ["agent:ready", "risk:low"]


@test
def a_failed_overlap_check_keeps_waiting_and_retries():
    st = make_state({101: {"head": sha(0xa1), "labels": [], "branch": "agent/issue-1", "files": files("+x", name="src/a.ts")}})
    add_issue(st, 201, ["agent:waiting"], ["src/a.ts"], label_at="2020-01-01T00:00:00Z")
    st["fail_cmds"] = ["pulls/101/files"]
    st = run(st, script="release-waiting", AGENT_CONFLICT_WAIT_MINUTES=10**9)
    assert st["_rc"] == 0 and labels(st, 201) == ["agent:waiting"] and "trying again later" in st["_stdout"]


# --- monorepos: path-scoped required checks and QA ------------------------------------------------
def pr_with(name, **extra):
    return make_state({101: {"head": sha(0xa1), "files": files("+x", name=name),
                             "comments": [approval(sha(0xa1), "reviewer"), queued()]}}, **extra)


@test
def pr_paths_picks_the_checks_and_scopes_that_apply():
    req = "Backend CI@backend/|shared/, Frontend CI@web/, Lint"
    out = lambda name, *a, **e: run(pr_with(name), script="pr-paths", args=list(a), **e)
    assert out("backend/api.py", "required", "101", AGENT_REQUIRED_CHECKS=req)["_stdout"].split("\n")[:2] == ["Backend CI", "Lint"]
    assert out("shared/t.ts", "required", "101", AGENT_REQUIRED_CHECKS=req)["_stdout"].split("\n")[:2] == ["Backend CI", "Lint"]
    r = out("README.md", "required", "101", AGENT_REQUIRED_CHECKS="Backend CI@backend/")
    assert r["_stdout"].strip() == "" and r["_rc"] == 0
    assert out("backend/a.py", "required", "101", AGENT_REQUIRED_CHECKS="Backend CI@backend/, Frontend CI@web/")["_rc"] == 0
    assert out("web/a.ts", "touches", "101", "web/|mobile/")["_rc"] == 0
    assert out("backend/a.py", "touches", "101", "web/")["_rc"] == 1
    assert out("backend/a.py", "touches", "101", "")["_rc"] == 0             # no paths: everything
    st = run(pr_with("backend/a.py", fail_cmds=["pulls/101/files"]), script="pr-paths", args=["touches", "101", "web/"])
    assert st["_rc"] == 3                                                     # an error is never a "no"
    st = run(pr_with("backend/a.py", fail_cmds=["pulls/101/files"]), script="pr-paths", args=["required", "101"],
             AGENT_REQUIRED_CHECKS="Backend CI@backend/")
    assert st["_rc"] != 0 and st["_stdout"].strip() == ""                     # never drops a check silently


@test
def the_queue_waits_only_for_the_checks_that_apply():
    req = "Backend CI@backend/, Frontend CI@web/"
    # Frontend CI never reports on a backend-only PR (path-filtered workflow): not waited for.
    st = run(pr_with("backend/api.py", checks={sha(0xa1): "pass"}, workflows=["Backend CI"]), AGENT_REQUIRED_CHECKS=req)
    assert st.get("merged") == [101], st["_stderr"][-1500:]
    st = run(pr_with("backend/api.py", checks={sha(0xa1): "fail"}, workflows=["Backend CI"]), AGENT_REQUIRED_CHECKS=req)
    assert not st.get("merged") and labels(st, 101) == ["agent:changes-requested"]   # and a red one still counts
    # A docs-only PR: no check applies, it merges without waiting.
    st = run(pr_with("docs/readme.md", checks={sha(0xa1): "none"}), AGENT_REQUIRED_CHECKS=req)
    assert st.get("merged") == [101] and "no required check applies" in st["_stderr"]
    # An unscoped check still applies to everything: never reporting still goes to a human.
    st = run(pr_with("docs/readme.md", checks={sha(0xa1): "none"}), AGENT_REQUIRED_CHECKS=req + ", CI")
    assert not st.get("merged") and labels(st, 101) == ["agent:needs-human"]


@test
def qa_in_the_queue_only_for_prs_that_change_qa_paths():
    st = pr_with("backend/api.py", audit_qa=False)   # no QA: the audit's QA rule doesn't apply
    st = run(st, AGENT_QA_IN_QUEUE="true", AGENT_QA_PATHS="web/")
    assert st.get("merged") == [101] and not holds(st, 101) and "AGENT_QA_PATHS" in st["_stderr"]
    st = pr_with("web/board.tsx")
    st["hooks"] = [qa_passes(101)]
    st = run(st, AGENT_QA_IN_QUEUE="true", AGENT_QA_PATHS="web/|packages/ui/")
    assert st.get("merged") == [101] and len(holds(st, 101)) == 1


@test
def merge_method_and_production_link_are_configurable():
    one = lambda: make_state({101: {"head": sha(0xa1), "issue": 11, "comments": [approval(sha(0xa1)), queued()]}})
    st = run(one())
    assert any(l.startswith("pr merge 101") and "--squash" in l for l in st["log"])   # the default
    assert "https://o.github.io/r/" in "\n".join(bodies(st, 11))
    st = run(one(), AGENT_MERGE_METHOD="rebase", AGENT_PRODUCTION_URL="https://app.example/{repo}/")
    assert st.get("merged") == [101] and any(l.startswith("pr merge 101") and "--rebase" in l for l in st["log"])
    assert "[production](https://app.example/r/)" in "\n".join(bodies(st, 11))
    st = run(one(), AGENT_MERGE_METHOD="fast", AGENT_PRODUCTION_URL="none")   # a typo falls back to squash
    assert st.get("merged") == [101] and any(l.startswith("pr merge 101") and "--squash" in l for l in st["log"])
    assert "production" not in "\n".join(bodies(st, 11)) and "AGENT_MERGE_METHOD" in st["_stderr"]


@test
def a_pr_the_implementor_is_fixing_is_left_alone_and_restarted_if_its_run_died():
    # agent:fixing: the sweep doesn't flag the PR again (no second Implementor run).
    st = make_state({101: {"head": sha(0xa1), "comments": [approval(sha(0xa1)), queued()]},
                     103: {"head": sha(0xc1), "labels": ["agent:fixing"], "branch": "agent/issue-3"}})
    st["conflict_after_merge"] = {"101": [103]}
    st = run(st)
    assert st.get("merged") == [101] and labels(st, 103) == ["agent:fixing"] and not bodies(st, 103)
    # The run died (no agent run active, the label is old): the watchdog restarts the Implementor.
    st0 = make_state({103: {"head": sha(0xc1), "labels": ["agent:fixing"], "branch": "agent/issue-3",
                            "label_at": {"agent:fixing": "2020-01-01T00:00:00Z"}}})
    st = run(st0, script="watchdog", AGENT_WATCHDOG_MINUTES=10)
    assert labels(st, 103) == ["agent:changes-requested"] and "Restarting the Implementor" in bodies(st, 103)[-1], st["_stdout"]
    st0["active_runs"] = [{"workflow": "agent-implementor.yml", "status": "in_progress", "name": "Agent · Implementor", "displayTitle": "T103"}]
    assert labels(run(st0, script="watchdog", AGENT_WATCHDOG_MINUTES=10), 103) == ["agent:fixing"]   # still working


# --- QA of an app that runs on the runner or a host of its own ------------------------------------
def qa_step_names():
    return [s.get("name") for s in workflow("agent-qa.yml")["jobs"]["qa"]["steps"]]


@test
def qa_sets_up_before_it_starts_anything_and_finds_the_baseline_afterwards():
    names = qa_step_names()
    assert names.index("E2E setup") < names.index("Start the baseline locally") < names.index("Start the app locally") \
        < names.index("Find the baseline") < names.index("Run e2e suite")
    assert "E2E_SETUP" not in steps("agent-qa.yml", "qa")["Run e2e suite"]["run"]   # npm ci would pull node_modules from under the app


@test
def qa_leaves_no_token_behind_for_the_code_it_runs():
    checkouts = [s for s in workflow("agent-qa.yml")["jobs"]["qa"]["steps"] if s.get("uses", "").startswith("actions/checkout")]
    assert len(checkouts) == 3 and all(c["with"]["persist-credentials"] is False for c in checkouts)


@test
def qa_screenshots_are_their_own_artifact_so_no_hidden_folder_hides_them():
    uploads = [s for s in workflow("agent-qa.yml")["jobs"]["qa"]["steps"] if s.get("uses", "").startswith("actions/upload-artifact")]
    shots = next(s for s in uploads if s.get("id") == "artifact")   # the one "Link screenshots" links to
    assert shots["with"]["name"].endswith("-screenshots")
    assert all(p.startswith(".agent-out/screenshots/*.") for p in shots["with"]["path"].split())


def e2e_setup(**env):
    return run(make_state({}), shell=steps("agent-qa.yml", "qa")["E2E setup"]["run"],
               **dict({"E2E_SETUP": "touch ran", "E2E_COMMAND": "npx playwright test"}, **env))


@test
def qa_e2e_setup_is_skipped_only_when_there_is_nothing_to_set_up():
    assert os.path.exists(os.path.join(e2e_setup()["_dir"], "ws", "ran"))
    assert not os.path.exists(os.path.join(e2e_setup(E2E_SETUP="none")["_dir"], "ws", "ran"))
    assert not os.path.exists(os.path.join(e2e_setup(E2E_COMMAND="none")["_dir"], "ws", "ran"))


def deployments(**env):
    st = make_state({}, deployments=[
        {"id": 1, "sha": sha(0xa1), "environment": "Preview – api", "state": "success", "url": "https://api.example"},
        {"id": 2, "sha": sha(0xa1), "environment": "Preview – web", "state": "success", "url": "https://web.example"},
        {"id": 3, "sha": sha(0xa2), "environment": "Preview – web", "state": "in_progress", "url": "https://web2.example"},
    ])
    return run(st, shell=steps("agent-qa.yml", "qa")["Wait for the preview of this commit"]["run"],
               **dict({"URL": "deployment", "HEAD_SHA": sha(0xa1), "ENVIRONMENT": "Preview – web"}, **env))["_outputs"]


@test
def qa_finds_the_deployment_of_this_commit_in_the_right_environment():
    assert deployments() == {"url": "https://web.example/", "ready": "true"}
    assert deployments(ENVIRONMENT="Preview – api")["url"] == "https://api.example/"
    assert "ready" not in deployments(HEAD_SHA=sha(0xa2))                 # still deploying
    assert "ready" not in deployments(ENVIRONMENT="Preview – docs")       # a backend-only PR that skipped the web build


def start_baseline(**env):
    runner_temp = tempfile.mkdtemp(prefix="agent-sim-temp-")
    shell = ("mkdir .agent-baseline && git -C .agent-baseline init -q && "
             "git -C .agent-baseline -c user.name=x -c user.email=x@example.test commit -q --allow-empty -m base\n"
             + steps("agent-qa.yml", "qa")["Start the baseline locally"]["run"])
    st = run(make_state({}), shell=shell, RUNNER_TEMP=runner_temp, URL="http://localhost:3001/", **env)
    return st, runner_temp


@test
def qa_starts_the_baseline_outside_the_workspace():
    st, runner_temp = start_baseline(START="pwd > started", FAKE_CURL_SITES=json.dumps({"http://localhost:3001/": "ok"}))
    assert "running on this machine" in st["_outputs"]["info"] and st["_outputs"]["info"].startswith("http://localhost:3001/")
    assert not os.path.exists(os.path.join(st["_dir"], "ws", ".agent-baseline"))   # the PR's build never sees its files
    marker = os.path.join(runner_temp, "agent-baseline", "started")
    for _ in range(50):
        if os.path.exists(marker) and open(marker).read():
            break
        time.sleep(0.1)
    assert open(marker).read().strip().endswith("/agent-baseline")


@test
def qa_goes_on_without_a_comparison_when_the_baseline_never_answers():
    st, _ = start_baseline(START="true")
    assert st["_rc"] == 0 and st["_outputs"]["info"].startswith("none (")


@test
def qa_prefers_the_baseline_on_the_runner_over_production():
    find = steps("agent-qa.yml", "qa")["Find the baseline"]["run"]
    st = run(make_state({}), shell=find, LOCAL_BASELINE="http://localhost:3001/ (local)", BASELINE_TEMPLATE="https://prod.example/", BASE="sandbox")
    assert st["_outputs"]["info"] == "http://localhost:3001/ (local)"
    st = run(make_state({}), shell=find, LOCAL_BASELINE="", BASELINE_TEMPLATE="https://prod.example/", BASE="sandbox",
             FAKE_CURL_SITES=json.dumps({"https://prod.example/": "b" + "0" * 39}))
    assert st["_outputs"]["info"].startswith("https://prod.example/ (serves")


# --- production check -----------------------------------------------------------------------------
HEAD = "b" + "0" * 39    # the fake base branch's head at version 0
PROD = "https://prod.example/health"


def production_check(st, serves=None, merged=HEAD):
    sites = {PROD: "up " + serves} if serves else {}
    return run(st, script="production-check", args=[merged, "sandbox"], AGENT_PRODUCTION_CHECK_URL=PROD,
               AGENT_PRODUCTION_CHECK_MINUTES="1", AGENT_ESCALATION_ASSIGNEE="human", FAKE_CURL_SITES=json.dumps(sites))


def issues(st):
    return {n: it for n, it in st["items"].items() if it.get("kind") == "issue"}


@test
def production_serving_the_merged_commit_opens_nothing():
    st = production_check(make_state({}), serves=HEAD)
    assert st["_rc"] == 0 and not issues(st)


@test
def production_failure_opens_one_issue_for_a_human_and_recovery_closes_it():
    st = production_check(make_state({}))
    assert st["_rc"] == 1
    (n, it), = issues(st).items()
    assert it["labels"] == ["agent:needs-human"] and "agent:production-check" in it["body"]
    for key in ("_stdout", "_stderr", "_rc", "_summary", "_dir", "_outputs"):
        st.pop(key)
    st = production_check(st)                       # still failing: the same issue
    assert st["_rc"] == 1 and list(issues(st)) == [n] and any("Still failing" in b for b in bodies(st, n))
    for key in ("_stdout", "_stderr", "_rc", "_summary", "_dir", "_outputs"):
        st.pop(key)
    st = production_check(st, serves=HEAD)          # recovered
    assert st["_rc"] == 0 and st["items"][n]["state"] == "CLOSED"


@test
def production_check_of_an_older_merge_stays_quiet_when_a_newer_one_landed():
    st = production_check(make_state({}, base_version=1))
    assert st["_rc"] == 0 and not issues(st)


# --- the issue pipeline: splitting, the size check, the Lead's budget, continuations, dependencies ---
# Through the real workflow steps (issueflow.Flow); #49 is the issue that got stuck before these.
from issueflow import Flow, HUMAN
from simlib import BOT


def big_files(k=30):
    return ["src/f%d.ts" % i for i in range(k)]


def three_parts():
    return [{"title": "Sync layer", "summary": "s", "acceptance_criteria": ["a"]},
            {"title": "Store", "summary": "s", "acceptance_criteria": ["b"], "depends_on": [1]},
            {"title": "Gate", "summary": "s", "acceptance_criteria": ["c"]}]


@test
def split_mode_allows_issues_and_sub_issues_but_not_deeper():
    f = Flow()
    f.issue(46); f.sub_issue(49, 46); f.sub_issue(60, 49)
    f.issue(70, body="<!-- agent:sub-issue parent=49 depends= -->")   # a human pasted the marker: no parent
    out = lambda n, **e: f.script("split-mode", n, **e)["_stdout"].strip()
    assert out(46) == "allowed" and out(49) == "allowed" and out(70) == "allowed"
    assert out(60).startswith("not-allowed") and "2 level" in out(60)
    assert out(49, AGENT_MAX_SPLIT_DEPTH=1).startswith("not-allowed")   # the old rule: sub-issues never split
    assert out(46, AGENT_SPLIT="false").startswith("not-allowed")


@test
def split_mode_is_required_only_after_a_bot_split_request_newer_than_the_design():
    f = Flow()
    f.issue(49)
    f.say(49, "<!-- agent:architect -->\ndesign 1")
    f.say(49, "<!-- agent:split-required -->\nplease split", user=HUMAN)   # not the bot's: ignored
    assert f.script("split-mode", 49)["_stdout"].strip() == "allowed"
    f.say(49, "<!-- agent:split-required -->\n🧩 The Lead asked for a split.")
    assert f.script("split-mode", 49)["_stdout"].strip() == "required"
    f.say(49, "<!-- agent:architect -->\ndesign 2 (the split)")
    assert f.script("split-mode", 49)["_stdout"].strip() == "allowed"


@test
def a_design_over_the_file_limit_is_sent_back_to_be_split():
    f = Flow()
    f.issue(46); f.sub_issue(49, 46, labels=["agent:analyzed"])
    mode = f.architect(49, "ready", files=big_files(30))
    assert mode["mode"] == "allowed"
    assert f.labels(49) == ["agent:analyzed"] and f.count(49, "<!-- agent:split-required -->") == 1
    assert not f.count(49, "<!-- agent:files")   # no planned files: nothing will be implemented from this design
    mode = f.architect(49, "split", subtasks=three_parts())
    assert mode["mode"] == "required" and "REQUIRED" in mode["text"]
    assert f.labels(49) == ["agent:split"]
    kids = f.st["created_issues"]
    assert len(kids) == 3
    for k in kids:
        assert "<!-- agent:sub-issue parent=49 " in f.st["items"][str(k)]["body"] and f.st["items"][str(k)]["author"] == BOT
    assert [f.labels(k) for k in kids] == [["agent:analyzed"], ["agent:blocked"], ["agent:analyzed"]]
    assert f.st["items"]["49"]["sub_issues"] == kids
    assert not f.count(49, "<!-- agent:lead -->")   # no Lead decision spent


@test
def the_file_limit_is_inclusive_and_configurable():
    f = Flow()
    f.issue(1, ["agent:analyzed"])
    f.architect(1, "ready", files=big_files(20))
    assert f.labels(1) == ["agent:ready"] and f.count(1, "<!-- agent:files") == 1
    f = Flow(AGENT_MAX_PLANNED_FILES="10")
    f.issue(1, ["agent:analyzed"])
    f.architect(1, "ready", files=big_files(11))
    assert f.labels(1) == ["agent:analyzed"] and f.count(1, "<!-- agent:split-required -->") == 1


@test
def a_big_high_risk_or_needs_human_design_is_split_first_too():
    for decision, risk in (("needs-human", "medium"), ("ready", "high")):
        f = Flow()
        f.issue(1, ["agent:analyzed"])
        f.architect(1, decision, risk=risk, files=big_files(25))
        assert f.labels(1) == ["agent:analyzed"], (decision, risk, f.labels(1))


@test
def a_design_too_big_that_cannot_be_split_goes_to_the_lead():
    f = Flow()
    f.issue(46); f.sub_issue(49, 46); f.sub_issue(60, 49, labels=["agent:analyzed"])
    mode = f.architect(60, "ready", files=big_files(30))
    assert mode["mode"] == "not-allowed" and f.labels(60) == ["agent:needs-decision"]
    assert any("can't be split further" in b for b in f.bodies(60))
    f = Flow(AGENT_SPLIT="false")
    f.issue(1, ["agent:analyzed"])
    f.architect(1, "split", subtasks=three_parts())   # splitting off: never creates issues
    assert f.labels(1) == ["agent:needs-decision"] and not f.st.get("created_issues")


@test
def an_architect_that_was_asked_to_split_and_did_not_goes_to_the_lead_once():
    f = Flow()
    f.issue(1, ["agent:analyzed"])
    f.say(1, "<!-- agent:split-required -->\nsplit")
    f.architect(1, "ready", files=big_files(5))
    assert f.labels(1) == ["agent:needs-decision"]
    assert any("asked to split this issue but returned `ready`" in b for b in f.bodies(1))
    # A run that crashed while a split was required takes the normal failure path, and stays required.
    f = Flow()
    f.issue(1, ["agent:analyzed"])
    f.say(1, "<!-- agent:split-required -->\nsplit")
    f.architect(1, "ready", comment=False)
    assert f.labels(1) == ["agent:needs-decision"] and any("Architect agent failed" in b for b in f.bodies(1))
    assert f.script("split-mode", 1)["_stdout"].strip() == "required"


@test
def the_lead_budget_counts_only_decisions_since_the_last_escalation():
    f = Flow()
    f.issue(49, ["agent:needs-decision"])
    for _ in range(3):
        f.say(49, "<!-- agent:lead -->\n## 🧭 Lead decision")
    f.say(49, "<!-- agent:lead -->\nforged", user=HUMAN)
    assert f.script("lead-budget", 49)["_stdout"].strip() == "3"
    g = f.lead(49, "implement")
    assert g["stop"] == "true" and f.labels(49) == ["agent:needs-human"]
    assert any("Lead has already made 3 decisions" in b for b in f.bodies(49))
    # The human sends it back: a fresh budget, and the Lead can split.
    f.say(49, "@claude the Lead should divide this issue into sub-issues", user=HUMAN)
    f.label(49, "agent:needs-decision", only=True)
    assert f.script("lead-budget", 49)["_stdout"].strip() == "0"
    g = f.lead(49, "split")
    assert g.get("stop") != "true" and g["used"] == "0" and g["split"] == "allowed"
    assert f.labels(49) == ["agent:analyzed"] and f.count(49, "<!-- agent:split-required -->") == 1
    assert f.script("lead-budget", 49)["_stdout"].strip() == "1"


@test
def the_lead_split_reaches_the_architect_as_required_and_a_wrong_split_escalates():
    f = Flow()
    f.issue(46); f.sub_issue(49, 46, labels=["agent:needs-decision"])
    f.say(49, "<!-- agent:architect -->\ndesign")
    f.lead(49, "split")
    assert f.labels(49) == ["agent:analyzed"]
    mode = f.architect(49, "split", subtasks=three_parts())
    assert mode["mode"] == "required" and f.labels(49) == ["agent:split"]
    # A sub-sub-issue can't split: the Lead's split escalates instead of looping.
    f.sub_issue(60, 49, labels=["agent:needs-decision"])
    g = f.lead(60, "split")
    assert g["split"] == "not-allowed" and f.labels(60) == ["agent:needs-human"]
    assert any("can't be split further" in b for b in f.bodies(60))
    # `split` on a PR is no PR action: a human decides.
    f.st["items"]["300"] = {"kind": "pr", "head": "a" * 40, "labels": ["agent:needs-decision"], "comments": [], "state": "OPEN"}
    f.lead(300, "split", kind="pr")
    assert f.labels(300) == ["agent:needs-human"]


@test
def with_splitting_turned_off_the_lead_is_told_so_and_its_split_escalates():
    f = Flow(AGENT_SPLIT="false")
    f.issue(1, ["agent:needs-decision"])
    g = f.lead(1, "split")
    assert g["split"] == "not-allowed" and "turned off" in g["split_text"]
    assert f.labels(1) == ["agent:needs-human"] and not f.count(1, "<!-- agent:split-required -->")


@test
def a_lead_run_without_a_comment_still_counts_from_the_total():
    f = Flow()
    f.issue(1, ["agent:needs-decision"])
    f.say(1, "<!-- agent:lead -->\nold")
    f.label(1, "agent:needs-human", only=True)        # escalated after it
    f.label(1, "agent:needs-decision", only=True)     # and sent back
    f.lead(1, "implement", comment=False)             # used=0 but total=1: no new comment is still detected
    assert f.labels(1) == ["agent:needs-human"] and any("could not decide ('missing-comment'" in b for b in f.bodies(1))


@test
def an_implementor_that_pushed_progress_continues_without_the_lead():
    f = Flow()
    f.issue(1, ["agent:ready"])
    f.implementor(1, None, push=True)                  # out of turns, but pushed
    assert f.labels(1) == ["agent:ready"] and f.count(1, "<!-- agent:continue -->") == 1
    f.implementor(1, "progress", push=True, reason="step 2 of 5 done")
    f.implementor(1, "progress", push=True, reason="step 3 of 5 done")
    assert f.labels(1) == ["agent:ready"] and f.count(1, "<!-- agent:continue -->") == 3
    assert any("(continuation 3 of 3)" in b and "step 3 of 5" in b for b in f.bodies(1))
    f.implementor(1, "progress", push=True)            # the 4th: too big, the Lead decides
    assert f.labels(1) == ["agent:needs-decision"] and any("consider `split`" in b for b in f.bodies(1))
    assert not f.count(1, "<!-- agent:lead -->")
    f.say(1, "<!-- agent:lead -->\n**Decision:** implement")   # a new decision: continuations count from it
    f.label(1, "agent:ready", only=True)
    f.implementor(1, "progress", push=True)
    assert f.labels(1) == ["agent:ready"] and any("(continuation 1 of 3)" in b for b in f.bodies(1))


@test
def an_implementor_run_that_pushed_nothing_or_is_blocked_goes_to_the_lead():
    for status, push in ((None, False), ("progress", False), ("blocked", True), ("blocked", False)):
        f = Flow()
        f.issue(1, ["agent:ready"])
        f.push(1)                                      # an earlier run's work
        f.implementor(1, status, push=push, reason="stuck")
        assert f.labels(1) == ["agent:needs-decision"], (status, push, f.labels(1))
        assert not f.count(1, "<!-- agent:continue -->")


@test
def a_first_push_to_a_new_branch_counts_as_progress():
    f = Flow()
    f.issue(1, ["agent:ready"])
    assert f.head(1) == ""
    f.implementor(1, None, push=True)
    assert f.labels(1) == ["agent:ready"] and f.count(1, "<!-- agent:continue -->") == 1


@test
def an_open_pr_wins_over_progress_or_waiting():
    f = Flow()
    f.issue(1, ["agent:ready"])
    f.st["items"]["9"] = {"kind": "pr", "head": "b" * 40, "labels": [], "comments": [], "state": "OPEN", "branch": "agent/issue-1"}
    f.implementor(1, "waiting", waiting_on=[2], push=True)
    assert f.labels(1) == ["agent:pr-open"] and not f.count(1, "<!-- agent:waits-on")


@test
def an_issue_that_must_wait_is_parked_and_restarts_when_the_other_closes():
    f = Flow()
    f.issue(49, ["agent:ready"]); f.issue(54, ["agent:pr-open"]); f.issue(55)
    f.implementor(49, "waiting", waiting_on=[54, 55, 49], reason="#54 must merge first")
    assert f.labels(49) == ["agent:blocked"] and f.count(49, "<!-- agent:waits-on 54,55 -->") == 1
    assert not f.count(49, "<!-- agent:lead -->")
    f.script("release-blocked")
    assert f.labels(49) == ["agent:blocked"]
    f.close(54); f.closed(54)
    assert f.labels(49) == ["agent:blocked"]          # #55 still open
    f.close(55); f.closed(55)
    assert f.labels(49) == ["agent:ready"]


@test
def a_dependency_closed_as_not_planned_goes_to_the_lead():
    f = Flow()
    f.issue(49, ["agent:ready"]); f.issue(54)
    f.implementor(49, "waiting", waiting_on=[54])
    f.close(54, "not_planned"); f.closed(54)
    assert f.labels(49) == ["agent:needs-decision"] and any("not planned" in b for b in f.bodies(49))


@test
def waiting_on_nothing_open_goes_to_the_lead():
    f = Flow()
    f.issue(49, ["agent:ready"]); f.issue(54, state="CLOSED", reason="completed")
    # A PR number (merged: the fake gh's `pr list` ignores --head, so an open one would look like #49's PR)
    f.st["items"]["9"] = {"kind": "pr", "head": "b" * 40, "labels": [], "comments": [], "state": "MERGED"}
    f.implementor(49, "waiting", waiting_on=[54, 9, 49, 12345])
    assert f.labels(49) == ["agent:needs-decision"] and any("none of [54,9,49,12345] is an open issue" in b for b in f.bodies(49))


@test
def release_leaves_sub_issues_blocked_by_siblings_to_subissues_sh_and_the_other_way_round():
    f = Flow()
    f.issue(46, ["agent:split"])
    f.sub_issue(47, 46); f.sub_issue(48, 46, depends="47", labels=["agent:blocked"])
    f.sub_issue(49, 46, depends="47", labels=["agent:blocked"])
    f.issue(54)
    f.say(46, "<!-- agent:split 47,48,49 -->")
    f.say(49, "<!-- agent:waits-on 54 -->")           # #49 was designed, then parked on #54
    f.close(47); f.closed(47)
    assert f.labels(48) == ["agent:analyzed"]          # its sibling is done: design starts
    assert f.labels(49) == ["agent:blocked"]           # still waits for #54, and is not sent back to design
    f.script("release-blocked")
    assert f.labels(48) == ["agent:analyzed"]
    f.close(54); f.closed(54)
    assert f.labels(49) == ["agent:ready"]             # designed already: straight to the Implementor


@test
def a_nested_split_closes_its_parent_and_then_the_grandparent():
    f = Flow()
    f.issue(46, ["agent:split"])
    f.sub_issue(47, 46); f.sub_issue(49, 46, labels=["agent:analyzed"])
    f.say(46, "<!-- agent:split 47,49 -->")
    f.architect(49, "split", subtasks=three_parts()[:2])
    a, b = f.st["created_issues"]
    for k in (a, b):
        f.label(k, "agent:pr-open", only=True); f.close(k); f.closed(k)
    assert f.st["items"]["49"]["state"] == "CLOSED" and f.st["items"]["49"]["state_reason"] == "completed"
    assert f.st["items"]["46"]["state"] == "OPEN"
    f.closed(49)                                       # GitHub fires `closed` for #49 too
    assert f.st["items"]["46"]["state"] == "OPEN"      # #47 still open
    f.close(47); f.closed(47)
    assert f.st["items"]["46"]["state"] == "CLOSED"


@test
def the_subissues_workflow_runs_for_every_closed_issue():
    job = workflow("agent-subissues.yml")["jobs"]["advance"]
    assert "agent:sub-issue" not in job["if"] and "pull_request" in job["if"]
    f = Flow()
    f.issue(5)
    f.close(5); f.closed(5)                            # not a sub-issue: both steps succeed, nothing changes
    assert f.labels(5) == []


@test
def issue_49_replayed_gets_split_without_a_human():
    # What happened: a 30-file design on a sub-issue, an outside dependency, a run out of turns,
    # step-by-step progress, and three Lead decisions spent before a human was needed.
    f = Flow()
    f.issue(46, ["agent:split"]); f.issue(54)
    f.sub_issue(49, 46, depends="47,48", labels=["agent:analyzed"])
    f.architect(49, "ready", files=big_files(30))                 # the size check catches it
    assert f.labels(49) == ["agent:analyzed"]
    f.architect(49, "split", subtasks=three_parts())
    assert f.labels(49) == ["agent:split"] and not f.count(49, "<!-- agent:lead -->")
    # The same issue if the Architect had kept it at 15 files:
    f = Flow()
    f.issue(46, ["agent:split"]); f.issue(54)
    f.sub_issue(49, 46, depends="47,48", labels=["agent:analyzed"])
    f.architect(49, "ready", files=big_files(15))
    assert f.labels(49) == ["agent:ready"]
    f.implementor(49, "waiting", waiting_on=[54], reason="the owner said: not before #54")
    assert f.labels(49) == ["agent:blocked"]
    f.close(54); f.closed(54)
    assert f.labels(49) == ["agent:ready"]
    f.implementor(49, None)                                       # 150 turns, nothing pushed
    assert f.labels(49) == ["agent:needs-decision"]
    f.lead(49, "implement")                                       # decision 1: smaller steps
    for _ in range(3):
        f.implementor(49, "progress", push=True)
        assert f.labels(49) == ["agent:ready"]
    f.implementor(49, None, push=True)                            # still not done after 3 continuations
    assert f.labels(49) == ["agent:needs-decision"]
    g = f.lead(49, "split")                                       # decision 2
    assert g["used"] == "1" and f.labels(49) == ["agent:analyzed"]
    f.architect(49, "split", subtasks=three_parts())
    assert f.labels(49) == ["agent:split"] and len(f.st["created_issues"]) == 3
    assert f.count(49, "<!-- agent:lead -->") == 2 and "agent:needs-human" not in f.labels(49)


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    failed = 0
    for t in TESTS:
        if only not in t.__name__:
            continue
        try:
            t()
            print("PASS", t.__name__)
        except Exception:
            failed += 1
            print("FAIL", t.__name__)
            traceback.print_exc(limit=3)
    print("\n%d failed" % failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
