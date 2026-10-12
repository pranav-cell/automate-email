"""Attachment validation and MIME email construction for Gmail API."""

import base64
import os
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Tuple

MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB limit for safety


def validate_pdf_attachment(file_path_or_bytes: bytes | str) -> Tuple[bool, str, int]:
    """
    Validate that an attachment is a valid, readable PDF file within safe size limits.
    Returns (is_valid, error_reason, size_in_bytes).
    """
    data: bytes = b""
    if isinstance(file_path_or_bytes, str):
        if not os.path.exists(file_path_or_bytes):
            return False, f"File does not exist: {file_path_or_bytes}", 0
        try:
            with open(file_path_or_bytes, "rb") as f:
                data = f.read()
        except Exception as e:
            return False, f"Failed to read file: {str(e)}", 0
    elif isinstance(file_path_or_bytes, bytes):
        data = file_path_or_bytes
    else:
        return False, "Unsupported attachment type", 0

    if len(data) == 0:
        return False, "Attachment file is completely empty (0 bytes)", 0

    if len(data) > MAX_ATTACHMENT_SIZE_BYTES:
        mb = len(data) / (1024 * 1024)
        return False, f"Attachment file is {mb:.1f}MB, which exceeds the 10MB limit.", len(data)

    # Validate PDF magic header bytes
    if not data.startswith(b"%PDF-"):
        return False, "File does not appear to be a valid PDF (missing '%PDF-' header)", len(data)

    return True, "", len(data)


def create_mime_message(
    sender_email: str,
    to_email: str,
    subject: str,
    body_text: str,
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: Optional[str] = "Resume.pdf",
) -> MIMEMultipart:
    """Create a standardized MIME email message with optional PDF attachment."""
    message = MIMEMultipart()
    message["to"] = to_email
    message["from"] = sender_email
    message["subject"] = subject

    # Plaintext message body
    text_part = MIMEText(body_text, "plain", "utf-8")
    message.attach(text_part)

    # Attach PDF if provided
    if attachment_bytes is not None:
        valid, err, _ = validate_pdf_attachment(attachment_bytes)
        if not valid:
            raise ValueError(f"Invalid PDF attachment: {err}")

        filename = attachment_filename or "Resume.pdf"
        if not filename.lower().endswith(".pdf"):
            filename += ".pdf"

        part = MIMEApplication(attachment_bytes, _subtype="pdf")
        part.add_header("Content-Disposition", "attachment", filename=filename)
        message.attach(part)

    return message


def encode_mime_message(message: MIMEMultipart) -> str:
    """Encode a MIMEMultipart object into a URL-safe base64 string for Gmail API."""
    raw_bytes = message.as_bytes()
    return base64.urlsafe_b64encode(raw_bytes).decode("utf-8")
