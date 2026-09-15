from __future__ import annotations

import io
import re
import threading
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
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

ROOT = Path(__file__).resolve().parent
FONT_DIR = ROOT / "fonts"

IVORY = HexColor("#F8F6F0")
IVORY_2 = HexColor("#EDE8DF")
CHARCOAL = HexColor("#141210")
TAUPE = HexColor("#766C63")
BRASS = HexColor("#C5A880")
OXBLOOD = HexColor("#58130E")
LINE = HexColor("#DCD5C8")
SUCCESS = HexColor("#24634C")
SUCCESS_PALE = HexColor("#E8F3ED")
SUCCESS_LINE = HexColor("#92BEA9")
WHITE = colors.white

_FONT_FILES = {
    "Invoice-Display": "CormorantGaramond-Regular.ttf",
    "Invoice-Display-Medium": "CormorantGaramond-Medium.ttf",
    "Invoice-Display-Italic": "CormorantGaramond-Italic.ttf",
    "Invoice-Sans-Light": "PlusJakartaSans-Light.ttf",
    "Invoice-Sans": "PlusJakartaSans-Regular.ttf",
    "Invoice-Sans-Medium": "PlusJakartaSans-Medium.ttf",
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
        text = canvas.beginText(0, y)
        text.setFont("Invoice-Display-Medium", size)
        text.setCharSpace(2.8)
        text.textOut("SUVI")
        canvas.drawText(text)
        first_width = pdfmetrics.stringWidth("SUVI", "Invoice-Display-Medium", size) + 4 * 2.8
        diamond_x = first_width + 6
        canvas.setFillColor(BRASS)
        canvas.saveState()
        canvas.translate(diamond_x, y + 4)
        canvas.rotate(45)
        canvas.rect(-1.8, -1.8, 3.6, 3.6, fill=1, stroke=0)
        canvas.restoreState()
        canvas.setFillColor(CHARCOAL)
        second = canvas.beginText(diamond_x + 8, y)
        second.setFont("Invoice-Display-Medium", size)
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
                raise RuntimeError(f"Bundled invoice font is missing: {filename}")
            pdfmetrics.registerFont(TTFont(name, str(path)))
        pdfmetrics.registerFontFamily(
            "Invoice-Sans",
            normal="Invoice-Sans",
            bold="Invoice-Sans-Medium",
            italic="Invoice-Sans-Light",
            boldItalic="Invoice-Sans-Medium",
        )
        pdfmetrics.registerFontFamily(
            "Invoice-Display",
            normal="Invoice-Display",
            bold="Invoice-Display-Medium",
            italic="Invoice-Display-Italic",
            boldItalic="Invoice-Display-Medium",
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
        parsed = date.fromisoformat(raw[:10])
        return parsed.strftime("%d %b %Y")
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
    amount = abs(amount)
    whole, fraction = f"{amount:.2f}".split(".")
    if len(whole) > 3:
        last = whole[-3:]
        leading = whole[:-3]
        groups = []
        while leading:
            groups.insert(0, leading[-2:])
            leading = leading[:-2]
        whole = ",".join(groups + [last])
    return f"{sign}{whole}.{fraction}"


def _money(value: object) -> str:
    return f"INR {_indian_number(value)}"


_ONES = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _under_hundred(value: int) -> str:
    if value < 20:
        return _ONES[value]
    tens, ones = divmod(value, 10)
    return _TENS[tens] + (f" {_ONES[ones]}" if ones else "")


def _under_thousand(value: int) -> str:
    hundreds, rest = divmod(value, 100)
    parts = []
    if hundreds:
        parts.append(f"{_ONES[hundreds]} Hundred")
    if rest:
        parts.append(_under_hundred(rest))
    return " ".join(parts) or "Zero"


def _integer_words(value: int) -> str:
    if value == 0:
        return "Zero"
    parts = []
    crore, value = divmod(value, 10_000_000)
    lakh, value = divmod(value, 100_000)
    thousand, value = divmod(value, 1_000)
    if crore:
        parts.append(f"{_integer_words(crore)} Crore")
    if lakh:
        parts.append(f"{_under_thousand(lakh)} Lakh")
    if thousand:
        parts.append(f"{_under_thousand(thousand)} Thousand")
    if value:
        parts.append(_under_thousand(value))
    return " ".join(parts)


def amount_in_indian_words(value: object) -> str:
    amount = _decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if amount < 0:
        return f"Minus {amount_in_indian_words(abs(amount))}"
    rupees = int(amount)
    paise = int((amount - Decimal(rupees)) * 100)
    result = f"Rupees {_integer_words(rupees)}"
    if paise:
        result += f" and {_integer_words(paise)} Paise"
    return result + " Only"


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
    if _clean(address.get("country")) and _clean(address.get("country")).lower() != "india":
        output.append(_clean(address["country"]))
    return output


def _party_markup(party: dict, supplier: bool = False) -> str:
    names = []
    legal_name = _clean(party.get("legal_name"))
    display_name = _clean(party.get("trade_name") if supplier else party.get("display_name"))
    fallback_name = _clean(party.get("display_name"))
    primary = legal_name or display_name or fallback_name or "—"
    names.append(f"<b>{_markup(primary)}</b>")
    secondary = display_name or fallback_name
    if secondary and secondary.casefold() != primary.casefold():
        names.append(_markup(secondary))
    names.extend(_markup(line) for line in _address_lines(party.get("address") or party.get("billing_address") or {}))
    if _clean(party.get("gstin")):
        names.append(f"GSTIN: {_markup(party['gstin'])}")
    if _clean(party.get("pan")):
        names.append(f"PAN: {_markup(party['pan'])}")
    if _clean(party.get("contact_person")):
        names.append(f"Contact: {_markup(party['contact_person'])}")
    contacts = " · ".join(filter(None, [_clean(party.get("phone")), _clean(party.get("email"))]))
    if contacts:
        names.append(_markup(contacts))
    return "<br/>".join(names)


def _label_value(label: str, value: object, styles: dict[str, ParagraphStyle]) -> list[Paragraph]:
    return [Paragraph(_markup(label.upper()), styles["micro"]), _paragraph(value or "—", styles["value"])]


class SignedQrEncodingError(ValueError):
    """Raised when signed QR data cannot be encoded by the invoice PDF renderer."""


def _signed_qr_widget(data: str):
    normalized = _clean(data)
    if not normalized:
        return None
    try:
        widget = qr.QrCodeWidget(normalized)
        widget.getBounds()
    except Exception as exc:
        raise SignedQrEncodingError("Signed QR data exceeds the PDF QR encoding capacity") from exc
    return widget


def preflight_signed_qr_data(data: str) -> None:
    """Check QR encodability only; this does not verify signatures or IRP authenticity."""
    _signed_qr_widget(data)


def _qr_drawing(data: str, size: float = 28 * mm) -> Drawing:
    widget = _signed_qr_widget(data)
    if widget is None:
        raise SignedQrEncodingError("Signed QR data is empty")
    widget.barFillColor = CHARCOAL
    widget.barBorder = 0
    x1, y1, x2, y2 = widget.getBounds()
    width = max(1, x2 - x1)
    height = max(1, y2 - y1)
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(widget)
    return drawing


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "body": ParagraphStyle(
            "InvoiceBody",
            parent=base["BodyText"],
            fontName="Invoice-Sans",
            fontSize=7.5,
            leading=10.5,
            textColor=CHARCOAL,
            spaceAfter=0,
        ),
        "long_body": ParagraphStyle(
            "InvoiceLongBody",
            parent=base["BodyText"],
            fontName="Invoice-Sans",
            fontSize=7.5,
            leading=10.5,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "small": ParagraphStyle(
            "InvoiceSmall",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Light",
            fontSize=6.7,
            leading=9.2,
            textColor=TAUPE,
            spaceAfter=0,
        ),
        "micro": ParagraphStyle(
            "InvoiceMicro",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=5.8,
            leading=7.2,
            textColor=TAUPE,
            spaceAfter=1.2,
        ),
        "value": ParagraphStyle(
            "InvoiceValue",
            parent=base["BodyText"],
            fontName="Invoice-Sans",
            fontSize=7.2,
            leading=9.5,
            textColor=CHARCOAL,
            spaceAfter=0,
        ),
        "title": ParagraphStyle(
            "InvoiceTitle",
            parent=base["Heading1"],
            fontName="Invoice-Display-Medium",
            fontSize=20,
            leading=21,
            alignment=TA_RIGHT,
            textColor=OXBLOOD,
            spaceAfter=0,
        ),
        "subtitle": ParagraphStyle(
            "InvoiceSubtitle",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=6.2,
            leading=8,
            alignment=TA_RIGHT,
            textColor=TAUPE,
            spaceAfter=0,
        ),
        "section": ParagraphStyle(
            "InvoiceSection",
            parent=base["Heading2"],
            fontName="Invoice-Sans-Medium",
            fontSize=7,
            leading=9,
            textColor=OXBLOOD,
            spaceAfter=4,
        ),
        "table_header": ParagraphStyle(
            "InvoiceTableHeader",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=5.7,
            leading=7,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=0,
        ),
        "table": ParagraphStyle(
            "InvoiceTable",
            parent=base["BodyText"],
            fontName="Invoice-Sans",
            fontSize=6.1,
            leading=8,
            textColor=CHARCOAL,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "table_right": ParagraphStyle(
            "InvoiceTableRight",
            parent=base["BodyText"],
            fontName="Invoice-Sans",
            fontSize=6.1,
            leading=8,
            textColor=CHARCOAL,
            alignment=TA_RIGHT,
            spaceAfter=0,
        ),
        "total": ParagraphStyle(
            "InvoiceTotal",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=8.5,
            leading=11,
            textColor=OXBLOOD,
            alignment=TA_RIGHT,
            spaceAfter=0,
        ),
        "paid_heading": ParagraphStyle(
            "InvoicePaidHeading",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=8.5,
            leading=10,
            textColor=SUCCESS,
            alignment=TA_RIGHT,
            borderWidth=0.7,
            borderColor=SUCCESS,
            borderPadding=3.5,
            backColor=SUCCESS_PALE,
            spaceBefore=3,
            spaceAfter=0,
        ),
        "paid_label": ParagraphStyle(
            "InvoicePaidLabel",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=9,
            leading=11,
            textColor=SUCCESS,
            spaceAfter=0,
        ),
        "paid_value": ParagraphStyle(
            "InvoicePaidValue",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Medium",
            fontSize=6.5,
            leading=9,
            textColor=SUCCESS,
            alignment=TA_RIGHT,
            spaceAfter=0,
        ),
        "signature": ParagraphStyle(
            "InvoiceSignature",
            parent=base["BodyText"],
            fontName="Invoice-Display-Italic",
            fontSize=9,
            leading=10.5,
            textColor=CHARCOAL,
            alignment=TA_CENTER,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "signature_caption": ParagraphStyle(
            "InvoiceSignatureCaption",
            parent=base["BodyText"],
            fontName="Invoice-Sans-Light",
            fontSize=6.7,
            leading=9.2,
            textColor=TAUPE,
            alignment=TA_CENTER,
            splitLongWords=1,
            spaceAfter=0,
        ),
        "words": ParagraphStyle(
            "InvoiceWords",
            parent=base["BodyText"],
            fontName="Invoice-Display-Italic",
            fontSize=8.2,
            leading=11,
            textColor=CHARCOAL,
            spaceAfter=0,
        ),
    }


def _page_decorator(canvas, doc, invoice_number: str, status: str) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setTitle(f"Suvi Interior Invoice {invoice_number}")
    canvas.setAuthor("Suvi Interior")
    canvas.setSubject("Private customer invoice")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(doc.leftMargin, 13 * mm, width - doc.rightMargin, 13 * mm)
    canvas.setFont("Invoice-Sans-Light", 5.8)
    canvas.setFillColor(TAUPE)
    footer_label = "PRIVATE FINANCIAL DOCUMENT"
    if status == "draft":
        footer_label += " · DRAFT · NOT ISSUED"
    canvas.drawString(doc.leftMargin, 8.5 * mm, footer_label)
    canvas.drawRightString(width - doc.rightMargin, 8.5 * mm, f"PAGE {doc.page}")

    badge = {
        "draft": ("DRAFT · NOT ISSUED", HexColor("#F5EAE5"), BRASS, OXBLOOD),
        "cancelled": ("CANCELLED", HexColor("#F8E5E5"), OXBLOOD, OXBLOOD),
    }.get(status)
    if badge:
        badge_label, badge_fill, badge_stroke, badge_text = badge
        canvas.setFont("Invoice-Sans-Medium", 6.2)
        badge_width = pdfmetrics.stringWidth(badge_label, "Invoice-Sans-Medium", 6.2) + (6 * mm)
        badge_height = 5.5 * mm
        badge_x = width - doc.rightMargin - badge_width
        badge_y = height - (10.5 * mm)
        canvas.setFillColor(badge_fill)
        canvas.setStrokeColor(badge_stroke)
        canvas.setLineWidth(0.55)
        canvas.roundRect(badge_x, badge_y, badge_width, badge_height, 2.75 * mm, fill=1, stroke=1)
        canvas.setFillColor(badge_text)
        canvas.drawCentredString(badge_x + (badge_width / 2), badge_y + 1.85 * mm, badge_label)

    canvas.restoreState()


def render_invoice_pdf(invoice: dict) -> bytes:
    """Render an invoice solely from its stored snapshot and trusted bundled fonts."""
    _register_fonts()
    styles = _styles()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=13 * mm,
        rightMargin=13 * mm,
        topMargin=13 * mm,
        bottomMargin=18 * mm,
        title=f"Suvi Interior Invoice {_clean(invoice.get('invoice_number') or 'Draft')}",
        author="Suvi Interior",
        subject="Private customer invoice",
    )
    available_width = A4[0] - doc.leftMargin - doc.rightMargin
    story = []

    status = _clean(invoice.get("status")).lower() or "draft"
    is_paid = status == "paid"
    actual_number = _clean(invoice.get("invoice_number"))
    number = actual_number or "NUMBER PENDING"
    base_title = _clean(invoice.get("document_title")) or "INVOICE"
    title = base_title
    if status == "draft" and "draft" not in base_title.casefold():
        title = f"{base_title} DRAFT"
    subtitle = f"{number} · NOT ISSUED" if status == "draft" else f"{number} · {status.upper()}"
    heading_details = [
        Paragraph(_markup(title), styles["title"]),
        Paragraph(_markup(subtitle), styles["subtitle"]),
    ]
    if is_paid:
        heading_details.append(Paragraph("PAID IN FULL", styles["paid_heading"]))
    heading = Table(
        [
            [
                Wordmark(),
                heading_details,
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

    supplier = invoice.get("supplier_snapshot") or {}
    customer = invoice.get("customer_snapshot") or {}
    party_table = Table(
        [
            [Paragraph("FROM", styles["section"]), Paragraph("BILL TO", styles["section"])],
            [
                Paragraph(_party_markup(supplier, supplier=True), styles["body"]),
                Paragraph(_party_markup(customer), styles["body"]),
            ],
        ],
        colWidths=[available_width / 2, available_width / 2],
    )
    party_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BACKGROUND", (0, 0), (-1, 0), IVORY_2),
                ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(party_table)
    if customer.get("shipping_same_as_billing") is False:
        shipping_address = customer.get("shipping_address") or {}
        delivery_name = _clean(customer.get("legal_name") or customer.get("display_name")) or "—"
        delivery_lines = [f"<b>{_markup(delivery_name)}</b>"]
        address_lines = _address_lines(shipping_address)
        delivery_lines.extend(_markup(line) for line in address_lines)
        if not address_lines:
            delivery_lines.append("—")
        delivery_table = Table(
            [
                [Paragraph("SHIP TO / DELIVERY ADDRESS", styles["section"])],
                [Paragraph("<br/>".join(delivery_lines), styles["body"])],
            ],
            colWidths=[available_width],
        )
        delivery_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BACKGROUND", (0, 0), (-1, 0), IVORY_2),
                    ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.35, LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.extend([Spacer(1, 5), delivery_table])
    story.append(Spacer(1, 7))

    place = invoice.get("place_of_supply") or {}
    reverse_charge = "Yes" if invoice.get("reverse_charge") else "No"
    details = [
        _label_value("Invoice number", number, styles),
        _label_value("Invoice date", _date_display(invoice.get("invoice_date")), styles),
    ]
    if _clean(invoice.get("due_date")):
        details.append(_label_value("Due date", _date_display(invoice.get("due_date")), styles))
    details.extend(
        [
            _label_value(
                "Place of supply",
                f"{_clean(place.get('state'))} ({_clean(place.get('state_code'))})".strip(),
                styles,
            ),
            _label_value("Reverse charge", reverse_charge, styles),
            _label_value("Project reference", invoice.get("project_reference") or "—", styles),
            _label_value("PO reference", invoice.get("po_reference") or "—", styles),
        ]
    )
    detail_columns = 4 if len(details) > 6 else 3
    detail_rows = [details[index:index + detail_columns] for index in range(0, len(details), detail_columns)]
    last_row_count = len(detail_rows[-1])
    if last_row_count < detail_columns:
        detail_rows[-1].extend([""] * (detail_columns - last_row_count))
    detail_table = Table(detail_rows, colWidths=[available_width / detail_columns] * detail_columns)
    detail_table_style = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), IVORY),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if last_row_count < detail_columns:
        detail_table_style.append(("SPAN", (last_row_count - 1, -1), (detail_columns - 1, -1)))
    detail_table.setStyle(TableStyle(detail_table_style))
    story.extend([detail_table, Spacer(1, 8)])

    headers = ["#", "DESCRIPTION", "HSN/SAC", "QTY", "UNIT", "RATE", "DISCOUNT", "TAXABLE", "GST", "TOTAL"]
    rows = [[Paragraph(header, styles["table_header"]) for header in headers]]
    for index, line in enumerate(invoice.get("lines") or [], start=1):
        description = f"<b>{_markup(line.get('name'))}</b>"
        if _clean(line.get("description")):
            description += f"<br/><font color='#766C63'>{_markup(line.get('description'))}</font>"
        discount = _money(line.get("discount_display"))
        if line.get("discount_type") == "percent":
            discount += f"<br/><font color='#766C63'>{_markup(line.get('discount_value'))}%</font>"
        gst_rate = _clean(line.get("gst_rate")) or "0"
        gst = f"{gst_rate}%<br/><font color='#766C63'>{_money(line.get('tax_display'))}</font>"
        row = [
            Paragraph(str(index), styles["table"]),
            Paragraph(description, styles["table"]),
            _paragraph(line.get("hsn_sac") or "—", styles["table"]),
            _paragraph(line.get("quantity") or "0", styles["table_right"]),
            _paragraph(line.get("unit") or "—", styles["table"]),
            _paragraph(_money(line.get("unit_rate_display")), styles["table_right"]),
            Paragraph(discount, styles["table_right"]),
            _paragraph(_money(line.get("taxable_display")), styles["table_right"]),
            Paragraph(gst, styles["table_right"]),
            _paragraph(_money(line.get("line_total_display")), styles["table_right"]),
        ]
        rows.append(row)
    line_widths = [17, 116, 42, 31, 29, 53, 48, 54, 44, available_width - 434]
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
                ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, IVORY]),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, 0), 4),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
                ("TOPPADDING", (0, 1), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 5),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ]
        )
    )
    story.extend([line_table, Spacer(1, 8)])

    totals = invoice.get("totals") or {}
    total_rows = [
        ["Subtotal", _money(totals.get("subtotal_display"))],
    ]
    if int(totals.get("discount_paise", 0) or 0):
        total_rows.append(["Less: discount", _money(totals.get("discount_display"))])
    total_rows.append(["Taxable value", _money(totals.get("taxable_display"))])
    if invoice.get("tax_regime") == "intra_state" or int(totals.get("cgst_paise", 0) or 0):
        total_rows.extend(
            [
                ["CGST", _money(totals.get("cgst_display"))],
                ["SGST", _money(totals.get("sgst_display"))],
            ]
        )
    if invoice.get("tax_regime") == "inter_state" or int(totals.get("igst_paise", 0) or 0):
        total_rows.append(["IGST", _money(totals.get("igst_display"))])
    if _clean(invoice.get("post_tax_adjustment_label")) or int(totals.get("post_tax_adjustment_paise", 0) or 0):
        total_rows.append(
            [
                _clean(invoice.get("post_tax_adjustment_label")) or "Post-tax adjustment",
                _money(totals.get("post_tax_adjustment_display")),
            ]
        )
    if int(totals.get("round_off_paise", 0) or 0):
        total_rows.append(["Round off", _money(totals.get("round_off_display"))])
    total_rows.append(["GRAND TOTAL", _money(totals.get("grand_total_display"))])
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
    totals_style = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, LINE),
        ("BACKGROUND", (0, -1), (-1, -1), IVORY_2),
        ("BOX", (0, -1), (-1, -1), 0.65, BRASS),
    ]
    totals_table.setStyle(TableStyle(totals_style))
    if is_paid:
        paid_table = Table(
            [
                [
                    Paragraph("PAID IN FULL", styles["paid_label"]),
                    Paragraph(
                        f"TOTAL SETTLED<br/><b>{_markup(_money(totals.get('settled_display')))}</b>",
                        styles["paid_value"],
                    ),
                ]
            ],
            colWidths=[110, 125],
            hAlign="RIGHT",
        )
        paid_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), SUCCESS_PALE),
                    ("BOX", (0, 0), (-1, -1), 0.8, SUCCESS),
                    ("LINEBEFORE", (1, 0), (1, 0), 0.35, SUCCESS_LINE),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        story.append(KeepTogether([totals_table, Spacer(1, 4), paid_table]))
    else:
        story.append(totals_table)
    story.extend(
        [
            Spacer(1, 7),
            Paragraph("AMOUNT IN WORDS", styles["section"]),
            Paragraph(_markup(amount_in_indian_words(totals.get("grand_total_display"))), styles["words"]),
            Spacer(1, 8),
        ]
    )

    payments = invoice.get("payments") or []
    payment_rows = [
        [Paragraph("PAYMENT SUMMARY", styles["section"]), "", "", ""],
        [
            _paragraph(f"Received: {_money(totals.get('received_display'))}", styles["body"]),
            _paragraph(f"TDS withheld: {_money(totals.get('tds_withheld_display'))}", styles["body"]),
            _paragraph(f"Total settled: {_money(totals.get('settled_display'))}", styles["body"]),
            _paragraph(f"Balance due: {_money(totals.get('balance_display'))}", styles["body"]),
        ],
    ]
    payment_summary = Table(payment_rows, colWidths=[available_width / 4] * 4)
    payment_summary.setStyle(
        TableStyle(
            [
                ("SPAN", (0, 0), (-1, 0)),
                ("BACKGROUND", (0, 0), (-1, 0), IVORY_2),
                ("BOX", (0, 0), (-1, -1), 0.4, LINE),
                ("INNERGRID", (0, 1), (-1, -1), 0.3, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(payment_summary)
    if payments:
        payment_detail_rows = [
            [
                Paragraph("DATE", styles["table_header"]),
                Paragraph("METHOD", styles["table_header"]),
                Paragraph("REFERENCE", styles["table_header"]),
                Paragraph("AMOUNT", styles["table_header"]),
                Paragraph("TDS", styles["table_header"]),
            ]
        ]
        for payment in payments:
            payment_detail_rows.append(
                [
                    _paragraph(_date_display(payment.get("payment_date")), styles["table"]),
                    _paragraph(_clean(payment.get("method")).replace("_", " ").title(), styles["table"]),
                    _paragraph(payment.get("reference") or "—", styles["table"]),
                    _paragraph(_money(payment.get("amount_display")), styles["table_right"]),
                    _paragraph(_money(payment.get("tds_withheld_display")), styles["table_right"]),
                ]
            )
        payment_table = Table(
            payment_detail_rows,
            colWidths=[70, 78, available_width - 70 - 78 - 78 - 70, 78, 70],
            repeatRows=1,
        )
        payment_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), TAUPE),
                    ("BOX", (0, 0), (-1, -1), 0.35, LINE),
                    ("INNERGRID", (0, 0), (-1, -1), 0.25, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(payment_table)
    story.append(Spacer(1, 8))

    bank = supplier.get("bank") or {}
    bank_lines = []
    for label, key in (
        ("Account name", "account_name"),
        ("Bank", "bank_name"),
        ("Account number", "account_number"),
        ("Branch", "branch"),
        ("IFSC", "ifsc"),
    ):
        if _clean(bank.get(key)):
            bank_lines.append(f"{label}: {_markup(bank[key])}")
    if _clean(supplier.get("upi_id")):
        bank_lines.append(f"UPI: {_markup(supplier['upi_id'])}")

    long_sections: list[tuple[str, Paragraph]] = []
    if bank_lines:
        long_sections.append(("PAYMENT DETAILS", Paragraph("<br/>".join(bank_lines), styles["long_body"])))
    if _clean(invoice.get("notes")):
        long_sections.append(("NOTES", _paragraph(invoice["notes"], styles["long_body"])))
    if _clean(invoice.get("terms")):
        long_sections.append(("TERMS", _paragraph(invoice["terms"], styles["long_body"])))
    for label, content in long_sections:
        story.extend(
            [
                Paragraph(label, styles["section"]),
                content,
                Spacer(1, 7),
            ]
        )

    e_invoice = invoice.get("e_invoice") or {}
    e_lines = []
    if _clean(e_invoice.get("irn")):
        e_lines.append(f"<b>IRN:</b> {_markup(e_invoice['irn'])}")
    if _clean(e_invoice.get("ack_number")):
        e_lines.append(f"<b>Acknowledgement:</b> {_markup(e_invoice['ack_number'])}")
    if e_invoice.get("ack_date"):
        e_lines.append(f"<b>Acknowledgement date:</b> {_markup(_date_display(e_invoice['ack_date']))}")
    signed_qr_data = _clean(e_invoice.get("signed_qr_data"))
    if e_lines:
        e_content = Paragraph("<br/>".join(e_lines), styles["small"])
        cells = [e_content]
        widths = [available_width]
        if signed_qr_data and _clean(e_invoice.get("irn")) and _clean(e_invoice.get("ack_number")):
            cells.append(_qr_drawing(signed_qr_data))
            widths = [available_width - 35 * mm, 35 * mm]
        e_table = Table([cells], colWidths=widths)
        e_table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), IVORY),
                    ("BOX", (0, 0), (-1, -1), 0.4, BRASS),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.extend([Paragraph("E-INVOICE DETAILS", styles["section"]), e_table, Spacer(1, 8)])

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
        colWidths=[available_width - 170, 170],
    )
    signature.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, -1), "CENTER"),
                ("LINEABOVE", (1, 2), (1, 2), 0.45, CHARCOAL),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    story.append(KeepTogether(signature))

    if status == "cancelled" and _clean(invoice.get("cancel_reason")):
        story.extend(
            [
                Spacer(1, 7),
                Paragraph("CANCELLATION REASON", styles["section"]),
                _paragraph(invoice["cancel_reason"], styles["body"]),
            ]
        )

    decorator = lambda canvas, built_doc: _page_decorator(canvas, built_doc, number, status)
    doc.build(story, onFirstPage=decorator, onLaterPages=decorator)
    return buffer.getvalue()
