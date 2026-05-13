import { Link, useLocation } from 'react-router-dom';
import { Home, PlusSquare, ShoppingBag, User, Truck, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../auth/AuthContext';

export default function BottomNav() {
  const location = useLocation();
  const { user, profile, viewMode } = useAuth();

  const navItems = [
    { icon: Home, label: 'Home', path: '/' },
    { icon: ShoppingBag, label: 'Trades', path: '/trades', protected: true },
  ];

  if (viewMode === 'seller' || profile?.roles?.includes('seller')) {
    navItems.push({ icon: PlusSquare, label: 'Sell', path: '/create', protected: true });
  }

  if (profile?.roles?.includes('driver')) {
    navItems.push({ icon: Truck, label: 'Fleet', path: '/driver', protected: true });
  }

  navItems.push({ icon: User, label: 'Profile', path: '/profile', protected: true });

  // Add Admin link if admin role exists
  if (profile?.roles?.includes('admin') || profile?.isAdmin || user?.email === 'realmswebs@gmail.com') {
    navItems.push({ icon: ShieldCheck, label: 'Ops', path: '/admin', protected: true });
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-brand-border bg-brand-bg/95 px-2 backdrop-blur-md">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        const isDisabled = item.protected && !user;

        return (
          <Link
            key={item.path}
            to={item.path}
            className={`flex flex-col items-center gap-1 transition-colors ${
              isActive ? 'text-amber-500' : isDisabled ? 'text-slate-700' : 'text-slate-500 hover:text-white'
            }`}
          >
            <motion.div whileTap={{ scale: 0.9 }}>
              <item.icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
            </motion.div>
            <span className="text-[10px] uppercase font-bold tracking-tighter">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
