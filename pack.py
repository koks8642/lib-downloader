# Упаковка расширения в zip для Chrome Web Store / Edge Add-ons.
# В пакет входят только файлы, нужные расширению (manifest, src/).
import os, sys, json, zipfile

sys.stdout.reconfigure(encoding="utf-8")
ROOT = os.path.dirname(os.path.abspath(__file__))

# что включаем
INCLUDE_FILES = ["manifest.json"]
INCLUDE_DIRS = ["src"]
# что НИКОГДА не включаем
# mobi.js — заготовка для роадмапа, в UI не используется (не везём в пакет)
SKIP = {".png.import", "mobi.js"}
SKIP_EXT = set()

ver = json.load(open(os.path.join(ROOT, "manifest.json"), encoding="utf-8"))["version"]
dist = os.path.join(ROOT, "dist")
os.makedirs(dist, exist_ok=True)
out = os.path.join(dist, f"lib-downloader-{ver}.zip")

n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for f in INCLUDE_FILES:
        z.write(os.path.join(ROOT, f), f); n += 1
    for d in INCLUDE_DIRS:
        for base, _, files in os.walk(os.path.join(ROOT, d)):
            for fn in files:
                if fn in SKIP or os.path.splitext(fn)[1] in SKIP_EXT:
                    continue
                full = os.path.join(base, fn)
                rel = os.path.relpath(full, ROOT).replace("\\", "/")
                z.write(full, rel); n += 1

print(f"Готово: {out}")
print(f"Файлов в пакете: {n}, версия: {ver}")
