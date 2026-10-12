#!/usr/bin/env python3
"""Create / update / disable a password-protected share for ONE checklist.

Run by the assistant (content edits go through chat). Uses the owner token from
env CHECKLIST_GIST_TOKEN (never printed).

  python3 share.py --list "影视拍摄器材验收清单" --password 8866
  python3 share.py --list "影视拍摄器材验收清单"            # re-sync content, keep password
  python3 share.py --list "..." --disable
  python3 share.py --init-registry                      # one-time: create the secret shares gist
  add --dry-run to print what would change without writing.

Storage:
  owner gist  (OWNER_GIST, file checklist-data.json): list.share = {id,url,createdAt,updatedAt,disabled}
                                                      root.sharesGistId = registry gist id
  shares gist (registry, secret, id only known to owner + worker): file share-<id>.json
              = {version,id,listId,salt,iter,hash,updatedAt,disabled,list}
Password: PBKDF2-SHA256, 100k iterations, random 16-byte salt; plaintext never stored.
"""
import argparse, base64, hashlib, json, os, secrets, sys, time, urllib.request

OWNER_GIST = os.environ.get("CHECKLIST_OWNER_GIST", "1647bd9e840333f548aee22d9471cd22")
OWNER_FILE = "checklist-data.json"
PAGES_URL = os.environ.get("CHECKLIST_PAGES_URL", "https://checklist-2wu.pages.dev/")
WORKER_URL = os.environ.get("CHECKLIST_WORKER_URL", "")  # e.g. https://checklist-share.<sub>.workers.dev
ITER = 100_000


def api(method, url, body=None):  # patched in tests
    token = os.environ.get("CHECKLIST_GIST_TOKEN")
    if not token:
        sys.exit("CHECKLIST_GIST_TOKEN not set")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                                          "Content-Type": "application/json", "User-Agent": "checklist-share-py"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def read_file(gist_id, name):
    g = api("GET", f"https://api.github.com/gists/{gist_id}")
    f = (g.get("files") or {}).get(name)
    if not f:
        return None
    if f.get("truncated"):
        token = os.environ["CHECKLIST_GIST_TOKEN"]
        req = urllib.request.Request(f["raw_url"], headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    return json.loads(f["content"])


def write_files(gist_id, files):
    api("PATCH", f"https://api.github.com/gists/{gist_id}",
        {"files": {k: {"content": json.dumps(v, ensure_ascii=False, indent=2)} for k, v in files.items()}})


def hash_pw(pw, salt_b64, iters=ITER):
    return base64.b64encode(hashlib.pbkdf2_hmac("sha256", pw.encode(), base64.b64decode(salt_b64), iters)).decode()


def merge_checks(content_list, share_list):
    """Content from owner; checked state per item = newer `u` wins."""
    old = {it["id"]: it for g in (share_list or {}).get("groups", []) for it in g.get("items", [])}
    out = json.loads(json.dumps(content_list))
    out.pop("share", None)
    for g in out.get("groups", []):
        for it in g.get("items", []):
            o = old.get(it["id"])
            if o and (o.get("u") or 0) > (it.get("u") or 0):
                it["checked"], it["u"] = o.get("checked", False), o.get("u")
    return out


def share_link(sid):
    return PAGES_URL + ("&" if "?" in PAGES_URL else "?") + "share=" + sid + (("&api=" + WORKER_URL) if WORKER_URL else "")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--list"); ap.add_argument("--password"); ap.add_argument("--disable", action="store_true")
    ap.add_argument("--init-registry", action="store_true"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)

    owner = read_file(OWNER_GIST, OWNER_FILE)
    if a.init_registry:
        if owner.get("sharesGistId"):
            print("registry exists:", owner["sharesGistId"]); return 0
        if a.dry_run:
            print("[dry-run] would create secret gist 'checklist shares' and set owner.sharesGistId"); return 0
        g = api("POST", "https://api.github.com/gists", {"description": "checklist shares (private)", "public": False,
                                                         "files": {"README.md": {"content": "Shared checklists. Do not share this gist link."}}})
        owner["sharesGistId"] = g["id"]; owner["updatedAt"] = max(int(time.time() * 1000), int(owner.get("updatedAt") or 0) + 1)
        write_files(OWNER_GIST, {OWNER_FILE: owner})
        print("registry created:", g["id"], "-> set SHARES_GIST_ID in worker/wrangler.toml"); return 0

    if not a.list:
        ap.error("--list required")
    reg = owner.get("sharesGistId")
    if not reg:
        sys.exit("no share registry yet: run --init-registry first")
    lst = next((l for l in owner["lists"] if l["name"] == a.list or l["id"] == a.list), None)
    if not lst:
        sys.exit("list not found. available: " + ", ".join(l["name"] for l in owner["lists"]))

    now = int(time.time() * 1000)
    sh = lst.get("share") or {}
    sid = sh.get("id") or secrets.token_urlsafe(9).replace("-", "x").replace("_", "y")
    fname = f"share-{sid}.json"
    rec = read_file(reg, fname) if sh.get("id") else None
    if not rec and not a.password and not a.disable:
        sys.exit("new share needs --password")
    rec = rec or {"version": 1, "id": sid, "listId": lst["id"], "iter": ITER}
    if a.password:
        if len(a.password) < 4:
            sys.exit("password too short (min 4)")
        rec["salt"] = base64.b64encode(secrets.token_bytes(16)).decode()
        rec["iter"] = ITER
        rec["hash"] = hash_pw(a.password, rec["salt"])
    rec["list"] = merge_checks(lst, rec.get("list"))
    rec["disabled"] = bool(a.disable)
    rec["updatedAt"] = max(now, int(rec.get("updatedAt") or 0) + 1)
    # owner copy adopts newer checks from share too
    synced = merge_checks(rec["list"], None)
    for g_o, g_s in zip(lst.get("groups", []), synced.get("groups", [])):
        for it_o, it_s in zip(g_o.get("items", []), g_s.get("items", [])):
            if it_o["id"] == it_s["id"]:
                it_o["checked"], it_o["u"] = it_s["checked"], it_s.get("u", it_o.get("u"))
    lst["share"] = {"id": sid, "url": share_link(sid), "createdAt": sh.get("createdAt") or now, "updatedAt": max(now, int(sh.get("updatedAt") or 0) + 1), "disabled": bool(a.disable)}
    lst["updatedAt"] = max(now, int(lst.get("updatedAt") or 0) + 1)
    owner["updatedAt"] = max(now, int(owner.get("updatedAt") or 0) + 1, max([int(v) for v in (owner.get("deleted") or {}).values()] or [0]) + 1)

    if a.dry_run:
        print("[dry-run] share", sid, "for", lst["name"], "disabled" if a.disable else "")
        print("[dry-run] link:", lst["share"]["url"]); return 0
    write_files(reg, {fname: rec})
    write_files(OWNER_GIST, {OWNER_FILE: owner})
    print(("已停用分享：" if a.disable else "分享链接：") + lst["share"]["url"])
    if not WORKER_URL:
        print("(注意：未设置 CHECKLIST_WORKER_URL，链接需要页面内置的 Worker 地址才能工作)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
