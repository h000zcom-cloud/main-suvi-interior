import io
import hashlib
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import httpx
from PIL import Image
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

from brochure_content import CONTENT

ROOT = Path(__file__).parent
FONT_DIR = ROOT / "fonts"

# Images committed alongside the source. Always readable, including on hosts that
# mount the application code read-only.
BUNDLED_CACHE_DIR = ROOT / "cache"


def _writable_cache_dir() -> Path:
    """Return a directory that newly downloaded images can be written to.

    Serverless and container hosts often mount the application directory read-only,
    where only a temporary directory is writable. Prefer the bundled cache so repeat
    runs stay warm, and fall back to a temporary directory when it is not writable.
    """
    try:
        BUNDLED_CACHE_DIR.mkdir(exist_ok=True)
        probe = BUNDLED_CACHE_DIR / ".write-probe"
        probe.write_bytes(b"")
        probe.unlink()
        return BUNDLED_CACHE_DIR
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "suvi-brochure-cache"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


CACHE_DIR = _writable_cache_dir()

W, H = A4
M = 42

IVORY = HexColor("#F8F6F0")
IVORY_2 = HexColor("#EDE8DF")
CHARCOAL = HexColor("#141210")
TAUPE = HexColor("#766C63")
BRASS = HexColor("#C5A880")
BRONZE = HexColor("#58130E")
OXBLOOD = HexColor("#58130E")
OXBLOOD_LIGHT = HexColor("#7A2A22")
LINE = HexColor("#DCD5C8")
NIGHT_LINE = HexColor("#2B2622")

FONTS = {
    "Display-Light": "CormorantGaramond-Light.ttf",
    "Display": "CormorantGaramond-Regular.ttf",
    "Display-Medium": "CormorantGaramond-Medium.ttf",
    "Display-Italic": "CormorantGaramond-Italic.ttf",
    "Sans-Light": "PlusJakartaSans-Light.ttf",
    "Sans": "PlusJakartaSans-Regular.ttf",
    "Sans-Medium": "PlusJakartaSans-Medium.ttf",
}

_fonts_ready = False


def register_fonts():
    global _fonts_ready
    if _fonts_ready:
        return
    for name, file in FONTS.items():
        pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / file)))
    _fonts_ready = True


def fetch_image(url: str) -> Image.Image:
    name = f"{hashlib.sha1(url.encode()).hexdigest()}.jpg"
    bundled = BUNDLED_CACHE_DIR / name
    if bundled.is_file():
        return Image.open(bundled).convert("RGB")
    path = CACHE_DIR / name
    if not path.exists():
        r = httpx.get(url, timeout=30, follow_redirects=True)
        r.raise_for_status()
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
        im.thumbnail((1600, 1600))
        im.save(path, "JPEG", quality=86)
    return Image.open(path).convert("RGB")


def draw_cover_image(c, url, x, y, w, h):
    im = fetch_image(url)
    iw, ih = im.size
    target = w / h
    if iw / ih > target:
        nw = int(ih * target)
        left = (iw - nw) // 2
        im = im.crop((left, 0, left + nw, ih))
    else:
        nh = int(iw / target)
        top = (ih - nh) // 2
        im = im.crop((0, top, iw, top + nh))
    im.thumbnail((1400, 1400))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    buf.seek(0)
    c.drawImage(ImageReader(buf), x, y, w, h, mask=None)


def style(font, size, color, leading=None, align=0, tracking=0):
    return ParagraphStyle(
        name=f"{font}-{size}-{align}",
        fontName=font,
        fontSize=size,
        leading=leading or size * 1.45,
        textColor=color,
        alignment=align,
    )


def para(c, text, x, top, w, st, max_h=2000):
    p = Paragraph(text, st)
    _, ph = p.wrap(w, max_h)
    p.drawOn(c, x, top - ph)
    return ph


def label(c, text, x, y, color=TAUPE, size=7.2, char_space=1.6, font="Sans-Medium"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, text.upper(), charSpace=char_space)


def label_right(c, text, right, y, color=TAUPE, size=7.2, char_space=1.6):
    c.setFont("Sans-Medium", size)
    tw = pdfmetrics.stringWidth(text.upper(), "Sans-Medium", size) + char_space * len(text)
    label(c, text, right - tw, y, color, size, char_space)


def rule(c, x1, y, x2, color=LINE, width=0.5):
    c.setStrokeColor(color)
    c.setLineWidth(width)
    c.line(x1, y, x2, y)


