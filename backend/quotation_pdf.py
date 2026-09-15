from __future__ import annotations

import io
import re
import threading
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

try:
    from invoice_pdf import amount_in_indian_words
except ImportError:  # Supports package-style imports in tooling.
    from .invoice_pdf import amount_in_indian_words

ROOT = Path(__file__).resolve().parent
FONT_DIR = ROOT / "fonts"

IVORY = HexColor("#F8F6F0")
IVORY_DARK = HexColor("#EDE8DF")
CHARCOAL = HexColor("#141210")
TAUPE = HexColor("#766C63")
BRASS = HexColor("#C5A880")
OXBLOOD = HexColor("#58130E")
LINE = HexColor("#DCD5C8")
WHITE = colors.white

_FONT_FILES = {
    "Quotation-Display": "CormorantGaramond-Regular.ttf",
    "Quotation-Display-Medium": "CormorantGaramond-Medium.ttf",
    "Quotation-Display-Italic": "CormorantGaramond-Italic.ttf",
    "Quotation-Sans-Light": "PlusJakartaSans-Light.ttf",
    "Quotation-Sans": "PlusJakartaSans-Regular.ttf",
    "Quotation-Sans-Medium": "PlusJakartaSans-Medium.ttf",
}
_fonts_ready = False
_font_lock = threading.Lock()


class Wordmark(Flowable):
    def __init__(self, width: float = 175, height: float = 25) -> None:
        super().__init__()
        self.width = width
        self.height = height

    def draw(self) -> None:
        canvas = self.canv
        size = 12
        y = 7
        canvas.setFillColor(CHARCOAL)
        first = canvas.beginText(0, y)
        first.setFont("Quotation-Display-Medium", size)
        first.setCharSpace(2.8)
        first.textOut("SUVI")
        canvas.drawText(first)
        first_width = pdfmetrics.stringWidth("SUVI", "Quotation-Display-Medium", size) + 4 * 2.8
        diamond_x = first_width + 6
        canvas.setFillColor(BRASS)
        canvas.saveState()
        canvas.translate(diamond_x, y + 4)
        canvas.rotate(45)
        canvas.rect(-1.8, -1.8, 3.6, 3.6, fill=1, stroke=0)
        canvas.restoreState()
        canvas.setFillColor(CHARCOAL)
        second = canvas.beginText(diamond_x + 8, y)
        second.setFont("Quotation-Display-Medium", size)
        second.setCharSpace(2.2)
        second.textOut("INTERIOR")
        canvas.drawText(second)


def _register_fonts() -> None:
    global _fonts_ready
    if _fonts_ready:
        return
    with _font_lock:
        if _fonts_ready:
            return
        for name, filename in _FONT_FILES.items():
            path = FONT_DIR / filename
            if not path.is_file():
                raise RuntimeError(f"Bundled quotation font is missing: {filename}")
            pdfmetrics.registerFont(TTFont(name, str(path)))
        pdfmetrics.registerFontFamily(
            "Quotation-Sans",
            normal="Quotation-Sans",
            bold="Quotation-Sans-Medium",
            italic="Quotation-Sans-Light",
            boldItalic="Quotation-Sans-Medium",
        )
        pdfmetrics.registerFontFamily(
            "Quotation-Display",
            normal="Quotation-Display",
            bold="Quotation-Display-Medium",
            italic="Quotation-Display-Italic",
            boldItalic="Quotation-Display-Medium",
        )
        _fonts_ready = True


def _clean(value: object) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", text).strip()


def _markup(value: object) -> str:
    return escape(_clean(value)).replace("\n", "<br/>")


def _paragraph(value: object, style: ParagraphStyle) -> Paragraph:
    return Paragraph(_markup(value), style)


def _date_display(value: object) -> str:
    raw = _clean(value)
    if not raw:
        return "—"
    try:
        return date.fromisoformat(raw[:10]).strftime("%d %b %Y")
    except ValueError:
        return raw


