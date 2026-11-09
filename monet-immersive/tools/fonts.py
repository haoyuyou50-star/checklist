"""Download subset web fonts (only the glyphs used by the demo) into assets/fonts/."""
import hashlib, pathlib, re, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

text = ""
for f in ["index.html", "src/scenes.js", "src/main.js", "src/demo.js"]:
    text += (ROOT / f).read_text(encoding="utf-8")
ascii_set = "".join(chr(c) for c in range(32, 127))
chars = sorted(set(ch for ch in text if ord(ch) > 127) | set(ascii_set) | set("·—–×…“”‘’《》，。、：；！？「」"))
glyphs = "".join(chars)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read()


def build(family, axes, prefix):
    q = urllib.parse.urlencode({"family": f"{family}:{axes}", "text": glyphs, "display": "swap"})
    css = fetch(f"https://fonts.googleapis.com/css2?{q}").decode()
    out, seen = [], {}
    for block in re.findall(r"@font-face\s*{[^}]+}", css):
        url = re.search(r"url\((https://[^)]+)\)", block).group(1)
        data = fetch(url)
        key = hashlib.sha1(data).hexdigest()
        if key not in seen:
            seen[key] = f"{prefix}-{len(seen)}.woff2"
            (OUT / seen[key]).write_bytes(data)
        out.append(block.replace(url, seen[key]))
    return out


OUT.mkdir(parents=True, exist_ok=True)
for old in OUT.glob("*.woff2"):
    old.unlink()
blocks = build("Noto Serif SC", "wght@400;500;600", "noto-serif-sc")
blocks += build("Cormorant Garamond", "ital,wght@0,400;0,500;1,400;1,500", "cormorant")
(OUT / "fonts.css").write_text("\n".join(blocks) + "\n", encoding="utf-8")
print(len(glyphs), "glyphs ->", [p.name for p in OUT.glob("*.woff2")])