def wordmark(c, x, y, color=CHARCOAL, size=11):
    c.setFillColor(color)
    c.setFont("Display-Medium", size)
    c.drawString(x, y, "SUVI", charSpace=size * 0.28)
    w1 = pdfmetrics.stringWidth("SUVI", "Display-Medium", size) + size * 0.28 * 4
    dot = size * 0.22
    c.setFillColor(BRASS)
    c.saveState()
    c.translate(x + w1 + size * 0.15, y + size * 0.3)
    c.rotate(45)
    c.rect(-dot / 2, -dot / 2, dot, dot, fill=1, stroke=0)
    c.restoreState()
    c.setFillColor(color)
    c.setFont("Display-Medium", size)
    c.drawString(x + w1 + size * 0.6, y, "INTERIOR", charSpace=size * 0.28)


def page_frame(c, page_no, dark=False):
    fg = IVORY if dark else CHARCOAL
    muted = HexColor("#D9BFB9") if dark else TAUPE
    wordmark(c, M, H - M + 6, fg, 9)
    label_right(c, CONTENT["site"]["descriptor"], W - M, H - M + 8, muted, 6.4)
    rule(c, M, M - 10, W - M, HexColor("#7A2A22") if dark else LINE)
    label(c, f"{CONTENT['site']['city']} · {CONTENT['site']['region']}", M, M - 22, muted, 6.4)
    label_right(c, f"{page_no:02d}", W - M, M - 22, muted, 6.4)


def cover(c):
    site = CONTENT["site"]
    c.setFillColor(OXBLOOD)
    c.rect(0, 0, W, H, fill=1, stroke=0)

    px, py, pw, ph = M, H * 0.36, W - 2 * M, H * 0.64 - M - 26
    draw_cover_image(c, CONTENT["images"]["cover"], px, py, pw, ph)
    c.setFillColor(OXBLOOD)
    c.setFillAlpha(0.18)
    c.rect(px, py, pw, ph, fill=1, stroke=0)
    c.setFillAlpha(1)

    c.setStrokeColor(IVORY)
    c.setStrokeAlpha(0.35)
    c.setLineWidth(0.5)
    c.rect(M * 0.55, M * 0.55, W - M * 1.1, H - M * 1.1, fill=0, stroke=1)
    c.setStrokeAlpha(1)

    wordmark(c, M, H - M - 8, IVORY, 14)
    label_right(c, f"Studio Brochure · {datetime.now(timezone.utc).year}", W - M, H - M - 6, HexColor("#E9D9D5"), 6.8)

    ty = py - 34
    c.setFillColor(BRASS)
    c.rect(M, ty + 2, 28, 0.6, fill=1, stroke=0)
    label(c, f"{site['city']} · {site['region']}", M + 38, ty, HexColor("#E9D9D5"), 7)

    c.setFillColor(IVORY)
    c.setFont("Display-Light", 50)
    c.drawString(M - 2, ty - 58, "Interiors that feel like")
    c.setFont("Display-Italic", 50)
    c.drawString(M - 2, ty - 110, "home.")

    para(c, site["positioning"], M, ty - 130, 270, style("Sans-Light", 8.4, HexColor("#E9D9D5"), 13.2))

    rule(c, M, M + 40, W - M, IVORY, 0.4)
    label(c, site["descriptor"], M, M + 26, HexColor("#E9D9D5"), 6.6)
    label_right(c, site["phone"], W - M, M + 26, BRASS, 7.2)
    c.showPage()


def studio_page(c, n):
    s = CONTENT["studio"]
    c.setFillColor(IVORY)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    page_frame(c, n)

    top = H - M - 54
    c.setFillColor(BRONZE)
    label(c, "01", M, top, BRONZE)
    label(c, "The Studio", M + 20, top)
    c.setFillColor(CHARCOAL)
    c.setFont("Display-Light", 36)
    c.drawString(M - 1, top - 48, "Designing spaces")
    c.drawString(M - 1, top - 86, "that feel like")
    c.setFont("Display-Italic", 36)
    c.drawString(M - 1, top - 124, "you.")

    col_w = 232
    y = top - 160
    for ptxt in s["body"]:
        y -= para(c, ptxt, M, y, col_w, style("Sans-Light", 8.8, CHARCOAL, 14.2)) + 10

    y -= 8
    rule(c, M, y, M + col_w)
    y -= 20
    label(c, "What we believe", M, y)
    y -= 12
    for p in CONTENT["principles"]:
        rule(c, M, y, M + col_w)
        y -= 18
        label(c, p["n"], M, y, BRONZE, 6.6)
        c.setFillColor(CHARCOAL)
        c.setFont("Display", 15)
        c.drawString(M + 22, y - 1, p["title"])
        y -= 14
        y -= para(c, p["text"], M + 22, y, col_w - 22, style("Sans-Light", 7.8, TAUPE, 11.5)) + 12

    ix = M + col_w + 30
    iw = W - M - ix
    ih = iw * 1.3
    draw_cover_image(c, CONTENT["images"]["studio"], ix, H - M - 54 - ih + 6, iw, ih)
    label(c, "Bedroom · walnut slat wall", ix, H - M - 54 - ih - 10, TAUPE, 6.2)
    label_right(c, "Representative", W - M, H - M - 54 - ih - 10, BRASS, 6.2)

    small_h = 118
    draw_cover_image(c, CONTENT["images"]["detail"], ix, M + 8, iw, small_h)
    c.showPage()


