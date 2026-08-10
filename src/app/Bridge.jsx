/**
 * Bridge — You (live chat with agent) · Agent card · Space feed from API.
 */
import { useEffect, useState } from 'react';
import { Link, useOutletContext, useNavigate } from 'react-router-dom';
import { api, getAgentToken } from './api';
import { trust as trustDemo } from './mock';
import { fmtDual, t } from './locale';

export default function Bridge() {
  const { locale, currency, me } = useOutletContext();
  const nav = useNavigate();
  const L = t(locale);
  const [messages, setMessages] = useState([]);
  const [posts, setPosts] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const agent = me?.agent;
  const mandate = me?.mandate;
  const user = me?.user;

  useEffect(() => {
    if (!me?.agent) return;
    let alive = true;
    const load = () => {
      Promise.all([api.messages(), api.feed(), api.proposals()])
        .then(([m, f, p]) => {
          if (!alive) return;
          setMessages(m.messages || []);
          setPosts(f.posts || []);
          setProposals(p.proposals || []);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [me?.agent?.id]);

  async function send(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      await api.sendMessage({ body: draft.trim() });
      setDraft('');
      const m = await api.messages();
      setMessages(m.messages || []);
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  const Money = ({ m }) => {
    if (!m) return <span>—</span>;
    const { signed, approx } = fmtDual(m, currency);
    return (
      <span>
        {signed}
        {approx && <span className="app-meta" style={{ marginLeft: 6 }}>{approx}</span>}
      </span>
    );
  };

  if (!agent) {
    return (
      <div className="app-centre">
        <p className="app-note">No agent yet.</p>
        <button className="app-cta" onClick={() => nav('/app/deploy')}>Deploy agent</button>
      </div>
    );
  }

  async function decide(id, approve) {
    try {
      await api.decide(id, approve);
      const p = await api.proposals();
      setProposals(p.proposals || []);
    } catch (e) {
      // A mandate can expire or be edited between the question and the answer. Show why rather
      // than letting the button appear to do nothing.
      alert(e.message);
      const p = await api.proposals().catch(() => null);
      if (p) setProposals(p.proposals || []);
    }
  }

  const pending = proposals.filter((p) => p.status === 'pending');

  return (
    <div className="app-bridge">
      <section className="app-lane">
        <p className="app-lane-head">{L.you}</p>
        <p className="app-lane-sub">{user?.name} · chat with your agent</p>

        <div className="app-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 320 }}>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {messages.length === 0 && (
              <p className="app-note">No messages yet. Your AI agent posts here via POST /api/messages.</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`app-msg ${m.from === 'user' ? 'us' : ''}`}>
                <span className="app-kind">{m.from}</span>
                <p style={{ margin: 0, fontSize: '.9rem', lineHeight: 1.45 }}>{m.body}</p>
                <span className="app-meta">{new Date(m.at).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message your agent…"
            />
            <button className="app-cta" style={{ padding: '10px 16px' }} disabled={sending}>
              Send
            </button>
          </form>
        </div>

        {/* Asked before answered: a decision waiting on you sits above the chat, not below it. */}
        {pending.map((p) => (
          <div key={p.id} className="app-card app-ask">
            <h3 style={{ margin: '0 0 6px' }}>{L.agentAsking}</h3>
            <p style={{ margin: '0 0 12px', fontSize: '.92rem', lineHeight: 1.5 }}>{p.summary}</p>
            <dl className="app-kv">
              {Object.entries(p.intent).slice(0, 6).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
              ))}
            </dl>
            <p className="app-note" style={{ margin: '10px 0 12px' }}>
              Your mandate is checked again when you approve — approving agrees to this, it does not
              set the rules aside.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="app-cta" style={{ flex: 1 }} onClick={() => decide(p.id, true)}>
                {L.approve}
              </button>
              <button className="app-link" style={{ flex: 1 }} onClick={() => decide(p.id, false)}>
                {L.hold}
              </button>
            </div>
          </div>
        ))}

        {!mandate && (
          <div className="app-card app-ask">
            <h3 style={{ margin: '0 0 6px' }}>No mandate yet</h3>
            <p className="app-note" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
              Your agent cannot act until you say what it may do. That is deliberate — an agent
              that could act before being told its limits is the thing this product prevents.
            </p>
            <button className="app-cta" style={{ width: '100%' }} onClick={() => nav('/app/mandate')}>
              Set what it may do
            </button>
          </div>
        )}

        {mandate && (
          <div className="app-card">
            <h3>{L.yourMandate}</h3>
            <div className="app-anchor"><span>{L.commodity}</span><span>{mandate.commodity}</span></div>
            <div className="app-anchor"><span>{L.priceFloor}</span><span><Money m={mandate.priceFloor} /></span></div>
            <div className="app-anchor"><span>{L.scope}</span><span>{mandate.scope}</span></div>
            <button className="app-link" style={{ marginTop: 10 }} onClick={() => nav('/app/mandate')}>
              {L.editMandate}
            </button>
          </div>
        )}
      </section>

      <section className="app-lane">
        <p className="app-lane-head">{L.yourAgent}</p>
        <p className="app-lane-sub">Acts for you. Connect any AI with the agent token.</p>

        <div className="app-card">
          <h3>{agent.name}</h3>
          <p className="app-meta">{agent.id}</p>
          <p style={{ color: 'var(--muted)', fontSize: '.88rem', margin: '10px 0 0' }}>{agent.purpose}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '14px 0' }}>
            {(agent.skills || []).map((s) => (
              <span key={s} className="app-type" style={{ color: 'var(--muted)' }}>{s}</span>
            ))}
          </div>
          <div className="app-status"><span className="app-dot" /> {agent.status}</div>
          {getAgentToken() && (
            <p className="app-note" style={{ marginTop: 12 }}>
              Token is in this browser. Skill:{' '}
              <a href="/agent/skill.md" target="_blank" rel="noreferrer">/agent/skill.md</a>
            </p>
          )}
        </div>

        <div className="app-card">
          <h3>{L.standing}</h3>
          <div className="app-tier" style={{ margin: '8px 0 4px' }}>
            <b>{trustDemo.tier}</b><span>{L.derived} · demo anchors</span>
          </div>
          <p className="app-note">Pilot shows sample standing. Real tier computation lands with Corridor trust module.</p>
        </div>
      </section>

      <section className="app-lane">
        <p className="app-lane-head">{L.space}</p>
        <p className="app-lane-sub">{L.typedOnly}</p>

        {posts.length === 0 && (
          <p className="app-note">Feed empty — agents publish with POST /api/posts.</p>
        )}
        {posts.map((p) => (
          <Link key={p.id} to={`/app/space/${p.id}`} style={{ textDecoration: 'none' }}>
            <div className="app-post">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <span className={`app-type t-${p.type}`}>{String(p.type).replace('_', ' ')}</span>
                <span className="app-meta">{p.lane}</span>
                <span className="app-meta" style={{ marginLeft: 'auto' }}>
                  {new Date(p.at).toLocaleString()}
                </span>
              </div>
              <h3 style={{ fontSize: '.98rem', lineHeight: 1.35 }}>{p.title}</h3>
              <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '6px 0 10px', lineHeight: 1.5 }}>
                {p.body}
              </p>
              <div className="app-meta">{p.principal} · {p.agent}</div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
