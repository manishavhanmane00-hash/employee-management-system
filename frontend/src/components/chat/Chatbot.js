import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, MessageCircle, Send, X, ThumbsUp, ThumbsDown, Ticket, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import './Chatbot.css';

const pageModule = pathname => {
  if (/attendance/i.test(pathname)) return 'attendance';
  if (/leave/i.test(pathname)) return 'leave';
  if (/payroll|salary/i.test(pathname)) return 'payroll';
  if (/dashboard/i.test(pathname)) return 'dashboard';
  if (/employee|document/i.test(pathname)) return 'employees';
  return 'general';
};

const Chatbot = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { canAccess } = useAuth();
  const module = useMemo(() => pageModule(location.pathname), [location.pathname]);
  const permitted = canAccess('chatbot');
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [feedbackDrafts, setFeedbackDrafts] = useState({});
  const [ticketDraft, setTicketDraft] = useState(null);
  const [ticketPreview, setTicketPreview] = useState(false);

  useEffect(() => {
    if (!permitted) return undefined;
    let active = true;
    chatAPI.suggestions(module).then(({ data }) => {
      if (active) setSuggestions(data.suggestions || []);
    }).catch(() => {
      if (active) setSuggestions([]);
    });
    return () => { active = false; };
  }, [module, permitted]);

  useEffect(() => {
    if (!permitted || !open || tab !== 'tickets') return undefined;
    chatAPI.listTickets().then(({ data }) => setTickets(data.data || []))
      .catch(err => setError(err.response?.data?.message || 'Unable to load tickets.'));
    return undefined;
  }, [open, tab, permitted]);

  const ask = async value => {
    const text = (value || question).trim();
    if (!text || loading) return;
    setError('');
    setQuestion('');
    setLoading(true);
    setMessages(previous => [...previous, { type: 'question', text }, { type: 'pending', id: `pending-${Date.now()}` }]);
    try {
      const { data } = await chatAPI.answer({ question: text, module, currentPath: location.pathname });
      setMessages(previous => [...previous.filter(message => message.type !== 'pending'), {
        type: 'answer', id: data.response.id, question: text, text: data.response.text,
        source: data.response.source, canEscalate: data.response.canEscalate,
        navigation: data.response.navigation, ticket: data.response.ticket,
        aiConfigured: data.context?.ai?.configured,
      }]);
    } catch (err) {
      setMessages(previous => [...previous.filter(message => message.type !== 'pending')]);
      setError(err.response?.data?.message || 'Assistant could not respond. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  const saveFeedback = async message => {
    const draft = feedbackDrafts[message.id] || {};
    if (typeof draft.helpful !== 'boolean') return;
    try {
      await chatAPI.feedback({
        responseId: message.id, helpful: draft.helpful, question: message.question,
        answer: message.text, comment: draft.comment || '', module,
      });
      setFeedbackDrafts(current => ({ ...current, [message.id]: { ...current[message.id], saved: true } }));
      toast.success('Thanks for your feedback.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save feedback.');
    }
  };

  const openTicketReview = message => {
    setTicketDraft({
      subject: message.question.slice(0, 160),
      description: `Question: ${message.question}\n\nAssistant response: ${message.text}`,
      module,
      category: module === 'general' ? 'General' : module,
    });
    setTicketPreview(false);
    setTab('tickets');
  };

  const createTicket = async () => {
    if (!ticketDraft || !ticketPreview) return;
    try {
      const { data } = await chatAPI.createTicket(ticketDraft);
      setTickets(previous => [data.data, ...previous]);
      setTicketDraft(null);
      setTicketPreview(false);
      setError('');
      toast.success(`Support ticket ${data.data.ticketId} created.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Unable to create the support ticket.');
    }
  };

  if (!permitted) return null;

  return (
    <div className="ems-chat-root">
      {open && (
        <section className="ems-chat-panel" aria-label="EMS Assistant">
          <header className="ems-chat-header">
            <div className="ems-chat-brand"><span className="ems-chat-icon"><Bot size={19} /></span><span><strong>EMS Assistant</strong><small>Verified EMS guidance</small></span></div>
            <button type="button" className="ems-chat-icon-button" onClick={() => setOpen(false)} aria-label="Close assistant"><X size={18} /></button>
          </header>
          <nav className="ems-chat-tabs">
            <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>Ask</button>
            <button type="button" className={tab === 'tickets' ? 'active' : ''} onClick={() => setTab('tickets')}><Ticket size={14} /> Tickets</button>
          </nav>
          {error && <div className="ems-chat-error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
          {tab === 'chat' ? (
            <>
              <div className="ems-chat-messages">
                {!messages.length && <div className="ems-chat-welcome"><Bot size={25} /><strong>How can I help?</strong><span>Answers use verified EMS guidance and data you are permitted to see.</span></div>}
                {messages.map(message => message.type === 'question'
                  ? <div className="ems-chat-user-message" key={`q-${message.text}-${messages.indexOf(message)}`}>{message.text}</div>
                  : message.type === 'pending'
                    ? <div className="ems-chat-answer" key={message.id}>Checking verified EMS information…</div>
                    : <article className="ems-chat-answer" key={message.id}>
                      <p>{message.text}</p>
                      {message.source && <small className="ems-chat-source">Source: {message.source}</small>}
                      {message.navigation && <button type="button" className="ems-chat-escalate" onClick={() => navigate(message.navigation)}>Open relevant EMS page</button>}
                      {message.ticket && <small className="ems-chat-source">Escalated to {message.ticket.ticketId} ({message.ticket.status}){message.ticket.reused ? ' · existing ticket' : ''}</small>}
                      {message.aiConfigured === false && <small className="ems-chat-source">AI provider is not configured. Set EMS_AI_API_KEY and EMS_AI_MODEL in the backend environment; verified EMS lookups remain available.</small>}
                      <div className="ems-chat-feedback">
                        <span>Was this helpful?</span>
                        <button type="button" aria-label="Helpful" className={feedbackDrafts[message.id]?.helpful === true ? 'selected' : ''} onClick={() => setFeedbackDrafts(current => ({ ...current, [message.id]: { ...current[message.id], helpful: true } }))}><ThumbsUp size={15} /></button>
                        <button type="button" aria-label="Not helpful" className={feedbackDrafts[message.id]?.helpful === false ? 'selected' : ''} onClick={() => setFeedbackDrafts(current => ({ ...current, [message.id]: { ...current[message.id], helpful: false } }))}><ThumbsDown size={15} /></button>
                      </div>
                      {typeof feedbackDrafts[message.id]?.helpful === 'boolean' && !feedbackDrafts[message.id]?.saved && (
                        <div className="ems-chat-feedback-form"><input value={feedbackDrafts[message.id]?.comment || ''} onChange={event => setFeedbackDrafts(current => ({ ...current, [message.id]: { ...current[message.id], comment: event.target.value } }))} placeholder="Optional comment" maxLength={1000} /><button type="button" onClick={() => saveFeedback(message)}>Send feedback</button></div>
                      )}
                      {feedbackDrafts[message.id]?.saved && <small>Feedback saved</small>}
                      {message.canEscalate && <button type="button" className="ems-chat-escalate" onClick={() => openTicketReview(message)}>Create a support ticket</button>}
                    </article>
                )}
              </div>
              {suggestions.length > 0 && messages.length === 0 && <div className="ems-chat-suggestions"><span>Suggested for this page</span>{suggestions.map(item => <button key={item} type="button" onClick={() => ask(item)}>{item}<ChevronDown size={13} /></button>)}</div>}
              <form className="ems-chat-input" onSubmit={event => { event.preventDefault(); ask(); }}>
                <input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about your EMS…" maxLength={2000} aria-label="Your question" />
                <button type="submit" disabled={!question.trim() || loading} aria-label="Send question"><Send size={17} /></button>
              </form>
            </>
          ) : (
            <div className="ems-chat-ticket-list">
              {ticketDraft && <div className="ems-chat-ticket-form">
                <strong>{ticketPreview ? 'Confirm ticket submission' : 'Review your support request'}</strong>
                <label>Subject<input value={ticketDraft.subject} maxLength={160} onChange={event => setTicketDraft({ ...ticketDraft, subject: event.target.value })} readOnly={ticketPreview} /></label>
                <label>Details<textarea value={ticketDraft.description} maxLength={4000} rows={5} onChange={event => setTicketDraft({ ...ticketDraft, description: event.target.value })} readOnly={ticketPreview} /></label>
                {!ticketPreview
                  ? <button type="button" className="ems-chat-primary" disabled={!ticketDraft.subject.trim() || !ticketDraft.description.trim()} onClick={() => setTicketPreview(true)}>Review before sending</button>
                  : <div className="ems-chat-ticket-actions"><button type="button" onClick={() => setTicketPreview(false)}>Edit</button><button type="button" className="ems-chat-primary" onClick={createTicket}>Confirm and submit</button></div>}
                <button type="button" className="ems-chat-cancel" onClick={() => { setTicketDraft(null); setTicketPreview(false); }}>Cancel</button>
              </div>}
              {!tickets.length && !ticketDraft && <div className="ems-chat-welcome"><Ticket size={24} /><strong>No support tickets yet</strong><span>When you create a ticket, its status and updates appear here.</span></div>}
              {tickets.map(ticket => <article className="ems-chat-ticket" key={ticket._id}>
                <div><strong>{ticket.ticketId}</strong><span className={`ems-ticket-status status-${ticket.status.toLowerCase().replace(/\s+/g, '-')}`}>{ticket.status}</span></div>
                <p>{ticket.subject}</p><small>{new Date(ticket.updatedAt).toLocaleString()}</small>
                <details><summary>History</summary>{ticket.history?.map((entry, index) => <p key={`${ticket._id}-${index}`}><b>{entry.performedByName}</b> · {entry.message} <small>{new Date(entry.createdAt).toLocaleString()}</small></p>)}</details>
              </article>)}
            </div>
          )}
        </section>
      )}
      <button type="button" className="ems-chat-launcher" onClick={() => setOpen(value => !value)} aria-label={open ? 'Close EMS Assistant' : 'Open EMS Assistant'}>
        {open ? <X size={21} /> : <MessageCircle size={21} />}<span>{open ? 'Close' : 'EMS Assistant'}</span>
      </button>
    </div>
  );
};

export default Chatbot;
