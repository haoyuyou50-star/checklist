"""Offline test for share.py with a fake gist API (no network, no token)."""
import base64, json, os, subprocess, sys, copy
sys.path.insert(0, os.path.dirname(__file__))
import share

def owner_doc():
    path = os.path.join(os.path.dirname(__file__), "..", "checklist-data.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    # Minimal stand-in so the test runs without a private data file.
    return {
        "version": 3, "updatedAt": 1, "activeListId": "demo-gear",
        "lists": [
            {"id": "demo-gear", "name": "影视拍摄器材验收清单", "updatedAt": 3, "groups": [
                {"id": "g", "name": "摄影组", "items": [
                    {"id": "a", "text": "A", "checked": False, "u": 1},
                    {"id": "b", "text": "B", "checked": False, "u": 1},
                    {"id": "c", "text": "C", "checked": False, "u": 1},
                ]}]},
            {"id": "demo-exhibit", "name": "展陈布置", "updatedAt": 2, "groups": []},
            {"id": "demo-daily", "name": "日常事项", "updatedAt": 1, "groups": []},
        ],
    }

store = {"OWNER": {"checklist-data.json": json.dumps(owner_doc())}}
def fake_api(method, url, body=None):
    if method == "POST":
        store["REG"] = {k: v["content"] for k, v in body["files"].items()}; return {"id": "REG"}
    gid = url.rsplit("/", 1)[1]
    if method == "GET":
        return {"files": {k: {"content": v, "truncated": False} for k, v in store[gid].items()}}
    for k, v in body["files"].items(): store[gid][k] = v["content"]
    return {}
share.api = fake_api
share.OWNER_GIST = "OWNER"
share.WORKER_URL = "https://checklist-share.example.workers.dev"
os.environ.setdefault("CHECKLIST_GIST_TOKEN", "x")

assert share.main(["--init-registry"]) == 0
owner = json.loads(store["OWNER"]["checklist-data.json"]); assert owner["sharesGistId"] == "REG"
assert share.main(["--list", "影视拍摄器材验收清单", "--password", "8866"]) == 0
owner = json.loads(store["OWNER"]["checklist-data.json"])
lst = next(l for l in owner["lists"] if l["id"] == "demo-gear"); sid = lst["share"]["id"]
rec = json.loads(store["REG"][f"share-{sid}.json"])
assert "8866" not in json.dumps(rec) and rec["hash"] and rec["salt"]
assert rec["list"]["name"] == "影视拍摄器材验收清单" and "share" not in rec["list"]
assert len(owner["lists"]) == 3 and all(l["id"] != "demo-exhibit" for l in [rec["list"]])
# recipient checks item via worker (simulate newer u), then owner re-syncs content -> keeps recipient check
rec["list"]["groups"][0]["items"][2]["checked"] = True; rec["list"]["groups"][0]["items"][2]["u"] = 9e15
store["REG"][f"share-{sid}.json"] = json.dumps(rec)
assert share.main(["--list", "demo-gear"]) == 0
owner = json.loads(store["OWNER"]["checklist-data.json"])
lst = next(l for l in owner["lists"] if l["id"] == "demo-gear")
assert lst["groups"][0]["items"][2]["checked"] is True, "recipient check propagated to owner"
rec2 = json.loads(store["REG"][f"share-{sid}.json"]); assert rec2["hash"] == rec["hash"], "password kept"
assert "share=" + sid in lst["share"]["url"]
print("share.py tests: OK  link example:", lst["share"]["url"])
# cross-check python hash == worker WebCrypto hash
salt = base64.b64encode(b"0123456789abcdef").decode()
py = share.hash_pw("8866", salt)
r = subprocess.run(["node", "test/handler.test.mjs"], cwd=os.path.join(os.path.dirname(__file__), "..", "worker"), env={**os.environ, "PY_HASH": py}, capture_output=True, text=True)
print(r.stdout.strip() or r.stderr); assert r.returncode == 0
print("python PBKDF2 == worker PBKDF2: OK")
