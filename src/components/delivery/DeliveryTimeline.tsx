import {
  CheckCircle2,
  Circle,
  Clock,
  PackageCheck,
  ShieldCheck,
  Truck,
  UserCheck
} from 'lucide-react';
import { motion } from 'motion/react';

import type { DeliveryStatus } from '../../services/deliveryService';

interface DeliveryTimelineProps {
  status?: DeliveryStatus | string;
  compact?: boolean;
}

const statusOrder: DeliveryStatus[] = [
  'pending',
  'assigned',
  'driver_arriving',
  'picked_up',
  'in_transit',
  'near_destination',
  'delivered',
  'buyer_confirmation',
  'completed'
];

const timelineItems = [
  {
    id: 'pending',
    label: 'Request created',
    icon: Clock
  },
  {
    id: 'assigned',
    label: 'Driver assigned',
    icon: UserCheck
  },
  {
    id: 'driver_arriving',
    label: 'Driver arriving',
    icon: Truck
  },
  {
    id: 'picked_up',
    label: 'Package picked up',
    icon: PackageCheck
  },
  {
    id: 'in_transit',
    label: 'In transit',
    icon: Truck
  },
  {
    id: 'near_destination',
    label: 'Near destination',
    icon: Circle
  },
  {
    id: 'delivered',
    label: 'Delivered',
    icon: CheckCircle2
  },
  {
    id: 'buyer_confirmation',
    label: 'Buyer confirmation',
    icon: ShieldCheck
  },
  {
    id: 'completed',
    label: 'Escrow release',
    icon: ShieldCheck
  }
] as const;

const normalizeStatus = (status?: string) => {
  if (status === 'accepted') return 'driver_arriving';
  if (status === 'arriving') return 'near_destination';
  return status || 'pending';
};

export default function DeliveryTimeline({
  status = 'pending',
  compact = false
}: DeliveryTimelineProps) {
  const normalizedStatus = normalizeStatus(status);
  const activeIndex = statusOrder.indexOf(normalizedStatus as DeliveryStatus);

  if (status === 'disputed') {
    return (
      <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-red-400">
          Delivery disputed
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Escrow remains locked while support reviews the shipment.
        </p>
      </div>
    );
  }

  if (status === 'cancelled') {
    return (
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          Delivery cancelled
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-[2rem] border border-white/5 bg-black/30 ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <div className="grid gap-3 md:grid-cols-9">
        {timelineItems.map((item, index) => {
          const Icon = item.icon;
          const done = activeIndex >= index;
          const active = activeIndex === index;

          return (
            <div key={item.id} className="relative flex items-center gap-3 md:block">
              {index < timelineItems.length - 1 && (
                <div
                  className={`absolute left-4 top-8 hidden h-px w-full md:block ${
                    done ? 'bg-amber-500' : 'bg-white/10'
                  }`}
                />
              )}

              <motion.div
                animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 1.4, repeat: active ? Infinity : 0 }}
                className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
                  done
                    ? 'border-amber-500 bg-amber-500 text-black shadow-[0_0_22px_rgba(245,158,11,0.35)]'
                    : 'border-white/10 bg-white/5 text-slate-600'
                }`}
              >
                <Icon className="h-4 w-4" />
              </motion.div>

              <p
                className={`text-[8px] font-black uppercase tracking-widest md:mt-3 ${
                  done ? 'text-white' : 'text-slate-600'
                }`}
              >
                {item.label}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
