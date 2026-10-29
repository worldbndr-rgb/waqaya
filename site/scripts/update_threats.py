#!/usr/bin/env python3
"""Scheduled phishing feed snapshot; standard library only. Never visits listed URLs."""
import json
import os
import pathlib
import tempfile
from datetime import datetime, timezone
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "threats.json"
FEEDS = [
    ("openphish", ["https://raw.githubusercontent.com/openphish/public_feed/main/feed.txt"]),
    ("phishdb", [
        "https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-links-NEW-today.txt",
        "https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-links-NEW-today.txt",
    ]),
]
MAX_ITEMS_PER_SOURCE = 30000
MAX_RESPONSE_BYTES = 12 * 1024 * 1024

def parse(raw):
    urls, seen = [], set()
    for line in raw.decode("utf-8", errors="replace").splitlines():
        u = line.strip()
        if not u or u.startswith(("#", "!")) or any(c.isspace() for c in u):
            continue
        try:
            parsed = urlsplit(u)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or "." not in parsed.hostname:
                continue
            if parsed.username or parsed.password or len(u) > 4096:
                continue
        except ValueError:
            continue
        if u not in seen:
            urls.append(u)
            seen.add(u)
        if len(urls) >= MAX_ITEMS_PER_SOURCE:
            break
    return urls

def get_feed(url):
    req = Request(url, headers={"User-Agent": "WaqayaThreatUpdater/1.0", "Accept": "text/plain"})
    with urlopen(req, timeout=35) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Feed too large")
    urls = parse(raw)
    if not urls:
        raise ValueError("Empty or invalid feed")
    return urls

def main():
    previous = {}
    if DEST.exists():
        try:
            previous = json.loads(DEST.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    previous_lists = {entry["source"]: entry["urls"] for entry in previous.get("lists", [])
                      if isinstance(entry, dict) and "source" in entry and "urls" in entry}
    merged, failures, successes = [], [], 0
    for source, mirrors in FEEDS:
        urls = None
        for url in mirrors:
            try:
                urls = get_feed(url)
                successes += 1
                break
            except Exception as exc:
                print(f"{source}: {type(exc).__name__}: {exc}")
        if urls is None:
            failures.append(source)
            urls = previous_lists.get(source, [])
        if urls:
            merged.append({"source": source, "urls": urls})
    if not successes:
        raise RuntimeError("No live source succeeded: refusing to rewrite snapshot")
    if not merged:
        raise RuntimeError("No usable threat data")
    now = datetime.now(timezone.utc)
    snapshot = {
        "schema": 1,
        "updatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "at": int(now.timestamp() * 1000),
        "sources": [e["source"] for e in merged],
        "failed": failures,
        "lists": merged
    }
    DEST.parent.mkdir(exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DEST.parent, prefix=".threats-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        os.replace(tmp, DEST)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    print(f"Saved {sum(len(e['urls']) for e in merged)} URLs; failures: {failures}")

if __name__ == "__main__":
    main()
