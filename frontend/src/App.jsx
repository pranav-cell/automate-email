import React, { useState, useEffect, useRef } from 'react';
import {
  Mail, Send, Users, FileText, CheckCircle2, AlertTriangle, XCircle,
  Clock, Shield, RefreshCw, Upload, FileCheck, Trash2, Search,
  Play, Square, Eye, Sparkles, ExternalLink, Sliders, Edit2, X,
  Share2, Copy, Check
} from 'lucide-react';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState(() => window.location.hash.slice(1) || 'recipients');
  const [systemStatus, setSystemStatus] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingRecipient, setEditingRecipient] = useState(null);
  const [singleTargetId, setSingleTargetId] = useState(null);
  const [targetEmail, setTargetEmail] = useState('');
  const [targetName, setTargetName] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [sharingRecipient, setSharingRecipient] = useState(null);
  const [sharingData, setSharingData] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [logs, setLogs] = useState([]);

  const pages = [
    { id: 'recipients', label: 'Recipients', detail: 'Manage your outreach list', icon: Users },
    { id: 'template', label: 'Email setup', detail: 'Resume & message template', icon: FileText },
    { id: 'preview', label: 'Preview', detail: 'Review a personalized email', icon: Eye },
    { id: 'send', label: 'Send campaign', detail: 'Test or launch outreach', icon: Send },
    { id: 'logs', label: 'Activity', detail: 'Delivery history and errors', icon: Clock },
  ];
  const navigate = (page) => {
    setActiveTab(page);
    window.location.hash = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const syncPage = () => setActiveTab(pages.some(page => page.id === window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'recipients');
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);



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
        if (data.subject_template) {
          setSubjectTemplate(data.subject_template);
        }
        if (data.body_template) {
          setBodyTemplate(data.body_template);
        }
        if (data.applicant) {
          setApplicant(data.applicant);
          if (!testEmailAddress && data.applicant.email) {
            setTestEmailAddress(data.applicant.email);
          }
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
        if (data.length > 0 && !targetEmail) {
          setSingleTargetId(data[0].id);
          setTargetEmail(data[0].email);
          setTargetName(data[0].name || '');
          setTargetCompany(data[0].company || '');
          setTargetRole(data[0].role || '');
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

  // Delete Single Recipient
  const handleDeleteSingleRecipient = async (id, email) => {
    if (!window.confirm(`Are you sure you want to delete ${email}?`)) return;
    try {
      const res = await fetch(`/api/recipients/${id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Deleted ${email}`, 'info');
        fetchStatus();
        fetchRecipients();
      } else {
        showToast('Failed to delete recipient', 'error');
      }
    } catch (e) {
      showToast('Delete error: ' + e.message, 'error');
    }
  };

  // Save Edited Recipient
  const handleSaveEditRecipient = async (e) => {
    if (e) e.preventDefault();
    if (!editingRecipient) return;

    try {
      const res = await fetch(`/api/recipients/${editingRecipient.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: editingRecipient.email,
          name: editingRecipient.name || '',
          company: editingRecipient.company || '',
          role: editingRecipient.role || '',
          notes: editingRecipient.notes || '',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Updated ${editingRecipient.email}!`, 'success');
        setEditingRecipient(null);
        fetchStatus();
        fetchRecipients();
      } else {
        showToast(data.detail || 'Update failed', 'error');
      }
    } catch (err) {
      showToast('Save error: ' + err.message, 'error');
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

  const [singleSendingId, setSingleSendingId] = useState(null);

  // Send Single Email to Specific Recipient
  const handleSendSingle = async (recipientId, recipientEmail) => {
    if (!dryRunMode && !systemStatus?.has_token) {
      showToast('⚠️ Please authorize Gmail first before sending live emails.', 'error');
      return;
    }
    const modePrompt = dryRunMode
      ? `Simulate email to ${recipientEmail} (Dry-Run mode)?`
      : `Send REAL application email to ${recipientEmail}?`;

    if (!window.confirm(modePrompt)) return;

    setSingleSendingId(recipientId);
    try {
      const res = await fetch(`/api/send/single/${recipientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dry_run: dryRunMode,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.result.dry_run) {
          showToast(`🧪 Simulated test message for ${recipientEmail}`, 'info');
        } else {
          showToast(`🎉 Email delivered to ${recipientEmail}!`, 'success');
        }
        fetchStatus();
        fetchRecipients();
        fetchLogs();
      } else {
        showToast(data.detail || 'Send failed', 'error');
      }
    } catch (err) {
      showToast('Send error: ' + err.message, 'error');
    } finally {
      setSingleSendingId(null);
    }
  };

  // Open Sharing Modal and prefetch rendered preview
  const openShareModal = async (recipient) => {
    setSharingRecipient(recipient);
    setSharingData(null);
    try {
      const res = await fetch(`/api/preview/${recipient.id}`);
      if (res.ok) {
        const data = await res.json();
        setSharingData(data);
      }
    } catch (e) {
      console.error('Failed to fetch preview for sharing:', e);
    }
  };

  // Open in Gmail Web Compose
  const handleOpenGmailWeb = async (rec) => {
    if (!rec) return;
    try {
      const res = await fetch(`/api/preview/${rec.id}`);
      if (res.ok) {
        const data = await res.json();
        const to = encodeURIComponent(rec.email);
        const su = encodeURIComponent(data.rendered.subject);
        const body = encodeURIComponent(data.rendered.body);
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`, '_blank');
        showToast(`Opened Gmail Web compose for ${rec.email}`, 'info');
      }
    } catch (err) {
      showToast('Error preparing Gmail draft: ' + err.message, 'error');
    }
  };

  // Open in Default Mail App (mailto:)
  const handleOpenMailto = async (rec) => {
    if (!rec) return;
    try {
      const res = await fetch(`/api/preview/${rec.id}`);
      if (res.ok) {
        const data = await res.json();
        const to = encodeURIComponent(rec.email);
        const su = encodeURIComponent(data.rendered.subject);
        const body = encodeURIComponent(data.rendered.body);
        window.location.href = `mailto:${to}?subject=${su}&body=${body}`;
        showToast(`Opening default mail app for ${rec.email}`, 'info');
      }
    } catch (err) {
      showToast('Error opening mail client: ' + err.message, 'error');
    }
  };

  // Copy Single Recipient Content to Clipboard
  const handleCopySingleContent = async (rec) => {
    if (!rec) return;
    try {
      const res = await fetch(`/api/preview/${rec.id}`);
      if (res.ok) {
        const data = await res.json();
        const text = `To: ${rec.email}\nSubject: ${data.rendered.subject}\n\n${data.rendered.body}`;
        await navigator.clipboard.writeText(text);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2500);
        showToast(`📋 Copied personalized email draft to clipboard!`, 'success');
      }
    } catch (err) {
      showToast('Error copying draft: ' + err.message, 'error');
    }
  };

  // Send or simulate outreach to the specified targetEmail (saved or custom)
  const handleSendTargetOutreach = async () => {
    const trimmedEmail = (targetEmail || '').trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      showToast('Please enter a valid recipient email address', 'warning');
      return;
    }

    const modePrompt = dryRunMode
      ? `Simulate outreach to ${trimmedEmail} (Dry-Run mode)?`
      : `Send REAL application email to ${trimmedEmail}?`;

    if (!window.confirm(modePrompt)) return;

    setSingleSendingId('target');
    try {
      const res = await fetch('/api/send/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: targetName,
          company: targetCompany,
          role: targetRole,
          dry_run: dryRunMode,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.result.dry_run) {
          showToast(`🧪 Simulated test message for ${trimmedEmail}`, 'info');
        } else {
          showToast(`🎉 Email delivered to ${trimmedEmail}!`, 'success');
        }
        fetchStatus();
        fetchRecipients();
        fetchLogs();
      } else {
        showToast(data.detail || 'Send failed', 'error');
      }
    } catch (err) {
      showToast('Send error: ' + err.message, 'error');
    } finally {
      setSingleSendingId(null);
    }
  };

  // Open Gmail Web Compose for target recipient
  const handleOpenGmailWebTarget = async () => {
    const trimmedEmail = (targetEmail || '').trim();
    if (!trimmedEmail) {
      showToast('Please enter a recipient email address', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/preview/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: targetName,
          company: targetCompany,
          role: targetRole,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const to = encodeURIComponent(trimmedEmail);
        const su = encodeURIComponent(data.rendered.subject);
        const body = encodeURIComponent(data.rendered.body);
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`, '_blank');
        showToast(`Opened Gmail Web compose for ${trimmedEmail}`, 'info');
      }
    } catch (err) {
      showToast('Error preparing Gmail draft: ' + err.message, 'error');
    }
  };

  // Open Default Mail App (mailto:) for target recipient
  const handleOpenMailtoTarget = async () => {
    const trimmedEmail = (targetEmail || '').trim();
    if (!trimmedEmail) {
      showToast('Please enter a recipient email address', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/preview/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: targetName,
          company: targetCompany,
          role: targetRole,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const to = encodeURIComponent(trimmedEmail);
        const su = encodeURIComponent(data.rendered.subject);
        const body = encodeURIComponent(data.rendered.body);
        window.location.href = `mailto:${to}?subject=${su}&body=${body}`;
        showToast(`Opening default mail app for ${trimmedEmail}`, 'info');
      }
    } catch (err) {
      showToast('Error opening mail client: ' + err.message, 'error');
    }
  };

  // Copy target draft to clipboard
  const handleCopyTargetDraft = async () => {
    const trimmedEmail = (targetEmail || '').trim();
    if (!trimmedEmail) {
      showToast('Please enter a recipient email address', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/preview/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          name: targetName,
          company: targetCompany,
          role: targetRole,
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          applicant,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = `To: ${trimmedEmail}\nSubject: ${data.rendered.subject}\n\n${data.rendered.body}`;
        await navigator.clipboard.writeText(text);
        setCopyFeedback(true);
        setTimeout(() => setCopyFeedback(false), 2500);
        showToast(`📋 Copied personalized email draft to clipboard!`, 'success');
      }
    } catch (err) {
      showToast('Error copying draft: ' + err.message, 'error');
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
      <aside className="app-sidebar">
        <a className="sidebar-brand" href="#recipients" onClick={() => navigate('recipients')}>
          <span className="brand-icon-wrap"><Mail size={21} /></span>
          <span><strong>Reachout</strong><small>CAREER OUTREACH</small></span>
        </a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {pages.map(({ id, label, detail, icon: Icon }) => (
            <button key={id} className={`side-link ${activeTab === id ? 'active' : ''}`} onClick={() => navigate(id)}>
              <Icon size={18} /><span>{label}<small>{detail}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status"><span className={`status-dot ${systemStatus?.has_token ? 'online' : ''}`} />{systemStatus?.has_token ? 'Gmail connected' : 'Gmail not connected'}</div>
          <span>Personal outreach workspace</span>
        </div>
      </aside>
      <main className="main-content">
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon-wrap">
            <Mail size={26} />
          </div>
          <div>
            <h1 className="brand-title">{pages.find(page => page.id === activeTab)?.label || 'Recipients'}</h1>
            <p className="brand-subtitle">{pages.find(page => page.id === activeTab)?.detail || 'Manage your outreach list'}</p>
          </div>
        </div>

        <div className="header-actions">
          {/* Mode switch */}
          <button
            className={`mode-toggle ${dryRunMode ? 'active' : ''}`}
            onClick={() => setDryRunMode(!dryRunMode)}
            title="Toggle between dry-run simulation and real email delivery"
          >
            <Shield size={16} />
            <span>{dryRunMode ? 'Dry-Run Mode (Safe)' : 'Live Send Mode'}</span>
          </button>

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
      {activeTab === 'recipients' && <>
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
      </>}

      {/* Notice Banner */}
      {activeTab === 'send' && <div className="notice-banner">
        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Deliverability & Safety Notice:</strong> Cold email delivery cannot guarantee 100% inbox placement, and this tool cannot verify if an email address belongs to an active recruiter. Use a conservative delay (5–10s) between messages to protect your Gmail reputation.
        </div>
      </div>}

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
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 8px', fontSize: '0.75rem', background: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.3)' }}
                              title={`Send email now to ${r.email}`}
                              disabled={singleSendingId === r.id}
                              onClick={() => handleSendSingle(r.id, r.email)}
                            >
                              {singleSendingId === r.id ? (
                                <RefreshCw size={13} className="spin-icon" color="#34d399" />
                              ) : (
                                <Send size={13} color="#34d399" />
                              )}
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 8px', fontSize: '0.75rem', background: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                              title={`Share or open options for ${r.email}`}
                              onClick={() => openShareModal(r)}
                            >
                              <Share2 size={13} color="#38bdf8" />
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                              title="Edit Recipient"
                              onClick={() => setEditingRecipient({ ...r })}
                            >
                              <Edit2 size={13} color="#818cf8" />
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                              title="Delete Recipient"
                              onClick={() => handleDeleteSingleRecipient(r.id, r.email)}
                            >
                              <Trash2 size={13} color="#f87171" />
                            </button>
                            {['NEEDS_REVIEW', 'FAILED', 'SENT', 'DRY_RUN'].includes(r.status) && (
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '6px 8px', fontSize: '0.75rem' }}
                                title="Reset to PENDING"
                                onClick={() => handleResetRecipient(r.id)}
                              >
                                <RefreshCw size={13} />
                              </button>
                            )}
                          </div>

                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Edit Recipient Modal Dialog */}
            {editingRecipient && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 99999,
                padding: 20,
              }}>
                <div className="glass-panel" style={{ width: '100%', maxWidth: 480, padding: 26, background: '#131929', border: '1px solid var(--border-focus)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Edit2 size={18} color="#818cf8" /> Edit Recipient #{editingRecipient.id}
                    </h3>
                    <button
                      onClick={() => setEditingRecipient(null)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <form onSubmit={handleSaveEditRecipient} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label>Email Address *</label>
                      <input
                        type="email"
                        required
                        value={editingRecipient.email}
                        onChange={(e) => setEditingRecipient({ ...editingRecipient, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label>Full Name</label>
                      <input
                        type="text"
                        value={editingRecipient.name || ''}
                        onChange={(e) => setEditingRecipient({ ...editingRecipient, name: e.target.value })}
                        placeholder="e.g. John Doe"
                      />
                    </div>
                    <div>
                      <label>Company</label>
                      <input
                        type="text"
                        value={editingRecipient.company || ''}
                        onChange={(e) => setEditingRecipient({ ...editingRecipient, company: e.target.value })}
                        placeholder="e.g. Acme Corp"
                      />
                    </div>
                    <div>
                      <label>Role / Position</label>
                      <input
                        type="text"
                        value={editingRecipient.role || ''}
                        onChange={(e) => setEditingRecipient({ ...editingRecipient, role: e.target.value })}
                        placeholder="e.g. Hiring Lead"
                      />
                    </div>
                    <div>
                      <label>Notes / Context</label>
                      <input
                        type="text"
                        value={editingRecipient.notes || ''}
                        onChange={(e) => setEditingRecipient({ ...editingRecipient, notes: e.target.value })}
                        placeholder="e.g. Found on LinkedIn"
                      />
                    </div>

                    <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
                      <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                        <CheckCircle2 size={16} /> Save Changes
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setEditingRecipient(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Share / Send Recipient Modal Dialog */}
            {sharingRecipient && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.78)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 99999,
                padding: 20,
              }}>
                <div className="glass-panel" style={{ width: '100%', maxWidth: 540, padding: 26, background: '#131929', border: '1px solid var(--border-focus)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.1rem' }}>
                      <Share2 size={20} color="#38bdf8" /> Share / Send Single Email
                    </h3>
                    <button
                      onClick={() => { setSharingRecipient(null); setSharingData(null); }}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      <X size={20} />
                    </button>
                  </div>

                  <div style={{ marginBottom: 16, padding: 12, background: 'rgba(16, 21, 36, 0.8)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <strong style={{ fontSize: '0.95rem', color: '#ffffff' }}>{sharingRecipient.name || 'Unnamed Recruiter'}</strong>
                        <div style={{ fontSize: '0.82rem', color: '#a5b4fc' }}>{sharingRecipient.email}</div>
                      </div>
                      <span className={`badge badge-${sharingRecipient.status.toLowerCase().replace('_', '-')}`}>
                        {sharingRecipient.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {sharingRecipient.company ? `Company: ${sharingRecipient.company}` : ''}
                      {sharingRecipient.role ? ` • Role: ${sharingRecipient.role}` : ''}
                    </div>
                  </div>

                  {sharingData ? (
                    <div style={{ marginBottom: 18, maxHeight: 180, overflowY: 'auto', background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                        <strong>Subject:</strong> {sharingData.rendered.subject}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', whiteSpace: 'pre-wrap' }}>
                        {sharingData.rendered.body}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      <RefreshCw size={16} className="spin-icon" style={{ marginBottom: 6 }} />
                      <div>Preparing personalized email draft...</div>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Method 1: Send via Gmail API */}
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', padding: '10px 14px', background: !dryRunMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : undefined }}
                      disabled={singleSendingId === sharingRecipient.id || (!dryRunMode && !systemStatus?.has_token)}
                      onClick={async () => {
                        const rid = sharingRecipient.id;
                        const remail = sharingRecipient.email;
                        setSharingRecipient(null);
                        setSharingData(null);
                        await handleSendSingle(rid, remail);
                      }}
                    >
                      {singleSendingId === sharingRecipient.id ? (
                        <RefreshCw size={15} className="spin-icon" />
                      ) : (
                        <Send size={15} />
                      )}
                      {dryRunMode ? 'Simulate Send (Dry-Run Mode)' : 'Send Real Email via Gmail API'}
                    </button>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {/* Method 2: Open in Gmail Web */}
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                        onClick={() => handleOpenGmailWeb(sharingRecipient)}
                      >
                        <ExternalLink size={14} color="#38bdf8" /> Open in Gmail Web
                      </button>

                      {/* Method 3: Open in Mail Client */}
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                        onClick={() => handleOpenMailto(sharingRecipient)}
                      >
                        <Mail size={14} color="#a855f7" /> Open in Mail App
                      </button>
                    </div>

                    {/* Method 4: Copy Email Content */}
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%', fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                      onClick={() => handleCopySingleContent(sharingRecipient)}
                    >
                      {copyFeedback ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                      {copyFeedback ? 'Copied to Clipboard!' : 'Copy Subject & Body to Clipboard'}
                    </button>
                  </div>
                </div>
              </div>
            )}
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

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: 300 }}>
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

                {previewData && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{ background: !dryRunMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : undefined, whiteSpace: 'nowrap' }}
                      disabled={singleSendingId === previewData.recipient.id || (!dryRunMode && !systemStatus?.has_token)}
                      onClick={() => handleSendSingle(previewData.recipient.id, previewData.recipient.email)}
                    >
                      {singleSendingId === previewData.recipient.id ? (
                        <RefreshCw size={14} className="spin-icon" />
                      ) : (
                        <Send size={14} />
                      )}
                      {dryRunMode ? 'Simulate Send (Dry-Run)' : 'Send Email to this Recipient'}
                    </button>

                    <button
                      className="btn btn-secondary"
                      style={{ whiteSpace: 'nowrap' }}
                      title="Share / Open in Gmail Web or Mail App"
                      onClick={() => openShareModal(previewData.recipient)}
                    >
                      <Share2 size={14} color="#38bdf8" /> Share Options
                    </button>

                    <button
                      className="btn btn-secondary"
                      style={{ whiteSpace: 'nowrap' }}
                      title="Copy rendered email text to clipboard"
                      onClick={() => handleCopySingleContent(previewData.recipient)}
                    >
                      {copyFeedback ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                      {copyFeedback ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                )}
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

            {/* Step C: Send / Share with Single Recipient */}
            <div className="glass-panel" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Share2 size={20} color="#38bdf8" /> Step C: Send / Share Single Recipient
                </h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                Target any recruiter individually without launching the entire batch. Select from directory or type any email address directly.
              </p>

              {/* 1. Quick Select Dropdown */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0, fontSize: '0.8rem' }}>Select from Saved Directory</label>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{recipients.length} saved</span>
                </div>
                <select
                  value={singleTargetId || ''}
                  onChange={(e) => {
                    const selId = e.target.value ? Number(e.target.value) : null;
                    setSingleTargetId(selId);
                    if (selId) {
                      const found = recipients.find((r) => r.id === selId);
                      if (found) {
                        setTargetEmail(found.email);
                        setTargetName(found.name || '');
                        setTargetCompany(found.company || '');
                        setTargetRole(found.role || '');
                      }
                    }
                  }}
                >
                  <option value="">-- Choose saved recruiter or type custom email below --</option>
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name ? `${r.name} • ` : ''}{r.email} ({r.company || 'No Company'}) [{r.status}]
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Direct Email Input */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0, fontSize: '0.8rem' }}>Recipient Email Address *</label>
                  {targetEmail && (
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                      onClick={() => {
                        setSingleTargetId(null);
                        setTargetEmail('');
                        setTargetName('');
                        setTargetCompany('');
                        setTargetRole('');
                      }}
                    >
                      + Clear / Type New Email
                    </button>
                  )}
                </div>
                <input
                  type="email"
                  required
                  value={targetEmail}
                  onChange={(e) => {
                    const val = e.target.value;
                    setTargetEmail(val);
                    const matched = recipients.find((r) => r.email.toLowerCase() === val.toLowerCase().trim());
                    if (matched) {
                      setSingleTargetId(matched.id);
                      if (!targetName && matched.name) setTargetName(matched.name);
                      if (!targetCompany && matched.company) setTargetCompany(matched.company);
                    } else if (singleTargetId) {
                      setSingleTargetId(null);
                    }
                  }}
                  placeholder="e.g. recruiter@company.com"
                />
              </div>

              {/* 3. Optional Recipient Name & Company Inputs */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: '0.78rem', marginBottom: 4 }}>Full Name (Optional)</label>
                  <input
                    type="text"
                    value={targetName}
                    onChange={(e) => setTargetName(e.target.value)}
                    placeholder="e.g. Alex Rivera"
                    style={{ fontSize: '0.82rem', padding: '8px 10px' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.78rem', marginBottom: 4 }}>Company (Optional)</label>
                  <input
                    type="text"
                    value={targetCompany}
                    onChange={(e) => setTargetCompany(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    style={{ fontSize: '0.82rem', padding: '8px 10px' }}
                  />
                </div>
              </div>

              {/* 4. Active Target Status Strip */}
              {targetEmail && (
                <div style={{ marginBottom: 18, padding: 12, background: 'rgba(16, 21, 36, 0.7)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: '0.88rem', color: '#ffffff' }}>
                      {targetName || targetEmail}
                    </strong>
                    {(() => {
                      const matched = recipients.find((r) => (singleTargetId && r.id === singleTargetId) || r.email.toLowerCase() === targetEmail.toLowerCase().trim());
                      if (matched) {
                        return <span className={`badge badge-${matched.status.toLowerCase().replace('_', '-')}`}>{matched.status}</span>;
                      }
                      return <span className="badge badge-pending">Custom Recipient</span>;
                    })()}
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#a5b4fc' }}>{targetEmail}</div>
                  {(targetCompany || targetRole) && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {targetCompany || ''} {targetRole ? `• ${targetRole}` : ''}
                    </div>
                  )}
                </div>
              )}

              {/* 5. Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '11px 16px', background: !dryRunMode ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : undefined }}
                  disabled={singleSendingId === 'target' || !targetEmail || (!dryRunMode && !systemStatus?.has_token)}
                  onClick={handleSendTargetOutreach}
                >
                  {singleSendingId === 'target' ? (
                    <RefreshCw size={16} className="spin-icon" />
                  ) : (
                    <Send size={16} />
                  )}
                  {dryRunMode
                    ? `Simulate Send to ${targetName || targetEmail || 'Recipient'} (Dry-Run)`
                    : `Send Real Email to ${targetName || targetEmail || 'Recipient'}`}
                </button>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                    onClick={handleOpenGmailWebTarget}
                    disabled={!targetEmail}
                  >
                    <ExternalLink size={14} color="#38bdf8" /> Gmail Web
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                    onClick={handleOpenMailtoTarget}
                    disabled={!targetEmail}
                  >
                    <Mail size={14} color="#a855f7" /> Mail App
                  </button>
                </div>

                <button
                  className="btn btn-secondary"
                  style={{ width: '100%', fontSize: '0.8rem', padding: '8px 10px', justifyContent: 'center' }}
                  onClick={handleCopyTargetDraft}
                  disabled={!targetEmail}
                >
                  {copyFeedback ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
                  {copyFeedback ? 'Copied to Clipboard!' : 'Copy Personalized Draft'}
                </button>
              </div>
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
                  {!Array.isArray(logs) || logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                        No send events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log, idx) => {
                      const statusClean = (log.status || 'INFO').toLowerCase().replace('_', '-');
                      return (
                        <tr key={log.id ?? idx}>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '—'}
                          </td>
                          <td style={{ fontWeight: 600 }}>{log.email || '—'}</td>
                          <td>
                            <span className={`badge badge-${statusClean}`}>
                              {log.status || 'INFO'}
                            </span>
                          </td>
                          <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.subject || '—'}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: log.error_message ? '#f87171' : 'var(--text-muted)' }}>
                            {log.error_message || 'Completed cleanly'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