def services_page(c, n, items, index_label, heading):
    c.setFillColor(IVORY)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    page_frame(c, n)
    top = H - M - 54
    label(c, index_label, M, top, BRONZE)
    label(c, "Capabilities", M + 20, top)
    c.setFillColor(CHARCOAL)
    c.setFont("Display-Light", 30)
    c.drawString(M - 1, top - 40, heading)

    row_top = top - 72
    row_h = (row_top - M - 6) / len(items)
    img_w = 178
    for i, s in enumerate(items):
        y0 = row_top - (i + 1) * row_h
        rule(c, M, y0 + row_h, W - M)
        pad = 12
        ih = row_h - pad * 2
        draw_cover_image(c, s["image"], M, y0 + pad, img_w, ih)
        tx = M + img_w + 22
        tw = W - M - tx
        ty = y0 + row_h - pad - 4
        label(c, s["number"], tx, ty, BRONZE, 6.6)
        c.setFillColor(CHARCOAL)
        c.setFont("Display", 21)
        c.drawString(tx, ty - 26, s["title"])
        ty -= 44
        ty -= para(c, s["description"], tx, ty, tw, style("Sans-Light", 8.2, CHARCOAL, 12.8)) + 10
        label(c, "Includes", tx, ty, TAUPE, 6.2)
        ty -= 12
        for f in s["features"]:
            c.setFillColor(BRASS)
            c.rect(tx, ty + 2.4, 3, 0.5, fill=1, stroke=0)
            c.setFillColor(CHARCOAL)
            c.setFont("Sans-Light", 7.8)
            c.drawString(tx + 9, ty, f)
            ty -= 11.5
        label(c, "Ideal for  " + "  ·  ".join(s["ideal_for"]), tx, y0 + pad + 2, TAUPE, 6.2, 1.1)
    c.showPage()


def process_page(c, n):
    c.setFillColor(OXBLOOD)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    page_frame(c, n, dark=True)
    top = H - M - 54
    label(c, "04", M, top, BRASS)
    label(c, "Process", M + 20, top, HexColor("#D9BFB9"))
    c.setFillColor(IVORY)
    c.setFont("Display-Light", 40)
    c.drawString(M - 1, top - 50, "From first conversation")
    c.drawString(M - 1, top - 92, "to a finished ")
    tw = pdfmetrics.stringWidth("to a finished ", "Display-Light", 40)
    c.setFont("Display-Italic", 40)
    c.drawString(M - 1 + tw, top - 92, "home.")

    para(c, CONTENT["process_intro"], M, top - 124, 300, style("Sans-Light", 8.8, HexColor("#E9D9D5"), 14))

    steps = CONTENT["process"]
    gy = top - 190
    col_w = (W - 2 * M - 4 * 14) / 5
    for i, s in enumerate(steps):
        x = M + i * (col_w + 14)
        rule(c, x, gy, x + col_w, BRASS if i == len(steps) - 1 else HexColor("#7A2A22"), 0.6)
        label(c, s["n"], x, gy - 16, BRASS if i == len(steps) - 1 else HexColor("#D9BFB9"), 6.6)
        c.setFillColor(IVORY)
        c.setFont("Display", 19)
        c.drawString(x, gy - 50, s["title"])
        para(c, s["text"], x, gy - 62, col_w, style("Sans-Light", 7.4, HexColor("#E9D9D5"), 11.2))

    iy = M + 8
    ih = gy - 150 - iy
    draw_cover_image(c, CONTENT["images"]["process"], M, iy, W - 2 * M, ih)
    c.setFillColor(OXBLOOD)
    c.setFillAlpha(0.3)
    c.rect(M, iy, W - 2 * M, ih, fill=1, stroke=0)
    c.setFillAlpha(1)
    c.setFillColor(IVORY)
    c.setFont("Display-Italic", 26)
    c.drawString(M + 24, iy + 42, "Design. Craft. Detail.")
    label(c, "One studio · one point of contact", M + 24, iy + 20, HexColor("#D8D2C6"), 6.4)
    c.showPage()


