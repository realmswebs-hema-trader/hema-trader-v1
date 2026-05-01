import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { Shield, ShoppingBag, Store, Check, Loader2, Truck } from 'lucide-react';
import { motion } from 'motion/react';

export default function RoleSelection() {
  const { profile, updateRoles } = useAuth();
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleRole = (role: string) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role) 
        : [...prev, role]
    );
  };

  const handleSave = async () => {
    if (selectedRoles.length === 0) return;
    setLoading(true);
    try {
      await updateRoles(selectedRoles);
    } catch (error) {
      console.error('Failed to save roles', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-[2.5rem] bg-brand-card p-10 border border-white/5 shadow-2xl space-y-8"
      >
        <div className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20 mb-4">
            <Shield className="h-8 w-8 text-amber-500" />
          </div>
          <h2 className="font-serif text-3xl text-white">Choose Your Role</h2>
          <p className="text-xs uppercase tracking-widest text-slate-500 leading-relaxed max-w-sm mx-auto">
            Welcome to Hema Trader. How would you like to use the marketplace? You can always change this later.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <button
            onClick={() => toggleRole('buyer')}
            className={`flex items-center gap-6 p-6 rounded-3xl border-2 transition-all text-left group ${
              selectedRoles.includes('buyer') 
                ? 'bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10' 
                : 'bg-black/40 border-white/5 hover:border-white/10'
            }`}
          >
            <div className={`p-4 rounded-2xl transition-colors ${
              selectedRoles.includes('buyer') ? 'bg-amber-500 text-black' : 'bg-white/5 text-slate-400 group-hover:text-white'
            }`}>
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className={`font-serif text-xl ${selectedRoles.includes('buyer') ? 'text-white' : 'text-slate-400'}`}>Buyer</h4>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">I want to discover and trade for local goods</p>
            </div>
            {selectedRoles.includes('buyer') && <Check className="h-6 w-6 text-amber-500" />}
          </button>

          <button
            onClick={() => toggleRole('seller')}
            className={`flex items-center gap-6 p-6 rounded-3xl border-2 transition-all text-left group ${
              selectedRoles.includes('seller') 
                ? 'bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10' 
                : 'bg-black/40 border-white/5 hover:border-white/10'
            }`}
          >
            <div className={`p-4 rounded-2xl transition-colors ${
              selectedRoles.includes('seller') ? 'bg-amber-500 text-black' : 'bg-white/5 text-slate-400 group-hover:text-white'
            }`}>
              <Store className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className={`font-serif text-xl ${selectedRoles.includes('seller') ? 'text-white' : 'text-slate-400'}`}>Seller</h4>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">I want to list my products and grow my reach</p>
            </div>
            {selectedRoles.includes('seller') && <Check className="h-6 w-6 text-amber-500" />}
          </button>

          <button
            onClick={() => toggleRole('driver')}
            className={`flex items-center gap-6 p-6 rounded-3xl border-2 transition-all text-left group ${
              selectedRoles.includes('driver') 
                ? 'bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10' 
                : 'bg-black/40 border-white/5 hover:border-white/10'
            }`}
          >
            <div className={`p-4 rounded-2xl transition-colors ${
              selectedRoles.includes('driver') ? 'bg-amber-500 text-black' : 'bg-white/5 text-slate-400 group-hover:text-white'
            }`}>
              <Truck className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h4 className={`font-serif text-xl ${selectedRoles.includes('driver') ? 'text-white' : 'text-slate-400'}`}>Driver</h4>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1">I want to deliver goods and earn commissions</p>
            </div>
            {selectedRoles.includes('driver') && <Check className="h-6 w-6 text-amber-500" />}
          </button>
        </div>

        <button
          onClick={handleSave}
          disabled={selectedRoles.length === 0 || loading}
          className="w-full bg-white text-black font-black uppercase tracking-[0.2em] py-5 rounded-2xl hover:bg-amber-500 transition-all flex items-center justify-center gap-3 shadow-xl active:scale-95 disabled:bg-slate-800 disabled:text-slate-600"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            'Enter Marketplace'
          )}
        </button>
      </motion.div>
    </div>
  );
}
