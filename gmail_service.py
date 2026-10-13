"""Gmail API client handling OAuth 2.0 authentication, rate limiting, and safe sending."""

import os
import time
import socket
from typing import Any, Dict, Optional, Tuple

from email_builder import create_mime_message, encode_mime_message

# Minimal required scope for sending emails
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]

CREDENTIALS_FILE = "credentials.json"
TOKEN_FILE = "token.json"


class AmbiguousSendError(Exception):
    """Raised when an API send attempt timed out or dropped after request was sent."""
    pass


class RateLimitExceededError(Exception):
    """Raised when Gmail API rate limit or daily sending quota is exceeded."""
    pass


class AuthenticationFailedError(Exception):
    """Raised when credentials are missing, revoked, or invalid."""
    pass


def get_gmail_service(
    credentials_path: str = CREDENTIALS_FILE,
    token_path: str = TOKEN_FILE,
) -> Any:
    """
    Authenticate and return an authorized Gmail API Resource instance.
    Uses credentials.json and saves refreshed tokens to token.json locally.
    """
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
    except ImportError as e:
        raise ImportError(f"Required Google API packages not installed: {e}")

    creds = None

    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception:
            creds = None

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception as e:
                creds = None

        if not creds:
            if not os.path.exists(credentials_path):
                raise FileNotFoundError(
                    f"'{credentials_path}' not found. Please download OAuth client credentials "
                    f"from Google Cloud Console and place in the project root."
                )
            flow = InstalledAppFlow.from_client_secrets_file(credentials_path, SCOPES)
            creds = flow.run_local_server(port=0)

        # Save authorized credentials to local token.json
        with open(token_path, "w") as token_file:
            token_file.write(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def send_single_message(
    service: Optional[Any],
    sender_email: str,
    to_email: str,
    subject: str,
    body_text: str,
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: Optional[str] = "Resume.pdf",
    dry_run: bool = True,
    max_retries: int = 2,
    base_backoff_sec: float = 2.0,
    sender_name: Optional[str] = "",
) -> Dict[str, Any]:
    """
    Send an email safely.
    - When dry_run is True: performs all MIME building & validation without calling Gmail.
    - Handles bounded retries for transient HTTP errors.
    - Detects ambiguous network timeouts and flags them without blind retries.
    - Respects rate limits and quotas.
    """
    # 1. Build and encode MIME message with full RFC 5322 compliance
    mime_msg = create_mime_message(
        sender_email=sender_email,
        to_email=to_email,
        subject=subject,
        body_text=body_text,
        attachment_bytes=attachment_bytes,
        attachment_filename=attachment_filename,
        sender_name=sender_name,
    )
    raw_encoded = encode_mime_message(mime_msg)

    # 2. Dry run bypass
    if dry_run:
        return {
            "dry_run": True,
            "status": "SIMULATED_SUCCESS",
            "message_id": f"dry-run-{int(time.time() * 1000)}",
            "to": to_email,
            "subject": subject,
        }

    # 3. Validation for live sending
    if service is None:
        raise AuthenticationFailedError("Gmail service is not authenticated.")

    attempts = 0
    while True:
        attempts += 1
        try:
            call = service.users().messages().send(userId="me", body={"raw": raw_encoded})
            result = call.execute()
            return {
                "dry_run": False,
                "status": "SUCCESS",
                "message_id": result.get("id"),
                "thread_id": result.get("threadId"),
                "to": to_email,
                "subject": subject,
            }
        except (socket.timeout, TimeoutError) as e:
            # Ambiguous: request might have reached Gmail servers. DO NOT RETRY.
            raise AmbiguousSendError(
                f"Connection timed out while waiting for Gmail response ({str(e)}). "
                f"Message may have been sent. Marked for manual review to avoid duplicates."
            ) from e
        except Exception as e:
            err_str = str(e).lower()

            # Rate limit or quota errors
            if "quotaexceeded" in err_str or "rate limit" in err_str or "429" in err_str:
                raise RateLimitExceededError(f"Gmail rate limit or sending quota reached: {str(e)}") from e

            # Authentication errors
            if "invalid_grant" in err_str or "401" in err_str or "auth" in err_str:
                raise AuthenticationFailedError(f"Gmail authentication failure: {str(e)}") from e

            # Transient errors (500, 502, 503, 504, backend error)
            is_transient = any(code in err_str for code in ["500", "502", "503", "504", "backenderror"])
            if is_transient and attempts <= max_retries:
                delay = base_backoff_sec * (2 ** (attempts - 1))
                time.sleep(delay)
                continue

            # Non-transient or exhausted retries
            raise e