def _decimal(value: object) -> Decimal:
    try:
        parsed = Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")
    return parsed if parsed.is_finite() else Decimal("0")


def _indian_number(value: object) -> str:
    amount = _decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    sign = "-" if amount < 0 else ""
    whole, fraction = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        tail = whole[-3:]
        leading = whole[:-3]
        groups = []
        while leading:
            groups.insert(0, leading[-2:])
            leading = leading[:-2]
        whole = ",".join(groups + [tail])
    return f"{sign}{whole}.{fraction}"


def _money(value: object) -> str:
    return f"INR {_indian_number(value)}"


def _address_lines(address: dict) -> list[str]:
    output = []
    for key in ("line1", "line2", "line3"):
        if _clean(address.get(key)):
            output.append(_clean(address[key]))
    locality = ", ".join(filter(None, [_clean(address.get("city")), _clean(address.get("state"))]))
    if _clean(address.get("pincode")):
        locality = f"{locality} {_clean(address['pincode'])}".strip()
    if locality:
        output.append(locality)
    country = _clean(address.get("country"))
    if country and country.casefold() != "india":
        output.append(country)
    return output


def _party_markup(party: dict, *, supplier: bool = False) -> str:
    legal_name = _clean(party.get("legal_name"))
    display_name = _clean(party.get("trade_name") if supplier else party.get("display_name"))
    fallback_name = _clean(party.get("display_name"))
    primary = legal_name or display_name or fallback_name or "—"
    lines = [f"<b>{_markup(primary)}</b>"]
    secondary = display_name or fallback_name
    if secondary and secondary.casefold() != primary.casefold():
        lines.append(_markup(secondary))
    lines.extend(_markup(line) for line in _address_lines(party.get("address") or party.get("billing_address") or {}))
    if _clean(party.get("gstin")):
        lines.append(f"GSTIN: {_markup(party['gstin'])}")
    if _clean(party.get("pan")):
        lines.append(f"PAN: {_markup(party['pan'])}")
    if _clean(party.get("contact_person")):
        lines.append(f"Contact: {_markup(party['contact_person'])}")
    contacts = " · ".join(filter(None, [_clean(party.get("phone")), _clean(party.get("email"))]))
    if contacts:
        lines.append(_markup(contacts))
    return "<br/>".join(lines)


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "QuotationBody",
            parent=base["BodyText"],
            fontName="Quotation-Sans",
            fontSize=8,
            leading=11,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "long_body": ParagraphStyle(
            "QuotationLongBody",
            parent=base["BodyText"],
            fontName="Quotation-Sans",
            fontSize=8,
            leading=11,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "small": ParagraphStyle(
            "QuotationSmall",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Light",
            fontSize=7,
            leading=9.5,
            textColor=TAUPE,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "micro": ParagraphStyle(
            "QuotationMicro",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Medium",
            fontSize=6.1,
            leading=7.8,
            textColor=TAUPE,
            splitLongWords=1,
            spaceAfter=1.2,
        ),
        "value": ParagraphStyle(
            "QuotationValue",
            parent=base["BodyText"],
            fontName="Quotation-Sans",
            fontSize=7.5,
            leading=10,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "title": ParagraphStyle(
            "QuotationTitle",
            parent=base["Heading1"],
            fontName="Quotation-Display-Medium",
            fontSize=20,
            leading=21,
            alignment=TA_RIGHT,
            textColor=OXBLOOD,
            spaceAfter=0,
        ),
        "subtitle": ParagraphStyle(
            "QuotationSubtitle",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Medium",
            fontSize=6.5,
            leading=8.5,
            alignment=TA_RIGHT,
            textColor=TAUPE,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "section": ParagraphStyle(
            "QuotationSection",
            parent=base["Heading2"],
            fontName="Quotation-Sans-Medium",
            fontSize=7.4,
            leading=9.6,
            textColor=OXBLOOD,
            keepWithNext=1,
            spaceAfter=4,
        ),
        "table_header": ParagraphStyle(
            "QuotationTableHeader",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Medium",
            fontSize=6.2,
            leading=7.8,
            textColor=WHITE,
            alignment=TA_LEFT,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "table": ParagraphStyle(
            "QuotationTable",
            parent=base["BodyText"],
            fontName="Quotation-Sans",
            fontSize=7.1,
            leading=9.4,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "table_right": ParagraphStyle(
            "QuotationTableRight",
            parent=base["BodyText"],
            fontName="Quotation-Sans",
            fontSize=7,
            leading=9.3,
            textColor=CHARCOAL,
            alignment=TA_RIGHT,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "total": ParagraphStyle(
            "QuotationTotal",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Medium",
            fontSize=9,
            leading=11.5,
            textColor=OXBLOOD,
            alignment=TA_RIGHT,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "words": ParagraphStyle(
            "QuotationWords",
            parent=base["BodyText"],
            fontName="Quotation-Display-Italic",
            fontSize=8.6,
            leading=11.5,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "signature": ParagraphStyle(
            "QuotationSignature",
            parent=base["BodyText"],
            fontName="Quotation-Display-Italic",
            fontSize=9,
            leading=11,
            textColor=CHARCOAL,
            alignment=TA_CENTER,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "signature_caption": ParagraphStyle(
            "QuotationSignatureCaption",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Light",
            fontSize=6.8,
            leading=9.3,
            textColor=TAUPE,
            alignment=TA_CENTER,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "disclaimer": ParagraphStyle(
            "QuotationDisclaimer",
            parent=base["BodyText"],
            fontName="Quotation-Sans-Medium",
            fontSize=7,
            leading=9.5,
            textColor=OXBLOOD,
            alignment=TA_CENTER,
            splitLongWords=1,
            spaceAfter=0,
        ),
    }


def _label_value(label: str, value: object, styles: dict[str, ParagraphStyle]) -> list[Paragraph]:
    return [Paragraph(_markup(label.upper()), styles["micro"]), _paragraph(value or "—", styles["value"])]


def _page_decorator(canvas, doc, identifier: str, status: str) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setTitle(f"Suvi Interior Quotation {identifier}")
    canvas.setAuthor("Suvi Interior")
    canvas.setSubject("Private customer quotation")

    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(doc.leftMargin, 13 * mm, width - doc.rightMargin, 13 * mm)
    canvas.setFont("Quotation-Sans-Light", 5.8)
    canvas.setFillColor(TAUPE)
    canvas.drawString(doc.leftMargin, 8.5 * mm, "PRIVATE QUOTATION · NOT A TAX INVOICE")
    canvas.drawRightString(width - doc.rightMargin, 8.5 * mm, f"{identifier} · PAGE {doc.page}")

    if doc.page > 1:
        canvas.setFont("Quotation-Sans-Medium", 6.2)
        canvas.setFillColor(CHARCOAL)
        canvas.drawString(doc.leftMargin, height - (8.7 * mm), "SUVI INTERIOR")
        canvas.setFillColor(TAUPE)
        canvas.drawRightString(
            width - doc.rightMargin,
            height - (8.7 * mm),
            f"{identifier} · {status.upper()}",
        )
        canvas.setStrokeColor(BRASS)
        canvas.line(doc.leftMargin, height - (11.5 * mm), width - doc.rightMargin, height - (11.5 * mm))
    elif status == "draft":
        badge_label = "DRAFT · NOT SENT"
        canvas.setFont("Quotation-Sans-Medium", 6.2)
        badge_width = pdfmetrics.stringWidth(badge_label, "Quotation-Sans-Medium", 6.2) + (6 * mm)
        badge_height = 5.5 * mm
        badge_x = width - doc.rightMargin - badge_width
        badge_y = height - (10.5 * mm)
        canvas.setFillColor(HexColor("#F5EAE5"))
        canvas.setStrokeColor(BRASS)
        canvas.roundRect(badge_x, badge_y, badge_width, badge_height, 2.75 * mm, fill=1, stroke=1)
        canvas.setFillColor(OXBLOOD)
        canvas.drawCentredString(badge_x + (badge_width / 2), badge_y + 1.85 * mm, badge_label)

    canvas.restoreState()


def render_quotation_pdf(quotation: dict) -> bytes:
    """Render only the persisted quotation snapshot; no live settings or calculation is consulted."""
    _register_fonts()
    styles = _styles()
    status = _clean(quotation.get("status")).casefold() or "draft"
    is_draft = status == "draft"
    number = _clean(quotation.get("quotation_number"))
    draft_reference = _clean(quotation.get("id"))[-6:].upper()
    if number:
        identifier = number
    elif is_draft:
        identifier = f"DRAFT · {draft_reference}" if draft_reference else "DRAFT"
    else:
        identifier = f"NUMBER PENDING · {draft_reference}" if draft_reference else "NUMBER PENDING"
    display_number = number or "NUMBER PENDING"
    title = "QUOTATION DRAFT" if is_draft else "QUOTATION"
    subtitle = f"{display_number} · NOT SENT" if is_draft else f"{display_number} · {status.upper()}"

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=13 * mm,
        rightMargin=13 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=f"Suvi Interior Quotation {identifier}",
        author="Suvi Interior",
        subject="Private customer quotation",
    )
    available_width = A4[0] - doc.leftMargin - doc.rightMargin
    story = []

    heading = Table(
        [
            [
                Wordmark(),
                [
                    Paragraph(_markup(title), styles["title"]),
                    Paragraph(_markup(subtitle), styles["subtitle"]),
                ],
            ]
        ],
        colWidths=[available_width * 0.51, available_width * 0.49],
    )
    heading.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, -1), 0.8, BRASS),
            ]
        )
    )
    story.extend([heading, Spacer(1, 6)])

    supplier = quotation.get("supplier_snapshot") or {}
    customer = quotation.get("customer_snapshot") or {}
    parties = Table(
        [
            [Paragraph("FROM", styles["section"]), Paragraph("QUOTATION FOR", styles["section"])],
            [
                Paragraph(_party_markup(supplier, supplier=True), styles["body"]),
                Paragraph(_party_markup(customer), styles["body"]),
            ],
        ],
        colWidths=[available_width / 2, available_width / 2],
    )
    parties.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), IVORY_DARK),
                ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(parties)

    if customer.get("shipping_same_as_billing") is False:
        shipping = customer.get("shipping_address") or {}
        delivery_name = _clean(customer.get("legal_name") or customer.get("display_name")) or "—"
        delivery_lines = [f"<b>{_markup(delivery_name)}</b>"]
        address_lines = _address_lines(shipping)
        delivery_lines.extend(_markup(line) for line in address_lines)
        if not address_lines:
            delivery_lines.append("—")
        delivery = Table(
            [
                [Paragraph("PROPOSED DELIVERY / SERVICE ADDRESS", styles["section"])],
                [Paragraph("<br/>".join(delivery_lines), styles["body"])],
            ],
            colWidths=[available_width],
        )
        delivery.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), IVORY_DARK),
                    ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.extend([Spacer(1, 5), delivery])
    story.append(Spacer(1, 7))

    place = quotation.get("place_of_supply") or {}
    details = [
        _label_value("Quotation number", display_number, styles),
        _label_value("Quotation date", _date_display(quotation.get("quotation_date")), styles),
        _label_value("Valid until", _date_display(quotation.get("valid_until")), styles),
        _label_value("Status", status.replace("_", " ").title(), styles),
        _label_value(
            "Place of supply",
            f"{_clean(place.get('state'))} ({_clean(place.get('state_code'))})".strip(),
            styles,
        ),
        _label_value("Reverse charge", "Yes" if quotation.get("reverse_charge") else "No", styles),
        _label_value("Project reference", quotation.get("project_reference") or "—", styles),
        _label_value("PO reference", quotation.get("po_reference") or "—", styles),
    ]
    detail_table = Table([details[:4], details[4:]], colWidths=[available_width / 4] * 4)
    detail_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
                ("BACKGROUND", (0, 0), (-1, -1), IVORY),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([detail_table, Spacer(1, 8)])

    headers = ["#", "ITEM / SCOPE", "QTY / UNIT", "PRICING", "TAX / DISCOUNT", "LINE TOTAL"]
    rows = [[Paragraph(header, styles["table_header"]) for header in headers]]
    for index, line in enumerate(quotation.get("lines") or [], start=1):
        description_parts = [f"<b>{_markup(line.get('name') or f'Line {index}')}</b>"]
        if _clean(line.get("description")):
            description_parts.append(f"<font color='#766C63'>{_markup(line.get('description'))}</font>")
        item_meta = []
        if _clean(line.get("item_type")):
            item_meta.append(_clean(line.get("item_type")).replace("_", " ").title())
        if _clean(line.get("hsn_sac")):
            item_meta.append(f"HSN/SAC: {_clean(line.get('hsn_sac'))}")
        if item_meta:
            description_parts.append(
                f"<font name='Quotation-Sans-Medium' size='6.2' color='#766C63'>{_markup(' · '.join(item_meta))}</font>"
            )

        quantity = (
            f"<b>{_markup(line.get('quantity') or '0')}</b>"
            f"<br/><font color='#766C63'>{_markup(line.get('unit') or '—')}</font>"
        )
        pricing = (
            f"<b>{_markup(_money(line.get('unit_rate_display')))}</b>"
            f"<br/><font color='#766C63'>Gross {_markup(_money(line.get('gross_display')))}</font>"
        )
        discount_suffix = ""
        if line.get("discount_type") == "percent":
            discount_suffix = f" ({_markup(line.get('discount_value') or '0')}%)"
        tax_detail = (
            f"Discount {_markup(_money(line.get('discount_display')))}{discount_suffix}"
            f"<br/>Taxable {_markup(_money(line.get('taxable_display')))}"
            f"<br/><font color='#766C63'>GST {_markup(line.get('gst_rate') or '0')}% · {_markup(_money(line.get('tax_display')))}</font>"
        )
        rows.append(
            [
                Paragraph(str(index), styles["table"]),
                Paragraph("<br/>".join(description_parts), styles["table"]),
                Paragraph(quantity, styles["table_right"]),
                Paragraph(pricing, styles["table_right"]),
                Paragraph(tax_detail, styles["table_right"]),
                Paragraph(f"<b>{_markup(_money(line.get('line_total_display')))}</b>", styles["table_right"]),
            ]
        )
    line_widths = [18, 190, 54, 82, 100, available_width - 444]
    line_table = Table(
        rows,
        colWidths=line_widths,
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
        splitInRow=1,
    )
    line_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), OXBLOOD),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, IVORY]),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, 0), 5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
                ("TOPPADDING", (0, 1), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ]
        )
    )
    story.extend([line_table, Spacer(1, 9)])

    totals = quotation.get("totals") or {}
    total_rows = [["Subtotal", _money(totals.get("subtotal_display"))]]
    if int(totals.get("discount_paise", 0) or 0):
        total_rows.append(["Less: discount", _money(totals.get("discount_display"))])
    total_rows.append(["Taxable value", _money(totals.get("taxable_display"))])
    if quotation.get("tax_regime") == "intra_state" or int(totals.get("cgst_paise", 0) or 0):
        total_rows.extend(
            [
                ["CGST", _money(totals.get("cgst_display"))],
                ["SGST", _money(totals.get("sgst_display"))],
            ]
        )
    if quotation.get("tax_regime") == "inter_state" or int(totals.get("igst_paise", 0) or 0):
        total_rows.append(["IGST", _money(totals.get("igst_display"))])
    if _clean(quotation.get("post_tax_adjustment_label")) or int(totals.get("post_tax_adjustment_paise", 0) or 0):
        total_rows.append(
            [
                _clean(quotation.get("post_tax_adjustment_label")) or "Post-tax adjustment",
                _money(totals.get("post_tax_adjustment_display")),
            ]
        )
    if int(totals.get("round_off_paise", 0) or 0):
        total_rows.append(["Round off", _money(totals.get("round_off_display"))])
    total_rows.append(["QUOTED TOTAL", _money(totals.get("grand_total_display"))])
    formatted_totals = []
    for row_index, (label, value) in enumerate(total_rows):
        is_grand = row_index == len(total_rows) - 1
        formatted_totals.append(
            [
                _paragraph(label, styles["section"] if is_grand else styles["body"]),
                _paragraph(value, styles["total"] if is_grand else styles["table_right"]),
            ]
        )
    totals_table = Table(formatted_totals, colWidths=[110, 125], hAlign="RIGHT")
    totals_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEBELOW", (0, 0), (-1, -2), 0.3, LINE),
                ("BACKGROUND", (0, -1), (-1, -1), IVORY_DARK),
                ("BOX", (0, -1), (-1, -1), 0.65, BRASS),
            ]
        )
    )
    story.append(
        KeepTogether(
            [
                totals_table,
                Spacer(1, 7),
                Paragraph("AMOUNT IN WORDS", styles["section"]),
                Paragraph(_markup(amount_in_indian_words(totals.get("grand_total_display"))), styles["words"]),
                Spacer(1, 8),
            ]
        )
    )

    for label, field in (("NOTES", "notes"), ("TERMS", "terms")):
        if _clean(quotation.get(field)):
            story.extend(
                [
                    Paragraph(label, styles["section"]),
                    _paragraph(quotation[field], styles["long_body"]),
                    Spacer(1, 7),
                ]
            )

    state_copy = {
        "draft": "This unnumbered draft quotation is provided for review and has not been sent.",
        "sent": "This quotation is valid only through the date shown and is subject to the stated scope and terms.",
        "accepted": "This quotation snapshot records the accepted scope, pricing, and terms.",
        "declined": "This quotation was declined and is no longer an active offer.",
        "expired": "This quotation has expired and is no longer an active offer.",
        "converted": "This quotation was converted to an invoice draft; it remains a quotation record only.",
    }.get(status, "This document is a stored quotation record.")
    disclaimer = Table(
        [
            [
                Paragraph(
                    f"THIS IS NOT A TAX INVOICE. {state_copy}",
                    styles["disclaimer"],
                )
            ]
        ],
        colWidths=[available_width],
    )
    disclaimer.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), IVORY_DARK),
                ("BOX", (0, 0), (-1, -1), 0.55, BRASS),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    signature_text = _clean(supplier.get("signature"))
    signatory_caption = _clean(supplier.get("authorised_signatory")) or "Authorised signatory"
    signature_area: Flowable = Spacer(1, 26)
    if signature_text:
        signature_area = Paragraph(_markup(signature_text), styles["signature"])
    signature = Table(
        [
            ["", Paragraph(_markup(f"For {_clean(supplier.get('trade_name') or supplier.get('display_name') or 'Suvi Interior')}"), styles["body"])],
            ["", signature_area],
            ["", Paragraph(_markup(signatory_caption), styles["signature_caption"])],
        ],
        colWidths=[available_width - 180, 180],
    )
    signature.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "CENTER"),
                ("LINEABOVE", (1, 2), (1, 2), 0.45, CHARCOAL),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story.append(KeepTogether([disclaimer, Spacer(1, 10), signature]))

    decorator = lambda canvas, built_doc: _page_decorator(canvas, built_doc, identifier, status)
    doc.build(story, onFirstPage=decorator, onLaterPages=decorator)
    return buffer.getvalue()
