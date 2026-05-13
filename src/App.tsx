import { ReactNode, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './components/auth/AuthContext';
import { NotificationProvider } from './components/notifications/NotificationContext';
import RetentionManager from './components/notifications/RetentionManager';
import { WifiOff, Loader2 } from 'lucide-react';

import Home from './pages/Home';
import ListingDetail from './pages/ListingDetail';
import CreateListing from './pages/CreateListing';
import Profile from './pages/Profile';
import Trades from './pages/Trades';
import TradeDetail from './pages/TradeDetail';
import DriverDashboard from './pages/DriverDashboard';
import DriverDiscovery from './pages/DriverDiscovery';
import Admin from './pages/Admin';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';

import Header from './components/layout/Header';
import BottomNav from './components/layout/BottomNav';
import RoleSelection from './components/auth/RoleSelection';
import AuthScreen from './components/auth/AuthScreen';

// ==========================
// PRIVATE ROUTE
// ==========================
const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Loading your profile...
        </span>
      </div>
    );
  }

  if (user && profile && (!profile.roles || profile.roles.length === 0)) {
    return <RoleSelection />;
  }

  return user ? <>{children}</> : <Navigate to="/" />;
};

// ==========================
// ADMIN ROUTE
// ==========================
const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Verifying permissions...
        </span>
      </div>
    );
  }

  return profile?.roles?.includes('admin') ? (
    <>{children}</>
  ) : (
    <Navigate to="/" />
  );
};

// ==========================
// OFFLINE BANNER
// ==========================
const OfflineBanner = () => {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="bg-amber-500 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-black">
      <WifiOff className="mb-0.5 mr-2 inline-block h-3 w-3" />
      You're currently offline. Some features may be limited until you reconnect.
    </div>
  );
};

// ==========================
// MAIN ROUTES
// ==========================
function AppRoutes() {
  const { user, loading } = useAuth();

  // GLOBAL LOADING
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-white">
        <Loader2 className="h-10 w-10 animate-spin text-amber-500" />
      </div>
    );
  }

  // AUTH SCREEN
  if (!user) {
    return <AuthScreen />;
  }

  // APP
  return (
    <div className="flex min-h-screen flex-col bg-brand-bg pb-20 font-sans text-slate-200">
      <OfflineBanner />

      <Header />

      <main className="flex-1 px-4 py-6">
        <Routes>

          {/* HOME */}
          <Route path="/" element={<Home />} />

          {/* LISTINGS */}
          <Route path="/listing/:id" element={<ListingDetail />} />

          {/* CREATE LISTING FIXED */}
          <Route
            path="/create-listing"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          {/* PROFILE */}
          <Route
            path="/profile"
            element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            }
          />

          <Route path="/profile/:userId" element={<Profile />} />

          {/* TRADES */}
          <Route
            path="/trades"
            element={
              <PrivateRoute>
                <Trades />
              </PrivateRoute>
            }
          />

          <Route
            path="/trade/:id"
            element={
              <PrivateRoute>
                <TradeDetail />
              </PrivateRoute>
            }
          />

          {/* DRIVERS */}
          <Route
            path="/driver"
            element={
              <PrivateRoute>
                <DriverDashboard />
              </PrivateRoute>
            }
          />

          <Route path="/drivers" element={<DriverDiscovery />} />

          {/* ADMIN */}
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />

          {/* LEGAL */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />

          {/* FALLBACK */}
          <Route path="*" element={<Navigate to="/" replace />} />

        </Routes>
      </main>

      <BottomNav />
    </div>
  );
}

// ==========================
// ROOT APP
// ==========================
export default function App() {
  return (
    <Router>
      <AuthProvider>
        <NotificationProvider>
          <RetentionManager />
          <AppRoutes />
        </NotificationProvider>
      </AuthProvider>
    </Router>
  );
}
