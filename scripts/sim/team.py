#!/usr/bin/env python3
"""Simulates the whole agent team on a fake repository, concurrently, the way GitHub runs it.

The real workflow steps and scripts run against the fake gh: the merge gate (Risk gate, Join the merge
queue), the Reviewer's Loop guard and Apply state transition, the Integrator's drain loop, the
watchdog, and every script they call. The LLM parts are scripted stand-ins with random outcomes:
the Reviewer's and QA's verdicts, the Implementor's fixes and conflict resolutions, the Lead's
decisions. Humans and GitHub misbehave on purpose, as the parameters ask (see DEFAULTS).

Runs follow GitHub's concurrency rules: per group (agent-<pr>, agent-<pr>-merge, agent-integrator)
one run at a time and at most one pending; a newer pending run replaces the older one (dropped), and
the merge gate cancels its running run. Jobs run in parallel threads, so the races between the
Integrator and the other roles are real.

When nothing is running or pending, the watchdog runs (as it does about 10 minutes after the last
agent run). If that changes nothing either, the repository has settled. Every PR must then be merged,
closed, a draft (paused by a human) or escalated to a human; anything else is STUCK.

Usage: python3 team.py --seed 3 --prs 5 --params '{"conflict": 0.5}' [--legacy-ref origin/main] [--sequential]
Prints one JSON line with the outcome. scripts/sim/matrix.py runs many of these.
"""
import sys
sys.dont_write_bytecode = True   # keep __pycache__ out of the repository

import argparse, json, os, random, shutil, signal, subprocess, sys, tempfile, threading, time, traceback

import simlib
from simlib import BOT, files, locked, read, sha

DEFAULTS = dict(
    # the agents (scripted LLM outcomes)
    review_ok=0.8, qa_ok=0.85, keep_edits=0.6, impl_blocked=0.05, lead_fix=0.3,
    # how long an agent works (real seconds, random up to this) before it acts: real agents take
    # minutes, and races between runs only show up when their work overlaps
    agent_time=0.0,
    # CI on each new commit: red, hanging (never finishes), never reporting, slow (pending for a while)
    ci_fail=0.1, ci_hang=0.03, ci_none=0.0, ci_slow=0.2,
    # merging and the base branch
    conflict=0.3, merge_fail=0.05, merge_err=0.03, workflow_change=0.0,
    # GitHub: lost webhooks, duplicated deliveries, API errors, mergeability UNKNOWN, Integrator job killed
    drop=0.0, dup=0.0, api_flake=0.0, unknown=0.0, kill_integrator=0.0,
    # humans
    human_base=0.02, human_push=0.02, human_draft=0.0, human_close=0.0, human_approve=0.0, human_lead=0.0,
    # issues: high risk, PRs touching protected paths
    risk_high=0.0, protected=0.0,
    # switches: pause all agents / switch merging off for a window of steps [from, to)
    pause_window=None, automerge_off_window=None,
    # repository variables
    # qa_stage: "queue" (QA once, at the front of the merge queue: the default) or "review" (QA before the queue)
    qa=True, qa_stage="queue", qa_on_update=False, skip_same=True, drain_minutes=100, checks_minutes=30, qa_minutes=600,
)

WORKFLOWS = {"reviewer": ("agent-reviewer.yml", "Agent · Reviewer"), "qa": ("agent-qa.yml", "Agent · QA"),
             "implementor": ("agent-implementor.yml", "Agent · Implementor"), "lead": ("agent-lead.yml", "Agent · Lead"),
             "merge": ("agent-merge.yml", "Agent · Merge"), "integrator": ("agent-integrator.yml", "Agent · Integrator"),
             "watchdog": ("agent-watchdog.yml", "Agent · Watchdog")}


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, kind, n, fn):
        self.kind, self.n, self.fn = kind, n, fn
        self.procs, self.cancelled, self.thread, self.error = [], False, None, None

    def cancel(self):
        self.cancelled = True
        for p in self.procs:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass


