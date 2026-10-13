"""FastAPI Backend Server for Job Application Email Automator."""

import json
import os
import threading
import time
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from csv_parser import (
    infer_company_from_email,
    is_valid_email,
    normalize_email,
    parse_csv_content,
)

from database import (
    DEFAULT_DB_PATH,
    STATUS_DRY_RUN,
    STATUS_FAILED,
    STATUS_NEEDS_REVIEW,
    STATUS_PENDING,
    STATUS_SENT,
    clear_all_recipients,
    delete_recipient,
    get_all_recipients,
    get_logs,
    get_recipient_by_id,
    get_setting,
    get_statistics,
    init_db,
    log_send_event,
    reset_recipient_status,
    set_setting,
    update_recipient_details,
    update_recipient_status,
    upsert_recipient,
)
from email_builder import validate_pdf_attachment
from email_templates import (
    DEFAULT_BODY_TEMPLATE,
    DEFAULT_SUBJECT_TEMPLATE,
    ApplicantProfile,
    render_email,
)
from gmail_service import (
    CREDENTIALS_FILE,
    TOKEN_FILE,
    AmbiguousSendError,
    AuthenticationFailedError,
    RateLimitExceededError,
    get_gmail_service,
    send_single_message,
)

# Initialize SQLite database
init_db(DEFAULT_DB_PATH)

app = FastAPI(title="Job Application Automator API", version="1.0.0")

# Enable CORS for React frontend (Vite runs on port 5173 by default)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOCAL_RESUME_FILE = "saved_resume.pdf"

# Global in-memory state for batch sender and active resume
STATE = {
    "resume_bytes": None,
    "resume_name": None,
    "resume_size": 0,
    "batch_running": False,
    "batch_abort": False,
    "batch_progress": {
        "total": 0,
        "processed": 0,
        "current_email": "",
        "status": "idle",
        "message": "",
    },
    "subject_template": DEFAULT_SUBJECT_TEMPLATE,
    "body_template": DEFAULT_BODY_TEMPLATE,
    "applicant": {
        "name": "Pranav",
        "email": "pranav@example.com",
        "phone": "",
        "linkedin": "",
        "github": "",
        "portfolio": "",
    },
}


def load_persistent_state() -> None:
    """Load settings and saved PDF resume from local storage and SQLite."""
    # 1. Load Subject Template
    saved_subj = get_setting("subject_template")
    if saved_subj:
        STATE["subject_template"] = saved_subj

    # 2. Load Body Template
    saved_body = get_setting("body_template")
    if saved_body:
        STATE["body_template"] = saved_body

    # 3. Load Applicant Profile
    saved_app = get_setting("applicant_profile")
    if saved_app:
        try:
            STATE["applicant"] = json.loads(saved_app)
        except Exception:
            pass

    # 4. Load Saved Resume PDF
    saved_name = get_setting("resume_name") or "Resume.pdf"
    if os.path.exists(LOCAL_RESUME_FILE):
        try:
            with open(LOCAL_RESUME_FILE, "rb") as f:
                content = f.read()
            is_valid, _, size_b = validate_pdf_attachment(content)
            if is_valid:
                STATE["resume_bytes"] = content
                STATE["resume_name"] = saved_name
                STATE["resume_size"] = size_b
        except Exception:
            pass


# Load persistent configuration on module initialization
load_persistent_state()



class TemplateUpdateRequest(BaseModel):
    subject_template: str
    body_template: str
    applicant: Dict[str, str]


class TestSendRequest(BaseModel):
    to_email: str
    dry_run: bool = True
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    applicant: Optional[Dict[str, str]] = None


class SingleSendRequest(BaseModel):
    dry_run: bool = False
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    applicant: Optional[Dict[str, str]] = None


class CustomSendRequest(BaseModel):
    email: str
    name: Optional[str] = ""
    company: Optional[str] = ""
    role: Optional[str] = ""
    notes: Optional[str] = ""
    dry_run: bool = False
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    applicant: Optional[Dict[str, str]] = None


