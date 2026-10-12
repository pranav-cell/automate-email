"""Streamlit Dashboard for Job Application Email Automation."""

import os
import time
import pandas as pd
import streamlit as st

from csv_parser import parse_csv_content
from database import (
    DEFAULT_DB_PATH,
    STATUS_DRY_RUN,
    STATUS_FAILED,
    STATUS_NEEDS_REVIEW,
    STATUS_PENDING,
    STATUS_SENT,
    clear_all_recipients,
    get_all_recipients,
    get_logs,
    get_statistics,
    init_db,
    log_send_event,
    reset_recipient_status,
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
    AmbiguousSendError,
    AuthenticationFailedError,
    RateLimitExceededError,
    get_gmail_service,
    send_single_message,
)

# Page configuration
st.set_page_config(
    page_title="Job Application Automator",
    page_icon="📬",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Initialize database
init_db(DEFAULT_DB_PATH)


def load_recipients_df(status_filter: str = "All") -> pd.DataFrame:
    """Load recipients into a clean pandas DataFrame for display."""
    recipients = get_all_recipients(DEFAULT_DB_PATH)
    if not recipients:
        return pd.DataFrame()
    df = pd.DataFrame(recipients)
    if status_filter != "All":
        df = df[df["status"] == status_filter]
    return df


# --- SIDEBAR CONFIGURATION ---
st.sidebar.title("⚙️ Control Panel")

st.sidebar.markdown("### 1. Gmail Authorization")
has_credentials = os.path.exists("credentials.json")
has_token = os.path.exists("token.json")

if has_token:
    st.sidebar.success("✅ Gmail authorized (`token.json` active)")
elif has_credentials:
    st.sidebar.warning("⚠️ `credentials.json` found. Needs authentication.")
    if st.sidebar.button("🔑 Authorize Gmail Account"):
        with st.spinner("Authorizing via browser..."):
            try:
                get_gmail_service("credentials.json", "token.json")
                st.sidebar.success("Successfully authenticated!")
                st.rerun()
            except Exception as e:
                st.sidebar.error(f"Auth error: {str(e)}")
else:
    st.sidebar.error("❌ Missing `credentials.json`")
    st.sidebar.caption("Follow Google Cloud Console steps in README to download your OAuth Desktop Client credentials.")

st.sidebar.markdown("---")
st.sidebar.markdown("### 2. Safety & Send Settings")
dry_run_mode = st.sidebar.toggle(
    "🧪 Dry-Run Mode (Simulation)",
    value=True,
    help="When enabled, runs full validation and mimics sends without connecting to or sending via Gmail.",
)

send_delay_sec = st.sidebar.slider(
    "⏱️ Delay between emails (seconds)",
    min_value=2,
    max_value=20,
    value=5,
    help="Conservative delay to comply with Gmail limits and prevent rate limit blocks.",
)

st.sidebar.markdown("---")
st.sidebar.markdown("### 3. Applicant Profile")
applicant_name = st.sidebar.text_input("Your Full Name", value="Pranav")
applicant_email = st.sidebar.text_input("Your Gmail / Contact Email", value="pranav@example.com")
applicant_phone = st.sidebar.text_input("Phone Number", value="")
applicant_linkedin = st.sidebar.text_input("LinkedIn Profile URL", value="")
applicant_github = st.sidebar.text_input("GitHub Profile URL", value="")
applicant_portfolio = st.sidebar.text_input("Portfolio / Website URL", value="")

applicant_profile = ApplicantProfile(
    name=applicant_name,
    email=applicant_email,
    phone=applicant_phone,
    linkedin=applicant_linkedin,
    github=applicant_github,
    portfolio=applicant_portfolio,
)

# --- MAIN APP LAYOUT ---
st.title("📬 Job Application Email Automator")
st.markdown(
    """
    **Local & Secure:** Direct OAuth 2.0 Gmail integration with SQLite recipient tracking, 
    duplicate protection, template customization, and PDF resume attachment.
    """
)

# Prominent Disclaimer Warning
st.warning(
    "⚠️ **Important Deliverability Notice**: This tool automates email dispatch via the official Gmail API from your personal account. "
    "It cannot guarantee 100% inbox placement (delivery depends on your sender reputation, message content, and recipient spam filters) "
    "nor can it verify if an email belongs to an active recruiter. Keep volume conservative to protect your domain reputation."
)

# Tab Navigation
tabs = st.tabs(["📊 Dashboard & Recipients", "📝 Template & Resume", "👁️ Live Preview", "🚀 Send Controls", "📜 Activity Logs"])

# ================= TAB 1: DASHBOARD & RECIPIENTS =================
with tabs[0]:
    stats = get_statistics(DEFAULT_DB_PATH)

    # Top Metric KPI Cards
    col1, col2, col3, col4, col5 = st.columns(5)
    col1.metric("Total Recipients", stats["total"])
    col2.metric("Pending", stats[STATUS_PENDING])
    col3.metric("Sent", stats[STATUS_SENT])
    col4.metric("Dry Run Tested", stats[STATUS_DRY_RUN])
    col5.metric("Needs Review / Failed", stats[STATUS_NEEDS_REVIEW] + stats[STATUS_FAILED])

    st.markdown("### 📥 Import Recipient CSV")
    uploaded_csv = st.file_uploader(
        "Upload recruiters CSV file (must include email column)",
        type=["csv"],
        help="Upload CSV with recruiters. Columns detected automatically: email, name, company, role, notes.",
    )

    if uploaded_csv is not None:
        file_bytes = uploaded_csv.getvalue().decode("utf-8", errors="ignore")
        existing_recs = get_all_recipients(DEFAULT_DB_PATH)
        existing_emails = {r["email"] for r in existing_recs}

        parse_res = parse_csv_content(file_bytes, existing_emails=existing_emails)

        if parse_res.warnings:
            with st.expander("⚠️ CSV Parse Warnings & Notes", expanded=True):
                for w in parse_res.warnings[:10]:
                    st.write(f"- {w}")
                if len(parse_res.warnings) > 10:
                    st.caption(f"...and {len(parse_res.warnings) - 10} more warnings.")

        if parse_res.duplicate_rows:
            with st.expander(f"🔁 Duplicate Emails Detected ({len(parse_res.duplicate_rows)})", expanded=False):
                for row_no, em, reason in parse_res.duplicate_rows:
                    st.write(f"- Row {row_no}: `{em}` ({reason})")

        if parse_res.invalid_rows:
            with st.expander(f"❌ Invalid Rows Skipped ({len(parse_res.invalid_rows)})", expanded=False):
                for row_no, raw, reason in parse_res.invalid_rows:
                    st.write(f"- Row {row_no}: `{raw}` - {reason}")

        st.info(
            f"Found **{len(parse_res.valid_rows)}** new, valid recipients to import "
            f"(out of {parse_res.total_parsed} parsed lines)."
        )

        if st.button("💾 Import Valid Recipients into Database", disabled=len(parse_res.valid_rows) == 0):
            imported = 0
            for r in parse_res.valid_rows:
                upsert_recipient(
                    DEFAULT_DB_PATH,
                    email=r.email,
                    name=r.name,
                    company=r.company,
                    role=r.role,
                    notes=r.notes,
                )
                imported += 1
            st.success(f"Successfully imported {imported} recipients!")
            time.sleep(0.5)
            st.rerun()

    st.markdown("---")
    st.markdown("### 📋 Recipient Directory")

    c_filter, c_search, c_reset = st.columns([2, 3, 2])
    with c_filter:
        selected_status = st.selectbox(
            "Filter by status",
            options=["All", STATUS_PENDING, STATUS_SENT, STATUS_DRY_RUN, STATUS_NEEDS_REVIEW, STATUS_FAILED],
        )
    with c_search:
        search_query = st.text_input("🔍 Search by name, company, or email", placeholder="Type to filter...")
    with c_reset:
        st.write("")
        st.write("")
        if st.button("🗑️ Clear Database", help="Reset all recipients and logs"):
            clear_all_recipients(DEFAULT_DB_PATH)
            st.warning("Database cleared.")
            time.sleep(0.5)
            st.rerun()

    df = load_recipients_df(selected_status)
    if not df.empty:
        if search_query:
            q = search_query.lower()
            df = df[
                df["email"].str.lower().str.contains(q, na=False)
                | df["name"].str.lower().str.contains(q, na=False)
                | df["company"].str.lower().str.contains(q, na=False)
            ]

        display_cols = ["id", "email", "name", "company", "role", "status", "attempt_count", "sent_at", "last_error"]
        present_cols = [c for c in display_cols if c in df.columns]
        st.dataframe(df[present_cols], use_container_width=True, hide_index=True)

        # Action for NEEDS_REVIEW / FAILED items
        needs_review_df = df[df["status"].isin([STATUS_NEEDS_REVIEW, STATUS_FAILED])]
        if not needs_review_df.empty:
            st.markdown("#### 🛠️ Reset Flagged Recipients")
            rec_to_reset = st.selectbox(
                "Select a recipient to reset back to PENDING",
                options=needs_review_df["id"].tolist(),
                format_func=lambda x: f"ID {x}: {needs_review_df[needs_review_df['id'] == x]['email'].values[0]}",
            )
            if st.button("Reset Selected Recipient to PENDING"):
                reset_recipient_status(rec_to_reset, STATUS_PENDING, DEFAULT_DB_PATH)
                st.success("Recipient reset to PENDING.")
                time.sleep(0.5)
                st.rerun()
    else:
        st.info("No recipients currently in database. Upload a CSV above or use `sample_recruiters.csv`.")


# ================= TAB 2: TEMPLATE & RESUME =================
with tabs[1]:
    st.markdown("### 📎 Resume Attachment (PDF)")
    resume_file = st.file_uploader(
        "Upload your PDF Resume",
        type=["pdf"],
        help="Upload the PDF resume to attach to each email. File must begin with %PDF- header and be under 10MB.",
    )

    pdf_bytes = None
    pdf_filename = "Resume.pdf"
    if resume_file is not None:
        pdf_bytes = resume_file.getvalue()
        pdf_filename = resume_file.name
        is_valid, err_msg, size_b = validate_pdf_attachment(pdf_bytes)
        if is_valid:
            st.success(f"✅ Valid PDF Resume attached: **{pdf_filename}** ({size_b / 1024:.1f} KB)")
            st.session_state["resume_bytes"] = pdf_bytes
            st.session_state["resume_name"] = pdf_filename
        else:
            st.error(f"❌ Invalid PDF: {err_msg}")
            st.session_state["resume_bytes"] = None
    elif "resume_bytes" in st.session_state and st.session_state["resume_bytes"]:
        pdf_bytes = st.session_state["resume_bytes"]
        pdf_filename = st.session_state.get("resume_name", "Resume.pdf")
        st.info(f"Using previously loaded resume: **{pdf_filename}**")
    else:
        st.warning("No PDF resume uploaded yet. Emails will be sent without an attachment unless uploaded.")

    st.markdown("---")
    st.markdown("### ✉️ Email Template Editor")
    st.caption("Available variables: `{name}`, `{first_name}`, `{company}`, `{role}`, `{applicant_name}`, `{contact_info}`")

    if "subject_tmpl" not in st.session_state:
        st.session_state["subject_tmpl"] = DEFAULT_SUBJECT_TEMPLATE
    if "body_tmpl" not in st.session_state:
        st.session_state["body_tmpl"] = DEFAULT_BODY_TEMPLATE

    subject_tmpl = st.text_input("Email Subject Template", value=st.session_state["subject_tmpl"])
    body_tmpl = st.text_area("Email Body Template", value=st.session_state["body_tmpl"], height=280)

    st.session_state["subject_tmpl"] = subject_tmpl
    st.session_state["body_tmpl"] = body_tmpl


# ================= TAB 3: LIVE PREVIEW =================
with tabs[2]:
    st.markdown("### 👁️ Recipient Preview")
    all_recs = get_all_recipients(DEFAULT_DB_PATH)

    if not all_recs:
        st.info("Import or add recipients in Tab 1 to preview personalized emails.")
    else:
        selected_rec_id = st.selectbox(
            "Select Recipient to Preview",
            options=[r["id"] for r in all_recs],
            format_func=lambda x: f"{[r['name'] for r in all_recs if r['id'] == x][0] or 'No Name'} <{[r['email'] for r in all_recs if r['id'] == x][0]}> ({[r['company'] for r in all_recs if r['id'] == x][0] or 'No Company'})",
        )
        rec_dict = [r for r in all_recs if r["id"] == selected_rec_id][0]

        rendered = render_email(
            subject_template=st.session_state["subject_tmpl"],
            body_template=st.session_state["body_tmpl"],
            recipient=rec_dict,
            applicant=applicant_profile,
        )

        st.markdown(f"**To:** `{rendered['to_email']}`")
        st.markdown(f"**Subject:** `{rendered['subject']}`")
        if st.session_state.get("resume_bytes"):
            st.markdown(f"**Attachment:** 📎 `{st.session_state.get('resume_name', 'Resume.pdf')}`")
        else:
            st.markdown("**Attachment:** *None*")

        st.markdown("---")
        st.text_area("Rendered Message Body", value=rendered["body"], height=250, disabled=True)


# ================= TAB 4: SEND CONTROLS =================
with tabs[3]:
    st.markdown("### 🧪 Step A: Send Test Message to Yourself")
    st.caption("Verify formatting, spacing, and PDF attachment by sending a test message strictly to your own email address.")

    test_email_target = st.text_input("Your Test Email Address", value=applicant_email)
    col_t1, col_t2 = st.columns([2, 5])
    with col_t1:
        if st.button("📤 Send Test Email"):
            if not test_email_target or "@" not in test_email_target:
                st.error("Please enter a valid test email address.")
            else:
                try:
                    service = None
                    if not dry_run_mode:
                        service = get_gmail_service("credentials.json", "token.json")

                    dummy_recipient = {
                        "name": applicant_name,
                        "company": "Your Company",
                        "role": "Software Engineer",
                        "email": test_email_target,
                    }
                    rendered_test = render_email(
                        subject_template="[TEST] " + st.session_state["subject_tmpl"],
                        body_template=st.session_state["body_tmpl"],
                        recipient=dummy_recipient,
                        applicant=applicant_profile,
                    )

                    with st.spinner("Dispatching test message..."):
                        test_res = send_single_message(
                            service=service,
                            sender_email=applicant_email,
                            to_email=test_email_target,
                            subject=rendered_test["subject"],
                            body_text=rendered_test["body"],
                            attachment_bytes=st.session_state.get("resume_bytes"),
                            attachment_filename=st.session_state.get("resume_name", "Resume.pdf"),
                            dry_run=dry_run_mode,
                        )
                    if test_res.get("dry_run"):
                        st.info(f"🧪 Dry-run test simulated successfully for `{test_email_target}`.")
                    else:
                        st.success(f"🎉 Live test email sent successfully to `{test_email_target}`!")
                except Exception as e:
                    st.error(f"Failed to send test email: {str(e)}")

    st.markdown("---")
    st.markdown("### 🚀 Step B: Batch Send Execution")

    pending_recipients = get_all_recipients(DEFAULT_DB_PATH, status=STATUS_PENDING)
    st.write(f"Eligible recipients with `PENDING` status: **{len(pending_recipients)}**")

    if dry_run_mode:
        st.info("Mode: **DRY-RUN IS ENABLED**. Executing this batch will simulate sends and update status to `DRY_RUN`.")
    else:
        st.warning("Mode: **LIVE SENDING IS ENABLED**. Real emails will be sent via Gmail.")

    confirm_batch = False
    if not dry_run_mode:
        confirm_batch = st.checkbox(
            "I explicitly confirm that I want to send REAL application emails to the pending recipients.",
            value=False,
        )

    col_btn1, col_btn2 = st.columns([2, 2])
    with col_btn1:
        start_batch = st.button(
            "▶️ Start Batch Process",
            disabled=(len(pending_recipients) == 0) or (not dry_run_mode and not confirm_batch),
            type="primary",
        )
    with col_btn2:
        stop_batch = st.button("⏹️ Stop Batch")

    if start_batch:
        st.session_state["abort_batch"] = False
        progress_bar = st.progress(0)
        status_text = st.empty()
        gmail_srv = None

        if not dry_run_mode:
            try:
                gmail_srv = get_gmail_service("credentials.json", "token.json")
            except Exception as e:
                st.error(f"Cannot initialize Gmail service: {str(e)}")
                st.stop()

        total_to_send = len(pending_recipients)
        processed = 0

        for i, rec in enumerate(pending_recipients):
            if st.session_state.get("abort_batch", False):
                status_text.warning("Batch stopped by user.")
                break

            rendered = render_email(
                subject_template=st.session_state["subject_tmpl"],
                body_template=st.session_state["body_tmpl"],
                recipient=rec,
                applicant=applicant_profile,
            )

            status_text.text(f"Processing ({i+1}/{total_to_send}): {rec['email']}...")

            try:
                res = send_single_message(
                    service=gmail_srv,
                    sender_email=applicant_email,
                    to_email=rec["email"],
                    subject=rendered["subject"],
                    body_text=rendered["body"],
                    attachment_bytes=st.session_state.get("resume_bytes"),
                    attachment_filename=st.session_state.get("resume_name", "Resume.pdf"),
                    dry_run=dry_run_mode,
                )

                if dry_run_mode:
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
                # Ambiguous: connection timeout, flag for review
                update_recipient_status(rec["id"], STATUS_NEEDS_REVIEW, error=str(e), db_path=DEFAULT_DB_PATH)
                log_send_event(
                    email=rec["email"],
                    status=STATUS_NEEDS_REVIEW,
                    recipient_id=rec["id"],
                    subject=rendered["subject"],
                    error_message=str(e),
                    db_path=DEFAULT_DB_PATH,
                )
                st.warning(f"⚠️ Ambiguous result for {rec['email']}: marked for manual review.")

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
                st.error(f"🛑 Critical stopping condition: {str(e)}")
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
                st.error(f"Error sending to {rec['email']}: {str(e)}")

            processed += 1
            progress_bar.progress(processed / total_to_send)

            # Polite sending delay between messages
            if i < total_to_send - 1:
                time.sleep(send_delay_sec)

        status_text.success(f"Batch completed! Processed {processed}/{total_to_send} recipients.")
        time.sleep(1)
        st.rerun()


# ================= TAB 5: ACTIVITY LOGS =================
with tabs[4]:
    st.markdown("### 📜 System Sending Logs")
    logs = get_logs(DEFAULT_DB_PATH, limit=100)
    if logs:
        df_logs = pd.DataFrame(logs)
        st.dataframe(df_logs, use_container_width=True, hide_index=True)
    else:
        st.info("No activity logged yet.")
