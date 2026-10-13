"""CSV Parsing, normalization, duplicate detection, and validation for recipient lists."""

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

# RFC 5322 simplified email regex pattern
# RFC 5322 simplified email regex pattern (permits international TLDs, subdomains, numbers and underscores in domain)
EMAIL_REGEX = re.compile(
    r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9_.-]+\.[a-zA-Z0-9-.]+$"
)

# Known column variations
EMAIL_COLUMNS = {"email", "e-mail", "email address", "recipient_email", "mail", "contact_email", "emails"}
NAME_COLUMNS = {"name", "full name", "first name", "recruiter", "recruiter name", "contact", "contact name"}
COMPANY_COLUMNS = {"company", "company name", "organization", "firm", "employer"}
ROLE_COLUMNS = {"role", "position", "job title", "title", "job_title"}
NOTES_COLUMNS = {"notes", "note", "source", "comments", "info"}

COMMON_WEBMAILS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com"}


def infer_company_from_email(email_str: str) -> str:
    """Infer a clean company name from domain if domain is not a generic webmail provider."""
    try:
        parts = email_str.split("@")
        if len(parts) != 2:
            return ""
        domain = parts[1].lower()
        if domain in COMMON_WEBMAILS:
            return ""
        # e.g. 'aldawaa.com.sa' -> 'aldawaa', 'sa.yokogawa.com' -> 'yokogawa'
        domain_parts = domain.split(".")
        # remove country code if present (like .sa)
        name_part = domain_parts[0]
        if len(name_part) <= 2 and len(domain_parts) > 1:
            name_part = domain_parts[1]
        name_clean = name_part.replace("-", " ").replace("_", " ").title()
        return name_clean
    except Exception:
        return ""


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
    if ".." in email_str or email_str.startswith(".") or email_str.endswith("."):
        return False
    return bool(EMAIL_REGEX.match(email_str))


def _identify_column(headers: List[str], candidate_set: Set[str]) -> Optional[str]:
    """Match CSV header to known candidate column names (case-insensitive)."""
    for col in headers:
        if not col:
            continue
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

    # Clean BOM and normalise newlines
    clean_content = file_content.lstrip("\ufeff").strip()
    if not clean_content:
        result.warnings.append("CSV file appears to be completely empty.")
        return result

    # 1. Handle single-column list of emails without delimiters safely
    # Explicitly constrain delimiter sniffing to commas, tabs, semicolons, and pipes
    # to avoid treating '@' in email addresses as a delimiter!
    try:
        sample = clean_content[:2048]
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",\t;|")
        except Exception:
            dialect = csv.excel
        reader = csv.DictReader(io.StringIO(clean_content), dialect=dialect)
    except Exception as e:
        result.warnings.append(f"Failed to parse CSV format: {str(e)}")
        return result

    fieldnames = list(reader.fieldnames or [])
    email_col = _identify_column(fieldnames, EMAIL_COLUMNS)
    name_col = _identify_column(fieldnames, NAME_COLUMNS)
    company_col = _identify_column(fieldnames, COMPANY_COLUMNS)
    role_col = _identify_column(fieldnames, ROLE_COLUMNS)
    notes_col = _identify_column(fieldnames, NOTES_COLUMNS)

    # If no header was found, check if the first fieldname itself is a valid email
    # (i.e. user uploaded a list with no header row)
    has_header = True
    if not email_col:
        if fieldnames and is_valid_email(normalize_email(fieldnames[0])):
            # First row is actually an email!
            has_header = False
            email_col = fieldnames[0]
        else:
            result.warnings.append(
                f"Could not find an email column. Looked for variations of {EMAIL_COLUMNS}. Available columns: {fieldnames}"
            )
            return result

    # Helper function to process an email row
    def process_row(raw_email: str, row_num: int, raw_dict: Dict[str, Any]):
        result.total_parsed += 1
        norm_email = normalize_email(raw_email)

        if not norm_email:
            result.invalid_rows.append((row_num, raw_email, "Email address is empty"))
            return

        if not is_valid_email(norm_email):
            result.invalid_rows.append((row_num, norm_email, "Invalid email address format"))
            return

        if norm_email in seen_in_file:
            result.duplicate_rows.append((row_num, norm_email, "Duplicate within uploaded CSV file"))
            return
        seen_in_file.add(norm_email)

        if norm_email in existing_set:
            result.duplicate_rows.append((row_num, norm_email, "Already exists in database"))
            return

        name_val = raw_dict.get(name_col, "").strip() if (name_col and raw_dict) else ""
        comp_val = raw_dict.get(company_col, "").strip() if (company_col and raw_dict) else ""
        role_val = raw_dict.get(role_col, "").strip() if (role_col and raw_dict) else ""
        notes_val = raw_dict.get(notes_col, "").strip() if (notes_col and raw_dict) else ""

        # Auto-infer company if blank
        if not comp_val:
            comp_val = infer_company_from_email(norm_email)

        recipient = RecipientRow(
            email=norm_email,
            name=name_val,
            company=comp_val,
            role=role_val,
            notes=notes_val,
            row_number=row_num,
            raw_data=raw_dict,
        )
        result.valid_rows.append(recipient)

    # If first row was actually an email without header, process it
    if not has_header:
        process_row(fieldnames[0], 1, {})

    row_num = 1 if has_header else 1
    for raw_row in reader:
        row_num += 1
        raw_email = raw_row.get(email_col, "")
        process_row(raw_email, row_num, raw_row)

    return result

