#!/usr/bin/env python3
"""The issue pipeline on a fake repository: Architect, Lead, Implementor (implement job) and the
Sub-issues workflow, through their real workflow steps. Only the LLM agents are scripted.

Used two ways:
  - test_scenarios.py drives `Flow` step by step for exact situations (splitting, the size check, the
    Lead's budget and `split`, Implementor continuations, waiting for other issues)
  - as a script, it plays the whole pipeline for many issues with randomized agent behaviour and checks
    that every issue ends up done, closed or with a human, without loops:

      python3 scripts/sim/issueflow.py --seeds 20        # exits 1 on any problem
"""
import sys
sys.dont_write_bytecode = True

import argparse, json, os, random, re

import simlib
from simlib import BOT, REPO, run, steps, subst

HUMAN = 1
PRE = ("mkdir -p .git/info .agent-trusted .agent-out\n"
       "ln -sfn {r}/scripts scripts\nln -sfn {r}/scripts .agent-trusted/scripts\nln -sfn {r}/.github .agent-trusted/.github\n")


def step(wf, job, name, ctx=None):
    """A workflow step's script, ready for simlib.run(shell=…), run from a workspace like the job's."""
    return PRE.format(r=REPO) + subst(steps(wf, job)[name]["run"], ctx or {})


class _Null:
    """GitHub's null: any property of it is null too, and it compares and prints as empty."""
    def __getattr__(self, k):
        return self

    __getitem__ = __getattr__

    def __bool__(self):
        return False

    def __eq__(self, other):
        return other is None or isinstance(other, _Null)

    def __ne__(self, other):
        return not self.__eq__(other)


NULL = _Null()


class _Ctx(dict):
    def __getattr__(self, k):
        v = self.get(k, None)
        return _Ctx(v) if isinstance(v, dict) else NULL if v is None else v

    __getitem__ = __getattr__


def evaluate(expr, ctx):
    """A GitHub expression (the subset the agent workflows use): missing values are null."""
    py = re.sub(r"\.([A-Za-z_]\w*(?:-\w+)+)", r'["\1"]', expr.strip())
    py = py.replace("&&", " and ").replace("||", " or ")
    py = re.sub(r"!(?!=)", " not ", py)
    funcs = {"contains": lambda a, b: bool(a) and b in a, "cancelled": lambda: False,
             "format": lambda f, *a: re.sub(r"\{(\d+)\}", lambda m: str(a[int(m.group(1))]), f)}
    v = eval(py, {"__builtins__": {}}, {**funcs, **{k: _Ctx(v) if isinstance(v, dict) else v for k, v in ctx.items()}})
    return "true" if v is True else "false" if v is False else "" if v is None or isinstance(v, _Null) else str(v)


def step_env(wf, job, name, ctx):
    """The environment GitHub gives a step: workflow, job and step `env:`, expressions evaluated.
    Taken from the workflow file, so a variable a step needs but doesn't get is missing here too."""
    doc = simlib.workflow(wf)
    j = doc["jobs"][job]
    env = {}
    for scope in (doc.get("env") or {}, j.get("env") or {}, steps(wf, job)[name].get("env") or {}):
        for k, v in scope.items():
            env[k] = re.sub(r"\$\{\{(.*?)\}\}", lambda m: evaluate(m.group(1), {**ctx, "env": env}), str(v))
    env.pop("GH_TOKEN", None)
    env.pop("AGENT_BOT_ID", None)   # simlib's fake bot
    return env


def stamp(clock):
    h, r = divmod(clock, 3600)
    m, s = divmod(r, 60)
    return "2020-01-01T%02d:%02d:%02dZ" % (h % 24, m, s)


