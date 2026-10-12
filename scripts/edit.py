#!/usr/bin/env python3
"""Chat-driven edits to the owner checklist gist (token: env CHECKLIST_GIST_TOKEN, never printed).

  edit.py show
  edit.py new-list  "名称"
  edit.py rename-list "旧名" "新名"
  edit.py delete-list "名称"                 # writes a tombstone so browsers drop it too
  edit.py clear-list  "名称"                 # keep list/share metadata, remove all groups
  edit.py add-group   "清单" "分组" [--color "#2f6db3"]
  edit.py delete-group "清单" "分组"
  edit.py add-item    "清单" "分组" "名称" [--qty ×1] [--tag 只成套租] [--note ...]   (group auto-created)
  edit.py delete-item "清单" "名称"
  edit.py uncheck-all "清单"
  edit.py load-groups "清单" groups.json     # replace all groups from {"groups":[{name,items:[{text,qty,tag}]}]}
Add --dry-run to preview. After editing a shared list, run: share.py --list "清单" to push content to the share.
"""
import argparse, json, secrets, sys, time
import share  # reuses api/read_file/write_files

COLORS = ["#1e3a5f", "#2f6db3", "#2a7d7b", "#6b4fa0", "#b5651d", "#3d4a5c", "#8a6d1f", "#5b7c2a"]
WARN = "#c0392b"
now = lambda: int(time.time() * 1000)
mono = lambda t, prev: max(t, int(prev or 0) + 1)  # monotonic: never go below a previous stamp
uid = lambda: secrets.token_hex(6)

def find(S, name):
    l = next((l for l in S["lists"] if l["name"] == name or l["id"] == name), None)
    if not l: sys.exit("找不到清单：" + name + "；现有：" + "、".join(x["name"] for x in S["lists"]))
    return l

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("cmd"); ap.add_argument("args", nargs="*")
    ap.add_argument("--qty", default=""); ap.add_argument("--tag", default=""); ap.add_argument("--note", default="")
    ap.add_argument("--color"); ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv); c, x = a.cmd, a.args
    S = share.read_file(share.OWNER_GIST, share.OWNER_FILE)
    S.setdefault("deleted", {}); t = now()
    if c == "show":
        for l in S["lists"]:
            n = sum(len(g["items"]) for g in l["groups"]); d = sum(i.get("checked") for g in l["groups"] for i in g["items"])
            print(f'{l["name"]}  {d}/{n}' + ("  [已分享]" if l.get("share") and not l["share"].get("disabled") else ""))
            for g in l["groups"]: print("  -", g["name"], len(g["items"]))
        return 0
    if c == "new-list":
        l = {"id": uid(), "name": x[0], "updatedAt": t, "groups": []}; S["lists"].append(l)
    else:
        l = find(S, x[0]); l["updatedAt"] = mono(t, l.get("updatedAt"))
        if c == "rename-list": l["name"] = x[1]
        elif c == "delete-list":
            S["lists"].remove(l); S["deleted"][l["id"]] = t
            if S.get("activeListId") == l["id"] and S["lists"]: S["activeListId"] = S["lists"][0]["id"]
        elif c == "clear-list": l["groups"] = []
        elif c == "load-groups":  # load-groups "清单" file.json  (replaces all groups; all unchecked)
            src = json.load(open(x[1], encoding="utf-8")); src = src.get("groups", src) if isinstance(src, dict) else src
            l["groups"] = []; k = 0
            for g in src:
                warn = g["name"].startswith("⚠")
                col = g.get("color") or (WARN if warn else COLORS[k % len(COLORS)]); k += 0 if warn else 1
                l["groups"].append({"id": uid(), "name": g["name"], "color": col, "items": [
                    {"id": uid(), "text": i["text"], "qty": i.get("qty", ""), "tag": i.get("tag", ""), "note": i.get("note", ""),
                     "checked": False, "u": t, "createdAt": t} for i in g["items"]]})
        elif c == "uncheck-all":
            for g in l["groups"]:
                for i in g["items"]: i["checked"], i["u"] = False, mono(t, i.get("u"))
        elif c in ("add-group", "add-item"):
            g = next((g for g in l["groups"] if g["name"] == x[1]), None)
            if not g:
                g = {"id": uid(), "name": x[1], "color": a.color or COLORS[len(l["groups"]) % len(COLORS)], "items": []}; l["groups"].append(g)
            elif a.color: g["color"] = a.color
            if c == "add-item":
                g["items"].append({"id": uid(), "text": x[2], "qty": a.qty, "tag": a.tag, "note": a.note, "checked": False, "u": t, "createdAt": t})
        elif c == "edit-item":  # edit-item "清单" "条目" [--qty --tag --note]
            hit = [i for g in l["groups"] for i in g["items"] if i["text"] == x[1] or i["id"] == x[1]]
            if not hit: sys.exit("找不到条目：" + x[1])
            for i in hit:
                if a.qty is not None: i["qty"] = a.qty
                if a.tag is not None: i["tag"] = a.tag
                if a.note is not None: i["note"] = a.note
                i["u"] = mono(t, i.get("u"))
            l["updatedAt"] = mono(t, l.get("updatedAt"))
        elif c == "delete-group": l["groups"] = [g for g in l["groups"] if g["name"] != x[1]]
        elif c == "delete-item":
            for g in l["groups"]: g["items"] = [i for i in g["items"] if i["text"] != x[1] and i["id"] != x[1]]
        else: sys.exit("unknown command " + c)
    S["updatedAt"] = max(t, int(S.get("updatedAt") or 0) + 1, max([int(v) for v in (S.get("deleted") or {}).values()] or [0]) + 1)
    if a.dry_run: print("[dry-run]", c, x); return 0
    share.write_files(share.OWNER_GIST, {share.OWNER_FILE: S}); print("OK", c, *x)
    return 0

if __name__ == "__main__": sys.exit(main())