class CustomPreviewRequest(BaseModel):
    email: str
    name: Optional[str] = ""
    company: Optional[str] = ""
    role: Optional[str] = ""
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    applicant: Optional[Dict[str, str]] = None



class BatchStartRequest(BaseModel):
    dry_run: bool = True
    delay_seconds: int = 5
    confirmed: bool = False
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    applicant: Optional[Dict[str, str]] = None


class RecipientImportItem(BaseModel):
    email: str
    name: str = ""
    company: str = ""
    role: str = ""
    notes: str = ""


class RecipientImportRequest(BaseModel):
    recipients: List[RecipientImportItem]


@app.get("/api/status")
def get_system_status():
    """Return auth status, database statistics, and app state."""
    has_creds = os.path.exists(CREDENTIALS_FILE)
    has_tok = os.path.exists(TOKEN_FILE)
    stats = get_statistics(DEFAULT_DB_PATH)

    return {
        "has_credentials": has_creds,
        "has_token": has_tok,
        "stats": stats,
        "has_resume": STATE["resume_bytes"] is not None,
        "resume_name": STATE["resume_name"],
        "resume_size": STATE["resume_size"],
        "batch_running": STATE["batch_running"],
        "subject_template": STATE["subject_template"],
        "body_template": STATE["body_template"],
        "applicant": STATE["applicant"],
    }


@app.get("/api/recipients")
def list_recipients(status: Optional[str] = None, search: Optional[str] = None):
    """Retrieve recipients with optional status and text search filtering."""
    recs = get_all_recipients(DEFAULT_DB_PATH, status=status if status and status != "All" else None)
    if search:
        s = search.lower()
        recs = [
            r
            for r in recs
            if s in (r.get("email") or "").lower()
            or s in (r.get("name") or "").lower()
            or s in (r.get("company") or "").lower()
            or s in (r.get("role") or "").lower()
        ]
    return recs


@app.post("/api/recipients/import")
def import_recipients(req: RecipientImportRequest):
    """Import valid recipients into database."""
    count = 0
    for r in req.recipients:
        upsert_recipient(
            DEFAULT_DB_PATH,
            email=r.email,
            name=r.name,
            company=r.company,
            role=r.role,
            notes=r.notes,
        )
        count += 1
    return {"status": "ok", "imported": count}


@app.post("/api/recipients/reset/{recipient_id}")
def reset_recipient(recipient_id: int):
    """Reset single recipient back to PENDING status."""
    ok = reset_recipient_status(recipient_id, STATUS_PENDING, DEFAULT_DB_PATH)
    if not ok:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {"status": "ok", "message": f"Recipient {recipient_id} reset to PENDING"}


@app.delete("/api/recipients/{recipient_id}")
def delete_single_recipient(recipient_id: int):
    """Delete a single recipient and their logs."""
    ok = delete_recipient(recipient_id, DEFAULT_DB_PATH)
    if not ok:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {"status": "ok", "message": f"Recipient {recipient_id} deleted"}