class Flow:
    def __init__(self, seed=0, **vars_):
        self.st = simlib.new_state(seed=seed)
        # Repository variables (AGENT_SPLIT, AGENT_MAX_SPLIT_DEPTH, …). Conflict avoidance is off unless a
        # test turns it on: it has its own scenarios, and its wait is released by the watchdog.
        self.vars = {"AGENT_AVOID_CONFLICTS": "false", **vars_}
        self.trace = []

    # --- the fake repository -------------------------------------------------------------------
    def _tick(self):
        self.st["clock"] = self.st.get("clock", 0) + 1
        return stamp(self.st["clock"])

    def issue(self, n, labels=(), author=HUMAN, body="", state="OPEN", reason=None):
        self.st["items"][str(n)] = {"kind": "issue", "labels": [], "comments": [], "state": state, "head": None,
                                    "author": author, "body": body, "title": "T%s" % n}
        if reason:
            self.st["items"][str(n)]["state_reason"] = reason
        for l in labels:
            self.label(n, l)
        return n

    def sub_issue(self, n, parent, depends="", labels=()):
        """An issue split.sh created: the bot opened it, with the sub-issue marker."""
        return self.issue(n, labels, author=BOT, body="Part of #%s.\n\n<!-- agent:sub-issue parent=%s depends=%s -->" % (parent, parent, depends))

    def say(self, n, body, user=BOT):
        c = {"id": len(self.st["comments_all"]) + 1, "body": body, "user": {"id": user}, "created_at": self._tick()}
        self.st["comments_all"].append(c)
        self.st["items"][str(n)]["comments"].append(c["id"])

    def label(self, n, name, only=False):
        """A human (or GitHub) applies a label; only=True replaces the agent:* state like transition.sh."""
        it = self.st["items"][str(n)]
        if only:
            it["labels"] = [l for l in it["labels"] if not l.startswith("agent:")]
        if name not in it["labels"]:
            it["labels"].append(name)
        it.setdefault("label_at", {})[name] = self._tick()

    def close(self, n, reason="completed"):
        it = self.st["items"][str(n)]
        it["state"], it["state_reason"] = "CLOSED", reason

    def push(self, n):
        """The simulated Implementor pushes a commit to agent/issue-<n>."""
        b = self.st.setdefault("branches", {})
        self.st["sha_counter"] = self.st.get("sha_counter", 0x20000) + 1
        b["agent/issue-%s" % n] = simlib.sha(self.st["sha_counter"])

    def head(self, n):
        return self.st.get("branches", {}).get("agent/issue-%s" % n, "")

    def labels(self, n):
        return [l for l in self.st["items"][str(n)]["labels"] if l.startswith("agent:")]

    def bodies(self, n, user=None):
        ids = set(self.st["items"][str(n)]["comments"])
        return [c["body"] for c in self.st["comments_all"] if c["id"] in ids and (user is None or c["user"]["id"] == user)]

    def count(self, n, marker):
        return sum(marker in b for b in self.bodies(n, BOT))

    def _run(self, what, **kw):
        out = run(self.st, **kw)
        if out["_rc"] != 0:
            raise AssertionError("%s failed (rc %s):\n%s\n%s" % (what, out["_rc"], out["_stdout"][-1500:], out["_stderr"][-1500:]))
        self.last = out
        self.st = {k: v for k, v in out.items() if not k.startswith("_")}
        self.trace.append(what)
        return out

    def step(self, wf, job, name, n, outputs=None, event=None):
        """Runs a workflow step for item #n with the env the workflow gives it. outputs: {step id: {output: value}}."""
        ctx = {"vars": self.vars, "steps": {k: {"outputs": v} for k, v in (outputs or {}).items()},
               "github": {"event": event or {"issue": {"number": n}, "repository": {"default_branch": "main"}},
                          "event_name": "issues", "repository": "o/r"},
               "secrets": {}, "inputs": {}}
        env = step_env(wf, job, name, ctx)
        return self._run("%s/%s #%s" % (wf, name, n), shell=step(wf, job, name, {"github.event.pull_request.head.sha": simlib.sha(0xa1),
                         "github.event.issue.number": str(n)}), **env)

    def script(self, name, *args, **env):
        return self._run(name, script=name, args=[str(a) for a in args], **{**self.vars, **env})

    # --- agent runs: real steps around a scripted agent ------------------------------------------
    def architect(self, n, decision, risk="medium", files=(), subtasks=None, comment=True):
        """decision: the Architect's decision, or a function of the split mode its prompt says
        (allowed / required / not-allowed) returning (decision, files, subtasks)."""
        before = self.count(n, "<!-- agent:architect -->")
        mode = self.step("agent-architect.yml", "architect", "Split mode", n)["_outputs"]
        if callable(decision):
            decision, files, subtasks = decision(mode["mode"])
        if comment:
            self.say(n, "<!-- agent:architect -->\n## 🏛 Architect\n**Decision:** %s" % decision)
        out = {"decision": decision, "risk": risk, "files": list(files)}
        if subtasks is not None:
            out["subtasks"] = subtasks
        self.step("agent-architect.yml", "architect", "Apply state transition", n,
                  {"before": {"count": before}, "split": mode, "agent": {"structured_output": json.dumps(out)}})
        return mode

    def lead(self, n, action, kind="issue", comment=True):
        event = {"issue": {"number": n}} if kind == "issue" else {"pull_request": {"number": n, "head": {"sha": simlib.sha(0xa1)}}}
        lead_step = lambda name, outputs=None: self._lead_step(name, n, kind, event, outputs)
        guard = lead_step("Decision budget")["_outputs"]
        if guard.get("stop") == "true":
            return guard
        if comment:
            self.say(n, "<!-- agent:lead -->\n## 🧭 Lead decision\n**Decision:** %s" % action)
        lead_step("Apply decision", {"guard": guard, "agent": {"structured_output": json.dumps({"action": action, "rationale": "r"})}})
        return guard

    def _lead_step(self, name, n, kind, event, outputs):
        ctx = {"vars": self.vars, "steps": {k: {"outputs": v} for k, v in (outputs or {}).items()},
               "github": {"event": event, "event_name": "issues" if kind == "issue" else "pull_request_target", "repository": "o/r"},
               "secrets": {}, "inputs": {}}
        env = step_env("agent-lead.yml", "lead", name, ctx)
        env.pop("BIN", None); env.pop("TRUSTED", None)   # simlib points BIN at the scripts under test
        return self._run("agent-lead.yml/%s #%s" % (name, n), shell=step("agent-lead.yml", "lead", name,
                         {"github.event.pull_request.head.sha": simlib.sha(0xa1)}), **env)

    def implementor(self, n, status=None, push=False, waiting_on=None, reason=None, pr=None):
        before = self.head(n)
        self.label(n, "agent:in-progress", only=True)   # what the Prepare step does
        if push:
            self.push(n)
        out = ""
        if status is not None:
            o = {"status": status}
            if waiting_on is not None:
                o["waiting_on"] = waiting_on
            if reason:
                o["reason"] = reason
            if pr:
                o["pr_number"] = pr
            out = json.dumps(o)
        return self.step("agent-implementor.yml", "implement", "Apply state transition", n,
                         {"prepare": {"head": before}, "agent": {"structured_output": out}})

    def closed(self, n):
        """The Sub-issues workflow after issue #n closed (it runs for every closed issue)."""
        self.step("agent-subissues.yml", "advance", "Unblock sub-issues, close the parent when all are done", n)
        self.step("agent-subissues.yml", "advance", "Restart issues that waited for this one", n)


