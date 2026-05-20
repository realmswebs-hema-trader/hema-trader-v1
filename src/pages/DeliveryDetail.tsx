import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Package, Truck } from 'lucide-react';

import { db } from '../lib/firebase';
import { useAuth } from '../components/auth/AuthContext';
import {
  confirmDeliveryAndReleaseEscrow,
  updateDeliveryRequestStatus
} from '../services/deliveryService';

interface DeliveryRequest {
  id: string;
  tradeId: string;
  buyerId: string;
  sellerId: string;
  driverId: string;
  pickupLocation: string;
  deliveryLocation: string;
  deliveryNotes?: string;
  estimatedFee?: number;
  driverCommission?: number;
  deliveryStatus: string;
  status: string;
}

const steps = [
  'pending',
  'accepted',
  'picked_up',
  'in_transit',
  'delivered',
  'completed'
];

export default function DeliveryDetail() {
  const { id } = useParams();
  const { user } = useAuth();

  const [request, setRequest] = useState<DeliveryRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!id) return;

    const unsubscribe = onSnapshot(doc(db, 'deliveryRequests', id), snap => {
      if (snap.exists()) {
        setRequest({ id: snap.id, ...snap.data() } as DeliveryRequest);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [id]);

  const updateStatus = async (status: any) => {
    if (!request) return;

    setUpdating(true);
    try {
      await updateDeliveryRequestStatus(request.id, request.tradeId, status);
    } finally {
      setUpdating(false);
    }
  };

  const confirm = async () => {
    if (!request || !user) return;

    setUpdating(true);
    try {
      await confirmDeliveryAndReleaseEscrow(request.id, user.uid);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  if (!request) {
    return (
      <div className="py-24 text-center">
        <h1 className="font-serif text-3xl text-white">Delivery not found</h1>
      </div>
    );
  }

  const currentIndex = Math.max(0, steps.indexOf(request.deliveryStatus || request.status));
  const isDriver = user?.uid === request.driverId;
  const isBuyer = user?.uid === request.buyerId;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pb-24 pt-8">
      <section className="rounded-[2rem] border border-white/5 bg-brand-card p-6">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-amber-500" />
          <h1 className="font-serif text-3xl text-white">Delivery Tracking</h1>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-black/30 p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Pickup</p>
            <p className="mt-2 text-white">{request.pickupLocation}</p>
          </div>
          <div className="rounded-2xl bg-black/30 p-5">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Delivery</p>
            <p className="mt-2 text-white">{request.deliveryLocation}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-6">
          {steps.map((step, index) => (
            <div
              key={step}
              className={`rounded-xl border p-3 text-center text-[9px] font-black uppercase tracking-widest ${
                index <= currentIndex
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                  : 'border-white/5 bg-black/30 text-slate-600'
              }`}
            >
              {step.replace('_', ' ')}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          {isDriver && request.deliveryStatus === 'accepted' && (
            <button onClick={() => updateStatus('picked_up')} disabled={updating} className="rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black">
              Mark Picked Up
            </button>
          )}

          {isDriver && request.deliveryStatus === 'picked_up' && (
            <button onClick={() => updateStatus('in_transit')} disabled={updating} className="rounded-xl bg-amber-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black">
              Start Transit
            </button>
          )}

          {isDriver && request.deliveryStatus === 'in_transit' && (
            <button onClick={() => updateStatus('delivered')} disabled={updating} className="rounded-xl bg-green-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black">
              Mark Delivered
            </button>
          )}

          {isBuyer && request.deliveryStatus === 'delivered' && (
            <button onClick={confirm} disabled={updating} className="flex items-center gap-2 rounded-xl bg-green-500 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-black">
              <CheckCircle2 className="h-4 w-4" />
              Buyer Confirms Delivery
            </button>
          )}

          <Link to={`/trade/${request.tradeId}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-white">
            <Package className="h-4 w-4" />
            View Trade
          </Link>
        </div>
      </section>
    </div>
  );
}