class Team:
    def __init__(self, seed, n_prs, params=None, legacy_dir=None, sequential=False, keep=False):
        self.p = dict(DEFAULTS, **(params or {}))
        self.rng = random.Random(seed)
        self.seed, self.sequential, self.keep = seed, sequential, keep
        self.repo = legacy_dir or simlib.REPO
        # An older ref with the merge queue runs like the current code; one without it, with its merge gate.
        self.legacy = bool(legacy_dir) and not os.path.exists(os.path.join(legacy_dir, ".github/workflows/agent-integrator.yml"))
        self.bin = os.path.join(self.repo, "scripts/agents")
        self.qa_in_queue_code = os.path.exists(os.path.join(self.bin, "qa-passed.sh"))
        self.reviewer_steps = simlib.steps("agent-reviewer.yml", "review", self.repo)
        self.merge_steps = simlib.steps("agent-merge.yml", "merge", self.repo)
        self.drain = None if self.legacy else simlib.drain_script(self.repo)
        self.dir = tempfile.mkdtemp(prefix="agent-team-")
        self.f = os.path.join(self.dir, "state.json")
        self.lock = threading.Lock()
        self.groups = {}
        self.stats = dict(jobs=0, reviews=0, qa=0, impl=0, impl_nochange=0, lead=0, integrator_runs=0, watchdog_runs=0, watchdog_kicks=0,
                          dropped_pending=0, lost_webhooks=0, duplicated=0, killed=0, failed_jobs=0, human_actions=0)
        self.failures = []
        self.step = 0
        self.merged_seen = 0
        st = simlib.new_state(seed=seed, p_api_flake=self.p["api_flake"], p_unknown=self.p["unknown"], legacy=self.legacy,
                               audit_qa=self.p["qa"] and not self.qa_before())
        st["check_plan"] = [self.draw_ci() for _ in range(2000)]
        for i in range(n_prs):
            self.open_pr(st, 101 + i)
        json.dump(st, open(self.f, "w"))

    # --- setup -------------------------------------------------------------------------------
    def draw_ci(self):
        r, p = self.rng.random(), self.p
        for name, w in (("fail", p["ci_fail"]), ("hang", p["ci_hang"]), ("none", p["ci_none"])):
            if r < w:
                return name
            r -= w
        return "slow:%d" % self.rng.randint(1, 8) if r < p["ci_slow"] else "pass"

    def new_sha(self, st, bv, fls):
        st["sha_counter"] = st.get("sha_counter", 0x10000) + 1
        s = sha(st["sha_counter"])
        simlib.add_sha(st, s, bv, fls)
        return s

    def open_pr(self, st, n):
        name = ".github/agents/x.md" if self.rng.random() < self.p["protected"] else "src/f%d.ts" % n
        head = self.new_sha(st, st["base_version"], files("+pr%d" % n, name=name))
        issue = 1000 + n
        simlib.add_pr(st, n, head, labels=(), issue=issue, merge_fails=1 if self.rng.random() < self.p["merge_fail"] else 0,
                      merge_error_after=self.rng.random() < self.p["merge_err"])
        if self.rng.random() < self.p["risk_high"]:
            st["items"][str(issue)]["labels"].append("risk:high")
        st["events"].append(["synchronize", str(n), head, "opened"])

    # --- running real steps and scripts -------------------------------------------------------
    def env(self, job, extra=None):
        e = simlib.env_for(self.f, self.bin, AGENT_WATCHDOG_MINUTES=0, AGENT_WATCHDOG_RETRIES=2,
                           AGENT_AUTO_MERGE="true" if self.automerge() else "",
                           AGENT_QA_ON_BASE_UPDATE="true" if self.qa_before() and self.p["qa_on_update"] else "",
                           AGENT_QA_IN_QUEUE="true" if self.p["qa"] and not self.qa_before() else "",
                           AGENT_INTEGRATOR_CHECKS_MINUTES=self.p["checks_minutes"],
                           AGENT_INTEGRATOR_QA_MINUTES=self.p["qa_minutes"], DRAIN_MINUTES=self.p["drain_minutes"])
        e.update({k: str(v) for k, v in (extra or {}).items()})
        return e

    def qa_before(self):
        """QA runs before the merge queue: AGENT_QA_STAGE == 'review', or code from before QA moved into the queue."""
        return self.p["qa"] and (self.p["qa_stage"] == "review" or not self.qa_in_queue_code)

    def sh(self, job, script=None, args=(), extra=None, shell=None):
        """Runs a script (scripts/agents/<script> args) or a workflow step (shell) inside a job."""
        if job.cancelled:
            raise Cancelled()
        d = tempfile.mkdtemp(dir=self.dir, prefix="run-")
        os.makedirs(os.path.join(d, ".agent-out"))
        out = os.path.join(d, "outputs")
        open(out, "w").close()
        e = self.env(job, dict(extra or {}, GITHUB_OUTPUT=out, GITHUB_STEP_SUMMARY=os.path.join(d, "summary")))
        cmd = ["bash", "-eo", "pipefail", "-c", shell] if shell is not None else [os.path.join(self.bin, script), *args]
        p = subprocess.Popen(cmd, env=e, cwd=d, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        job.procs.append(p)
        try:
            so, se = p.communicate(timeout=900)
        except subprocess.TimeoutExpired:
            job.cancel()
            so, se = p.communicate()
        if job.cancelled:
            raise Cancelled()
        outputs = dict(l.split("=", 1) for l in open(out).read().splitlines() if "=" in l)
        if p.returncode:
            raise RuntimeError("%s exited %d: %s" % (script or "step", p.returncode, se[-1500:]))
        return so, outputs

    def comment(self, n, body):
        with locked(self.f) as st:
            st["clock"] += 1
            c = {"id": len(st["comments_all"]) + 1, "body": body, "user": {"id": BOT}, "created_at": "2020-01-01T00:00:00Z"}
            h, r = divmod(st["clock"], 3600)
            c["created_at"] = "2020-01-01T%02d:%02d:%02dZ" % (h % 24, r // 60, r % 60)
            st["comments_all"].append(c)
            st["items"][str(n)]["comments"].append(c["id"])

    # --- the roles ------------------------------------------------------------------------------
    def reviewer(self, job, n, action, head):
        ctx = {"github.event.action": action, "github.event.pull_request.head.sha": head}
        env = dict(PR=n, QA="true" if self.qa_before() else "", QA_IN_QUEUE="true" if self.p["qa"] and not self.qa_before() else "",
                   QA_ON_BASE_UPDATE="true" if self.p["qa_on_update"] else "",
                   SKIP_SAME="true" if self.p["skip_same"] else "", MAX_ROUNDS=3)
        _, out = self.sh(job, shell=simlib.subst(self.reviewer_steps["Loop guard"]["run"], ctx), extra=env)
        if out.get("stop") == "true":
            return
        self.stats["reviews"] += 1
        self.work()
        verdict = "approve" if self.rng.random() < self.p["review_ok"] else "request-changes"
        self.comment(n, "<!-- agent:reviewer -->\n**Verdict:** %s" % verdict)
        ctx.update({"steps.guard.outputs.total": out.get("total", 0), "steps.guard.outputs.round": out.get("round", 1)})
        self.sh(job, shell=simlib.subst(self.reviewer_steps["Apply state transition"]["run"], ctx),
                extra=dict(env, OUT=json.dumps({"verdict": verdict})))

    def qa(self, job, n, head):
        so, _ = self.sh(job, "pr-still-current.sh", [n, head, "agent:qa"])
        if so.strip():
            return
        self.stats["qa"] += 1
        self.work()
        st = read(self.f)
        mine = [c["body"] for c in st["comments_all"] if c["id"] in st["items"][n]["comments"]]
        last_lead = max([i for i, b in enumerate(mine) if "<!-- agent:lead -->" in b] or [-1])
        if sum(1 for b in mine[last_lead + 1:] if "<!-- agent:qa -->" in b and "Verdict:** fail" in b) >= 3:
            self.sh(job, "transition.sh", [n, "agent:needs-decision"])
            return
        ok = self.rng.random() < self.p["qa_ok"]
        self.comment(n, "<!-- agent:qa -->\n**Verdict:** %s" % ("pass" if ok else "fail"))
        if ok:
            self.sh(job, "approve.sh", [n, head, "qa"])
        else:
            self.sh(job, "transition.sh", [n, "agent:changes-requested"])

    def implementor(self, job, n):
        self.stats["impl"] += 1
        self.sh(job, "transition.sh", [n, "agent:fixing"])   # Prepare: agent:changes-requested -> agent:fixing
        self.work()   # agent:fixing while the Implementor works (the window the sweep must respect)
        blocked = self.rng.random() < self.p["impl_blocked"]
        nothing_to_do = False
        with locked(self.f) as st:
            it = st["items"][n]
            # Why it was called: the latest of a rejection (review/QA) or a merge-queue notice. Asked to fix
            # a conflict that is already gone (and the branch is up to date), the real Implementor reports
            # no-change, which goes to the Lead.
            mine = [c["body"] for c in st["comments_all"] if c["id"] in it["comments"]]
            why = next((b for b in reversed(mine) if "<!-- agent:merge -->" in b or "Verdict:** request-changes" in b
                        or ("<!-- agent:qa -->" in b and "Verdict:** fail" in b)), "")
            behind = st["shas"][it["head"]]["base_version"] < st["base_version"]
            red = "checks failed" in why.lower() or "<!-- agent:integration-failed -->" in why
            if not blocked and "<!-- agent:merge -->" in why and not red and not it.get("conflict") and not behind:
                nothing_to_do = True
                st.setdefault("nochange", []).append({"pr": n, "why": why[:160], "clock": st["clock"]})
            if not blocked and st["shas"][it["head"]]["base_version"] < st.get("workflow_version", -1):
                blocked = self.rng.random() < 0.5   # pushing a merge that brings in workflow changes may be refused
            if not blocked and not nothing_to_do:
                old = st["shas"][it["head"]]["files"]
                keep = it.get("conflict") and self.rng.random() < self.p["keep_edits"]
                fls = old if keep else [dict(old[0], patch=old[0]["patch"] + "\n+fix%d" % st.get("sha_counter", 0))]
                h = self.new_sha(st, st["base_version"], fls)   # always merges the base before pushing
                it["head"], it["conflict"] = h, False
                st["events"].append(["synchronize", n, h, "implementor"])
        if nothing_to_do:
            self.count("impl_nochange")
        if blocked or nothing_to_do:
            self.sh(job, "transition.sh", [n, "agent:needs-decision"])
        elif "agent:fixing" in read(self.f)["items"][n]["labels"]:   # Apply: pushed, clear agent:fixing only
            self.sh(job, "transition.sh", [n])

    def lead(self, job, n):
        self.stats["lead"] += 1
        self.work()
        st = read(self.f)
        used = sum(1 for c in st["comments_all"] if c["id"] in st["items"][n]["comments"] and "<!-- agent:lead -->" in c["body"])
        if used >= 3:
            self.sh(job, "transition.sh", [n, "agent:needs-human"])
            return
        self.comment(n, "<!-- agent:lead -->\n## 🧭 Lead decision")
        st = read(self.f)
        it = st["items"][n]
        if it.get("conflict") or self.rng.random() < self.p["lead_fix"]:
            self.sh(job, "transition.sh", [n, "agent:changes-requested"])
        else:
            self.sh(job, "approve.sh", [n, it["head"], "lead"])

    def merge_gate(self, job, n, head, sender):
        if self.legacy:
            return self.legacy_gate(job, n, head, sender)
        env = dict(PR=n, HEAD_SHA=head, SENDER_TYPE=sender, SENDER="someone", BASE="sandbox", HIGH_RISK_OK="",
                   PROTECTED=".github/,scripts/,templates/")
        _, out = self.sh(job, shell=self.merge_steps["Risk gate"]["run"], extra=env)
        if out.get("stop") != "true":
            self.sh(job, shell=self.merge_steps["Join the merge queue"]["run"], extra=env)

    def legacy_gate(self, job, n, head, sender):
        g = self.merge_steps
        base = dict(PR=n, HEAD_SHA=head, REQUIRED="CI", BASE="sandbox")
        _, risk = self.sh(job, shell=g["Risk gate"]["run"], extra=dict(base, SENDER_TYPE=sender, SENDER="someone", HIGH_RISK_OK="",
                                                                      PROTECTED=".github/,scripts/,templates/"))
        if risk.get("stop") == "true":
            return
        _, fresh = self.sh(job, shell=g["Up-to-date gate"]["run"], extra=dict(base, RETEST="CI now runs"))
        if fresh.get("stop") == "true":
            return
        _, checks = self.sh(job, shell=g["Wait for required checks"]["run"], extra=base)
        _, final = self.sh(job, shell=g["Merge or send back"]["run"],
                           extra=dict(base, RESULT=checks.get("result", ""), FAILED=checks.get("failed", ""), ISSUE=risk.get("issue", "")))
        if final.get("merged") == "true":
            self.sh(job, shell=g["Send PRs that now conflict back to the Implementor"]["run"], extra=base)

    def integrator(self, job):
        self.stats["integrator_runs"] += 1
        if self.rng.random() < self.p["kill_integrator"]:   # the job gets cancelled, times out or loses its runner
            threading.Timer(self.rng.uniform(0.2, 4.0), lambda: (job.cancel(), self.count("killed"))).start()
        self.sh(job, shell=self.drain)

    def watchdog(self, job):
        self.stats["watchdog_runs"] += 1
        so, _ = self.sh(job, "watchdog.sh", [])
        if "restarting" in so:
            self.stats["watchdog_kicks"] += 1

    def work(self):
        """An agent thinking: real time passes while other runs go on."""
        if self.p["agent_time"]:
            time.sleep(self.rng.uniform(0, self.p["agent_time"]))

    def count(self, k):
        with self.lock:
            self.stats[k] += 1

    # --- GitHub: routing events to runs ----------------------------------------------------------
    def paused(self):
        w = self.p["pause_window"]
        return bool(w) and w[0] <= self.step < w[1]

    def automerge(self):
        w = self.p["automerge_off_window"]
        return not (w and w[0] <= self.step < w[1])

    def route(self, ev):
        """Which run (if any) an event starts: (group, kind, function)."""
        kind, n = ev[0], ev[1]
        st = read(self.f)
        it = st["items"].get(n, {})
        if self.paused() or it.get("kind", "pr") != "pr" or it.get("state", "OPEN") != "OPEN" or it.get("draft"):
            return None
        if kind == "synchronize":
            return ("agent-%s" % n, "reviewer", lambda j: self.reviewer(j, n, "synchronize", ev[2]))
        if kind != "labeled":
            return None
        lab, head = ev[2], it["head"]
        sender = ev[3] if len(ev) > 3 else "Bot"
        table = {"agent:review": ("agent-%s" % n, "reviewer", lambda j: self.reviewer(j, n, "labeled", head)),
                 "agent:qa": ("agent-%s" % n, "qa", lambda j: self.qa(j, n, head)),
                 "agent:changes-requested": ("agent-%s" % n, "implementor", lambda j: self.implementor(j, n)),
                 "agent:needs-decision": ("agent-%s" % n, "lead", lambda j: self.lead(j, n))}
        if self.automerge():
            table["agent:approved"] = ("agent-%s-merge" % n, "merge", lambda j: self.merge_gate(j, n, head, sender))
            if not self.legacy:
                table["agent:queued"] = ("agent-integrator", "integrator", lambda j: self.integrator(j))
        return table.get(lab)

    def submit(self, group, kind, n, fn):
        g = self.groups.setdefault(group, {"running": None, "pending": None})
        job = Job(kind, n, fn)
        if g["running"] is None:
            self.start(g, job)
        else:
            if g["pending"] is not None:
                self.stats["dropped_pending"] += 1   # GitHub keeps one pending run per group
            g["pending"] = job
            if group.endswith("-merge"):
                g["running"].cancel()                 # the merge gate cancels its running run
        self.publish_runs()

    def start(self, g, job):
        g["running"] = job
        self.stats["jobs"] += 1
        self.step += 1
        self.world()

        # GitHub lists a run as queued or in progress before its first step runs: publish it first.
        self.publish_runs()

        def body():
            try:
                job.fn(job)
            except Cancelled:
                pass
            except Exception as e:   # a failed job: on GitHub the run just fails
                job.error = "%s: %s" % (job.kind, e)
        job.thread = threading.Thread(target=body, daemon=True)
        job.thread.start()
        if self.sequential:
            job.thread.join()

    def reap(self):
        changed = False
        for name, g in self.groups.items():
            j = g["running"]
            if j and not j.thread.is_alive():
                if j.error:
                    self.stats["failed_jobs"] += 1
                    if not (self.p["api_flake"] or self.p["kill_integrator"]):
                        self.failures.append(j.error[-600:])
                g["running"] = None
                if g["pending"] is not None:
                    nxt, g["pending"] = g["pending"], None
                    self.start(g, nxt)
                changed = True
        if changed:
            self.publish_runs()
        return changed

    def busy(self):
        return any(g["running"] or g["pending"] for g in self.groups.values())

    def publish_runs(self):
        """What `gh run list` shows (the watchdog reads it)."""
        runs = []
        for g in self.groups.values():
            for status, j in (("in_progress", g["running"]), ("pending", g["pending"])):
                if j:
                    wf, name = WORKFLOWS[j.kind]
                    runs.append({"workflow": wf, "name": name, "displayTitle": "T%s" % j.n if j.n else "", "status": status, "databaseId": 1})
        with locked(self.f) as st:
            st["active_runs"] = runs

    # --- the world outside the agents -------------------------------------------------------------
    def world(self):
        p, r = self.p, self.rng
        with locked(self.f) as st:
            for _ in st.get("merged", [])[self.merged_seen:]:
                for it in st["items"].values():   # merges make other PRs conflict
                    if it.get("kind", "pr") == "pr" and it.get("state") == "OPEN" and r.random() < p["conflict"]:
                        it["conflict"] = True
            self.merged_seen = len(st.get("merged", []))
            prs = [n for n, it in st["items"].items() if it.get("kind", "pr") == "pr" and it.get("state") == "OPEN" and not it.get("draft")]
            if not prs:
                return
            human = lambda: self.stats.__setitem__("human_actions", self.stats["human_actions"] + 1)
            if r.random() < p["human_base"] or r.random() < p["workflow_change"]:
                st["base_version"] += 1   # a human merges something by hand
                st.setdefault("human_merges", []).append(st.get("calls", 0))
                st["log"] = st.get("log", []) + ["world: a human merged into the base (version %d)" % st["base_version"]]
                if r.random() < p["workflow_change"] / max(p["workflow_change"] + p["human_base"], 1e-9):
                    st["workflow_version"] = st["base_version"]
                for n in prs:
                    if r.random() < p["conflict"] / 2:
                        st["items"][n]["conflict"] = True
                human()
            if r.random() < p["human_push"]:
                n = r.choice(prs)
                it = st["items"][n]
                old = st["shas"][it["head"]]
                h = self.new_sha(st, old["base_version"], [dict(old["files"][0], patch=old["files"][0]["patch"] + "\n+human")])
                it["head"] = h
                st["events"].append(["synchronize", n, h, "human"])
                human()
            if r.random() < p["human_draft"]:
                st["items"][r.choice(prs)]["draft"] = True
                human()
            if r.random() < p["human_close"]:
                st["items"][r.choice(prs)]["state"] = "CLOSED"
                human()
            if r.random() < p["human_approve"]:
                n = r.choice(prs)
                if "agent:approved" not in st["items"][n]["labels"]:
                    st["items"][n]["labels"].append("agent:approved")
                st["events"].append(["labeled", n, "agent:approved", "User"])
                human()
            if r.random() < p["human_lead"]:
                n = r.choice(prs)
                st["items"][n]["labels"].append("agent:needs-decision")
                st["events"].append(["labeled", n, "agent:needs-decision", "User"])
                human()

    # --- main loop ---------------------------------------------------------------------------------
    def run(self, max_jobs=2500, max_seconds=1200):
        t0 = time.time()
        outcome = "settled"
        quiet = 0   # watchdog runs in a row that ran cleanly and changed nothing
        while True:
            with locked(self.f) as st:
                events, st["events"] = st["events"], []
            for ev in events:
                if ev[0] not in ("labeled", "synchronize"):
                    continue
                if self.rng.random() < self.p["drop"]:
                    self.stats["lost_webhooks"] += 1
                    continue
                copies = 2 if self.rng.random() < self.p["dup"] else 1
                self.stats["duplicated"] += copies - 1
                for _ in range(copies):
                    r = self.route(ev)
                    if r:
                        self.submit(r[0], r[1], ev[1], r[2])
            self.reap()
            if self.stats["jobs"] > max_jobs or time.time() - t0 > max_seconds:
                outcome = "LIVELOCK"
                break
            if events or self.busy():
                time.sleep(0.01)
                continue
            # idle: everything settled or stalled. The pause and the merge switch end here, then the watchdog runs.
            if self.p["pause_window"] and self.step < self.p["pause_window"][1]:
                self.step = self.p["pause_window"][1]
            if self.p["automerge_off_window"] and self.step < self.p["automerge_off_window"][1]:
                self.step = self.p["automerge_off_window"][1]
            # The real watchdog runs again (after every agent run, and every 10 minutes): a run that
            # failed (e.g. an API error) doesn't count, and it takes two quiet runs in a row to settle.
            before = json.dumps(read(self.f)["items"], sort_keys=True)
            job = Job("watchdog", None, lambda j: self.watchdog(j))
            self.start({"running": None}, job)
            job.thread.join()
            if job.error:
                self.stats["failed_jobs"] += 1
                if not self.p["api_flake"]:
                    self.failures.append(job.error[-600:])
                quiet = 0
                continue
            if not read(self.f)["events"] and json.dumps(read(self.f)["items"], sort_keys=True) == before:
                quiet += 1
                if quiet >= 2:
                    break
            else:
                quiet = 0
        for g in self.groups.values():
            for j in (g["running"], g["pending"]):
                if j:
                    j.cancel()
        return self.report(outcome)

    def report(self, outcome):
        st = read(self.f)
        result, violations = {}, list(st.get("violations", []))
        for n, it in st["items"].items():
            if it.get("kind", "pr") != "pr":
                continue
            labs = it.get("labels", [])
            if it.get("state") == "MERGED":
                result[n] = "merged"
                stale = [l for l in labs if l.startswith("agent:") and l != "agent:done"]
                if stale and not self.legacy:
                    violations.append({"kind": "merged-pr-with-state", "pr": int(n), "labels": stale})
            elif it.get("state") == "CLOSED":
                result[n] = "closed"
            elif it.get("draft"):
                result[n] = "draft"
            elif "agent:needs-human" in labs:
                result[n] = "needs-human"
            else:
                result[n] = ("LIVELOCK " if outcome == "LIVELOCK" else "STUCK ") + ",".join(labs)
            if len(it.get("comments", [])) > 80:
                violations.append({"kind": "comment-storm", "pr": int(n), "comments": len(it["comments"])})
        stats = dict(self.stats, ci_runs=len(st.get("ci_runs", {})), updates=st.get("updates", 0), api_flakes=st.get("flakes", 0),
                     merged_order=st.get("merged", []))
        out = {"seed": self.seed, "result": result, "violations": violations, "unexpected_failures": self.failures[:5],
               "stats": stats, "dir": self.dir}
        if not self.keep and (self.legacy or not violations) and not self.failures and not any(v.split()[0] in ("STUCK", "LIVELOCK") for v in result.values()):
            shutil.rmtree(self.dir, ignore_errors=True)
            out["dir"] = None
        return out


def legacy_checkout(ref):
    d = tempfile.mkdtemp(prefix="agent-legacy-")
    tar = subprocess.run(["git", "-C", simlib.REPO, "archive", ref, "scripts/agents", ".github/workflows"], capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", d], input=tar, check=True)
    return d


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--seed", type=int, default=1)
    a.add_argument("--prs", type=int, default=4)
    a.add_argument("--params", default="{}", help="JSON object overriding DEFAULTS")
    a.add_argument("--legacy-ref", help="simulate the merge gate of this git ref instead (no merge queue), e.g. 5673863")
    a.add_argument("--sequential", action="store_true", help="one run at a time (reproducible)")
    a.add_argument("--keep", action="store_true", help="keep the state directory")
    o = a.parse_args()
    legacy = legacy_checkout(o.legacy_ref) if o.legacy_ref else None
    try:
        t = Team(o.seed, o.prs, json.loads(o.params), legacy_dir=legacy, sequential=o.sequential, keep=o.keep)
        print(json.dumps(t.run()))
    except Exception:
        print(json.dumps({"seed": o.seed, "crash": traceback.format_exc()[-3000:]}))
        sys.exit(2)


if __name__ == "__main__":
    main()
