"""Shared helpers for the agent-team simulator: building a fake repository, running the real
scripts and workflow steps against it, and reading the result."""
import contextlib, fcntl, json, os, re, subprocess, tempfile

import yaml

SIM = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(SIM))
FAKE_BIN = os.path.join(SIM, "fakegh")
BOT = 999


def sha(n):
    return "%040x" % n


def files(*lines, name="src/a.ts"):
    """A PR's own diff: one file with the given +/- lines."""
    return [{"filename": name, "status": "modified", "changes": len(lines), "patch": "@@ -1,3 +1,3 @@\n ctx\n" + "\n".join(lines)}]


def bot_comment(body):
    return {"body": body, "user": {"id": BOT}}


def approval(s, role="qa"):
    return bot_comment("<!-- agent:%s -->\n**Verdict:** pass\n<!-- agent:approved-sha %s -->" % (role, s))


def queued():
    return bot_comment("<!-- agent:queued -->\n🚦 Queued")


def new_state(base_version=0, seed=0, **extra):
    st = {"base": "sandbox", "base_version": base_version, "items": {}, "shas": {}, "comments_all": [],
          "clock": 0, "events": [], "seed": seed}
    st.update(extra)
    return st


def add_sha(st, s, bv, fls, commit=None):
    st["shas"][s] = {"base_version": bv, "files": fls, "commit": commit or {
        "parents": [{"sha": sha(1)}], "author": {"id": 1}, "committer": {"login": "someone"},
        "commit": {"verification": {"verified": False}}}}


def add_pr(st, n, head, bv=None, fls=None, labels=("agent:queued",), comments=(), **flags):
    if head not in st["shas"]:
        add_sha(st, head, st["base_version"] if bv is None else bv, fls or files("+pr%s" % n))
    it = {"kind": "pr", "head": head, "labels": list(labels), "comments": [], "state": "OPEN"}
    it.update(flags)
    st["items"][str(n)] = it
    if flags.get("issue"):
        st["items"][str(flags["issue"])] = {"kind": "issue", "labels": ["agent:pr-open"], "comments": [], "state": "OPEN",
                                            "head": None}
    for c in comments:
        st["clock"] += 1
        c = dict(c, id=len(st["comments_all"]) + 1, created_at="2020-01-01T00:%02d:%02dZ" % divmod(st["clock"], 60))
        st["comments_all"].append(c)
        it["comments"].append(c["id"])
    return it


def make_state(prs, base_version=0, **extra):
    """prs: {number: {"head": sha, "bv": base version, "files": [...], "labels": [...], "comments": [...], flags…}}"""
    st = new_state(base_version, **extra)
    for n, p in prs.items():
        p = dict(p)
        for s, meta in p.pop("extra_shas", {}).items():
            st["shas"][s] = meta
        add_pr(st, n, p.pop("head"), bv=p.pop("bv", None), fls=p.pop("files", None),
               labels=p.pop("labels", ["agent:queued"]), comments=p.pop("comments", []), **p)
    return st


def env_for(state_file, bin_dir=None, **extra):
    e = dict(os.environ)
    e.update(PATH=FAKE_BIN + ":" + os.environ["PATH"], FAKE_GH_STATE=state_file, FAKE_DATE_FILE=state_file + ".clock",
             GITHUB_REPOSITORY="o/r", GITHUB_REPOSITORY_OWNER="o", AGENT_BOT_ID=str(BOT), GH_TOKEN="x",
             GITHUB_RUN_ID="1", GITHUB_SERVER_URL="https://github.com",
             BIN=bin_dir or os.path.join(REPO, "scripts/agents"),
             AGENT_REQUIRED_CHECKS="CI", DRAIN_MINUTES="100")
    e.update({k: str(v) for k, v in extra.items()})
    return e


@contextlib.contextmanager
def locked(state_file):
    """Read-modify-write the state under the same lock the fake gh uses."""
    with open(state_file + ".lock", "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        st = json.load(open(state_file))
        yield st
        tmp = state_file + ".tmp"
        json.dump(st, open(tmp, "w"))
        os.replace(tmp, state_file)


def read(state_file):
    with open(state_file + ".lock", "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_SH)
        return json.load(open(state_file))


def workflow(name, repo=REPO):
    return yaml.safe_load(open(os.path.join(repo, ".github/workflows", name)))


def steps(name, job, repo=REPO):
    return {s.get("name"): s for s in workflow(name, repo)["jobs"][job]["steps"]}


def subst(script, ctx):
    """Replace ${{ … }} expressions in a workflow step by values from ctx (missing: empty)."""
    return re.sub(r"\$\{\{\s*(.*?)\s*\}\}", lambda m: str(ctx.get(m.group(1), "")), script)


def drain_script(repo=REPO):
    return next(s["run"] for s in workflow("agent-integrator.yml", repo)["jobs"]["integrate"]["steps"] if "run" in s)


def run(st, script=None, args=(), shell=None, bin_dir=None, **envx):
    """Run a script from scripts/agents (script + args), or a shell snippet (shell=...), or the Integrator's
    drain loop (neither), against state st. Returns the final state with _stdout/_stderr/_rc/_summary/_outputs."""
    d = tempfile.mkdtemp(prefix="agent-sim-")
    f = os.path.join(d, "state.json")
    if envx.get("AGENT_QA_IN_QUEUE") == "true" and "audit_qa" not in st:
        st = dict(st, audit_qa=True)   # every merge must be QA-tested (see the fake gh's merge audit)
    json.dump(st, open(f, "w"))
    summary, outputs = os.path.join(d, "summary.md"), os.path.join(d, "outputs")
    open(summary, "w").close(); open(outputs, "w").close()
    e = env_for(f, bin_dir, GITHUB_STEP_SUMMARY=summary, GITHUB_OUTPUT=outputs, **envx)
    os.makedirs(os.path.join(d, "ws", ".agent-out"), exist_ok=True)
    if script:
        cmd = [os.path.join(e["BIN"], script), *args]
    else:
        cmd = ["bash", "-eo", "pipefail", "-c", shell if shell is not None else drain_script()]
    r = subprocess.run(cmd, env=e, capture_output=True, text=True, cwd=os.path.join(d, "ws"), timeout=600)
    out = json.load(open(f))
    out.update(_stdout=r.stdout, _stderr=r.stderr, _rc=r.returncode, _summary=open(summary).read(), _dir=d,
               _outputs=dict(l.split("=", 1) for l in open(outputs).read().splitlines() if "=" in l))
    return out


def bodies(st, n):
    ids = set(st["items"][str(n)]["comments"])
    return [c["body"] for c in st["comments_all"] if c["id"] in ids]


def labels(st, n):
    return st["items"][str(n)]["labels"]
