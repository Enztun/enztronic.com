#!/usr/bin/env python3
"""Render a validated invoice JSON document from stdin to PDF on stdout."""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


MAX_INPUT_BYTES = 1024 * 1024
MAX_ITEMS = 100
BRAND = colors.HexColor("#2563EB")
INK = colors.HexColor("#132436")
MUTED = colors.HexColor("#687786")
LINE = colors.HexColor("#DFE6EC")
PALE = colors.HexColor("#F4F7F9")


class InvoiceValidationError(ValueError):
    pass


def text(
    value: Any,
    field: str,
    maximum: int,
    *,
    optional: bool = False,
    multiline: bool = False,
) -> str | None:
    if optional and (value is None or value == ""):
        return None
    if not isinstance(value, str):
        raise InvoiceValidationError(f"{field} is invalid")
    normalized = value.strip()
    has_control = any(
        ord(char) < 32 and not (multiline and char == "\n") for char in normalized
    ) or "\x7f" in normalized
    if not normalized or len(normalized) > maximum or has_control:
        raise InvoiceValidationError(f"{field} is invalid")
    return normalized


def iso_date(value: Any, field: str) -> str:
    normalized = text(value, field, 10)
    assert normalized is not None
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise InvoiceValidationError(f"{field} is invalid") from exc
    if parsed.isoformat() != normalized:
        raise InvoiceValidationError(f"{field} is invalid")
    return parsed.strftime("%d %b %Y")


def decimal_value(
    value: Any,
    field: str,
    *,
    strictly_positive: bool = False,
) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise InvoiceValidationError(f"{field} is invalid")
    raw = str(value).strip()
    if not re.fullmatch(r"(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?", raw):
        raise InvoiceValidationError(f"{field} is invalid")
    try:
        result = Decimal(raw)
    except InvalidOperation as exc:
        raise InvoiceValidationError(f"{field} is invalid") from exc
    if not result.is_finite() or result < 0 or (strictly_positive and result <= 0):
        raise InvoiceValidationError(f"{field} is invalid")
    return result


