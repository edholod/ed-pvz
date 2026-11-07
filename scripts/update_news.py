#!/usr/bin/env python3
"""Aggregate public RSS headlines without authentication or third-party dependencies."""
import datetime as dt
import email.utils
from html.parser import HTMLParser
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
CHANNELS = [
    ("pvzhelp", "Библиотечка ПВЗ"),
    ("offlineplus", "Offline Plus"),
    ("wbpolzapvz", "WB Польза ПВЗ"),
    ("wbpvzlearning", "WB ПВЗ Новости. Менеджеры"),
]
MAX_ITEMS = 200
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

class TelegramParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.message = None
        self.depth = 0
        self.text_depth = 0
        self.text_parts = []
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = a.get("class", "").split()
        if self.message is None:
            if tag == "div" and "tgme_widget_message_wrap" in classes:
                self.message = {"url": "", "date": "", "text": ""}
                self.depth = 1
            return
        if tag == "div":
            self.depth += 1
        if "tgme_widget_message_text" in classes:
            self.text_depth = self.depth
        if tag == "a" and "tgme_widget_message_date" in classes:
            self.message["url"] = a.get("href", "")
        if tag == "time":
            self.message["date"] = a.get("datetime", "")
        if self.text_depth and tag == "br":
            self.text_parts.append(" ")
    def handle_data(self, data):
        if self.message is not None and self.text_depth:
            self.text_parts.append(data)
    def handle_endtag(self, tag):
        if self.message is None:
            return
        if tag == "div":
            if self.text_depth == self.depth:
                self.text_depth = 0
            self.depth -= 1
            if self.depth == 0:
                self.message["text"] = re.sub(r"\s+", " ", "".join(self.text_parts)).strip()
                self.items.append(self.message)
                self.message = None
                self.text_parts = []

def fetch_telegram(channel, source_name):
    url = "https://t.me/s/" + channel
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; EdPVZNews/1.0)",
        "Accept-Language": "ru-RU,ru;q=0.9",
    })
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read(2_500_000)
    parser = TelegramParser()
    parser.feed(raw.decode("utf-8", "replace"))
    result = []
    for msg in parser.items:
        link = msg["url"]
        if not re.fullmatch(r"https://t\.me/" + re.escape(channel) + r"/\d+", link):
            continue
        body = msg["text"]
        if not body:
            continue
        title = body[:180].rsplit(" ", 1)[0] if len(body) > 180 else body
        if len(body) > 180:
            title += "…"
        result.append({
            "title": title, "url": link, "source": source_name,
            "category": "Каналы", "date": msg["date"],
            "channel": channel,
        })
    if not result:
        raise ValueError("Публичные сообщения не обнаружены")
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
    for channel, source_name in CHANNELS:
        try:
            items.extend(fetch_telegram(channel, source_name))
        except Exception as e:
            errors.append('@' + channel + ': ' + str(e)[:150])
    if not items and old.get("items"):
        # Do not erase the last usable feed when all sources fail.
        old["errors"] = errors or ["Источники временно недоступны"]
        OUT.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    seen = set()
    unique = []
    for item in sorted(items, key=lambda x: x["date"], reverse=True):
        key = item["url"] if item.get("channel") else re.sub(r"\W+", "", item["title"].lower())
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
