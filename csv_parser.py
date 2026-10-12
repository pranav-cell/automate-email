"""CSV Parsing, normalization, duplicate detection, and validation for recipient lists."""

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

# RFC 5322 simplified email regex pattern
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
)

# Known column variations
EMAIL_COLUMNS = {"email", "e-mail", "email address", "recipient_email", "mail", "contact_email"}
NAME_COLUMNS = {"name", "full name", "first name", "recruiter", "recruiter name", "contact", "contact name"}
COMPANY_COLUMNS = {"company", "company name", "organization", "firm", "employer"}
ROLE_COLUMNS = {"role", "position", "job title", "title", "job_title"}
NOTES_COLUMNS = {"notes", "note", "source", "comments", "info"}


@dataclass
class RecipientRow:
    email: str
    name: str = ""
    company: str = ""
    role: str = ""
    notes: str = ""
    row_number: int = 0
    raw_data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ParseResult:
    valid_rows: List[RecipientRow] = field(default_factory=list)
    duplicate_rows: List[Tuple[int, str, str]] = field(default_factory=list)  # (row_no, email, reason)
    invalid_rows: List[Tuple[int, str, str]] = field(default_factory=list)    # (row_no, raw_val, reason)
    warnings: List[str] = field(default_factory=list)
    total_parsed: int = 0


def normalize_email(email_str: str) -> str:
    """Normalize email by stripping whitespace and converting to lowercase."""
    if not email_str:
        return ""
    return email_str.strip().lower()


def is_valid_email(email_str: str) -> bool:
    """Check if normalized email matches valid email syntax."""
    if not email_str:
        return False
    # Avoid typical placeholders
    if email_str.endswith("@example.com") or email_str.endswith("@domain.com"):
        # We allow in tests/samples, but format must match
        pass
    if ".." in email_str or email_str.startswith(".") or email_str.endswith("."):
        return False
    return bool(EMAIL_REGEX.match(email_str))


def _identify_column(headers: List[str], candidate_set: Set[str]) -> Optional[str]:
    """Match CSV header to known candidate column names (case-insensitive)."""
    for col in headers:
        clean = col.strip().lower().replace("_", " ")
        if clean in candidate_set or col.strip().lower() in candidate_set:
            return col
    return None


def parse_csv_content(
    file_content: str,
    existing_emails: Optional[Set[str]] = None,
) -> ParseResult:
    """
    Parse CSV string or stream into validated RecipientRow objects.
    Detects intra-file and cross-database duplicates and formats errors.
    """
    result = ParseResult()
    existing_set = {normalize_email(e) for e in (existing_emails or set())}
    seen_in_file: Set[str] = set()

    # Handle dialect detection
    try:
        sample = file_content[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample)
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(io.StringIO(file_content), dialect=dialect)
    except Exception as e:
        result.warnings.append(f"Failed to parse CSV format: {str(e)}")
        return result

    if not reader.fieldnames:
        result.warnings.append("CSV file appears to be empty or has no header row.")
        return result

    fieldnames = list(reader.fieldnames)
    email_col = _identify_column(fieldnames, EMAIL_COLUMNS)
    name_col = _identify_column(fieldnames, NAME_COLUMNS)
    company_col = _identify_column(fieldnames, COMPANY_COLUMNS)
    role_col = _identify_column(fieldnames, ROLE_COLUMNS)
    notes_col = _identify_column(fieldnames, NOTES_COLUMNS)

    if not email_col:
        result.warnings.append(
            f"Could not find an email column. Looked for variations of {EMAIL_COLUMNS}. Available columns: {fieldnames}"
        )
        return result

    row_num = 1  # 1 is header
    for raw_row in reader:
        row_num += 1
        result.total_parsed += 1

        raw_email = raw_row.get(email_col, "")
        norm_email = normalize_email(raw_email)

        # 1. Check for empty email
        if not norm_email:
            result.invalid_rows.append((row_num, raw_email, "Email address is empty"))
            continue

        # 2. Check for invalid syntax
        if not is_valid_email(norm_email):
            result.invalid_rows.append((row_num, norm_email, "Invalid email address format"))
            continue

        # 3. Check for duplicates within this file
        if norm_email in seen_in_file:
            result.duplicate_rows.append(
                (row_num, norm_email, "Duplicate within uploaded CSV file")
            )
            continue
        seen_in_file.add(norm_email)

        # 4. Check for duplicates against existing DB records
        if norm_email in existing_set:
            result.duplicate_rows.append(
                (row_num, norm_email, "Already exists in database")
            )
            continue

        # Extract other fields
        name_val = raw_row.get(name_col, "").strip() if name_col else ""
        comp_val = raw_row.get(company_col, "").strip() if company_col else ""
        role_val = raw_row.get(role_col, "").strip() if role_col else ""
        notes_val = raw_row.get(notes_col, "").strip() if notes_col else ""

        if not name_val:
            result.warnings.append(f"Row {row_num} ({norm_email}): Recipient name is blank.")

        recipient = RecipientRow(
            email=norm_email,
            name=name_val,
            company=comp_val,
            role=role_val,
            notes=notes_val,
            row_number=row_num,
            raw_data=raw_row,
        )
        result.valid_rows.append(recipient)

    return result
