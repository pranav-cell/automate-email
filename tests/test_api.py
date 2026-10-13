"""Automated tests for FastAPI endpoints."""

import io
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)


def test_api_status():
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert "stats" in data
    assert "has_credentials" in data
    assert "has_token" in data
    assert "applicant" in data


def test_api_upload_csv_and_import():
    from database import clear_all_recipients, DEFAULT_DB_PATH
    clear_all_recipients(DEFAULT_DB_PATH)

    csv_content = b"""name,email,company,role
Alex Rivera,alex.rivera@example.com,VentureSoft,Senior Engineer
Bob Vance,bob.vance@example.com,Vance Refrigeration,Sales
"""

    files = {"file": ("recruiters.csv", io.BytesIO(csv_content), "text/csv")}
    response = client.post("/api/upload-csv", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["valid_count"] == 2
    assert len(data["valid_rows"]) == 2

    # Import the rows
    import_resp = client.post("/api/recipients/import", json={"recipients": data["valid_rows"]})
    assert import_resp.status_code == 200
    assert import_resp.json()["imported"] == 2

    # Verify recipient list
    list_resp = client.get("/api/recipients?search=Alex")
    assert list_resp.status_code == 200
    recs = list_resp.json()
    assert len(recs) >= 1
    assert recs[0]["email"] == "alex.rivera@example.com"


def test_api_resume_upload():
    fake_pdf = b"%PDF-1.4 sample content for resume"
    files = {"file": ("Resume.pdf", io.BytesIO(fake_pdf), "application/pdf")}
    response = client.post("/api/upload-resume", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["filename"] == "Resume.pdf"


def test_api_test_send_dry_run():
    payload = {
        "to_email": "self@test.com",
        "dry_run": True,
        "subject_template": "Test Subj - {applicant_name}",
        "body_template": "Hello {first_name}",
    }
    response = client.post("/api/send/test", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["result"]["dry_run"] is True
    assert data["result"]["status"] == "SIMULATED_SUCCESS"


def test_api_edit_and_delete_recipient():
    from database import upsert_recipient, DEFAULT_DB_PATH
    rec_id, _ = upsert_recipient(DEFAULT_DB_PATH, "edit_target@example.com", name="Original Name", company="Old Co")

    # 1. Update recipient
    update_payload = {
        "email": "updated_target@example.com",
        "name": "Updated Name",
        "company": "New Co",
        "role": "Lead Architect",
        "notes": "Met at conference",
    }
    put_resp = client.put(f"/api/recipients/{rec_id}", json=update_payload)
    assert put_resp.status_code == 200

    # Verify update
    get_resp = client.get("/api/recipients?search=Updated")
    assert get_resp.status_code == 200
    recs = get_resp.json()
    assert len(recs) == 1
    assert recs[0]["email"] == "updated_target@example.com"
    assert recs[0]["company"] == "New Co"

    # 2. Delete recipient
    del_resp = client.delete(f"/api/recipients/{rec_id}")
    assert del_resp.status_code == 200

    # Verify deletion
    verify_resp = client.get(f"/api/recipients?search=updated_target@example.com")
    assert len(verify_resp.json()) == 0

