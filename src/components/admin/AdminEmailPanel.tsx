import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Mail,
  Search,
  Send,
  Users
} from 'lucide-react';
import {
  collection,
  getDocs,
  limit,
  query
} from 'firebase/firestore';

import { db } from '../../lib/firebase';
import {
  sendAdminEmailCampaign,
  type EmailAudience
} from '../../services/emailCampaignService';

interface UserEmailRow {
  id: string;
  email?: string;
  displayName?: string;
  name?: string;
  roles?: string[];
  isModerator?: boolean;
  moderatorVerified?: boolean;
  moderatorStatus?: string;
}

const getDisplayName = (user: UserEmailRow) =>
  user.displayName || user.name || user.email || `User ${user.id.slice(-6)}`;

const isModerator = (user: UserEmailRow) =>
  user.roles?.includes('moderator') ||
  (user.isModerator === true &&
    user.moderatorVerified === true &&
    user.moderatorStatus === 'approved');

const emailApiBaseUrl = import.meta.env.VITE_EMAIL_API_BASE_URL as
  | string
  | undefined;

export default function AdminEmailPanel() {
  const [users, setUsers] = useState<UserEmailRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState<EmailAudience>('all_users');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');

  const emailEngineConfigured = Boolean(emailApiBaseUrl);

  useEffect(() => {
    let mounted = true;

    const loadUsers = async () => {
      setLoadingUsers(true);

      try {
        const snap = await getDocs(query(collection(db, 'users'), limit(500)));
        const nextUsers = snap.docs
          .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
          })) as UserEmailRow[];

        if (!mounted) return;

        setUsers(
          nextUsers
            .filter(user => Boolean(user.email))
            .sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)))
        );
      } catch (error) {
        console.error('Admin email users load failed:', error);
        if (mounted) {
          setMessage('Could not load user emails.');
        }
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    };

    void loadUsers();

    return () => {
      mounted = false;
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return users;

    return users.filter(user =>
      [
        getDisplayName(user),
        user.email,
        ...(user.roles || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [search, users]);

  const moderatorCount = useMemo(
    () => users.filter(user => isModerator(user)).length,
    [users]
  );

  const recipientCount =
    audience === 'all_users'
      ? users.length
      : audience === 'moderators'
        ? moderatorCount
        : selectedUserIds.length;

  const toggleSelectedUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const sendCampaign = async () => {
    if (!emailEngineConfigured) {
      setMessage(
        'VITE_EMAIL_API_BASE_URL is not configured on the main Render app service.'
      );
      return;
    }

    if (!subject.trim() || !title.trim() || !body.trim()) {
      setMessage('Subject, title, and body are required.');
      return;
    }

    if (audience === 'selected_users' && selectedUserIds.length === 0) {
      setMessage('Select at least one recipient.');
      return;
    }

    const confirmed = window.confirm(
      `Send this email to ${recipientCount.toLocaleString()} recipient(s)?`
    );

    if (!confirmed) return;

    setWorking(true);
    setMessage('');

    try {
      const result = await sendAdminEmailCampaign({
        audience,
        recipientIds: selectedUserIds,
        subject,
        preheader,
        title,
        body,
        ctaLabel,
        ctaUrl
      });

      setMessage(
        `Campaign sent. Sent: ${result.sentCount}. Failed: ${result.failedCount}.`
      );

      setSubject('');
      setPreheader('');
      setTitle('');
      setBody('');
      setCtaLabel('');
      setCtaUrl('');
      setSelectedUserIds([]);
    } catch (error) {
      console.error('Email campaign failed:', error);
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not send email campaign.'
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-3 font-serif text-3xl text-white">
              <Mail className="h-6 w-6 text-amber-500" />
              Email Campaigns
            </h2>
            <p className="mt-2 max-w-3xl text-[10px] font-black uppercase leading-relaxed tracking-widest text-slate-500">
              Send branded Hema Trader updates, newsletters, safety notices, and promos through the Render email engine and Mailchimp.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
              <Users className="mx-auto h-4 w-4 text-amber-500" />
              <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                Users
              </p>
              <p className="font-serif text-xl text-white">{users.length}</p>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
              <BadgeCheck className="mx-auto h-4 w-4 text-green-400" />
              <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                Moderators
              </p>
              <p className="font-serif text-xl text-white">{moderatorCount}</p>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/30 p-4">
              <Send className="mx-auto h-4 w-4 text-blue-400" />
              <p className="mt-2 text-[8px] font-black uppercase text-slate-600">
                Recipients
              </p>
              <p className="font-serif text-xl text-white">{recipientCount}</p>
            </div>
          </div>
        </div>
      </section>

      {!emailEngineConfigured && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-relaxed text-red-200">
          Email engine is not configured. Add{' '}
          <span className="font-bold text-white">VITE_EMAIL_API_BASE_URL</span>{' '}
          to the main Render static site environment variables, set it to your
          Render email engine URL, then redeploy the main app.
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          {message}
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[1fr_420px]">
        <section className="space-y-5 rounded-[2.5rem] border border-white/5 bg-brand-card p-8 shadow-2xl">
          <h3 className="font-serif text-2xl text-white">Compose Email</h3>

          <div className="grid gap-4">
            <input
              value={subject}
              onChange={event => setSubject(event.target.value)}
              placeholder="Email subject"
              className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />

            <input
              value={preheader}
              onChange={event => setPreheader(event.target.value)}
              placeholder="Short preview text"
              className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />

            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              placeholder="Email headline"
              className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />

            <textarea
              value={body}
              onChange={event => setBody(event.target.value)}
              placeholder="Write the message. You can include updates, promotions, safety notices, or newsletter content."
              className="min-h-52 resize-y rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm leading-relaxed text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
            />

            <div className="grid gap-4 md:grid-cols-2">
              <input
                value={ctaLabel}
                onChange={event => setCtaLabel(event.target.value)}
                placeholder="Button label, optional"
                className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />

              <input
                value={ctaUrl}
                onChange={event => setCtaUrl(event.target.value)}
                placeholder="Button URL, optional"
                className="rounded-xl border border-white/5 bg-black/40 px-5 py-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            onClick={sendCampaign}
            disabled={working || recipientCount === 0 || !emailEngineConfigured}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black shadow-xl disabled:opacity-50"
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send Branded Email
          </button>
        </section>

        <aside className="space-y-5 rounded-[2.5rem] border border-white/5 bg-brand-card p-6 shadow-2xl">
          <h3 className="font-serif text-2xl text-white">Recipients</h3>

          <div className="grid gap-2">
            {[
              { id: 'all_users', label: 'All Users' },
              { id: 'moderators', label: 'Moderators Only' },
              { id: 'selected_users', label: 'Choose Users' }
            ].map(option => (
              <button
                key={option.id}
                onClick={() => setAudience(option.id as EmailAudience)}
                className={`rounded-xl px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest transition ${
                  audience === option.id
                    ? 'bg-amber-500 text-black'
                    : 'border border-white/5 bg-black/30 text-slate-500 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {audience === 'selected_users' && (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/40 px-4 py-3">
                <Search className="h-4 w-4 text-slate-600" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search users..."
                  className="w-full bg-transparent text-sm text-white placeholder:text-slate-700 focus:outline-none"
                />
              </div>

              <div className="max-h-[34rem] space-y-2 overflow-y-auto pr-1">
                {loadingUsers ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                  </div>
                ) : (
                  filteredUsers.map(user => {
                    const selected = selectedUserIds.includes(user.id);

                    return (
                      <button
                        key={user.id}
                        onClick={() => toggleSelectedUser(user.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                          selected
                            ? 'border-amber-500/40 bg-amber-500/10'
                            : 'border-white/5 bg-black/30 hover:border-white/15'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white">
                            {getDisplayName(user)}
                          </p>
                          <p className="truncate text-[9px] uppercase tracking-widest text-slate-500">
                            {user.email}
                          </p>
                        </div>

                        {selected && (
                          <CheckCircle2 className="h-4 w-4 text-amber-500" />
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
