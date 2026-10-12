"""Comprehensive automated tests for Job Application Automator."""

import os
import tempfile
import pytest

from csv_parser import parse_csv_content, normalize_email, is_valid_email
from email_builder import validate_pdf_attachment, create_mime_message, encode_mime_message
from email_templates import ApplicantProfile, render_email, extract_first_name
from database import (
    init_db,
    upsert_recipient,
    get_all_recipients,
    update_recipient_status,
    log_send_event,
    get_statistics,
    reset_recipient_status,
    STATUS_PENDING,
    STATUS_DRY_RUN,
    STATUS_SENT,
    STATUS_FAILED,
    STATUS_NEEDS_REVIEW,
)
from gmail_service import send_single_message, AmbiguousSendError


@pytest.fixture
def temp_db():
    """Create and tear down an isolated temporary SQLite database."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    init_db(path)
    yield path
    if os.path.exists(path):
        os.remove(path)


def test_email_normalization_and_validation():
    assert normalize_email("  John.Doe@Example.COM  ") == "john.doe@example.com"
    assert is_valid_email("recruiter@company.com") is True
    assert is_valid_email("jane.smith+jobs@sub.domain.co") is True
    assert is_valid_email("plainaddress") is False
    assert is_valid_email("@missingusername.com") is False
    assert is_valid_email("missing.domain@") is False
    assert is_valid_email("double..dots@domain.com") is False


def test_csv_parser_with_duplicates_and_invalids():
    csv_data = """Name,Email,Company,Role
Alice Walker,alice@techfirm.io,TechFirm,Software Engineer
Bob Smith,BOB@techfirm.io,TechFirm,Backend Dev
Alice Walker,alice@techfirm.io,TechFirm,Duplicate Engineer
Invalid Guy,not-an-email,BadCorp,Dev
,empty_email,,
No Name Recruiter,recruiter@talent.com,Talent Inc,Lead
"""
    result = parse_csv_content(csv_data)
    assert result.total_parsed == 6
    assert len(result.valid_rows) == 3  # alice, bob, recruiter@talent.com
    assert len(result.duplicate_rows) == 1
    assert result.duplicate_rows[0][1] == "alice@techfirm.io"
    assert len(result.invalid_rows) == 2  # not-an-email and empty


def test_csv_parser_cross_database_duplicates(temp_db):
    # Insert one into database
    upsert_recipient(temp_db, "existing@corp.com", name="Existing Recruiter")
    existing_recipients = get_all_recipients(temp_db)
    existing_set = {r["email"] for r in existing_recipients}

    csv_data = """Full Name,E-mail,Company
New Person,new@corp.com,NewCorp
Existing Person,existing@corp.com,OldCorp
"""
    result = parse_csv_content(csv_data, existing_emails=existing_set)
    assert len(result.valid_rows) == 1
    assert result.valid_rows[0].email == "new@corp.com"
    assert len(result.duplicate_rows) == 1
    assert result.duplicate_rows[0][1] == "existing@corp.com"


def test_pdf_attachment_validation():
    # Valid PDF magic header
    valid_pdf = b"%PDF-1.4\n%test content\n%%EOF"
    is_valid, err, size = validate_pdf_attachment(valid_pdf)
    assert is_valid is True
    assert err == ""
    assert size == len(valid_pdf)

    # Empty bytes
    is_valid, err, _ = validate_pdf_attachment(b"")
    assert is_valid is False
    assert "empty" in err.lower()

    # Invalid header
    invalid_header = b"NOT A PDF HEADER"
    is_valid, err, _ = validate_pdf_attachment(invalid_header)
    assert is_valid is False
    assert "missing '%pdf-'" in err.lower()

    # Oversized PDF (> 10MB)
    fake_huge_pdf = b"%PDF-" + b"0" * (11 * 1024 * 1024)
    is_valid, err, _ = validate_pdf_attachment(fake_huge_pdf)
    assert is_valid is False
    assert "exceeds the 10mb limit" in err.lower()


def test_email_template_rendering():
    applicant = ApplicantProfile(
        name="Pranav",
        email="pranav@example.com",
        linkedin="https://linkedin.com/in/pranav",
    )
    recipient = {
        "name": "Sarah Connor",
        "company": "Cyberdyne",
        "role": "Robotics Engineer",
        "email": "sarah@cyberdyne.com",
    }
    rendered = render_email(
        subject_template="Application for {role} at {company} - {applicant_name}",
        body_template="Hi {first_name},\nI am interested in {role} at {company}.\nBest,\n{applicant_name}",
        recipient=recipient,
        applicant=applicant,
    )
    assert rendered["subject"] == "Application for Robotics Engineer at Cyberdyne - Pranav"
    assert "Hi Sarah," in rendered["body"]
    assert "Cyberdyne" in rendered["body"]
    assert extract_first_name("Dr. Evelyn Reed") == "Evelyn"
    assert extract_first_name("") == "there"


def test_database_state_transitions_and_duplicate_prevention(temp_db):
    rec_id, is_new = upsert_recipient(temp_db, "candidate@jobs.com", name="Candidate")
    assert is_new is True

    # Initial state should be PENDING
    rec = get_all_recipients(temp_db)[0]
    assert rec["status"] == STATUS_PENDING

    # Transition to DRY_RUN
    update_recipient_status(rec_id, STATUS_DRY_RUN, db_path=temp_db)
    rec = get_all_recipients(temp_db)[0]
    assert rec["status"] == STATUS_DRY_RUN

    # Transition to SENT
    update_recipient_status(rec_id, STATUS_SENT, increment_attempt=True, db_path=temp_db)
    rec = get_all_recipients(temp_db)[0]
    assert rec["status"] == STATUS_SENT
    assert rec["attempt_count"] == 1
    assert rec["sent_at"] is not None

    # Accidental duplicate attempt to change SENT to PENDING should be rejected
    rejected = update_recipient_status(rec_id, STATUS_PENDING, db_path=temp_db)
    assert rejected is False
    rec = get_all_recipients(temp_db)[0]
    assert rec["status"] == STATUS_SENT  # still protected!

    # Manual reset
    reset_ok = reset_recipient_status(rec_id, STATUS_PENDING, db_path=temp_db)
    assert reset_ok is True
    rec = get_all_recipients(temp_db)[0]
    assert rec["status"] == STATUS_PENDING


def test_dry_run_mode_execution():
    valid_pdf = b"%PDF-1.4 sample content"
    res = send_single_message(
        service=None,  # No live service needed for dry run
        sender_email="me@example.com",
        to_email="recruiter@example.com",
        subject="Test Application",
        body_text="Hello, this is a dry run.",
        attachment_bytes=valid_pdf,
        dry_run=True,
    )
    assert res["dry_run"] is True
    assert res["status"] == "SIMULATED_SUCCESS"
    assert "dry-run-" in res["message_id"]


def test_mime_assembly_and_encoding():
    valid_pdf = b"%PDF-1.4 sample resume document"
    msg = create_mime_message(
        sender_email="me@example.com",
        to_email="dest@example.com",
        subject="Job Application",
        body_text="Here is my resume.",
        attachment_bytes=valid_pdf,
        attachment_filename="Pranav_Resume.pdf",
    )
    assert msg["subject"] == "Job Application"
    assert msg["to"] == "dest@example.com"
    encoded = encode_mime_message(msg)
    assert isinstance(encoded, str)
    assert len(encoded) > 0
