import React, { useState, useEffect, useRef } from 'react';
import {
  Mail, Send, Users, FileText, CheckCircle2, AlertTriangle, XCircle,
  Clock, Shield, RefreshCw, Upload, FileCheck, Trash2, Search,
  Play, Square, Eye, Sparkles, ExternalLink, Sliders
} from 'lucide-react';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('recipients');
  const [systemStatus, setSystemStatus] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [logs, setLogs] = useState([]);

  // Template and Profile
  const [applicant, setApplicant] = useState({
    name: 'Pranav',
    email: 'pranav@example.com',
    phone: '',
    linkedin: '',
    github: '',
    portfolio: '',
  });
  const [subjectTemplate, setSubjectTemplate] = useState('Application for {role} - {applicant_name}');
  const [bodyTemplate, setBodyTemplate] = useState(
`Hi {first_name},

I hope this email finds you well.

I am reaching out to express my keen interest in open {role} opportunities at {company}. With my background in software engineering and hands-on experience building scalable applications, I believe my skills would be a strong match for your team.

I have attached my resume for your review. I would welcome the opportunity to connect briefly and discuss how I can contribute to {company}'s goals.

Thank you very much for your time and consideration.

Best regards,
{applicant_name}
{contact_info}`
  );

  // Resume state
  const [resumeInfo, setResumeInfo] = useState({ has_resume: false, name: '', size_kb: 0 });
  const [resumeUploading, setResumeUploading] = useState(false);

  // CSV upload state
  const [csvResult, setCsvResult] = useState(null);
  const [csvUploading, setCsvUploading] = useState(false);

  // Preview state
  const [previewRecipientId, setPreviewRecipientId] = useState(null);
  const [previewData, setPreviewData] = useState(null);

  // Send & Batch controls
  const [dryRunMode, setDryRunMode] = useState(true);
  const [sendDelay, setSendDelay] = useState(5);
  const [confirmLiveSend, setConfirmLiveSend] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);

  // Status notification
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  // Poll system status and batch progress
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
        setResumeInfo({
          has_resume: data.has_resume,
          name: data.resume_name,
          size_kb: data.resume_size ? Math.round(data.resume_size / 1024) : 0,
        });
        if (!testEmailAddress && data.applicant?.email) {
          setTestEmailAddress(data.applicant.email);
        }
      }
    } catch (e) {
      console.error('Failed to fetch status:', e);
    }
  };

  const fetchRecipients = async () => {
    try {
      const url = new URL('/api/recipients', window.location.origin);
      if (statusFilter !== 'All') url.searchParams.append('status', statusFilter);
      if (searchQuery) url.searchParams.append('search', searchQuery);
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecipients(data);
        if (data.length > 0 && !previewRecipientId) {
          setPreviewRecipientId(data[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to fetch recipients:', e);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchRecipients();
    fetchLogs();
  }, []);

  useEffect(() => {
    fetchRecipients();
  }, [statusFilter, searchQuery]);

  // Polling for batch process
  useEffect(() => {
    let interval = null;
    if (systemStatus?.batch_running) {
      interval = setInterval(async () => {
        try {
          const res = await fetch('/api/batch/progress');
          if (res.ok) {
            const data = await res.json();
            setBatchProgress(data);
            if (!data.running) {
              fetchStatus();
              fetchRecipients();
              fetchLogs();
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [systemStatus?.batch_running]);

  // Handle preview fetch
  useEffect(() => {
    if (previewRecipientId) {
      fetch(`/api/preview/${previewRecipientId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setPreviewData(data))
        .catch(console.error);
    }
  }, [previewRecipientId, subjectTemplate, bodyTemplate, applicant]);

  // Save template & profile
  const handleSaveTemplate = async () => {
    try {
      const res = await fetch('/api/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      if (res.ok) {
        showToast('Template & Applicant Profile saved!', 'success');
      }
    } catch (e) {
      showToast('Error saving template: ' + e.message, 'error');
    }
  };

  // Upload Resume
  const handleResumeUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setResumeUploading(true);

    try {
      const res = await fetch('/api/upload-resume', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Resume attached: ${data.filename} (${data.size_kb} KB)`, 'success');
        fetchStatus();
      } else {
        showToast(data.detail || 'Failed to upload PDF', 'error');
      }
    } catch (err) {
      showToast('Upload error: ' + err.message, 'error');
    } finally {
      setResumeUploading(false);
    }
  };

  // Upload CSV
  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    setCsvUploading(true);

    try {
      const res = await fetch('/api/upload-csv', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setCsvResult(data);
        showToast(`Parsed ${data.total_parsed} rows. Found ${data.valid_count} valid recipients.`, 'info');
      } else {
        showToast('CSV parsing error', 'error');
      }
    } catch (err) {
      showToast('CSV upload error: ' + err.message, 'error');
    } finally {
      setCsvUploading(false);
    }
  };

  // Commit CSV
  const handleImportRecipients = async () => {
    if (!csvResult?.valid_rows) return;
    try {
      const res = await fetch('/api/recipients/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: csvResult.valid_rows }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Successfully imported ${data.imported} recipients!`, 'success');
        setCsvResult(null);
        fetchStatus();
        fetchRecipients();
      }
    } catch (err) {
      showToast('Import error: ' + err.message, 'error');
    }
  };

  // Reset Recipient
  const handleResetRecipient = async (id) => {
    try {
      const res = await fetch(`/api/recipients/reset/${id}`, { method: 'POST' });
      if (res.ok) {
        showToast('Recipient reset to PENDING', 'success');
        fetchStatus();
        fetchRecipients();
      }
    } catch (e) {
      showToast('Reset failed', 'error');
    }
  };

  // Clear DB
  const handleClearDatabase = async () => {
    if (!window.confirm('Are you sure you want to delete all recipients and activity logs?')) return;
    try {
      await fetch('/api/recipients/clear', { method: 'DELETE' });
      showToast('Database reset successfully.', 'warning');
      fetchStatus();
      fetchRecipients();
      fetchLogs();
    } catch (e) {
      showToast('Clear failed', 'error');
    }
  };

  // Test Email
  const handleSendTest = async () => {
    if (!testEmailAddress) {
      showToast('Please enter your test email address', 'warning');
      return;
    }
    setTestSending(true);
    try {
      const res = await fetch('/api/send/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_email: testEmailAddress,
          dry_run: dryRunMode,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.result.dry_run) {
          showToast(`🧪 Simulated test message generated for ${testEmailAddress}`, 'info');
        } else {
          showToast(`🎉 Test email sent successfully to ${testEmailAddress}!`, 'success');
        }
        fetchLogs();
      } else {
        showToast(data.detail || 'Test send failed', 'error');
      }
    } catch (err) {
      showToast('Test send error: ' + err.message, 'error');
    } finally {
      setTestSending(false);
    }
  };

  // Start Batch
  const handleStartBatch = async () => {
    try {
      const res = await fetch('/api/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: dryRunMode,
          delay_seconds: sendDelay,
          confirmed: confirmLiveSend,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(dryRunMode ? '🧪 Starting dry-run batch simulation...' : '🚀 Starting live batch dispatch...', 'info');
        fetchStatus();
      } else {
        showToast(data.detail || 'Failed to start batch', 'error');
      }
    } catch (err) {
      showToast('Batch error: ' + err.message, 'error');
    }
  };

  // Stop Batch
  const handleStopBatch = async () => {
    try {
      await fetch('/api/batch/stop', { method: 'POST' });
      showToast('Aborting batch...', 'warning');
    } catch (e) {
      console.error(e);
    }
  };

  // Authorize Gmail
  const handleAuthorizeGmail = async () => {
    showToast('Starting OAuth sign-in flow...', 'info');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        showToast('Gmail Authorized successfully!', 'success');
        fetchStatus();
      } else {
        showToast(data.detail || 'Authorization failed', 'error');
      }
    } catch (e) {
      showToast('Auth error: ' + e.message, 'error');
    }
  };

  const insertVariable = (varName) => {
    setBodyTemplate(prev => prev + ' ' + varName);
  };

  const stats = systemStatus?.stats || { total: 0, PENDING: 0, SENT: 0, DRY_RUN: 0, NEEDS_REVIEW: 0, FAILED: 0 };

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 9999,
          background: toast.type === 'error' ? 'var(--danger-bg)' : toast.type === 'success' ? 'var(--success-bg)' : 'var(--bg-tertiary)',
          color: toast.type === 'error' ? '#fca5a5' : toast.type === 'success' ? '#6ee7b7' : '#93c5fd',
          border: `1px solid ${toast.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : toast.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(99, 102, 241, 0.4)'}`,
          padding: '12px 20px',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-card)',
          fontWeight: 600,
          fontSize: '0.875rem',
          backdropFilter: 'blur(12px)',
        }}>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <header className="glass-panel app-header">
        <div className="brand-section">
          <div className="brand-icon-wrap">
            <Mail size={26} />
          </div>
          <div>
            <h1 className="brand-title">Job Application Automator</h1>
            <p className="brand-subtitle">Automate personalized outreach with official Gmail OAuth 2.0</p>
          </div>
        </div>

        <div className="header-actions">
          {/* Mode switch */}
          <div
            className={`mode-toggle ${dryRunMode ? 'active' : ''}`}
            onClick={() => setDryRunMode(!dryRunMode)}
            title="Toggle between dry-run simulation and real email delivery"
          >
            <Shield size={16} />
            <span>{dryRunMode ? 'Dry-Run Mode (Safe)' : 'Live Send Mode'}</span>
          </div>

          {/* Auth status indicator */}
          {systemStatus?.has_token ? (
            <div className="badge badge-sent">
              <CheckCircle2 size={14} /> Gmail Authorized
            </div>
          ) : systemStatus?.has_credentials ? (
            <button className="btn btn-secondary" onClick={handleAuthorizeGmail}>
              <ExternalLink size={16} /> Authorize Gmail
            </button>
          ) : (
            <div className="badge badge-failed" title="Add credentials.json to project directory">
              <XCircle size={14} /> Missing credentials.json
            </div>
          )}
        </div>
      </header>

      {/* KPI Stats Bar */}
      <div className="stats-grid">
        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}>
            <Users size={22} />
          </div>
          <div>
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Recipients</div>
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ background: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1' }}>
            <Clock size={22} />
          </div>
          <div>
            <div className="stat-number">{stats.PENDING}</div>
            <div className="stat-label">Pending Send</div>
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ background: 'var(--success-bg)', color: '#34d399' }}>
            <CheckCircle2 size={22} />
          </div>
          <div>
            <div className="stat-number">{stats.SENT}</div>
            <div className="stat-label">Sent Successfully</div>
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ background: 'var(--info-bg)', color: '#38bdf8' }}>
            <Shield size={22} />
          </div>
          <div>
            <div className="stat-number">{stats.DRY_RUN}</div>
            <div className="stat-label">Dry-Run Tested</div>
          </div>
        </div>

        <div className="glass-panel stat-card">
          <div className="stat-icon" style={{ background: 'var(--warning-bg)', color: '#fbbf24' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <div className="stat-number">{stats.NEEDS_REVIEW + stats.FAILED}</div>
            <div className="stat-label">Review / Failed</div>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      <div className="notice-banner">
        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Deliverability & Safety Notice:</strong> Cold email delivery cannot guarantee 100% inbox placement, and this tool cannot verify if an email address belongs to an active recruiter. Use a conservative delay (5–10s) between messages to protect your Gmail reputation.
        </div>
      </div>

      {/* Tabs Navigation */}
      <nav className="tabs-nav">
        <button
          className={`tab-btn ${activeTab === 'recipients' ? 'active' : ''}`}
          onClick={() => setActiveTab('recipients')}
        >
          <Users size={18} /> Recipient Directory
        </button>
        <button
          className={`tab-btn ${activeTab === 'template' ? 'active' : ''}`}
          onClick={() => setActiveTab('template')}
        >
          <FileText size={18} /> Resume & Template
        </button>
        <button
          className={`tab-btn ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          <Eye size={18} /> Live Preview
        </button>
        <button
          className={`tab-btn ${activeTab === 'send' ? 'active' : ''}`}
          onClick={() => setActiveTab('send')}
        >
          <Send size={18} /> Send & Batch Controls
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <Clock size={18} /> Activity Logs
        </button>
      </nav>

      {/* TAB 1: RECIPIENTS */}
      {activeTab === 'recipients' && (
        <div className="tab-pane">
          {/* CSV Import Dropzone */}
          <div className="glass-panel" style={{ padding: 24, marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload size={20} color="#818cf8" /> Import Recipient CSV List
            </h3>
            <label className="dropzone">
              <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
              <Upload size={32} style={{ color: '#818cf8', marginBottom: 12 }} />
              <p style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                {csvUploading ? 'Parsing CSV file...' : 'Click or Drag & Drop recruiters.csv here'}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Supports columns: email, name, company, role, notes
              </p>
            </label>

            {/* CSV Parse Results */}
            {csvResult && (
              <div style={{ marginTop: 20, padding: 18, background: 'rgba(16, 21, 36, 0.7)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <h4 style={{ color: '#ffffff' }}>CSV Analysis Summary</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      Parsed {csvResult.total_parsed} rows • Found <strong>{csvResult.valid_count}</strong> valid new recipients
                    </p>
                  </div>
                  <button className="btn btn-primary" onClick={handleImportRecipients} disabled={csvResult.valid_count === 0}>
                    <CheckCircle2 size={16} /> Confirm & Import {csvResult.valid_count} Recipients
                  </button>
                </div>

                {csvResult.duplicate_rows?.length > 0 && (
                  <div style={{ marginBottom: 10, fontSize: '0.8rem', color: '#fbbf24' }}>
                    🔁 {csvResult.duplicate_rows.length} duplicates skipped (already existing in file or database).
                  </div>
                )}
                {csvResult.invalid_rows?.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: '#f87171' }}>
                    ❌ {csvResult.invalid_rows.length} invalid email rows skipped.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Directory Toolbar */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
                <Search size={18} color="var(--text-muted)" />
                <input
                  type="text"
                  placeholder="Search by name, email, or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="filter-pills">
                {['All', 'PENDING', 'SENT', 'DRY_RUN', 'NEEDS_REVIEW', 'FAILED'].map((st) => (
                  <button
                    key={st}
                    className={`filter-pill ${statusFilter === st ? 'active' : ''}`}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <button className="btn btn-danger" onClick={handleClearDatabase} title="Clear all recipients">
                <Trash2 size={16} /> Clear All
              </button>
            </div>

            {/* Recipient Table */}
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
                        No recipients found. Import your recruiters CSV above or use <code>sample_recruiters.csv</code>.
                      </td>
                    </tr>
                  ) : (
                    recipients.map((r) => (
                      <tr key={r.id}>
                        <td><code>#{r.id}</code></td>
                        <td style={{ fontWeight: 600 }}>{r.email}</td>
                        <td>{r.name || '—'}</td>
                        <td>{r.company || '—'}</td>
                        <td>{r.role || '—'}</td>
                        <td>
                          <span className={`badge badge-${r.status.toLowerCase().replace('_', '-')}`}>
                            {r.status}
                          </span>
                        </td>
                        <td>
                          {['NEEDS_REVIEW', 'FAILED', 'SENT', 'DRY_RUN'].includes(r.status) && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                              onClick={() => handleResetRecipient(r.id)}
                            >
                              <RefreshCw size={12} /> Reset to PENDING
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: TEMPLATE & RESUME */}
      {activeTab === 'template' && (
        <div className="tab-pane">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 24 }}>
            {/* Left Column: Resume & Profile */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* PDF Resume Uploader */}
              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileCheck size={20} color="#34d399" /> Resume Attachment (PDF)
                </h3>
                {resumeInfo.has_resume ? (
                  <div style={{ padding: 16, background: 'var(--success-bg)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: '#34d399' }}>{resumeInfo.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{resumeInfo.size_kb} KB • Validated %PDF- Header</div>
                    </div>
                    <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                      Replace PDF
                      <input type="file" accept=".pdf" onChange={handleResumeUpload} style={{ display: 'none' }} />
                    </label>
                  </div>
                ) : (
                  <label className="dropzone" style={{ display: 'block' }}>
                    <input type="file" accept=".pdf" onChange={handleResumeUpload} style={{ display: 'none' }} />
                    <Upload size={28} style={{ color: '#34d399', marginBottom: 8 }} />
                    <p style={{ fontWeight: 600 }}>{resumeUploading ? 'Verifying PDF...' : 'Upload PDF Resume'}</p>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Max 10MB • Header verified</p>
                  </label>
                )}
              </div>

              {/* Applicant Profile */}
              <div className="glass-panel" style={{ padding: 24 }}>
                <h3 style={{ marginBottom: 14 }}>👤 Applicant Profile</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label>Full Name</label>
                    <input
                      type="text"
                      value={applicant.name}
                      onChange={(e) => setApplicant({ ...applicant, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Your Gmail Address</label>
                    <input
                      type="email"
                      value={applicant.email}
                      onChange={(e) => setApplicant({ ...applicant, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Phone Number</label>
                    <input
                      type="text"
                      value={applicant.phone}
                      onChange={(e) => setApplicant({ ...applicant, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>LinkedIn URL</label>
                    <input
                      type="text"
                      value={applicant.linkedin}
                      onChange={(e) => setApplicant({ ...applicant, linkedin: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>GitHub URL</label>
                    <input
                      type="text"
                      value={applicant.github}
                      onChange={(e) => setApplicant({ ...applicant, github: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Portfolio / Website</label>
                    <input
                      type="text"
                      value={applicant.portfolio}
                      onChange={(e) => setApplicant({ ...applicant, portfolio: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Template Editor */}
            <div className="glass-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3>✉️ Email Template Editor</h3>
                <button className="btn btn-primary" onClick={handleSaveTemplate}>
                  <CheckCircle2 size={16} /> Save Changes
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label>Subject Line Template</label>
                <input
                  type="text"
                  value={subjectTemplate}
                  onChange={(e) => setSubjectTemplate(e.target.value)}
                />
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                <label>Email Body Template</label>
                <textarea
                  style={{ flex: 1, minHeight: 300, resize: 'vertical' }}
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                />
              </div>

              <div style={{ marginTop: 14 }}>
                <label>Click to insert placeholder variables:</label>
                <div className="var-chips">
                  {['{first_name}', '{name}', '{company}', '{role}', '{applicant_name}', '{contact_info}'].map((v) => (
                    <span key={v} className="var-chip" onClick={() => insertVariable(v)}>
                      + {v}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE PREVIEW */}
      {activeTab === 'preview' && (
        <div className="tab-pane">
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h3>👁️ Personalized Recipient Preview</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Inspect how variables render for individual recruiters before sending.
                </p>
              </div>

              <div style={{ width: 320 }}>
                <select
                  value={previewRecipientId || ''}
                  onChange={(e) => setPreviewRecipientId(Number(e.target.value))}
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || 'No Name'} • {r.email} ({r.company || 'No Company'})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {previewData ? (
              <div className="email-mockup">
                <div className="email-mockup-header">
                  <div style={{ marginBottom: 8, fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-muted)', width: 60, display: 'inline-block' }}>To:</span>
                    <strong style={{ color: '#ffffff' }}>{previewData.rendered.to_email}</strong>
                  </div>
                  <div style={{ marginBottom: 8, fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-muted)', width: 60, display: 'inline-block' }}>Subject:</span>
                    <strong style={{ color: '#a5b4fc' }}>{previewData.rendered.subject}</strong>
                  </div>
                  <div style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', width: 60, display: 'inline-block' }}>Attach:</span>
                    {previewData.has_attachment ? (
                      <span className="badge badge-sent">
                        📎 {previewData.attachment_name}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>None</span>
                    )}
                  </div>
                </div>
                <div className="email-mockup-body">
                  {previewData.rendered.body}
                </div>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                Select a recipient from the dropdown above to view live preview.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SEND CONTROLS */}
      {activeTab === 'send' && (
        <div className="tab-pane">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
            {/* Step A: Test send */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sparkles size={20} color="#38bdf8" /> Step A: Send Test to Yourself
                </h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Send a test message strictly to your own email address to verify inbox appearance, font rendering, and PDF attachment.
              </p>

              {/* In-Card Mode Switcher */}
              <div style={{ marginBottom: 16, padding: 12, background: 'rgba(16, 21, 36, 0.7)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <label style={{ marginBottom: 8, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Sending Mode for Test:
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    className={`btn ${dryRunMode ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem' }}
                    onClick={() => setDryRunMode(true)}
                  >
                    🧪 Dry-Run Simulation
                  </button>
                  <button
                    type="button"
                    className={`btn ${!dryRunMode ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '8px 12px', fontSize: '0.8rem', background: !dryRunMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : undefined }}
                    onClick={() => setDryRunMode(false)}
                  >
                    🚀 Real Email Delivery
                  </button>
                </div>
              </div>

              {/* Mode Explanation Notice */}
              {dryRunMode ? (
                <div style={{ marginBottom: 16, padding: 10, background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: '#fde68a' }}>
                  ℹ️ <strong>Dry-Run Mode is Active</strong>: Clicking the button below will only <em>simulate</em> the email in memory. It will <strong>NOT</strong> be delivered to your inbox. Click <strong>"Real Email Delivery"</strong> above to send a real email.
                </div>
              ) : (
                <div style={{ marginBottom: 16, padding: 10, background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: '#6ee7b7' }}>
                  ✅ <strong>Real Email Delivery is Active</strong>: The email will be sent directly through your Gmail account to your inbox!
                </div>
              )}

              {/* Authorization prompt if not yet authorized */}
              {!systemStatus?.has_token && (
                <div style={{ marginBottom: 16, padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)' }}>
                  <p style={{ fontSize: '0.82rem', color: '#fca5a5', marginBottom: 10, fontWeight: 600 }}>
                    ⚠️ Gmail is not authorized yet. You must complete Google OAuth before real emails can be delivered.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: '100%', fontSize: '0.82rem', padding: '8px 12px' }}
                    onClick={handleAuthorizeGmail}
                  >
                    <ExternalLink size={14} /> Authorize Gmail Now (1-Click)
                  </button>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label>Your Verified Email Address</label>
                <input
                  type="email"
                  value={testEmailAddress}
                  onChange={(e) => setTestEmailAddress(e.target.value)}
                  placeholder="your.email@gmail.com"
                />
              </div>

              <button
                className={`btn ${dryRunMode ? 'btn-secondary' : 'btn-primary'}`}
                style={{ width: '100%', padding: '12px 18px', fontSize: '0.9rem' }}
                onClick={handleSendTest}
                disabled={testSending || (!dryRunMode && !systemStatus?.has_token)}
              >
                {testSending ? (
                  <RefreshCw size={16} className="spin-icon" />
                ) : (
                  <Send size={16} />
                )}
                {dryRunMode
                  ? 'Simulate Test Email (Dry-Run Only)'
                  : `Send Real Test Email to ${testEmailAddress || 'You'}`}
              </button>
            </div>


            {/* Step B: Batch Send */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Send size={20} color="#a855f7" /> Step B: Batch Send Outreach
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Dispatch outreach to all <strong>{stats.PENDING}</strong> eligible pending recipients with conservative pacing.
              </p>

              {/* Delay slider */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label>Sending Delay Between Emails</label>
                  <span style={{ fontWeight: 700, color: '#a855f7' }}>{sendDelay} seconds</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="20"
                  value={sendDelay}
                  onChange={(e) => setSendDelay(Number(e.target.value))}
                />
              </div>

              {/* Confirmation checkbox for live send */}
              {!dryRunMode && (
                <div style={{ marginBottom: 20, padding: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--radius-md)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: '#fca5a5' }}>
                    <input
                      type="checkbox"
                      checked={confirmLiveSend}
                      onChange={(e) => setConfirmLiveSend(e.target.checked)}
                      style={{ width: 18, height: 18 }}
                    />
                    <span>I confirm I want to send <strong>REAL</strong> emails to recruiters.</span>
                  </label>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleStartBatch}
                  disabled={systemStatus?.batch_running || stats.PENDING === 0 || (!dryRunMode && !confirmLiveSend)}
                >
                  <Play size={16} />
                  {dryRunMode ? 'Start Dry-Run Simulation' : 'Launch Live Batch'}
                </button>

                {systemStatus?.batch_running && (
                  <button className="btn btn-danger" onClick={handleStopBatch}>
                    <Square size={16} /> Stop Batch
                  </button>
                )}
              </div>

              {/* Batch progress */}
              {batchProgress && (
                <div style={{ marginTop: 24, padding: 16, background: 'rgba(16, 21, 36, 0.7)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                    <span>Progress: {batchProgress.processed} / {batchProgress.total}</span>
                    <span style={{ color: '#a5b4fc' }}>{batchProgress.current_email}</span>
                  </div>
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${batchProgress.total > 0 ? (batchProgress.processed / batchProgress.total) * 100 : 0}%`
                      }}
                    />
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {batchProgress.message}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: LOGS */}
      {activeTab === 'logs' && (
        <div className="tab-pane">
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3>📜 System Audit & Activity Logs</h3>
              <button className="btn btn-secondary" onClick={fetchLogs}>
                <RefreshCw size={14} /> Refresh Logs
              </button>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Subject</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        No send events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '—'}
                        </td>
                        <td style={{ fontWeight: 600 }}>{log.email}</td>
                        <td>
                          <span className={`badge badge-${log.status.toLowerCase().replace('_', '-')}`}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.subject || '—'}
                        </td>
                        <td style={{ fontSize: '0.8rem', color: log.error_message ? '#f87171' : 'var(--text-muted)' }}>
                          {log.error_message || 'Completed cleanly'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