def materials_page(c, n):
    c.setFillColor(IVORY_2)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    page_frame(c, n)
    top = H - M - 54
    label(c, "05", M, top, BRONZE)
    label(c, "Materials & Craft", M + 20, top)
    c.setFillColor(CHARCOAL)
    c.setFont("Display-Light", 36)
    c.drawString(M - 1, top - 46, "Made to be ")
    tw = pdfmetrics.stringWidth("Made to be ", "Display-Light", 36)
    c.setFont("Display-Italic", 36)
    c.drawString(M - 1 + tw, top - 46, "touched.")
    para(c, CONTENT["materials_intro"], W - M - 220, top - 8, 220, style("Sans-Light", 8.2, TAUPE, 12.8))

    grid_top = top - 80
    gap = 14
    cw = (W - 2 * M - 2 * gap) / 3
    ch = (grid_top - M - 8 - gap - 36) / 2
    for i, m in enumerate(CONTENT["materials"]):
        col, row = i % 3, i // 3
        x = M + col * (cw + gap)
        y = grid_top - (row + 1) * ch - row * gap - row * 18
        draw_cover_image(c, m["image"], x, y + 18, cw, ch - 18)
        c.setFillColor(CHARCOAL)
        c.setFont("Display", 13)
        c.drawString(x, y + 4, m["title"])
        label_right(c, m["note"], x + cw, y + 5, TAUPE, 5.8, 1.0)
    c.showPage()


def contact_page(c, n):
    site = CONTENT["site"]
    c.setFillColor(IVORY)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    page_frame(c, n)
    top = H - M - 54

    img_h = 250
    draw_cover_image(c, CONTENT["images"]["contact"], M, top - img_h, W - 2 * M, img_h)

    y = top - img_h - 40
    label(c, "06", M, y, BRONZE)
    label(c, "The Studio", M + 20, y)
    c.setFillColor(CHARCOAL)
    c.setFont("Display-Light", 40)
    c.drawString(M - 1, y - 50, "Visit us in ")
    tw = pdfmetrics.stringWidth("Visit us in ", "Display-Light", 40)
    c.setFont("Display-Italic", 40)
    c.drawString(M - 1 + tw, y - 50, "Nashik.")

    cy = y - 90
    rule(c, M, cy, W - M)
    col_w = (W - 2 * M) / 2 - 20

    label(c, "Studio address", M, cy - 18)
    ay = cy - 36
    for line in site["address"]:
        c.setFillColor(CHARCOAL)
        c.setFont("Sans-Light", 8.8)
        c.drawString(M, ay, line)
        ay -= 13.5

    label(c, "Enquiries", M, ay - 14)
    c.setFillColor(CHARCOAL)
    c.setFont("Display", 26)
    c.drawString(M, ay - 46, site["phone"])
    label(c, "Call or WhatsApp", M, ay - 60, TAUPE, 6.4)

    rx = M + col_w + 40
    label(c, "Scan to WhatsApp", rx, cy - 18)
    qsize = 92
    qw = qr.QrCodeWidget(site["whatsapp_url"])
    qw.barFillColor = CHARCOAL
    qw.barBorder = 0
    b = qw.getBounds()
    d = Drawing(qsize, qsize, transform=[qsize / (b[2] - b[0]), 0, 0, qsize / (b[3] - b[1]), 0, 0])
    d.add(qw)
    renderPDF.draw(d, c, rx, cy - 36 - qsize)
    para(c, "Scan with your phone camera to start a WhatsApp conversation with the studio.", rx + qsize + 14, cy - 38, W - M - rx - qsize - 14, style("Sans-Light", 7.8, TAUPE, 11.5))

    if site["website"]:
        label(c, "Website", rx, cy - 36 - qsize - 22)
        para(c, site["website"].replace("https://", ""), rx, cy - 36 - qsize - 28, W - M - rx, style("Sans-Light", 7.6, CHARCOAL, 11))

    rule(c, M, M + 40, W - M)
    para(c, CONTENT["imagery_notice"], M, M + 32, W - 2 * M, style("Sans-Light", 6.6, TAUPE, 9.8))
    c.showPage()


def build_pdf() -> bytes:
    register_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Suvi Interior — Studio Brochure")
    c.setAuthor("Suvi Interior")
    c.setSubject("Interior design, modular kitchens and custom furniture — Nashik")

    cover(c)
    studio_page(c, 2)
    services = CONTENT["services"]
    services_page(c, 3, services[:3], "02", "What we design & make")
    services_page(c, 4, services[3:], "03", "Furniture made to measure")
    process_page(c, 5)
    materials_page(c, 6)
    contact_page(c, 7)
    c.save()
    return buf.getvalue()
