import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { Shield, ShoppingBag, Store, Check, Loader2, Truck } from 'lucide-react';
import { motion } from 'motion/react';

const ROLE_OPTIONS = [
  {
    id: 'buyer',
    title: 'Buyer',
    description: 'I want to discover and trade for local goods',
    icon: ShoppingBag
  },
  {
    id: 'seller',
    title: 'Seller',
    description: 'I want to list my products and grow my reach',
    icon: Store
  },
  {
    id: 'driver',
    title: 'Driver',
    description: 'I want to deliver goods and earn commissions',
    icon: Truck
  }
];

export default function RoleSelection() {
  const { profile, updateRoles } = useAuth();

  const [selectedRoles, setSelectedRoles] = useState<string[]>(
    Array.isArray(profile?.roles) ? profile.roles : []
  );
  const [loading, setLoading] = useState(false);

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role)
        ? prev.filter(existingRole => existingRole !== role)
        : [...prev, role]
    );
  };

  const handleSave = async () => {
    if (selectedRoles.length === 0 || loading) return;

    setLoading(true);

    try {
      const safeRoles = Array.from(
        new Set(
          selectedRoles.includes('buyer')
            ? selectedRoles
            : ['buyer', ...selectedRoles]
        )
      );

      await updateRoles(safeRoles);
    } catch (error) {
      console.error('Failed to save roles:', error);
      alert('Unable to save your roles. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-4 pb-28 backdrop-blur-md sm:p-6">
      <div className="flex min-h-full items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg space-y-6 rounded-[2.5rem] border border-white/5 bg-brand-card p-6 shadow-2xl sm:p-10"
        >
          <div className="space-y-3 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-amber-500/20 bg-amber-500/10">
              <Shield className="h-8 w-8 text-amber-500" />
            </div>

            <h2 className="font-serif text-3xl text-white">
              Choose Your Role
            </h2>

            <p className="mx-auto max-w-sm text-xs uppercase leading-relaxed tracking-widest text-slate-500">
              Welcome to Hema Trader. How would you like to use the marketplace?
              You can always change this later.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {ROLE_OPTIONS.map(role => {
              const Icon = role.icon;
              const selected = selectedRoles.includes(role.id);

              return (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => toggleRole(role.id)}
                  className={`group flex items-center gap-5 rounded-3xl border-2 p-5 text-left transition-all sm:gap-6 sm:p-6 ${
                    selected
                      ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                      : 'border-white/5 bg-black/40 hover:border-white/10'
                  }`}
                >
                  <div
                    className={`rounded-2xl p-4 transition-colors ${
                      selected
                        ? 'bg-amber-500 text-black'
                        : 'bg-white/5 text-slate-400 group-hover:text-white'
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h4
                      className={`font-serif text-xl ${
                        selected ? 'text-white' : 'text-slate-400'
                      }`}
                    >
                      {role.title}
                    </h4>

                    <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                      {role.description}
                    </p>
                  </div>

                  {selected && <Check className="h-6 w-6 shrink-0 text-amber-500" />}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={selectedRoles.length === 0 || loading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-5 font-black uppercase tracking-[0.2em] text-black shadow-xl transition-all hover:bg-amber-500 active:scale-95 disabled:bg-slate-800 disabled:text-slate-600"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Enter Marketplace'}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
