#!/usr/bin/env python3
"""Aggregate public RSS headlines without authentication or third-party dependencies."""
import datetime as dt
import email.utils
import json
import pathlib
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "news.json"
SOURCES = [
    ("ПВЗ", "Wildberries ПВЗ пункт выдачи изменения"),
    ("Продавцы", "Wildberries продавцы тарифы правила"),
    ("Компания", "Wildberries RWB новости"),
    ("API", "Wildberries API обновления"),
    ("ПВЗ", "site:seller.wildberries.ru ПВЗ Wildberries"),
    ("Компания", "site:rwb.ru Wildberries RWB"),
]
MAX_ITEMS = 120
def parse_date(value):
    try:
        d = email.utils.parsedate_to_datetime(value)
        return d.astimezone(dt.timezone.utc).isoformat()
    except Exception:
        return ""
def fetch(category, query):
    params = urllib.parse.urlencode({"q": query, "hl": "ru", "gl": "RU", "ceid": "RU:ru"})
    url = "https://news.google.com/rss/search?" + params
    request = urllib.request.Request(url, headers={"User-Agent": "EdPVZNews/1.0 (public RSS aggregator)"})
    with urllib.request.urlopen(request, timeout=18) as response:
        raw = response.read(1_500_000)
    root = ET.fromstring(raw)
    result = []
    for entry in root.findall("./channel/item")[:45]:
        title = (entry.findtext("title") or "").strip()
        link = (entry.findtext("link") or "").strip()
        source = entry.find("source")
        source_name = source.text.strip() if source is not None and source.text else "Новостной источник"
        if not title or not link.startswith("https://"):
            continue
        title = re.sub(r"\s+[-—]\s+" + re.escape(source_name) + r"$", "", title)
        result.append({"title": title[:250], "url": link, "source": source_name[:100], "category": category, "date": parse_date(entry.findtext("pubDate") or "")})
    return result
def main():
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    items = []
    errors = []
    for category, query in SOURCES:
        try:
            items.extend(fetch(category, query))
        except Exception as e:
            errors.append(category + ": " + str(e)[:150])
    if not items and old.get("items"):
        # Do not erase the last usable feed when all sources fail.
        old["errors"] = errors or ["Источники временно недоступны"]
        OUT.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    seen = set()
    unique = []
    for item in sorted(items, key=lambda x: x["date"], reverse=True):
        key = re.sub(r"\W+", "", item["title"].lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    data = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(), "items": unique[:MAX_ITEMS], "errors": errors}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Saved", len(data["items"]), "items;", len(errors), "source errors")
if __name__ == "__main__":
    main()
