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

## 🖥️ Step 4 — Launch the Application

You can launch either the modern **React Web UI** or the classic **Streamlit Dashboard**:

### Option A: Launch the React Web UI (Recommended)

1. Start the backend server:
   ```bash
   source .venv/bin/activate
   python server.py
   ```
2. Open your browser to:
   ```text
   http://127.0.0.1:8000
   ```
   *(The pre-built React application is served directly by the backend!)*

   *If you want to run Vite dev mode with hot reload:*
   ```bash
   # In a separate terminal tab:
   cd frontend
   npm run dev
   # Open http://localhost:5173
   ```

### Option B: Launch the Streamlit Dashboard

```bash
source .venv/bin/activate
streamlit run app.py
```

---

## 📬 Step 5 — Workflow for Your 61 Recruiters

1. **Authorize Gmail**:
   - In the header / sidebar, click **Authorize Gmail** (a one-time Google sign-in window opens in your browser; local `token.json` is created).
2. **Import Your 61 Recipient Addresses**:
   - Under **Recipient Directory**, drag & drop your `recruiters.csv` file.
   - Review any duplicate or invalid email warnings.
   - Click **Confirm & Import Recipients**.
3. **Upload Your Resume & Configure Message**:
   - Under **Resume & Template**, upload your PDF resume. The system validates the `%PDF-` header and size (< 10MB).
   - Customize your applicant profile and edit the **Subject** and **Body** templates with dynamic tags like `{first_name}`, `{company}`, `{role}`.
4. **Live Preview**:
   - Under **Live Preview**, pick any recipient from the dropdown to verify how personalized variables look.
5. **Simulate a Dry Run**:
   - Ensure **Dry-Run Mode** is active.
   - Go to **Send & Batch Controls** and click **Start Dry-Run Simulation**. This tests the entire sequence and marks rows as `DRY_RUN` without contacting Google's servers.
6. **Send a Test Email to Yourself**:
   - Under **Send & Batch Controls** (Step A), enter your personal email and send a test message to verify the real layout and PDF attachment in your inbox.
7. **Execute Live Batch**:
   - Toggle **Dry-Run Mode** OFF.
   - Check the explicit confirmation checkbox.
   - Adjust the delay slider (5–10s recommended).
   - Click **Launch Live Batch**. You can click **Stop Batch** at any moment to cancel.


---

## ⚠️ Important Deliverability & Safety Advice

- **Inbox Placement**: Cold emailing cannot guarantee 100% inbox placement. Messages may land in Spam or Promotions depending on domain reputation, sending volume, and subject lines.
- **Recruiter Addresses**: The tool cannot verify whether an address belongs to an active employee. Always ensure your CSV list is current and verified.
- **Gmail Quotas**: Standard personal Gmail accounts have a sending limit of 500 emails per 24 hours (Workspace accounts allow up to 2,000). For cold outreach, keeping batches to 30–60 emails per day is recommended to protect your sender score.
