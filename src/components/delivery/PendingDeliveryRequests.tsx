import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { Loader2, Package, XCircle, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { db } from '../../lib/firebase';
import { useAuth } from '../auth/AuthContext';
import {
  acceptDeliveryRequest,
  declineDeliveryRequest
} from '../../services/deliveryService';

interface DeliveryRequest {
  id: string;
  tradeId: string;
  pickupLocation: string;
  deliveryLocation: string;
  deliveryNotes?: string;
  urgency?: string;
  estimatedFee?: number;
  driverCommission?: number;
  status: string;
}

export default function PendingDeliveryRequests() {
  const { user } = useAuth();

  const [requests, setRequests] = useState<DeliveryRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'deliveryRequests'),
        where('driverId', '==', user.uid),
        limit(50)
      ),
      snap => {
        setRequests(
          snap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() } as DeliveryRequest))
            .filter(request => request.status === 'pending')
        );
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const accept = async (requestId: string) => {
    if (!user) return;

    setUpdatingId(requestId);
    try {
      await acceptDeliveryRequest(requestId, user.uid);
    } finally {
      setUpdatingId(null);
    }
  };

  const decline = async (requestId: string) => {
    if (!user) return;

    setUpdatingId(requestId);
    try {
      await declineDeliveryRequest(requestId, user.uid);
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center rounded-2xl border border-white/5 bg-brand-card p-8">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  if (requests.length === 0) return null;

  return (
    <section className="space-y-4 rounded-[2rem] border border-amber-500/20 bg-amber-500/5 p-5">
      <h2 className="font-serif text-2xl text-white">New Delivery Requests</h2>

      <div className="grid gap-3">
        {requests.map(request => (
          <div
            key={request.id}
            className="rounded-2xl border border-white/10 bg-black/30 p-4"
          >
            <div className="flex items-start gap-3">
              <Package className="mt-1 h-5 w-5 text-amber-500" />

              <div className="flex-1 space-y-2">
                <p className="text-sm text-white">
                  {request.pickupLocation} → {request.deliveryLocation}
                </p>
                <p className="text-xs text-slate-500">
                  {request.deliveryNotes || 'No delivery notes'}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">
                  Commission: {(request.driverCommission || 0).toLocaleString()} CFA
                </p>

                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={() => accept(request.id)}
                    disabled={updatingId === request.id}
                    className="flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Accept
                  </button>

                  <button
                    onClick={() => decline(request.id)}
                    disabled={updatingId === request.id}
                    className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-400 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    Decline
                  </button>

                  <Link
                    to={`/delivery/${request.id}`}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-300"
                  >
                    Details
                  </Link>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
