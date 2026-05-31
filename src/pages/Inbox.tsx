import { useEffect, useMemo, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { Link } from 'react-router-dom';
import {
  collection,
  limit,
  onSnapshot,
  query,
  where,
  type Query
} from 'firebase/firestore';
import {
  AlertCircle,
  Loader2,
  MessageCircle,
  Search
} from 'lucide-react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';

interface TradeInboxItem {
  id: string;
  listingId?: string;
  buyerId?: string;
  sellerId?: string;
  driverId?: string;
  participants?: string[];
  participantIds?: string[];
  status?: string;
  lastMessage?: string;
  lastMessageAt?: any;
  lastMessageSenderId?: string;
  unreadBy?: string[];
  readBy?: string[];
  updatedAt?: any;
  createdAt?: any;
}

interface InboxQueryDefinition {
  key: string;
  value: Query;
  required?: boolean;
}

const REQUIRED_QUERY_KEYS = ['buyer', 'seller', 'driver'];

const getMillis = (value: any) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (value.seconds) return value.seconds * 1000;
  if (value._seconds) return value._seconds * 1000;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const getInboxTime = (item: TradeInboxItem) =>
  getMillis(item.lastMessageAt) ||
  getMillis(item.updatedAt) ||
  getMillis(item.createdAt);

const formatTime = (value: any) => {
  const millis = getMillis(value);
  if (!millis) return '';

  return new Date(millis).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const handleFirestoreError = (error: unknown) => {
  if (error instanceof FirebaseError) {
    if (error.code === 'permission-denied') {
      return 'You do not have permission to load this inbox.';
    }

    if (error.code === 'failed-precondition') {
      return 'This inbox query needs a Firestore index.';
    }

    return error.message;
  }

  if (error instanceof Error) return error.message;

  return 'Could not load inbox.';
};

const buildInboxQueries = (userId: string): InboxQueryDefinition[] => [
  {
    key: 'buyer',
    required: true,
    value: query(
      collection(db, 'trades'),
      where('buyerId', '==', userId),
      limit(50)
    )
  },
  {
    key: 'seller',
    required: true,
    value: query(
      collection(db, 'trades'),
      where('sellerId', '==', userId),
      limit(50)
    )
  },
  {
    key: 'driver',
    required: true,
    value: query(
      collection(db, 'trades'),
      where('driverId', '==', userId),
      limit(50)
    )
  },
  {
    key: 'participants',
    value: query(
      collection(db, 'trades'),
      where('participants', 'array-contains', userId),
      limit(50)
    )
  },
  {
    key: 'participantIds',
    value: query(
      collection(db, 'trades'),
      where('participantIds', 'array-contains', userId),
      limit(50)
    )
  }
];

export default function Inbox() {
  const { user } = useAuth();

  const [buckets, setBuckets] = useState<Record<string, TradeInboxItem[]>>({});
  const [queryErrors, setQueryErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.uid) {
      setBuckets({});
      setQueryErrors({});
      setLoading(false);
      return;
    }

    let active = true;

    setBuckets({});
    setQueryErrors({});
    setLoading(true);

    const tradeQueries = buildInboxQueries(user.uid);

    const unsubscribes = tradeQueries.map(({ key, value, required }) =>
      onSnapshot(
        value,
        snapshot => {
          if (!active) return;

          setBuckets(current => ({
            ...current,
            [key]: snapshot.docs.map(docSnap => ({
              id: docSnap.id,
              ...docSnap.data()
            })) as TradeInboxItem[]
          }));

          setQueryErrors(current => {
            const next = { ...current };
            delete next[key];
            return next;
          });

          setLoading(false);
        },
        err => {
          if (!active) return;

          const message = handleFirestoreError(err);

          console.warn(
            `Inbox ${key} query failed${required ? '' : ' (optional)'}:`,
            err
          );

          setQueryErrors(current => ({
            ...current,
            [key]: message
          }));

          setLoading(false);
        }
      )
    );

    return () => {
      active = false;
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, [user?.uid]);

  const conversations = useMemo(() => {
    const byId = new Map<string, TradeInboxItem>();

    Object.values(buckets).forEach(items => {
      items.forEach(item => {
        const existing = byId.get(item.id);

        if (!existing || getInboxTime(item) >= getInboxTime(existing)) {
          byId.set(item.id, item);
        }
      });
    });

    return Array.from(byId.values()).sort(
      (a, b) => getInboxTime(b) - getInboxTime(a)
    );
  }, [buckets]);

  const requiredQueriesFailed = REQUIRED_QUERY_KEYS.every(
    key => Boolean(queryErrors[key]) && !(key in buckets)
  );

  const fatalError = requiredQueriesFailed
    ? queryErrors.buyer ||
      queryErrors.seller ||
      queryErrors.driver ||
      'Could not load inbox.'
    : null;

  const filteredConversations = conversations.filter(item => {
    const text = `${item.id} ${item.listingId || ''} ${item.lastMessage || ''} ${
      item.status || ''
    }`.toLowerCase();

    return text.includes(search.trim().toLowerCase());
  });

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[2rem] border border-white/5 bg-brand-card p-10 text-center">
        <AlertCircle className="mx-auto mb-5 h-10 w-10 text-amber-500" />
        <h1 className="font-serif text-2xl text-white">Sign In Required</h1>
        <p className="mt-2 text-sm text-slate-500">
          Sign in to view your trade inbox.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-col gap-5 rounded-[2rem] border border-white/5 bg-brand-card p-6 shadow-2xl md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-serif text-3xl text-white">Inbox</h1>
          <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
            Trade messages, delivery updates, and escrow conversations
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/40 px-4 py-3">
          <Search className="h-4 w-4 text-slate-600" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search inbox"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-700 focus:outline-none md:w-56"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center rounded-[2rem] border border-white/5 bg-brand-card py-24">
          <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
        </div>
      ) : fatalError ? (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/5 p-10 text-center">
          <AlertCircle className="mx-auto mb-4 h-10 w-10 text-red-500" />
          <p className="font-serif text-xl text-white">Inbox unavailable</p>
          <p className="mt-2 text-sm text-slate-500">{fatalError}</p>
        </div>
      ) : filteredConversations.length === 0 ? (
        <div className="rounded-[2rem] border border-white/5 bg-brand-card p-12 text-center">
          <MessageCircle className="mx-auto mb-5 h-12 w-12 text-slate-700" />
          <p className="font-serif text-2xl text-white">No conversations yet</p>
          <p className="mt-2 text-sm text-slate-500">
            Your trade chats will appear here after you start buying, selling, or delivering.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[2rem] border border-white/5 bg-brand-card shadow-2xl">
          {filteredConversations.map(item => {
            const isUnread = Array.isArray(item.unreadBy)
              ? item.unreadBy.includes(user.uid)
              : Boolean(
                  item.lastMessageSenderId &&
                    item.lastMessageSenderId !== user.uid &&
                    !item.readBy?.includes(user.uid)
                );

            return (
              <Link
                key={item.id}
                to={`/trade/${item.id}`}
                className="flex items-center gap-4 border-b border-white/5 p-5 transition-all last:border-b-0 hover:bg-white/[0.03]"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
                  <MessageCircle className="h-5 w-5 text-amber-500" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-serif text-lg text-white">
                      Trade #{item.id.slice(-6).toUpperCase()}
                    </p>

                    {isUnread && (
                      <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-black">
                        New
                      </span>
                    )}
                  </div>

                  <p className="mt-1 truncate text-sm text-slate-500">
                    {item.lastMessage || 'Open trade conversation'}
                  </p>
                </div>

                <div className="hidden text-right md:block">
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                    {item.status || 'active'}
                  </p>
                  <p className="mt-1 text-[8px] font-black uppercase tracking-widest text-slate-700">
                    {formatTime(item.lastMessageAt || item.updatedAt || item.createdAt)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
