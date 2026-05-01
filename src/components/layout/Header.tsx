import { useAuth } from '../auth/AuthContext';
import { LogIn, User as UserIcon, ShoppingBag, Store } from 'lucide-react';
import { motion } from 'motion/react';
import NotificationTray from '../notifications/NotificationTray';

export default function Header() {
  const { user, profile, viewMode, setViewMode, signInWithGoogle } = useAuth();

  const isBoth = profile?.roles?.includes('buyer') && profile?.roles?.includes('seller');

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-brand-border bg-brand-bg/80 px-4 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="flex h-8 w-8 items-center justify-center rounded-sm bg-gradient-to-tr from-amber-600 to-amber-400 text-black font-bold font-serif"
          >
            H
          </motion.div>
          <h1 className="text-xl font-serif font-semibold tracking-tight text-white">Hema Trader</h1>
        </div>

        {isBoth && (
          <div className="hidden sm:flex items-center bg-black/40 rounded-xl p-1 border border-white/5">
            <button
              onClick={() => setViewMode('buyer')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                viewMode === 'buyer' 
                  ? 'bg-white text-black shadow-lg' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <ShoppingBag className="h-3 w-3" />
              Buyer
            </button>
            <button
              onClick={() => setViewMode('seller')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all ${
                viewMode === 'seller' 
                  ? 'bg-amber-500 text-black shadow-lg' 
                  : 'text-slate-500 hover:text-slate-300'
              }`}
             >
              <Store className="h-3 w-3" />
              Seller
            </button>
          </div>
        )}
      </div>

      <div>
        {user ? (
          <div className="flex items-center gap-4">
            <NotificationTray />
            <div className="flex items-center gap-3">
              <span className="hidden text-xs uppercase tracking-widest text-slate-400 sm:block">{profile?.displayName}</span>
              <div className="h-8 w-8 rounded-full bg-slate-800 border border-white/20 overflow-hidden">
                {profile?.photoURL ? (
                  <img src={profile.photoURL} alt="Avatar" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon className="h-full w-full p-1 text-slate-500" />
                )}
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={signInWithGoogle}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-amber-700"
          >
            <LogIn className="h-4 w-4" />
            Sign In
          </button>
        )}
      </div>
    </header>
  );
}
