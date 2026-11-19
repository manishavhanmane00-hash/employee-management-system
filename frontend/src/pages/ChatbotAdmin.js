import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, MessageSquareText, RefreshCw, Search, Ticket, ThumbsUp } from 'lucide-react';
import { chatAPI, authAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import './ChatbotAdmin.css';

const TICKET_STATUSES = ['Open', 'Pending', 'Assigned', 'In Progress', 'Resolved', 'Closed'];

const ChatbotAdmin = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';
  const [tab, setTab] = useState('tickets');
  const [analytics, setAnalytics] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [comment, setComment] = useState({});
  const [analyticsModule, setAnalyticsModule] = useState('all');
  const [analyticsSearch, setAnalyticsSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadTickets = useCallback(async () => {
    const { data } = await chatAPI.listTickets();
    setTickets(data.data || []);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const { data } = await chatAPI.feedbackAnalytics();
    setAnalytics(data);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadTickets(), isAdmin ? loadAnalytics() : Promise.resolve()]);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load assistant management data.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, loadAnalytics, loadTickets]);

  useEffect(() => {
    load();
    if (isAdmin) {
      authAPI.getUsers().then(({ data }) => setAssignees((data.users || data.data || [])
        .filter(account => ['Admin', 'HR'].includes(account.role) && account.isActive)))
        .catch(() => setAssignees([]));
    }
  }, [isAdmin, load]);

  const updateTicket = async (ticket, updates) => {
    setError('');
    try {
      await chatAPI.updateTicket(ticket._id, updates);
      if (updates.comment) setComment(current => ({ ...current, [ticket._id]: '' }));
      await loadTickets();
      toast.success('Ticket updated.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update ticket.');
    }
  };

  const feedback = analytics?.summary || { helpful: 0, notHelpful: 0 };
  const totalFeedback = feedback.helpful + feedback.notHelpful;
  const helpfulRate = totalFeedback ? Math.round((feedback.helpful / totalFeedback) * 100) : 0;
  const reportedIssues = analytics?.unhelpful || [];
  const modules = Array.from(new Set(reportedIssues.map(issue => issue.latestModule).filter(Boolean))).sort();
  const visibleIssues = reportedIssues.filter(issue => (
    (analyticsModule === 'all' || issue.latestModule === analyticsModule)
    && `${issue.latestQuestion || ''} ${issue.latestComment || ''}`.toLowerCase().includes(analyticsSearch.trim().toLowerCase())
  ));

  return (
    <div className="page-container chat-admin">
      <header className="page-header">
        <div className="page-header-top chat-admin__page-heading">
          <div>
            <h1 className="page-title">EMS Assistant Management</h1>
            <p className="page-subtitle">Manage support tickets and review assistant feedback.</p>
          </div>
          <button type="button" className="btn btn-outline" onClick={load} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </div>
      </header>

      <nav className="tabs chat-admin__tabs" aria-label="Assistant management views">
        <button type="button" className={`tab ${tab === 'tickets' ? 'active' : ''}`} onClick={() => setTab('tickets')}>
          <Ticket size={15} aria-hidden="true" /> Support tickets <span className="chat-admin__tab-count">{tickets.length}</span>
        </button>
        {isAdmin && <button type="button" className={`tab ${tab === 'feedback' ? 'active' : ''}`} onClick={() => setTab('feedback')}>
          <ThumbsUp size={15} aria-hidden="true" /> Feedback analytics
        </button>}
      </nav>

      {error && <div className="alert alert-danger chat-admin__alert" role="alert">
        <span>{error}</span>
        <button type="button" className="btn btn-ghost" onClick={() => setError('')}>Dismiss</button>
      </div>}

      {tab === 'tickets' && <section className="chat-admin__section" aria-labelledby="chat-admin-tickets-title">
        <div className="chat-admin__section-heading">
          <div>
            <h2 id="chat-admin-tickets-title">Support tickets</h2>
            <p>Review employee requests, update status, assign an owner, and keep the conversation history together.</p>
          </div>
          <span className="badge badge-gray">{tickets.length} total</span>
        </div>

        {loading ? <div className="card"><div className="card-body">Loading support tickets…</div></div>
          : !tickets.length ? <div className="card chat-admin__empty"><div className="empty-state"><Ticket size={22} /><strong>No support tickets</strong><span>Employee requests will appear here.</span></div></div>
            : <div className="chat-admin__ticket-list">{tickets.map(ticket => (
              <article className="card chat-admin__ticket" key={ticket._id}>
                <header className="chat-admin__ticket-header">
                  <div className="chat-admin__ticket-title">
                    <span className="chat-admin__ticket-id">{ticket.ticketId}</span>
                    <h3>{ticket.subject}</h3>
                    <p>{ticket.requesterName} <span>·</span> {ticket.requesterRole} <span>·</span> {ticket.module || 'General'}{ticket.category ? ` · ${ticket.category}` : ''}</p>
                  </div>
                  <span className={`chat-admin__status chat-admin__status--${ticket.status.toLowerCase().replace(/\s+/g, '-')}`}>{ticket.status}</span>
                </header>

                <div className="chat-admin__ticket-body">
                  <p className="chat-admin__description">{ticket.description}</p>
                  <div className="chat-admin__controls">
                    <label className="chat-admin__field">
                      <span>Status</span>
                      <select className="form-control" aria-label={`Status for ${ticket.ticketId}`} value={ticket.status} onChange={event => updateTicket(ticket, { status: event.target.value })}>
                        {TICKET_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                      </select>
                    </label>
                    {isAdmin && <label className="chat-admin__field">
                      <span>Assigned to</span>
                      <select className="form-control" aria-label={`Assignee for ${ticket.ticketId}`} value={ticket.assignedTo || ''} onChange={event => updateTicket(ticket, { assignedTo: event.target.value || null })}>
                        <option value="">Unassigned</option>
                        {assignees.map(account => <option key={account._id} value={account._id}>{account.name} ({account.role})</option>)}
                      </select>
                    </label>}
                    <span className="chat-admin__updated"><Clock3 size={14} aria-hidden="true" /> Updated {new Date(ticket.updatedAt).toLocaleString()}</span>
                  </div>

                  <form className="chat-admin__comment-form" onSubmit={event => { event.preventDefault(); updateTicket(ticket, { comment: comment[ticket._id] }); }}>
                    <label className="chat-admin__sr-only" htmlFor={`ticket-comment-${ticket._id}`}>Add a ticket update</label>
                    <input id={`ticket-comment-${ticket._id}`} className="form-control" maxLength={2000} placeholder="Add an update or comment" value={comment[ticket._id] || ''} onChange={event => setComment(current => ({ ...current, [ticket._id]: event.target.value }))} />
                    <button type="submit" className="btn btn-outline" disabled={!(comment[ticket._id] || '').trim()}>
                      <MessageSquareText size={15} aria-hidden="true" /> Add comment
                    </button>
                  </form>

                  <details className="chat-admin__history">
                    <summary>Ticket history <span>{ticket.history?.length || 0}</span></summary>
                    {!ticket.history?.length ? <p className="chat-admin__history-empty">No history entries yet.</p> : (
                      <ol>{ticket.history.map((entry, index) => <li key={`${ticket._id}-${index}`}>
                        <span className="chat-admin__history-dot" aria-hidden="true" />
                        <div><strong>{entry.performedByName}</strong><p>{entry.message}</p><time>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}</time></div>
                      </li>)}</ol>
                    )}
                  </details>
                </div>
              </article>
            ))}</div>}
      </section>}

      {tab === 'feedback' && isAdmin && <section className="chat-admin__section" aria-labelledby="chat-admin-feedback-title">
        <div className="chat-admin__section-heading">
          <div>
            <h2 id="chat-admin-feedback-title">Feedback analytics</h2>
            <p>Use employee ratings and repeated issues to find answers that need review.</p>
          </div>
          <span className="chat-admin__period">All recorded feedback</span>
        </div>

        {loading ? <div className="card"><div className="card-body">Loading feedback analytics…</div></div>
          : !analytics ? <div className="card"><div className="empty-state">Feedback analytics are unavailable.</div></div>
            : <>
              <div className="chat-admin__metrics">
                <article className="card chat-admin__metric">
                  <span className="chat-admin__metric-label">Helpful responses</span>
                  <strong>{feedback.helpful}</strong>
                  <span className="chat-admin__metric-note">Rated helpful by employees</span>
                </article>
                <article className="card chat-admin__metric chat-admin__metric--warning">
                  <span className="chat-admin__metric-label">Needs attention</span>
                  <strong>{feedback.notHelpful}</strong>
                  <span className="chat-admin__metric-note">Not helpful ratings</span>
                </article>
                <article className="card chat-admin__metric chat-admin__metric--rate">
                  <span className="chat-admin__metric-label">Helpful rate</span>
                  <strong>{totalFeedback ? `${helpfulRate}%` : '—'}</strong>
                  <div className="chat-admin__meter" role="img" aria-label={`${helpfulRate}% helpful out of ${totalFeedback} ratings`}>
                    <span style={{ width: `${helpfulRate}%` }} />
                  </div>
                  <span className="chat-admin__metric-note">{totalFeedback} total ratings</span>
                </article>
              </div>

              <div className="chat-admin__issues-head">
                <div><h3>Reported issues</h3><p>Questions with the most unhelpful ratings.</p></div>
                <div className="chat-admin__filters">
                  <label className="chat-admin__filter-search">
                    <Search size={16} aria-hidden="true" />
                    <input value={analyticsSearch} onChange={event => setAnalyticsSearch(event.target.value)} placeholder="Filter questions" aria-label="Filter reported questions" />
                  </label>
                  <label className="chat-admin__filter-module">
                    <span className="chat-admin__sr-only">Filter by module</span>
                    <select className="form-control" value={analyticsModule} onChange={event => setAnalyticsModule(event.target.value)}>
                      <option value="all">All modules</option>
                      {modules.map(module => <option key={module} value={module}>{module}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              {!visibleIssues.length ? <div className="card chat-admin__empty"><div className="empty-state"><ThumbsUp size={22} /><strong>No reported issues</strong><span>{reportedIssues.length ? 'Try another filter.' : 'No unhelpful response reports have been recorded.'}</span></div></div> : (
                <div className="card chat-admin__table-wrap">
                  <table className="data-table chat-admin__issues-table">
                    <thead><tr><th>Question</th><th>Module</th><th>Reports</th><th>Latest comment</th></tr></thead>
                    <tbody>{visibleIssues.map(issue => <tr key={issue._id}>
                      <td><strong>{issue.latestQuestion}</strong></td>
                      <td><span className="badge badge-gray">{issue.latestModule || 'General'}</span></td>
                      <td><span className="chat-admin__report-count">{issue.count}</span></td>
                      <td>{issue.latestComment || <span className="chat-admin__no-comment">No comment provided</span>}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              )}
              <p className="chat-admin__footnote">Feedback is for monitoring and quality review; it does not change company policies automatically.</p>
            </>}
      </section>}
    </div>
  );
};

export default ChatbotAdmin;
