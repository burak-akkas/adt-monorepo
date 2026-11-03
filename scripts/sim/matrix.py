#!/usr/bin/env python3
"""Runs the scenario profiles (profiles.json) with several seeds each through team.py and prints a
matrix: outcomes per profile, invariant violations, and how much work the team did.

Exit status 1 when any run got STUCK, hit a LIVELOCK, violated an invariant (unsafe merge, a merged
PR left in an agent state, a comment storm), crashed the simulator, or failed a job without an
injected cause (API errors, killed jobs). Keeps the state of every such run for debugging.

  python3 scripts/sim/matrix.py                    # everything, 6 seeds
  python3 scripts/sim/matrix.py --quick --seeds 3  # the fast set (CI)
  python3 scripts/sim/matrix.py --only conflicts --seeds 20 --report /tmp/report.md
"""
import argparse, collections, concurrent.futures, json, os, subprocess, sys, time

SIM = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(SIM))
TERMINAL = ("merged", "closed", "draft", "needs-human")


def run_one(name, prof, seed, sequential):
    cmd = [sys.executable, os.path.join(SIM, "team.py"), "--seed", str(seed), "--prs", str(prof["prs"]),
           "--params", json.dumps(prof.get("params", {}))]
    if prof.get("legacy_ref"):
        cmd += ["--legacy-ref", prof["legacy_ref"]]
    if sequential:
        cmd.append("--sequential")
    t = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        out = {"seed": seed, "crash": (r.stdout + r.stderr)[-3000:]}
    out.update(profile=name, seconds=round(time.time() - t, 1))
    return out


def problems_of(r, prof=None):
    if "crash" in r:
        return ["simulator crash: " + r["crash"][-500:]]
    p = ["%s #%s: %s" % (v.split()[0], n, v) for n, v in r["result"].items() if v.split()[0] in ("STUCK", "LIVELOCK")]
    if not (prof or {}).get("legacy_ref"):   # the old merge gate's violations are what the "before" rows show
        p += ["violation: %s" % json.dumps(v) for v in r["violations"] if v["kind"] != "human-merge-race"]
    p += ["unexpected job failure: %s" % f for f in r["unexpected_failures"]]
    return p


def main():
    a = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    a.add_argument("--profiles", default=os.path.join(SIM, "profiles.json"))
    a.add_argument("--seeds", type=int, default=6)
    a.add_argument("--first-seed", type=int, default=1)
    a.add_argument("--jobs", type=int, default=max(2, (os.cpu_count() or 2) - 1))
    a.add_argument("--only", default="", help="only profiles whose name contains this")
    a.add_argument("--quick", action="store_true", help="only the profiles marked quick")
    a.add_argument("--sequential", action="store_true", help="one run at a time inside each simulation (reproducible)")
    a.add_argument("--report", help="also write the matrix (markdown) here")
    a.add_argument("--json", help="write all raw results (JSON lines) here")
    a.add_argument("--from-json", help="don't simulate: render the matrix from results written with --json")
    o = a.parse_args()

    profiles = {k: v for k, v in json.load(open(o.profiles)).items() if not k.startswith("_")}
    profiles = {k: v for k, v in profiles.items() if o.only.lower() in k.lower() and (not o.quick or v.get("quick"))}
    for k, v in list(profiles.items()):
        if v.get("legacy_ref") and subprocess.run(["git", "-C", REPO, "cat-file", "-e", v["legacy_ref"]], capture_output=True).returncode:
            print("skipping %r: git ref %s not found" % (k, v["legacy_ref"]), file=sys.stderr)
            del profiles[k]
    jobs = [(k, v, s) for k, v in profiles.items() for s in range(o.first_seed, o.first_seed + o.seeds)]
    print("running %d simulations (%d profiles × %d seeds, %d at a time)…" % (len(jobs), len(profiles), o.seeds, o.jobs), file=sys.stderr)

    results = collections.defaultdict(list)
    t0 = time.time()
    if o.from_json:
        for line in open(o.from_json):
            r = json.loads(line)
            if r["profile"] in profiles:
                results[r["profile"]].append(r)
        jobs = [j for j in jobs if any(r.get("seed") == j[2] for r in results[j[0]])]
    with concurrent.futures.ThreadPoolExecutor(o.jobs) as ex:
        futs = [] if o.from_json else [ex.submit(run_one, k, v, s, o.sequential) for k, v, s in jobs]
        for i, f in enumerate(concurrent.futures.as_completed(futs), 1):
            r = f.result()
            results[r["profile"]].append(r)
            bad = problems_of(r, profiles[r["profile"]])
            print("[%d/%d] %s seed %s: %s" % (i, len(jobs), r["profile"], r.get("seed"), "PROBLEM" if bad else "ok"), file=sys.stderr)
    if o.json:
        with open(o.json, "w") as fh:
            for rs in results.values():
                for r in rs:
                    fh.write(json.dumps(r) + "\n")

    lines = ["| Profile | Runs | PRs | Merged | Escalated to a human | Closed / draft (by a human) | **Stuck** | **Violations** | **Unexpected failures** | Reviews / merged PR | QA / merged PR | Implementor / merged PR | Branch updates / merged PR | Lead runs | Wasted Implementor runs (no-change) | Watchdog queue restarts | Human-merge races | Injected trouble |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    problems = []
    for name in profiles:
        rs = results[name]
        ok = [r for r in rs if "crash" not in r]
        c = collections.Counter(v.split()[0] for r in ok for v in r["result"].values())
        s = lambda k: sum(r["stats"].get(k, 0) for r in ok)
        merged = max(c["merged"], 1)
        stuck = c["STUCK"] + c["LIVELOCK"]
        viol = sum(1 for r in ok for v in r["violations"] if v["kind"] != "human-merge-race")
        races = sum(1 for r in ok for v in r["violations"] if v["kind"] == "human-merge-race")
        unexp = sum(len(r["unexpected_failures"]) for r in ok) + (len(rs) - len(ok))
        trouble = ", ".join("%s %d" % (k, s(k)) for k in ("lost_webhooks", "duplicated", "dropped_pending", "api_flakes", "killed", "human_actions") if s(k))
        lines.append("| %s | %d | %d | %d | %d | %d | %s | %s | %s | %.2f | %.2f | %.2f | %.2f | %d | %d | %d | %d | %s |" % (
            name, len(rs), sum(len(r["result"]) for r in ok), c["merged"], c["needs-human"], c["closed"] + c["draft"],
            "**%d**" % stuck if stuck else "0", "**%d**" % viol if viol else "0", "**%d**" % unexp if unexp else "0",
            s("reviews") / merged, s("qa") / merged, s("impl") / merged, s("updates") / merged, s("lead"), s("impl_nochange"), s("watchdog_kicks"), races, trouble or "–"))
        for r in rs:
            for p in problems_of(r, profiles[name]):
                problems.append("- %s, seed %s: %s (state kept in %s)" % (name, r.get("seed"), p, r.get("dir")))
    report = "\n".join(lines) + "\n\n" + ("**Problems**\n" + "\n".join(problems) if problems else "No stuck PRs, invariant violations or unexpected failures.") + \
        "\n\n_%d simulations in %.0f s._\n" % (len(jobs), time.time() - t0)
    print(report)
    if o.report:
        open(o.report, "w").write(report)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
