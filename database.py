"""SQLite persistence and state-machine tracking for job application automation."""

import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_DB_PATH = "recipients.db"


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO 8601 string format."""
    return datetime.now(timezone.utc).isoformat()


# Valid status values
STATUS_PENDING = "PENDING"
STATUS_DRY_RUN = "DRY_RUN"
STATUS_SENT = "SENT"
STATUS_FAILED = "FAILED"
STATUS_NEEDS_REVIEW = "NEEDS_REVIEW"

VALID_STATUSES = {
    STATUS_PENDING,
    STATUS_DRY_RUN,
    STATUS_SENT,
    STATUS_FAILED,
    STATUS_NEEDS_REVIEW,
}


def get_connection(db_path: str = DEFAULT_DB_PATH) -> sqlite3.Connection:
    """Get SQLite database connection with row factory configured."""
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: str = DEFAULT_DB_PATH) -> None:
    """Initialize database tables with appropriate schemas and indexes."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS recipients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                name TEXT,
                company TEXT,
                role TEXT,
                notes TEXT,
                status TEXT NOT NULL DEFAULT 'PENDING',
                attempt_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS send_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipient_id INTEGER,
                email TEXT NOT NULL COLLATE NOCASE,
                status TEXT NOT NULL,
                subject TEXT,
                error_message TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (recipient_id) REFERENCES recipients (id)
            )
            """
        )

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_recipients_status ON recipients(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_recipients_email ON recipients(email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON send_logs(timestamp)")
        conn.commit()


def upsert_recipient(
    db_path: str,
    email: str,
    name: str = "",
    company: str = "",
    role: str = "",
    notes: str = "",
) -> Tuple[int, bool]:
    """
    Insert a new recipient or update existing non-status details if not yet sent.
    Returns (recipient_id, is_new).
    """
    clean_email = email.strip().lower()
    clean_name = name.strip() if name else ""
    clean_company = company.strip() if company else ""
    clean_role = role.strip() if role else ""
    clean_notes = notes.strip() if notes else ""

    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, status FROM recipients WHERE email = ?", (clean_email,))
        row = cursor.fetchone()

        if row:
            rec_id, current_status = row["id"], row["status"]
            # Only update profile details, preserving SENT / NEEDS_REVIEW status
            cursor.execute(
                """
                UPDATE recipients
                SET name = COALESCE(NULLIF(?, ''), name),
                    company = COALESCE(NULLIF(?, ''), company),
                    role = COALESCE(NULLIF(?, ''), role),
                    notes = COALESCE(NULLIF(?, ''), notes),
                    updated_at = ?
                WHERE id = ?
                """,
                (clean_name, clean_company, clean_role, clean_notes, utc_now_iso(), rec_id),
            )
            conn.commit()
            return rec_id, False
        else:
            now = utc_now_iso()
            cursor.execute(
                """
                INSERT INTO recipients (email, name, company, role, notes, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clean_email,
                    clean_name,
                    clean_company,
                    clean_role,
                    clean_notes,
                    STATUS_PENDING,
                    now,
                    now,
                ),
            )
            conn.commit()
            return cursor.lastrowid, True


def get_all_recipients(db_path: str = DEFAULT_DB_PATH, status: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retrieve all recipients, optionally filtered by status."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        if status:
            cursor.execute("SELECT * FROM recipients WHERE status = ? ORDER BY id ASC", (status,))
        else:
            cursor.execute("SELECT * FROM recipients ORDER BY id ASC")
        return [dict(row) for row in cursor.fetchall()]


def get_recipient_by_id(recipient_id: int, db_path: str = DEFAULT_DB_PATH) -> Optional[Dict[str, Any]]:
    """Get single recipient by primary key."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM recipients WHERE id = ?", (recipient_id,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_recipient_by_email(email: str, db_path: str = DEFAULT_DB_PATH) -> Optional[Dict[str, Any]]:
    """Get single recipient by email address."""
    clean_email = email.strip().lower()
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM recipients WHERE email = ?", (clean_email,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_recipient_status(
    recipient_id: int,
    status: str,
    error: Optional[str] = None,
    increment_attempt: bool = False,
    db_path: str = DEFAULT_DB_PATH,
) -> bool:
    """
    Safely transition recipient status and prevent accidental duplicate sending.
    """
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}")

    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status, attempt_count FROM recipients WHERE id = ?", (recipient_id,))
        row = cursor.fetchone()
        if not row:
            return False

        current_status = row["status"]
        # Protect against re-sending already sent messages
        if current_status == STATUS_SENT and status != STATUS_SENT:
            # Prevent overwriting a completed send status unless explicitly reset
            return False

        now = utc_now_iso()
        sent_timestamp = now if status == STATUS_SENT else None

        if increment_attempt:
            cursor.execute(
                """
                UPDATE recipients
                SET status = ?,
                    last_error = ?,
                    attempt_count = attempt_count + 1,
                    sent_at = COALESCE(?, sent_at),
                    updated_at = ?
                WHERE id = ?
                """,
                (status, error, sent_timestamp, now, recipient_id),
            )
        else:
            cursor.execute(
                """
                UPDATE recipients
                SET status = ?,
                    last_error = ?,
                    sent_at = COALESCE(?, sent_at),
                    updated_at = ?
                WHERE id = ?
                """,
                (status, error, sent_timestamp, now, recipient_id),
            )

        conn.commit()
        return True


def log_send_event(
    email: str,
    status: str,
    recipient_id: Optional[int] = None,
    subject: Optional[str] = None,
    error_message: Optional[str] = None,
    db_path: str = DEFAULT_DB_PATH,
) -> None:
    """
    Log send action metadata.
    Never logs credentials, OAuth tokens, or sensitive message contents.
    """
    clean_email = email.strip().lower()
    safe_error = (error_message[:500] if error_message else None)

    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO send_logs (recipient_id, email, status, subject, error_message, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (recipient_id, clean_email, status, subject, safe_error, utc_now_iso()),
        )
        conn.commit()


def get_logs(db_path: str = DEFAULT_DB_PATH, limit: int = 100) -> List[Dict[str, Any]]:
    """Retrieve recent send logs."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM send_logs ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(row) for row in cursor.fetchall()]


def get_statistics(db_path: str = DEFAULT_DB_PATH) -> Dict[str, int]:
    """Retrieve counts across statuses."""
    stats = {
        "total": 0,
        STATUS_PENDING: 0,
        STATUS_DRY_RUN: 0,
        STATUS_SENT: 0,
        STATUS_FAILED: 0,
        STATUS_NEEDS_REVIEW: 0,
    }
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT status, COUNT(*) as cnt FROM recipients GROUP BY status")
        rows = cursor.fetchall()
        for r in rows:
            st = r["status"]
            cnt = r["cnt"]
            if st in stats:
                stats[st] = cnt
            stats["total"] += cnt
    return stats


def reset_recipient_status(recipient_id: int, new_status: str = STATUS_PENDING, db_path: str = DEFAULT_DB_PATH) -> bool:
    """Allow user to manually reset a failed or needs-review recipient back to PENDING."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE recipients
            SET status = ?, last_error = NULL, updated_at = ?
            WHERE id = ?
            """,
            (new_status, utc_now_iso(), recipient_id),
        )
        conn.commit()
        return cursor.rowcount > 0


def clear_all_recipients(db_path: str = DEFAULT_DB_PATH) -> None:
    """Clear all recipient and log data (user requested reset)."""
    with get_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM send_logs")
        cursor.execute("DELETE FROM recipients")
        conn.commit()
