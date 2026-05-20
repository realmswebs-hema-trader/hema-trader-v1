import { useAuth } from '../auth/AuthContext';
import {
  LogIn,
  User as UserIcon,
  ShoppingBag,
  Store,
  Truck
} from 'lucide-react';
import { motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router-dom';
import NotificationTray from '../notifications/NotificationTray';

export default function Header() {
  const { user, profile, activeRole, switchRole } = useAuth();
  const [searchParams] = useSearchParams();

  const selectedRole = searchParams.get('role') || activeRole || 'all';
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];

  const visibleRoles = ['buyer', 'seller', 'driver'].filter(role =>
    roles.includes(role)
  );

  const roleLinks = [
    {
      key: 'buyer',
      label: 'Buyer',
      icon: ShoppingBag,
      accent: 'white'
    },
    {
      key: 'seller',
      label: 'Seller',
      icon: Store,
      accent: 'amber'
    },
    {
      key: 'driver',
      label: 'Driver',
      icon: Truck,
      accent: 'green'
    }
  ].filter(item => visibleRoles.includes(item.key));

  const getActiveClass = (key: string) => {
    if (key === 'driver') {
      return 'bg-green-500 text-black shadow-lg';
    }

    if (key === 'seller') {
      return 'bg-amber-500 text-black shadow-lg';
    }

    return 'bg-white text-black shadow-lg';
  };

  const handleRoleClick = async (role: string) => {
    try {
      await switchRole(role);
    } catch (error) {
      console.error('Failed to switch role:', error);
    }
  };

  return (
    <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-brand-border bg-brand-bg/80 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-4">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            className="flex h-8 w-8 items-center justify-center rounded-sm bg-gradient-to-tr from-amber-600 to-amber-400 font-serif font-bold text-black"
          >
            H
          </motion.div>

          <h1 className="text-xl font-serif font-semibold tracking-tight text-white">
            Hema Trader
          </h1>
        </Link>

        {roleLinks.length > 0 && (
          <div className="hidden items-center rounded-xl border border-white/5 bg-black/40 p-1 sm:flex">
            {roleLinks.map(item => {
              const Icon = item.icon;
              const active = selectedRole === item.key || activeRole === item.key;

              return (
                <Link
                  key={item.key}
                  to={`/?role=${item.key}`}
                  onClick={() => handleRoleClick(item.key)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[8px] font-black uppercase tracking-wider transition-all ${
                    active
                      ? getActiveClass(item.key)
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                  title={`Switch to ${item.label}`}
                >
                  <Icon className="h-3 w-3" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div>
        {user ? (
          <div className="flex items-center gap-4">
            <NotificationTray />

            <Link
              to="/profile"
              className="flex items-center gap-3 rounded-full transition hover:opacity-80"
            >
              <span className="hidden max-w-40 truncate text-xs uppercase tracking-widest text-slate-400 sm:block">
                {profile?.displayName || profile?.name || user.displayName || 'Profile'}
              </span>

              <div className="h-8 w-8 overflow-hidden rounded-full border border-white/20 bg-slate-800">
                {profile?.photoURL || user.photoURL ? (
                  <img
                    src={profile?.photoURL || user.photoURL || ''}
                    alt="Avatar"
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <UserIcon className="h-full w-full p-1 text-slate-500" />
                )}
              </div>
            </Link>
          </div>
        ) : (
          <Link
            to="/auth"
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-white shadow-lg shadow-amber-600/20 transition-colors hover:bg-amber-700 active:scale-95"
          >
            <LogIn className="h-4 w-4" />
            Sign In
          </Link>
        )}
      </div>
    </header>
  );
}
