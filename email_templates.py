"""Email template formatting and applicant detail interpolation."""

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class ApplicantProfile:
    name: str = "Pranav"
    email: str = "pranav@example.com"
    phone: str = ""
    linkedin: str = ""
    github: str = ""
    portfolio: str = ""


DEFAULT_SUBJECT_TEMPLATE = "Application for {role} - {applicant_name}"

DEFAULT_BODY_TEMPLATE = """Hi {first_name},

I hope this email finds you well.

I am reaching out to express my keen interest in open {role} opportunities at {company}. With my background in software engineering and hands-on experience building scalable applications, I believe my skills would be a strong match for your team.

I have attached my resume for your review. I would welcome the opportunity to connect briefly and discuss how I can contribute to {company}'s goals.

Thank you very much for your time and consideration.

Best regards,
{applicant_name}
{contact_info}"""


def extract_first_name(full_name: str) -> str:
    """Extract first name from full name or return a sensible fallback."""
    if not full_name:
        return "there"
    parts = full_name.strip().split()
    if not parts:
        return "there"
    first = parts[0]
    # Remove honorifics if present
    if first.lower() in {"mr.", "ms.", "mrs.", "dr."} and len(parts) > 1:
        return parts[1]
    return first


def render_email(
    subject_template: str,
    body_template: str,
    recipient: Dict[str, Any],
    applicant: ApplicantProfile,
) -> Dict[str, str]:
    """
    Safely render subject and body with recipient and applicant placeholders.
    Missing variables are replaced with graceful fallbacks.
    """
    raw_name = recipient.get("name") or ""
    first_name = extract_first_name(raw_name)
    company = recipient.get("company") or "your company"
    role = recipient.get("role") or "Software Engineer"

    # Build formatted contact line
    contact_parts = []
    if applicant.phone:
        contact_parts.append(f"Phone: {applicant.phone}")
    if applicant.linkedin:
        contact_parts.append(f"LinkedIn: {applicant.linkedin}")
    if applicant.github:
        contact_parts.append(f"GitHub: {applicant.github}")
    if applicant.portfolio:
        contact_parts.append(f"Portfolio: {applicant.portfolio}")
    contact_info = "\n".join(contact_parts) if contact_parts else ""

    replacements = {
        "{name}": raw_name or "Hiring Team",
        "{first_name}": first_name,
        "{company}": company,
        "{role}": role,
        "{applicant_name}": applicant.name,
        "{applicant_email}": applicant.email,
        "{applicant_phone}": applicant.phone,
        "{applicant_linkedin}": applicant.linkedin,
        "{applicant_github}": applicant.github,
        "{applicant_portfolio}": applicant.portfolio,
        "{contact_info}": contact_info,
    }

    rendered_subject = subject_template
    for key, val in replacements.items():
        rendered_subject = rendered_subject.replace(key, str(val))

    rendered_body = body_template
    for key, val in replacements.items():
        rendered_body = rendered_body.replace(key, str(val))

    return {
        "subject": rendered_subject.strip(),
        "body": rendered_body.strip(),
        "to_email": recipient.get("email", ""),
        "recipient_name": raw_name,
    }