@app.put("/api/recipients/{recipient_id}")
def update_single_recipient(recipient_id: int, req: RecipientImportItem):
    """Update details of a single recipient."""
    from csv_parser import is_valid_email
    if not is_valid_email(req.email):
        raise HTTPException(status_code=400, detail="Invalid email address format")

    ok = update_recipient_details(
        recipient_id,
        email=req.email,
        name=req.name,
        company=req.company,
        role=req.role,
        notes=req.notes,
        db_path=DEFAULT_DB_PATH,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return {"status": "ok", "message": f"Recipient {recipient_id} updated successfully"}


@app.delete("/api/recipients/clear")
def clear_database():
    """Clear all recipients and logs."""
    clear_all_recipients(DEFAULT_DB_PATH)
    return {"status": "ok", "message": "Database cleared"}



@app.post("/api/upload-csv")
async def upload_csv(file: UploadFile = File(...)):
    """Parse and validate uploaded CSV file without modifying database."""
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")
    existing_recs = get_all_recipients(DEFAULT_DB_PATH)
    existing_emails = {r["email"] for r in existing_recs}

    parsed = parse_csv_content(text, existing_emails=existing_emails)

    return {
        "total_parsed": parsed.total_parsed,
        "valid_count": len(parsed.valid_rows),
        "valid_rows": [
            {
                "email": r.email,
                "name": r.name,
                "company": r.company,
                "role": r.role,
                "notes": r.notes,
                "row_number": r.row_number,
            }
            for r in parsed.valid_rows
        ],
        "duplicate_rows": [{"row": row, "email": em, "reason": reason} for row, em, reason in parsed.duplicate_rows],
        "invalid_rows": [{"row": row, "raw": raw, "reason": reason} for row, raw, reason in parsed.invalid_rows],
        "warnings": parsed.warnings,
    }


@app.post("/api/upload-resume")
async def upload_resume(file: UploadFile = File(...)):
    """Upload, validate, and persist PDF resume locally."""
    content = await file.read()
    is_valid, err_msg, size_b = validate_pdf_attachment(content)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid PDF: {err_msg}")

    # 1. Save PDF file locally to disk
    try:
        with open(LOCAL_RESUME_FILE, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save PDF locally: {str(e)}")

    filename = file.filename or "Resume.pdf"
    STATE["resume_bytes"] = content
    STATE["resume_name"] = filename
    STATE["resume_size"] = size_b

    # 2. Persist filename in SQLite settings
    set_setting("resume_name", filename)

    return {
        "status": "ok",
        "filename": filename,
        "size_bytes": size_b,
        "size_kb": round(size_b / 1024, 1),
    }


@app.post("/api/template")
def update_template(req: TemplateUpdateRequest):
    """Update active email template and applicant profile and persist to SQLite."""
    STATE["subject_template"] = req.subject_template
    STATE["body_template"] = req.body_template
    STATE["applicant"] = req.applicant

    # Persist locally in SQLite
    set_setting("subject_template", req.subject_template)
    set_setting("body_template", req.body_template)
    set_setting("applicant_profile", json.dumps(req.applicant))

    return {"status": "ok"}



@app.get("/api/preview/{recipient_id}")
def preview_email(recipient_id: int):
    """Render preview for a specific recipient."""
    rec = get_recipient_by_id(recipient_id, DEFAULT_DB_PATH)
    if not rec:
        raise HTTPException(status_code=404, detail="Recipient not found")

    app_prof = ApplicantProfile(**STATE["applicant"])
    rendered = render_email(
        subject_template=STATE["subject_template"],
        body_template=STATE["body_template"],
        recipient=rec,
        applicant=app_prof,
    )
    return {
        "recipient": rec,
        "rendered": rendered,
        "has_attachment": STATE["resume_bytes"] is not None,
        "attachment_name": STATE["resume_name"],
    }


@app.post("/api/preview/custom")
def preview_custom_email(req: CustomPreviewRequest):
    """Render preview for an on-the-fly custom email recipient."""
    email_clean = normalize_email(req.email) if req.email else "recipient@example.com"
    company_val = req.company or (infer_company_from_email(email_clean) if email_clean else "")
    dummy_rec = {
        "email": email_clean,
        "name": req.name or "",
        "company": company_val,
        "role": req.role or "",
    }
    app_prof = ApplicantProfile(**(req.applicant or STATE["applicant"]))
    subj_tmpl = req.subject_template or STATE["subject_template"]
    body_tmpl = req.body_template or STATE["body_template"]
    rendered = render_email(
        subject_template=subj_tmpl,
        body_template=body_tmpl,
        recipient=dummy_rec,
        applicant=app_prof,
    )
    return {
        "recipient": dummy_rec,
        "rendered": rendered,
        "has_attachment": STATE["resume_bytes"] is not None,
        "attachment_name": STATE["resume_name"],
    }


@app.post("/api/auth/login")
def authorize_gmail():
    """Trigger OAuth 2.0 flow for desktop."""
    if not os.path.exists(CREDENTIALS_FILE):
        raise HTTPException(
            status_code=400,
            detail="credentials.json not found in project folder. Follow README instructions to add it.",
        )
    try:
        get_gmail_service(CREDENTIALS_FILE, TOKEN_FILE)
        return {"status": "ok", "message": "Successfully authenticated with Gmail!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authentication failed: {str(e)}")


@app.post("/api/send/test")
def send_test_email(req: TestSendRequest):
    """Send test email strictly to user's address."""
    app_prof = ApplicantProfile(**(req.applicant or STATE["applicant"]))
    subj_tmpl = req.subject_template or STATE["subject_template"]
    body_tmpl = req.body_template or STATE["body_template"]

    dummy_rec = {
        "name": app_prof.name,
        "company": "Your Company",
        "role": "Software Engineer",
        "email": req.to_email,
    }
    rendered = render_email(
        subject_template="[TEST] " + subj_tmpl,
        body_template=body_tmpl,
        recipient=dummy_rec,
        applicant=app_prof,
    )

    try:
        service = None
        if not req.dry_run:
            service = get_gmail_service(CREDENTIALS_FILE, TOKEN_FILE)

        res = send_single_message(
            service=service,
            sender_email=app_prof.email,
            to_email=req.to_email,
            subject=rendered["subject"],
            body_text=rendered["body"],
            attachment_bytes=STATE["resume_bytes"],
            attachment_filename=STATE["resume_name"] or "Resume.pdf",
            dry_run=req.dry_run,
        )
        return {"status": "ok", "result": res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/send/single/{recipient_id}")
def send_single_recipient_email(recipient_id: int, req: SingleSendRequest):
    """Dispatch email to a specific individual recipient."""
    rec = get_recipient_by_id(recipient_id, DEFAULT_DB_PATH)
    if not rec:
        raise HTTPException(status_code=404, detail="Recipient not found")

    app_prof = ApplicantProfile(**(req.applicant or STATE["applicant"]))
    subj_tmpl = req.subject_template or STATE["subject_template"]
    body_tmpl = req.body_template or STATE["body_template"]

    rendered = render_email(
        subject_template=subj_tmpl,
        body_template=body_tmpl,
        recipient=rec,
        applicant=app_prof,
    )

    try:
        service = None
        if not req.dry_run:
            service = get_gmail_service(CREDENTIALS_FILE, TOKEN_FILE)

        res = send_single_message(
            service=service,
            sender_email=app_prof.email,
            to_email=rec["email"],
            subject=rendered["subject"],
            body_text=rendered["body"],
            attachment_bytes=STATE["resume_bytes"],
            attachment_filename=STATE["resume_name"] or "Resume.pdf",
            dry_run=req.dry_run,
        )

        new_status = STATUS_DRY_RUN if req.dry_run else STATUS_SENT
        update_recipient_status(rec["id"], new_status, increment_attempt=not req.dry_run, db_path=DEFAULT_DB_PATH)
        log_send_event(
            email=rec["email"],
            status=new_status,
            recipient_id=rec["id"],
            subject=rendered["subject"],
            db_path=DEFAULT_DB_PATH,
        )

        return {"status": "ok", "result": res, "recipient": rec}
    except Exception as e:
        update_recipient_status(rec["id"], STATUS_FAILED, error=str(e), db_path=DEFAULT_DB_PATH)
        log_send_event(
            email=rec["email"],
            status=STATUS_FAILED,
            recipient_id=rec["id"],
            subject=rendered["subject"],
            error_message=str(e),
            db_path=DEFAULT_DB_PATH,
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/send/custom")
def send_custom_email(req: CustomSendRequest):
    """Dispatch email to any custom recipient email address directly."""
    email_clean = normalize_email(req.email)
    if not is_valid_email(email_clean):
        raise HTTPException(status_code=400, detail="Invalid email address format.")

    company_val = req.company or infer_company_from_email(email_clean)
    rec_id, _ = upsert_recipient(
        DEFAULT_DB_PATH,
        email_clean,
        name=req.name or "",
        company=company_val,
        role=req.role or "",
        notes=req.notes or "Custom outreach",
    )
    rec = get_recipient_by_id(rec_id, DEFAULT_DB_PATH)

    app_prof = ApplicantProfile(**(req.applicant or STATE["applicant"]))
    subj_tmpl = req.subject_template or STATE["subject_template"]
    body_tmpl = req.body_template or STATE["body_template"]

    rendered = render_email(
        subject_template=subj_tmpl,
        body_template=body_tmpl,
        recipient=rec,
        applicant=app_prof,
    )

    try:
        service = None
        if not req.dry_run:
            service = get_gmail_service(CREDENTIALS_FILE, TOKEN_FILE)

        res = send_single_message(
            service=service,
            sender_email=app_prof.email,
            to_email=rec["email"],
            subject=rendered["subject"],
            body_text=rendered["body"],
            attachment_bytes=STATE["resume_bytes"],
            attachment_filename=STATE["resume_name"] or "Resume.pdf",
            dry_run=req.dry_run,
        )

        new_status = STATUS_DRY_RUN if req.dry_run else STATUS_SENT
        update_recipient_status(rec["id"], new_status, increment_attempt=not req.dry_run, db_path=DEFAULT_DB_PATH)
        log_send_event(
            email=rec["email"],
            status=new_status,
            recipient_id=rec["id"],
            subject=rendered["subject"],
            db_path=DEFAULT_DB_PATH,
        )

        return {"status": "ok", "result": res, "recipient": rec, "rendered": rendered}
    except Exception as e:
        update_recipient_status(rec["id"], STATUS_FAILED, error=str(e), db_path=DEFAULT_DB_PATH)
        log_send_event(
            email=rec["email"],
            status=STATUS_FAILED,
            recipient_id=rec["id"],
            subject=rendered["subject"],
            error_message=str(e),
            db_path=DEFAULT_DB_PATH,
        )
        raise HTTPException(status_code=500, detail=str(e))



def run_batch_thread(req: BatchStartRequest):
    """Worker running the batch send process sequentially with safety halts."""
    STATE["batch_running"] = True
    STATE["batch_abort"] = False

    app_prof = ApplicantProfile(**(req.applicant or STATE["applicant"]))
    subj_tmpl = req.subject_template or STATE["subject_template"]
    body_tmpl = req.body_template or STATE["body_template"]

    pending = get_all_recipients(DEFAULT_DB_PATH, status=STATUS_PENDING)
    total = len(pending)

    STATE["batch_progress"] = {
        "total": total,
        "processed": 0,
        "current_email": "",
        "status": "running",
        "message": f"Processing batch of {total} recipients...",
    }

    gmail_srv = None
    if not req.dry_run:
        try:
            gmail_srv = get_gmail_service(CREDENTIALS_FILE, TOKEN_FILE)
        except Exception as e:
            STATE["batch_running"] = False
            STATE["batch_progress"]["status"] = "error"
            STATE["batch_progress"]["message"] = f"Gmail auth error: {str(e)}"
            return

    for i, rec in enumerate(pending):
        if STATE["batch_abort"]:
            STATE["batch_progress"]["message"] = "Batch aborted by user."
            break

        STATE["batch_progress"]["current_email"] = rec["email"]
        rendered = render_email(
            subject_template=subj_tmpl,
            body_template=body_tmpl,
            recipient=rec,
            applicant=app_prof,
        )

        try:
            res = send_single_message(
                service=gmail_srv,
                sender_email=app_prof.email,
                to_email=rec["email"],
                subject=rendered["subject"],
                body_text=rendered["body"],
                attachment_bytes=STATE["resume_bytes"],
                attachment_filename=STATE["resume_name"] or "Resume.pdf",
                dry_run=req.dry_run,
            )

            if req.dry_run:
                update_recipient_status(rec["id"], STATUS_DRY_RUN, db_path=DEFAULT_DB_PATH)
                log_send_event(
                    email=rec["email"],
                    status=STATUS_DRY_RUN,
                    recipient_id=rec["id"],
                    subject=rendered["subject"],
                    db_path=DEFAULT_DB_PATH,
                )
            else:
                update_recipient_status(rec["id"], STATUS_SENT, increment_attempt=True, db_path=DEFAULT_DB_PATH)
                log_send_event(
                    email=rec["email"],
                    status=STATUS_SENT,
                    recipient_id=rec["id"],
                    subject=rendered["subject"],
                    db_path=DEFAULT_DB_PATH,
                )

        except AmbiguousSendError as e:
            update_recipient_status(rec["id"], STATUS_NEEDS_REVIEW, error=str(e), db_path=DEFAULT_DB_PATH)
            log_send_event(
                email=rec["email"],
                status=STATUS_NEEDS_REVIEW,
                recipient_id=rec["id"],
                subject=rendered["subject"],
                error_message=str(e),
                db_path=DEFAULT_DB_PATH,
            )
        except (RateLimitExceededError, AuthenticationFailedError) as e:
            update_recipient_status(rec["id"], STATUS_FAILED, error=str(e), db_path=DEFAULT_DB_PATH)
            log_send_event(
                email=rec["email"],
                status=STATUS_FAILED,
                recipient_id=rec["id"],
                subject=rendered["subject"],
                error_message=str(e),
                db_path=DEFAULT_DB_PATH,
            )
            STATE["batch_progress"]["status"] = "error"
            STATE["batch_progress"]["message"] = f"Critical stop: {str(e)}"
            break
        except Exception as e:
            update_recipient_status(rec["id"], STATUS_FAILED, error=str(e), db_path=DEFAULT_DB_PATH)
            log_send_event(
                email=rec["email"],
                status=STATUS_FAILED,
                recipient_id=rec["id"],
                subject=rendered["subject"],
                error_message=str(e),
                db_path=DEFAULT_DB_PATH,
            )

        STATE["batch_progress"]["processed"] = i + 1

        if i < total - 1 and not STATE["batch_abort"]:
            time.sleep(req.delay_seconds)

    STATE["batch_running"] = False
    if STATE["batch_progress"]["status"] != "error":
        STATE["batch_progress"]["status"] = "finished"
        STATE["batch_progress"]["message"] = (
            f"Finished! Successfully processed {STATE['batch_progress']['processed']}/{total} recipients."
        )


@app.post("/api/batch/start")
def start_batch(req: BatchStartRequest):
    """Start batch dispatch in background thread."""
    if STATE["batch_running"]:
        raise HTTPException(status_code=400, detail="Batch is already running")

    if not req.dry_run and not req.confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation required for live send")

    t = threading.Thread(target=run_batch_thread, args=(req,), daemon=True)
    t.start()
    return {"status": "ok", "message": "Batch process initiated"}


@app.post("/api/batch/stop")
def stop_batch():
    """Request abort of running batch."""
    STATE["batch_abort"] = True
    return {"status": "ok", "message": "Abort requested"}


@app.get("/api/batch/progress")
def get_batch_progress():
    """Get active batch progress."""
    return {
        "running": STATE["batch_running"],
        **STATE["batch_progress"],
    }


@app.get("/api/logs")
def get_activity_logs(limit: int = 100):
    """Retrieve system sending logs."""
    return get_logs(DEFAULT_DB_PATH, limit=limit)


# Mount static frontend production build if present
DIST_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.exists(DIST_DIR):
    assets_dir = os.path.join(DIST_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(DIST_DIR, full_path)
        if full_path and os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)