def party(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvoiceValidationError(f"{field} is invalid")
    raw_lines = value.get("addressLines") or []
    if not isinstance(raw_lines, list) or len(raw_lines) > 8:
        raise InvoiceValidationError(f"{field}.addressLines is invalid")
    lines = [text(line, f"{field}.addressLines", 180) for line in raw_lines]
    return {
        "name": text(value.get("name"), f"{field}.name", 160),
        "addressLines": lines,
        "email": text(value.get("email"), f"{field}.email", 254, optional=True),
        "phone": text(value.get("phone"), f"{field}.phone", 80, optional=True),
        "taxId": text(value.get("taxId"), f"{field}.taxId", 80, optional=True),
    }


def validate_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InvoiceValidationError("payload is invalid")

    currency = text(value.get("currency"), "currency", 3)
    assert currency is not None
    currency = currency.upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise InvoiceValidationError("currency is invalid")
    fraction_digits = value.get("currencyFractionDigits", 2)
    if (
        isinstance(fraction_digits, bool)
        or not isinstance(fraction_digits, int)
        or not 0 <= fraction_digits <= 4
    ):
        raise InvoiceValidationError("currencyFractionDigits is invalid")
    money_quantum = Decimal(1).scaleb(-fraction_digits)

    raw_items = value.get("items")
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_ITEMS:
        raise InvoiceValidationError("items are invalid")

    items: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            raise InvoiceValidationError(f"items[{index}] is invalid")
        quantity = decimal_value(
            item.get("quantity"), f"items[{index}].quantity", strictly_positive=True
        )
        unit_price = decimal_value(item.get("unitPrice"), f"items[{index}].unitPrice")
        computed_line_total = (quantity * unit_price).quantize(
            money_quantum, rounding=ROUND_HALF_UP
        )
        raw_line_total = item.get("lineTotal")
        line_total = (
            decimal_value(raw_line_total, f"items[{index}].lineTotal")
            if raw_line_total is not None
            else computed_line_total
        )
        if line_total != computed_line_total:
            raise InvoiceValidationError(f"items[{index}].lineTotal is inconsistent")
        items.append(
            {
                "description": text(
                    item.get("description"),
                    f"items[{index}].description",
                    500,
                    multiline=True,
                ),
                "quantity": quantity,
                "unitPrice": unit_price,
                "lineTotal": line_total,
            }
        )

    computed_subtotal = sum((item["lineTotal"] for item in items), Decimal("0"))
    subtotal = decimal_value(
        value.get("subtotalAmount", str(computed_subtotal)), "subtotalAmount"
    )
    if subtotal != computed_subtotal:
        raise InvoiceValidationError("subtotalAmount is inconsistent")
    tax = decimal_value(value.get("taxAmount", "0"), "taxAmount")
    discount = decimal_value(value.get("discountAmount", "0"), "discountAmount")
    paid = decimal_value(value.get("amountPaid", "0"), "amountPaid")
    computed_total = (subtotal + tax - discount).quantize(
        money_quantum, rounding=ROUND_HALF_UP
    )
    total = decimal_value(value.get("totalAmount", str(computed_total)), "totalAmount")
    if total != computed_total:
        raise InvoiceValidationError("totalAmount is inconsistent")
    if discount > subtotal + tax or paid > total:
        raise InvoiceValidationError("invoice adjustments are invalid")

    due_date = value.get("dueDate")
    return {
        "invoiceNumber": text(value.get("invoiceNumber"), "invoiceNumber", 80),
        "currency": currency,
        "currencyFractionDigits": fraction_digits,
        "issueDate": iso_date(value.get("issueDate"), "issueDate"),
        "dueDate": iso_date(due_date, "dueDate") if due_date else None,
        "purchaseOrder": text(
            value.get("purchaseOrder"), "purchaseOrder", 100, optional=True
        ),
        "company": party(value.get("company"), "company"),
        "client": party(value.get("client"), "client"),
        "items": items,
        "subtotal": subtotal,
        "taxAmount": tax,
        "discountAmount": discount,
        "amountPaid": paid,
        "total": total,
        "amountDue": (total - paid).quantize(money_quantum, rounding=ROUND_HALF_UP),
        "notes": text(value.get("notes"), "notes", 2000, optional=True, multiline=True),
        "paymentInstructions": text(
            value.get("paymentInstructions"),
            "paymentInstructions",
            2000,
            optional=True,
            multiline=True,
        ),
    }


def markup(value: str) -> str:
    return escape(value).replace("\n", "<br/>")


def money(value: Decimal, currency: str, fraction_digits: int) -> str:
    quantum = Decimal(1).scaleb(-fraction_digits)
    amount = value.quantize(quantum, rounding=ROUND_HALF_UP)
    return f"{currency} {amount:,.{fraction_digits}f}"


def quantity(value: Decimal) -> str:
    normalized = format(value.normalize(), "f")
    return normalized.rstrip("0").rstrip(".") if "." in normalized else normalized


def party_paragraph(value: dict[str, Any], style: ParagraphStyle) -> Paragraph:
    lines = [f"<b>{markup(value['name'])}</b>"]
    lines.extend(markup(line) for line in value["addressLines"])
    if value.get("email"):
        lines.append(markup(value["email"]))
    if value.get("phone"):
        lines.append(markup(value["phone"]))
    if value.get("taxId"):
        lines.append(f"Tax ID: {markup(value['taxId'])}")
    return Paragraph("<br/>".join(lines), style)


def render(invoice: dict[str, Any]) -> bytes:
    output = BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=f"Invoice {invoice['invoiceNumber']}",
        author=invoice["company"]["name"],
    )

    styles = getSampleStyleSheet()
    normal = ParagraphStyle(
        "InvoiceBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9,
        leading=14,
        textColor=INK,
        spaceAfter=0,
    )
    small = ParagraphStyle(
        "InvoiceSmall",
        parent=normal,
        fontSize=8,
        leading=12,
        textColor=MUTED,
    )
    label = ParagraphStyle(
        "InvoiceLabel",
        parent=small,
        fontName="Helvetica-Bold",
        fontSize=7,
        leading=10,
        textColor=MUTED,
    )
    heading = ParagraphStyle(
        "InvoiceHeading",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=28,
        leading=32,
        textColor=INK,
        spaceAfter=0,
    )
    right = ParagraphStyle("InvoiceRight", parent=normal, alignment=TA_RIGHT)
    right_bold = ParagraphStyle(
        "InvoiceRightBold", parent=right, fontName="Helvetica-Bold"
    )

    story: list[Any] = []
    header = Table(
        [
            [
                Paragraph(markup(invoice["company"]["name"]), heading),
                Paragraph("INVOICE", ParagraphStyle("InvoiceWord", parent=heading, alignment=TA_RIGHT, textColor=BRAND)),
            ]
        ],
        colWidths=[95 * mm, 64 * mm],
    )
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.extend([header, Spacer(1, 8 * mm)])

    metadata_rows = [
        [Paragraph("INVOICE NUMBER", label), Paragraph(markup(invoice["invoiceNumber"]), right_bold)],
        [Paragraph("ISSUED", label), Paragraph(markup(invoice["issueDate"]), right)],
    ]
    if invoice.get("dueDate"):
        metadata_rows.append([Paragraph("DUE", label), Paragraph(markup(invoice["dueDate"]), right)])
    if invoice.get("purchaseOrder"):
        metadata_rows.append([Paragraph("PURCHASE ORDER", label), Paragraph(markup(invoice["purchaseOrder"]), right)])

    parties = Table(
        [
            [Paragraph("FROM", label), Paragraph("BILL TO", label), Table(metadata_rows, colWidths=[32 * mm, 43 * mm])],
            [
                party_paragraph(invoice["company"], normal),
                party_paragraph(invoice["client"], normal),
                "",
            ],
        ],
        colWidths=[48 * mm, 48 * mm, 63 * mm],
    )
    parties.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("SPAN", (2, 0), (2, 1)),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.extend([parties, Spacer(1, 9 * mm)])

    item_rows: list[list[Any]] = [
        [
            Paragraph("DESCRIPTION", label),
            Paragraph("QTY", label),
            Paragraph("UNIT PRICE", label),
            Paragraph("AMOUNT", label),
        ]
    ]
    for item in invoice["items"]:
        item_rows.append(
            [
                Paragraph(markup(item["description"]), normal),
                Paragraph(quantity(item["quantity"]), right),
                Paragraph(money(item["unitPrice"], invoice["currency"], invoice["currencyFractionDigits"]), right),
                Paragraph(money(item["lineTotal"], invoice["currency"], invoice["currencyFractionDigits"]), right_bold),
            ]
        )

    items_table = Table(
        item_rows,
        colWidths=[84 * mm, 17 * mm, 29 * mm, 29 * mm],
        repeatRows=1,
        hAlign="LEFT",
    )
    items_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALE),
                ("LINEBELOW", (0, 0), (-1, 0), 1, BRAND),
                ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([items_table, Spacer(1, 6 * mm)])

    totals = [
        [Paragraph("Subtotal", normal), Paragraph(money(invoice["subtotal"], invoice["currency"], invoice["currencyFractionDigits"]), right)],
    ]
    if invoice["taxAmount"]:
        totals.append([Paragraph("Tax", normal), Paragraph(money(invoice["taxAmount"], invoice["currency"], invoice["currencyFractionDigits"]), right)])
    if invoice["discountAmount"]:
        totals.append([Paragraph("Discount", normal), Paragraph(f"- {money(invoice['discountAmount'], invoice['currency'], invoice['currencyFractionDigits'])}", right)])
    totals.append([Paragraph("Total", right_bold), Paragraph(money(invoice["total"], invoice["currency"], invoice["currencyFractionDigits"]), right_bold)])
    if invoice["amountPaid"]:
        totals.append([Paragraph("Paid", normal), Paragraph(f"- {money(invoice['amountPaid'], invoice['currency'], invoice['currencyFractionDigits'])}", right)])
    totals.append([Paragraph("Amount due", right_bold), Paragraph(money(invoice["amountDue"], invoice["currency"], invoice["currencyFractionDigits"]), right_bold)])

    totals_table = Table(totals, colWidths=[37 * mm, 38 * mm], hAlign="RIGHT")
    totals_table.setStyle(
        TableStyle(
            [
                ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND),
                ("BACKGROUND", (0, -1), (-1, -1), PALE),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.append(totals_table)

    supplemental: list[Any] = []
    if invoice.get("paymentInstructions"):
        supplemental.extend(
            [
                Paragraph("PAYMENT INSTRUCTIONS", label),
                Spacer(1, 2 * mm),
                Paragraph(markup(invoice["paymentInstructions"]), normal),
                Spacer(1, 5 * mm),
            ]
        )
    if invoice.get("notes"):
        supplemental.extend(
            [
                Paragraph("NOTES", label),
                Spacer(1, 2 * mm),
                Paragraph(markup(invoice["notes"]), normal),
            ]
        )
    if supplemental:
        story.extend([Spacer(1, 9 * mm), KeepTogether(supplemental)])

    def footer(canvas: Canvas, doc: SimpleDocTemplate) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(18 * mm, 8 * mm, f"Invoice {invoice['invoiceNumber']}")
        canvas.drawRightString(A4[0] - 18 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()


def main() -> int:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if not raw or len(raw) > MAX_INPUT_BYTES:
        print("invalid invoice payload", file=sys.stderr)
        return 2
    try:
        payload = json.loads(raw.decode("utf-8"))
        invoice = validate_payload(payload)
        pdf = render(invoice)
    except (UnicodeDecodeError, json.JSONDecodeError, InvoiceValidationError):
        print("invalid invoice payload", file=sys.stderr)
        return 2
    except Exception:
        print("invoice rendering failed", file=sys.stderr)
        return 3

    if not pdf.startswith(b"%PDF-"):
        print("invoice rendering failed", file=sys.stderr)
        return 3
    sys.stdout.buffer.write(pdf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
