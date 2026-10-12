# 📬 Gmail Job Application Automator

A secure, local, Streamlit-based application designed to automate cold job outreach to recruiters using the official Gmail API (OAuth 2.0).

---

## 🌟 Key Features

- **Direct Gmail API Integration**: Uses Google OAuth 2.0 Desktop credentials (`credentials.json`), requesting only the minimal `gmail.send` scope. No passwords stored.
- **Safety First & Dry-Run Mode**: Starts in **Dry-Run Mode by default** to test and validate emails without sending anything over the network.
- **Test-Send Mode**: Send a verified test email strictly to your own email address to check formatting and attachments before any batch run.
- **Explicit Batch Confirmation**: Batch sends require a separate, explicit checkbox confirmation.
- **Duplicate Prevention**: SQLite state-machine tracks `PENDING`, `DRY_RUN`, `SENT`, `FAILED`, and `NEEDS_REVIEW`. Prevents duplicate sends to the same recruiter.
- **Ambiguous Error Handling**: Network timeouts or unclear responses are flagged as `NEEDS_REVIEW` instead of blindly retrying, preventing accidental double emails.
- **Rate-Limit & Backoff Protection**: Configurable delays between messages (e.g. 5–10s) with exponential backoff on transient errors and immediate safe stop on quota errors.
- **CSV Import & Normalization**: Automatically normalizes emails, trims whitespace, validates syntax, and detects intra-file and cross-database duplicates.
- **PDF Resume Attachment**: Instant validation of PDF headers (`%PDF-`) and file sizes (< 10MB).
- **Privacy & Security**: Credentials, tokens, databases, and PDFs are excluded in `.gitignore`. Logs never store tokens or private message bodies.

---

## 📁 Project Structure

```text
job-application-automator/
├── app.py                 # Streamlit interactive dashboard
├── gmail_service.py       # Gmail OAuth 2.0 and API dispatch service
├── email_builder.py       # PDF validation and MIME multipart message assembly
├── email_templates.py     # Application email templates and placeholder substitution
├── database.py            # SQLite state machine, duplicate prevention, and logs
├── csv_parser.py          # CSV parser, email normalization, and duplicate detection
├── sample_recruiters.csv  # Example CSV with recruiter fields
├── requirements.txt       # Dependencies
├── pytest.ini             # Test configuration
├── .gitignore             # Safeguards credentials, tokens, and PDFs
├── tests/
│   └── test_automator.py  # Comprehensive test suite
└── README.md              # Setup and usage guide
```

---

## 🚀 Setup & Launch on Mac

### Step 1 — Set Up Your Virtual Environment

Open your Mac Terminal and navigate into this project folder:

```bash
cd /Users/pranav/Documents/automate-email
```

Activate the existing virtual environment:

```bash
source .venv/bin/activate
```

*(If you ever need to recreate it from scratch)*:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Step 2 — Run the Tests

Verify all components are working:

```bash
pytest
```

---

## 🔑 Step 3 — Create Your Gmail API Credentials

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in with the Gmail account you will send from.
2. Create a new project named **Job Application Automator**.
3. In the sidebar, navigate to **APIs & Services → Library**, search for **Gmail API**, and click **Enable**.
4. Configure the **OAuth consent screen**:
   - User Type: choose **External**.
   - Fill in App Name (e.g., `Job Application Automator`) and your email address.
   - Under **Test users**, add your own Gmail address (since the app is in testing mode).
5. Create your OAuth Client:
   - Navigate to **APIs & Services → Credentials**.
   - Click **+ Create Credentials → OAuth client ID**.
   - Application type: Select **Desktop app**.
   - Name: `Job Automator Desktop Client`.
   - Click **Create**, then click **Download JSON**.
6. Move the downloaded JSON file into this project folder and rename it:
   ```text
   credentials.json
   ```
   > 🔒 **Security Notice**: Never commit `credentials.json` or `token.json` to git or share them publicly. They are already listed in `.gitignore`.

---

## 🖥️ Step 4 — Launch the Dashboard

With your virtual environment activated, run:

```bash
streamlit run app.py
```

Streamlit will open the dashboard in your default browser at `http://localhost:8501`.

---

## 📬 Step 5 — Workflow for Your 61 Recruiters

1. **Authorize Gmail**:
   - In the sidebar under **1. Gmail Authorization**, click **Authorize Gmail Account**.
   - A Google sign-in window will open in your browser. Grant the application permission to send emails. (Your credentials token will be saved locally to `token.json`).
2. **Import Your 61 Recipient Addresses**:
   - In Tab 1 (**Dashboard & Recipients**), drag & drop your `recruiters.csv` file.
   - Review any duplicate or invalid email warnings.
   - Click **Import Valid Recipients into Database**.
3. **Upload Your Resume & Configure Message**:
   - In Tab 2 (**Template & Resume**), upload your PDF resume. The system validates the PDF file structure.
   - Customize the **Subject** and **Body** templates. You can use `{name}`, `{first_name}`, `{company}`, `{role}`, and `{applicant_name}`.
4. **Live Preview**:
   - In Tab 3 (**Live Preview**), select different imported recruiters from the dropdown to verify how personalized variables render.
5. **Dry-Run Test**:
   - Keep **Dry-Run Mode** toggled ON in the sidebar.
   - Go to Tab 4 (**Send Controls**) and click **Start Batch Process**. This simulates the full batch and marks items as `DRY_RUN` without touching Gmail.
6. **Send a Test Email to Yourself**:
   - In Tab 4 (**Step A: Send Test Message to Yourself**), turn off dry-run mode or test send directly to your personal email to review the exact formatting and attachment in your real inbox.
7. **Execute Live Batch**:
   - In the sidebar, turn OFF **Dry-Run Mode**.
   - Select your desired delay (recommended: 5–10 seconds between emails).
   - In Tab 4, check the confirmation box: *"I explicitly confirm that I want to send REAL application emails..."*
   - Click **▶️ Start Batch Process**.
   - You can click **⏹️ Stop Batch** at any moment to halt the sequence.

---

## ⚠️ Important Deliverability & Safety Advice

- **Inbox Placement**: Cold emailing cannot guarantee 100% inbox placement. Messages may land in Spam or Promotions depending on domain reputation, sending volume, and subject lines.
- **Recruiter Addresses**: The tool cannot verify whether an address belongs to an active employee. Always ensure your CSV list is current and verified.
- **Gmail Quotas**: Standard personal Gmail accounts have a sending limit of 500 emails per 24 hours (Workspace accounts allow up to 2,000). For cold outreach, keeping batches to 30–60 emails per day is recommended to protect your sender score.
