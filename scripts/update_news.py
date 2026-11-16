#!/usr/bin/env python3
"""Aggregate public news and extract article content when available."""
import datetime as dt
import difflib
import email.utils
from html.parser import HTMLParser
import ipaddress
import json
import pathlib
import re
import socket
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
    ("AvitoPvzLive", "Avito ПВЗ Live"),
    ("ozonapvz", "Ozon и партнёры ПВЗ"),
]
MAX_ITEMS = 200
# Backfill the article reported missing during the RSS outage.
ARTICLE_BACKFILL = {
    "title": "Новые правила Ozon с 19 ноября могут привести к росту цен до 5%",
    "url": "https://news.google.com/rss/articles/CBMijwFBVV95cUxNWDdpeUVQTWNxMEVZRzJDWXp3N2U0QzlqYktDVjBsRkdNcUxkdVNIUmtMTWJYVnAwR1hRMDJmWVJZU09UNEl5ZVZiYnJrTkNsdzhTZHlzYW9nWUpBYktFSWIybkZ1b0ZHMUZucmVaSW5xd25DOUhqZmtoS2dha3ZrQUdYR0MybUd5Mmc0cnNXcw?oc=5",
    "source": "PNZ.RU",
    "publisher": "https://pnz.ru",
    "category": "Продавцы",
    "date": "2026-11-15T15:00:00+00:00",
    "original_url": "https://pnz.ru/life/novye-pravila-ozon-s-19-noyabrya-mogut-privesti-k-rostu-czen-do-5/"
}
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
        result.append({"title": title[:250], "url": link, "source": source_name[:100], "publisher": source.get("url", "") if source is not None else "", "category": category, "date": parse_date(entry.findtext("pubDate") or "")})
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
                self.message = {"url": "", "date": "", "text": "", "links": [], "images": []}
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
        image = ""
        if tag == "a" and ("tgme_widget_message_photo_wrap" in classes or "tgme_widget_message_video_thumb" in classes):
            match = re.search(r"""background-image:\s*url\(['"]?(https://[^'")]+)""", a.get("style", ""))
            if match:
                image = match.group(1)
        if tag == "img" and ("tgme_widget_message_photo" in classes or "tgme_widget_message_video_thumb" in classes):
            image = a.get("src", "")
        if image.startswith("https://") and image not in self.message["images"]:
            self.message["images"].append(image)
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
        if not re.fullmatch(r"https://t\.me/" + re.escape(channel) + r"/\d+", link, flags=re.IGNORECASE):
            continue
        body = msg["text"]
        if not body and not msg["images"]:
            continue
        title = body[:180].rsplit(" ", 1)[0] if len(body) > 180 else body
        if len(body) > 180:
            title += "…"
        result.append({
            "title": title or "Фото из канала «" + source_name + "»", "url": link, "source": source_name,
            "category": "Каналы", "date": msg["date"],
            "channel": channel,
            "content": body,
            "links": msg["links"],
            "images": msg["images"],
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
    if any(item.get('channel') and not item.get('content') for item in (a, b)):
        return False
    left, right = normalized_title(a), normalized_title(b)
    if not left or not right:
        return False
    if not within_days(a, b):
        return False
    if left == right:
        return len(left) >= 35
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

def public_url(url, publisher):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.")
    if (parts.scheme != "https" or not publisher or not host or
            not (host == publisher or host.endswith("." + publisher)) or
            parts.username or parts.password or parts.port not in (None, 443)):
        raise ValueError("Unexpected publisher URL")
    if not all(ipaddress.ip_address(entry[4][0]).is_global
               for entry in socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)):
        raise ValueError("Non-public publisher")
    return url


def fetch_article(item):
    from googlenewsdecoder import gnewsdecoder
    from trafilatura import extract
    from lxml import html

    publisher = (urllib.parse.urlsplit(item.get("publisher", "")).hostname or "").lower().removeprefix("www.")
    class PublisherRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return super().redirect_request(request, fp, code, msg, headers, public_url(newurl, publisher))

    opener = urllib.request.build_opener(PublisherRedirect())
    link = item.get("original_url") or item["url"]
    if urllib.parse.urlsplit(link).hostname == "news.google.com":
        if not re.fullmatch(r"https://news\.google\.com/rss/articles/[A-Za-z0-9_-]+(?:\?[^#]*)?", link):
            return {}
        decoded = gnewsdecoder(link, timeout=8)
        link = decoded.get("decoded_url")
        if not link:
            query = urllib.parse.urlencode({"search": item["title"], "per_page": 5, "subtype": "post"})
            search = public_url("https://" + publisher + "/wp-json/wp/v2/search?" + query, publisher)
            with opener.open(search, timeout=5) as response:
                matches = json.loads(response.read(100_000))
            link = next((match.get("url") for match in matches
                         if normalized_title({"title": match.get("title")}) == normalized_title(item)), None)
            if not link:
                return {}

    request = urllib.request.Request(public_url(link, publisher), headers={
        "User-Agent": "Mozilla/5.0 (compatible; EdPVZNews/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    })
    with opener.open(request, timeout=8) as response:
        if response.headers.get_content_type() not in ("text/html", "application/xhtml+xml"):
            return {}
        raw = response.read(2_000_001)
        final_url = response.geturl()
    if len(raw) > 2_000_000:
        return {}
    page = html.fromstring(raw)
    for image in page.xpath("//img"):
        lazy = image.get("data-src") or image.get("data-lazy-src") or image.get("data-original")
        if lazy:
            image.set("src", lazy)
    parsed = extract(html.tostring(page, encoding="unicode"), url=final_url,
                     output_format="xml", include_images=True, include_comments=False,
                     include_links=True, include_tables=True, include_formatting=True)
    if not parsed:
        return {}
    main = ET.fromstring(parsed).find("main")
    if main is None:
        return {}
    images = []
    for value in page.xpath('//meta[@property="og:image" or @property="og:image:secure_url"]/@content') + [
        node.get("src", "") for node in main.iter("graphic")
    ]:
        if value:
            image_url = urllib.parse.urljoin(final_url, value)
            if image_url.startswith("https://") and image_url not in images:
                images.append(image_url)
    paragraphs = []
    for node in main.iter():
        if node.tag not in ("p", "head", "item", "row", "quote"):
            continue
        if any(child.tag in ("p", "head", "item", "row", "quote") for child in list(node.iter())[1:]):
            continue
        text = re.sub(r"\s+", " ", " ".join(node.itertext()) if node.tag == "row" else "".join(node.itertext())).strip()
        if text and text != item["title"]:
            paragraphs.append(text)
    body = "\n\n".join(paragraphs)
    if len(body) < 120:
        return {"original_url": final_url, "images": images}
    return {"original_url": final_url, "content": body, "images": images}


def enrich_articles(items):
    candidates = sorted((item for item in items if item.get("publisher") and not item.get("content")),
                        key=lambda item: (not item.get("original_url"), item.get("article_checked_at", "")))[:60]
    if not candidates:
        return
    from concurrent.futures import ThreadPoolExecutor
    socket.setdefaulttimeout(8)
    def enrich(item):
        item["article_checked_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
        try:
            item.update({k: v for k, v in fetch_article(item).items() if v})
        except Exception as error:
            print("Article unavailable:", item["source"], type(error).__name__)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(enrich, candidates))


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
    if not items and old.get("items") and not any(item.get("publisher") and not item.get("content") for item in old["items"]):
        # Do not erase the last usable feed when all sources fail.
        old["errors"] = errors or ["Источники временно недоступны"]
        OUT.write_text(json.dumps(old, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    # A partial RSS outage must not remove recently collected articles.
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=7)
    if ARTICLE_BACKFILL["date"] >= cutoff.isoformat():
        items.append(ARTICLE_BACKFILL.copy())
    recent = [item for item in old.get("items", []) if isinstance(item, dict)
              and (item.get("date") or "") >= cutoff.isoformat()]
    # Keep previously collected readable text when a newer feed entry has only a headline.
    previous_by_url = {canonical_url(x): x for x in old.get("items", []) if isinstance(x, dict)}
    for item in items:
        previous = previous_by_url.get(canonical_url(item))
        if previous:
            for field in ("content", "links", "image", "images", "original_url", "article_checked_at"):
                if not item.get(field) and previous.get(field):
                    item[field] = previous[field]
    unique = deduplicate(items + recent)
    enrich_articles(unique[:MAX_ITEMS])
    data = {"updated": dt.datetime.now(dt.timezone.utc).isoformat(), "items": unique[:MAX_ITEMS], "errors": errors}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Saved", len(data["items"]), "items;", len(errors), "source errors")
if __name__ == "__main__":
    main()