# --- randomized pipeline ---------------------------------------------------------------------------
DEFAULTS = dict(
    issues=4,            # top-level issues
    big=0.4,             # chance an issue is too big for one PR (the Architect plans > the file limit)
    honest_size=0.6,     # chance the Architect splits a big issue on its own (otherwise it says ready, and the size check acts)
    arch_fail=0.05,      # an Architect run fails (no comment)
    refuse_split=0.1,    # asked to split, the Architect returns ready anyway
    dep=0.3,             # chance an issue must wait for another open issue
    impl_fail=0.1,       # an Implementor run ends with nothing pushed
    impl_blocked=0.05,   # the Implementor reports blocked
    steps_needed=(1, 6), # Implementor runs needed for one issue (a big unsplit issue needs more)
    lead_split=0.8,      # chance the Lead picks split when the Implementor didn't finish (otherwise implement)
    human_back=0.7,      # chance a human sends an escalated issue back to the team (re-applies needs-decision)
    max_jobs=600,
)


def simulate(seed, **params):
    p = dict(DEFAULTS, **params)
    rng = random.Random(seed)
    f = Flow(seed=seed)
    work = {}                       # issue -> Implementor runs it still needs
    deps = {}                       # issue -> issue it must wait for (until that one is closed)
    big = {}
    lead_runs, problems = {}, []

    tops = list(range(101, 101 + p["issues"]))
    lo, hi = p["steps_needed"]
    for n in tops:
        big[n] = rng.random() < p["big"]
        work[n] = rng.randint(lo, hi) * (3 if big[n] else 1)
        f.issue(n, ["agent:analyzed"])
    for n in tops[1:]:
        if rng.random() < p["dep"]:
            deps[n] = rng.choice([m for m in tops if m < n])

    def design(n):
        def decide(mode):
            nfiles = rng.randint(25, 40) if big[n] else rng.randint(2, 12)
            files = ["f%d.ts" % i for i in range(nfiles)]
            split = big[n] and mode != "not-allowed" and (mode == "required" or rng.random() < p["honest_size"])
            if mode == "required" and rng.random() < p["refuse_split"]:
                split = False
            if not split:
                return "ready", files, None
            k = rng.randint(2, 3)
            return "split", [], [{"title": "part %d" % i, "summary": "s", "acceptance_criteria": ["a"],
                                  "depends_on": [i] if i else []} for i in range(k)]
        return decide

    jobs = 0
    while True:
        if jobs >= p["max_jobs"]:
            problems.append("LIVELOCK: more than %d jobs" % p["max_jobs"])
            break
        actionable = sorted((int(k), l) for k, v in f.st["items"].items() if v.get("kind") == "issue" and v["state"] == "OPEN"
                            for l in v["labels"] if l in ("agent:analyzed", "agent:ready", "agent:needs-decision", "agent:needs-human"))
        if not actionable:
            break
        jobs += 1
        n, state = rng.choice(actionable)   # any order, like concurrent runs finishing
        it = f.st["items"][str(n)]
        if state == "agent:analyzed":
            if rng.random() < p["arch_fail"]:
                f.architect(n, "ready", comment=False)
                continue
            f.architect(n, design(n))
            if "agent:split" in f.labels(n):
                kids = [c for c in f.st.get("created_issues", []) if "parent=%s " % n in f.st["items"][str(c)]["body"] and c not in work]
                for c in kids:
                    big[c] = False
                    work[c] = max(1, work[n] // len(kids))
        elif state == "agent:ready":
            if n in deps and f.st["items"][str(deps[n])]["state"] == "OPEN":
                f.implementor(n, "waiting", waiting_on=[deps[n]], reason="needs #%s first" % deps[n])
                continue
            r = rng.random()
            if r < p["impl_fail"]:
                f.implementor(n, None)                       # out of turns, nothing pushed
            elif r < p["impl_fail"] + p["impl_blocked"]:
                f.implementor(n, "blocked", reason="stuck")
            else:
                work[n] -= 1
                if work[n] <= 0:
                    f.implementor(n, "pr-opened", push=True)  # the PR then merges and closes the issue
                    f.close(n)
                    f.closed(n)
                else:
                    f.implementor(n, rng.choice(["progress", None]), push=True, reason="step done")
        elif state == "agent:needs-decision":
            lead_runs[n] = lead_runs.get(n, 0) + 1
            if lead_runs[n] > 15:
                problems.append("#%s: the Lead ran %d times (loop)" % (n, lead_runs[n]))
                break
            text = "\n".join(f.bodies(n, BOT)[-3:])
            if "not finished" in text and rng.random() < p["lead_split"]:
                f.lead(n, "split")
            else:
                f.lead(n, rng.choice(["implement", "redesign", "split", "escalate"]))
        elif state == "agent:needs-human":
            if it.get("human_seen", 0) >= 2 or rng.random() >= p["human_back"]:
                it["labels"].remove("agent:needs-human")
                it["labels"].append("human:handled")    # stays with the human: a correct end
                continue
            it["human_seen"] = it.get("human_seen", 0) + 1
            f.say(n, "Human: try again, split it if it is big.", user=HUMAN)
            f.label(n, "agent:needs-decision", only=True)

    # Every issue must end closed or with a human. A split parent closes when its sub-issues are done.
    for k, v in f.st["items"].items():
        if v.get("kind") != "issue" or v["state"] == "CLOSED" or "human:handled" in v["labels"]:
            continue
        labs = ",".join(v["labels"]) or "no state"
        if "agent:split" in v["labels"] or "agent:blocked" in v["labels"]:
            # Fine only while it waits for an issue that is with a human.
            waiting_on_human = any("human:handled" in w["labels"] and w["state"] == "OPEN" for w in f.st["items"].values() if w.get("kind") == "issue")
            if waiting_on_human:
                continue
        problems.append("#%s STUCK in %s" % (k, labs))
    count = lambda m: sum(1 for c in f.st["comments_all"] if m in c["body"])
    stats = dict(jobs=jobs, issues=sum(1 for v in f.st["items"].values() if v.get("kind") == "issue"),
                 closed=sum(1 for v in f.st["items"].values() if v.get("kind") == "issue" and v["state"] == "CLOSED"),
                 splits=count("<!-- agent:split "), size_checks=count("📏 **Too big"), lead_splits=count("The Lead asked for a split"),
                 continuations=count("<!-- agent:continue -->"), waits=count("<!-- agent:waits-on"), lead=count("<!-- agent:lead -->"),
                 human=sum(1 for v in f.st["items"].values() if "human:handled" in v.get("labels", [])),
                 budget_escalations=count("Lead has already made"))
    return problems, stats, f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=10)
    ap.add_argument("--params", default="{}")
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()
    params = json.loads(a.params)
    bad = 0
    totals = {}
    for seed in range(a.seeds):
        try:
            problems, stats, f = simulate(seed, **params)
        except AssertionError as e:
            problems, stats, f = ["UNEXPECTED FAILURE: %s" % str(e)[:1500]], {}, None
        for k, v in stats.items():
            totals[k] = totals.get(k, 0) + v
        if problems:
            bad += 1
            print("seed %d: PROBLEM\n  %s" % (seed, "\n  ".join(problems)))
            if f is not None:
                print("  trace: " + " | ".join(f.trace[-25:]))
        elif a.verbose:
            print("seed %d: ok %s" % (seed, stats))
    print("issue flow: %d seeds, %d with problems; totals %s" % (a.seeds, bad, totals))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
