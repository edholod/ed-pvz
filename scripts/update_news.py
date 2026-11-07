#!/usr/bin/env python3
"""Aggregate public RSS headlines without authentication or third-party dependencies."""
import datetime as dt
import difflib
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
    ("MAX", "site:max.ru/wb_pvz_news_manager Wildberries ПВЗ"),
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
    """Extract text, links and photo previews from public Telegram channel pages."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.message = None
        self.depth = 0
        self.text_depth = 0
        self.text_parts = []
        self.links = []
        self.active_link = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = a.get("class", "").split()
        if self.message is None:
            if tag == "div" and "tgme_widget_message_wrap" in classes:
                self.message = {"url": "", "date": "", "text": "", "links": [], "image": ""}
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
        if not self.message["image"]:
            if tag == "a" and ("tgme_widget_message_photo_wrap" in classes or "tgme_widget_message_video_thumb" in classes):
                style = a.get("style", "")
                match = re.search(r"""background-image:\s*url\(['"]?(https://[^'")]+)""", style)
                if match and match.group(1).startswith("https://"):
                    self.message["image"] = match.group(1)
            if tag == "img" and ("tgme_widget_message_photo" in classes or "tgme_widget_message_video_thumb" in classes):
                src = a.get("src", "")
                if src.startswith("https://"):
                    self.message["image"] = src
        if self.text_depth and tag == "a":
            href = a.get("href", "")
            if href.startswith(("https://", "http://", "tg://")):
                self.active_link = {"url": href, "text": ""}
        if self.text_depth and tag == "br":
            self.text_parts.append("\n")

    def handle_data(self, data):
        if self.message is not None and self.text_depth:
            self.text_parts.append(data)
            if self.active_link is not None:
                self.active_link["text"] += data

    def handle_endtag(self, tag):
        if self.message is None:
            return
        if tag == "a" and self.active_link is not None:
            self.active_link["text"] = self.active_link["text"].strip()
            self.message["links"].append(self.active_link)
            self.active_link = None
        if tag == "div":
            if self.text_depth == self.depth:
                self.text_depth = 0
            self.depth -= 1
            if self.depth == 0:
                self.message["text"] = re.sub(r"[ \\t]+", " ", "".join(self.text_parts)).strip()
                self.items.append(self.message)
                self.message = None
                self.text_parts = []
                self.active_link = None

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
            "content": body,
            "links": msg["links"],
            "image": msg["image"],
        })
    if not result:
        raise ValueError("Публичные сообщения не обнаружены")
    return result


# Compare news across channels, RSS queries and publishers, not just identical URLs.
# Conservative matching: short/generic headlines are not merged by fuzzy similarity.
STOPWORDS = {"wildberries", "вайлдберриз", "вб", "wb", "rwb", "пвз", "для",
             "что", "как", "это", "или", "при", "после", "уже", "все", "всех",
             "новости", "новость", "компания", "компании", "сегодня"}
def normalized_title(item):
    text = str(item.get("title") or "").lower().replace("ё", "е")
    text = re.sub(r"https?://\S+|@\w+|#\w+", " ", text)
    text = re.sub(r"\s+[—–-]\s+[^—–-]{2,55}$", "", text)
    return re.sub(r"\s+", " ", re.sub(r"[^а-яa-z0-9]+", " ", text)).strip()

def keywords(title):
    return {w for w in title.split() if len(w) >= 4 and w not in STOPWORDS}

def canonical_url(item):
    url = str(item.get("url") or "")
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc.lower().removeprefix("www.")
    path = parts.path.rstrip("/")
    # Strip tracking parameters; keep meaningful identifiers.
    query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    query = [(k, v) for k, v in query if not (k.startswith("utm_") or k in {"fbclid", "yclid", "gclid"})]
    return urllib.parse.urlunsplit((parts.scheme.lower(), host, path,
                                   urllib.parse.urlencode(query), ""))

def within_days(a, b, days=7):
    try:
        da = dt.datetime.fromisoformat(str(a.get("date", "")).replace("Z", "+00:00"))
        db = dt.datetime.fromisoformat(str(b.get("date", "")).replace("Z", "+00:00"))
        if da.tzinfo is None: da = da.replace(tzinfo=dt.timezone.utc)
        if db.tzinfo is None: db = db.replace(tzinfo=dt.timezone.utc)
        return abs((da - db).total_seconds()) <= days * 86400
    except (ValueError, TypeError):
        return True

def same_news(a, b):
    if canonical_url(a) == canonical_url(b):
        return True
    left, right = normalized_title(a), normalized_title(b)
    if not left or not right:
        return False
    if left == right:
        return True
    if not within_days(a, b):
        return False
    ka, kb = keywords(left), keywords(right)
    if len(ka) < 4 or len(kb) < 4:
        return False
    common = len(ka & kb)
    if common < 4:
        return False
    overlap = common / min(len(ka), len(kb))
    similarity = difflib.SequenceMatcher(None, left, right, autojunk=False).ratio()
    # A near-identical rewrite, or a shorter headline embedded in a longer one.
    return (overlap >= .85 and similarity >= .78) or (overlap >= .92 and similarity >= .68)

def deduplicate(items):
    unique = []
    # Preserve latest article, with a stable preference for a directly linked original.
    for item in sorted(items, key=lambda x: x.get("date") or "", reverse=True):
        if not item.get("title") or not item.get("url"):
            continue
        if any(same_news(item, previous) for previous in unique):
            continue
        unique.append(item)
    return unique

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
    # Keep previously collected readable text when a newer feed entry has only a headline.
    previous_by_url = {canonical_url(x): x for x in old.get("items", []) if isinstance(x, dict)}
    for item in items:
        previous = previous_by_url.get(canonical_url(item))
        if previous:
            for field in ("content", "links", "image"):
                if not item.get(field) and previous.get(field):
                    item[field] = previous[field]
    unique = deduplicate(items)
    data = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(), "items": unique[:MAX_ITEMS], "errors": errors}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Saved", len(data["items"]), "items;", len(errors), "source errors")
if __name__ == "__main__":
    main()
