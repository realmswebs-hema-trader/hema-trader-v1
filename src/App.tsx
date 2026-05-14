import { ReactNode, useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation
} from 'react-router-dom';

import {
  AuthProvider,
  useAuth
} from './components/auth/AuthContext';

import {
  NotificationProvider
} from './components/notifications/NotificationContext';

import RetentionManager from './components/notifications/RetentionManager';

import {
  WifiOff,
  Loader2
} from 'lucide-react';

// =====================================
// PAGES
// =====================================

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

// =====================================
// COMPONENTS
// =====================================

import AuthScreen from './components/auth/AuthScreen';
import Header from './components/layout/Header';
import BottomNav from './components/layout/BottomNav';
import RoleSelection from './components/auth/RoleSelection';

// =====================================
// PRIVATE ROUTE
// =====================================

const PrivateRoute = ({
  children
}: {
  children: ReactNode;
}) => {

  const {
    user,
    profile,
    loading
  } = useAuth();

  const location =
    useLocation();

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

  if (!user) {
    return (
      <Navigate
        to="/auth"
        state={{
          from: location
        }}
        replace
      />
    );
  }

  if (
    profile &&
    (
      !profile.roles ||
      profile.roles.length === 0
    )
  ) {
    return <RoleSelection />;
  }

  return <>{children}</>;
};

// =====================================
// ADMIN ROUTE
// =====================================

const AdminRoute = ({
  children
}: {
  children: ReactNode;
}) => {

  const {
    user,
    profile,
    loading
  } = useAuth();

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

  const hasAdminRole =
    profile?.roles?.includes(
      'admin'
    ) ||
    profile?.isAdmin === true;

  const isAdminEmail =
    user?.email ===
    'realmswebs@gmail.com';

  return (
    hasAdminRole ||
    isAdminEmail
  ) ? (
    <>{children}</>
  ) : (
    <Navigate to="/" />
  );
};

// =====================================
// OFFLINE BANNER
// =====================================

const OfflineBanner = () => {

  const [isOffline, setIsOffline] =
    useState(!navigator.onLine);

  useEffect(() => {

    const onOnline = () =>
      setIsOffline(false);

    const onOffline = () =>
      setIsOffline(true);

    window.addEventListener(
      'online',
      onOnline
    );

    window.addEventListener(
      'offline',
      onOffline
    );

    return () => {
      window.removeEventListener(
        'online',
        onOnline
      );

      window.removeEventListener(
        'offline',
        onOffline
      );
    };

  }, []);

  if (!isOffline) return null;

  return (
    <div className="bg-amber-500 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-black">
      <WifiOff className="inline-block mr-2 h-3 w-3 mb-0.5" />
      You're currently offline. Some features may be limited until you reconnect.
    </div>
  );
};

// =====================================
// APP ROUTES
// =====================================

function AppRoutes() {

  const {
    user,
    loading
  } = useAuth();

  const location =
    useLocation();

  const isPublicRoute =
    [
      '/privacy',
      '/terms'
    ].includes(
      location.pathname
    );

  if (loading) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center gap-4 text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-white">
          Loading marketplace...
        </span>
      </div>
    );
  }

  if (
    !user &&
    !isPublicRoute
  ) {
    return <AuthScreen />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-bg pb-20 font-sans text-slate-200">

      <OfflineBanner />

      <Header />

      <main className="flex-1 px-4 py-6">

        <Routes>

          {/* HOME */}
          <Route
            path="/"
            element={<Home />}
          />

          {/* AUTH */}
          <Route
            path="/auth"
            element={
              <Navigate
                to="/"
                replace
              />
            }
          />

          {/* LISTINGS */}
          <Route
            path="/listing/:id"
            element={<ListingDetail />}
          />

          {/* FIXED CREATE LISTING ROUTE */}
          <Route
            path="/create"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          {/* ADDED MISSING ROUTE */}
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

          <Route
            path="/profile/:userId"
            element={<Profile />}
          />

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

          <Route
            path="/drivers"
            element={<DriverDiscovery />}
          />

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
          <Route
            path="/privacy"
            element={<PrivacyPolicy />}
          />

          <Route
            path="/terms"
            element={<TermsOfService />}
          />

          {/* FALLBACK */}
          <Route
            path="*"
            element={
              <Navigate
                to="/"
                replace
              />
            }
          />

        </Routes>

      </main>

      <BottomNav />

    </div>
  );
}

// =====================================
// APP
// =====================================

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
