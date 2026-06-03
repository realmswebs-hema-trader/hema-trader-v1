import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
import Inbox from './pages/Inbox';
import Wallet from './pages/Wallet';
import DriverDashboard from './pages/DriverDashboard';
import DriverDeliveries from './pages/DriverDeliveries';
import DriverDiscovery from './pages/DriverDiscovery';
import Drivers from './pages/Drivers';
import DriverProfile from './pages/DriverProfile';
import DeliveryDetail from './pages/DeliveryDetail';
import DeliveryTracking from './pages/DeliveryTracking';
import MapView from './pages/MapView';
import Admin from './pages/Admin';
import Moderators from './pages/Moderators';
import ModeratorDashboard from './pages/ModeratorDashboard';
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

const PrivateRoute = ({ children }: { children: ReactNode }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

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
        state={{ from: location }}
        replace
      />
    );
  }

  if (profile && (!profile.roles || profile.roles.length === 0)) {
    return <RoleSelection />;
  }

  return <>{children}</>;
};

// =====================================
// ADMIN ROUTE
// =====================================

const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { user, profile, loading } = useAuth();

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
    profile?.roles?.includes('admin') ||
    profile?.isAdmin === true;

  const isAdminEmail =
    user?.email === 'realmswebs@gmail.com';

  return hasAdminRole || isAdminEmail ? (
    <>{children}</>
  ) : (
    <Navigate to="/" replace />
  );
};

// =====================================
// OFFLINE BANNER
// =====================================

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
      <WifiOff className="mr-2 mb-0.5 inline-block h-3 w-3" />
      You're currently offline. Some features may be limited until you reconnect.
    </div>
  );
};

// =====================================
// APP ROUTES
// =====================================

function AppRoutes() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  const isPublicRoute = ['/privacy', '/terms'].includes(location.pathname);

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

  if (!user && !isPublicRoute) {
    return <AuthScreen />;
  }

  if (
    user &&
    profile &&
    (!profile.roles || profile.roles.length === 0) &&
    !isPublicRoute
  ) {
    return (
      <div className="min-h-screen bg-brand-bg font-sans text-slate-200">
        <OfflineBanner />
        <RoleSelection />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-brand-bg pb-20 font-sans text-slate-200">
      <OfflineBanner />

      <Header />

      <main className="flex-1 px-4 py-6">
        <Routes>
          <Route
            path="/"
            element={<Home />}
          />

          <Route
            path="/auth"
            element={<Navigate to="/" replace />}
          />

          <Route
            path="/listing/:id"
            element={<ListingDetail />}
          />

          <Route
            path="/listing/:id/edit"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          <Route
            path="/listings/:id/edit"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          <Route
            path="/edit-listing/:id"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          <Route
            path="/create"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

          <Route
            path="/create-listing"
            element={
              <PrivateRoute>
                <CreateListing />
              </PrivateRoute>
            }
          />

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

          <Route
            path="/trades/:id"
            element={
              <PrivateRoute>
                <TradeDetail />
              </PrivateRoute>
            }
          />

          <Route
            path="/inbox"
            element={
              <PrivateRoute>
                <Inbox />
              </PrivateRoute>
            }
          />

          <Route
            path="/messages"
            element={
              <PrivateRoute>
                <Inbox />
              </PrivateRoute>
            }
          />

          <Route
            path="/messages/:id"
            element={
              <PrivateRoute>
                <TradeDetail />
              </PrivateRoute>
            }
          />

          <Route
            path="/wallet"
            element={
              <PrivateRoute>
                <Wallet />
              </PrivateRoute>
            }
          />

          <Route
            path="/map"
            element={
              <PrivateRoute>
                <MapView />
              </PrivateRoute>
            }
          />

          <Route
            path="/driver"
            element={
              <PrivateRoute>
                <DriverDashboard />
              </PrivateRoute>
            }
          />

          <Route
            path="/driver/deliveries"
            element={
              <PrivateRoute>
                <DriverDeliveries />
              </PrivateRoute>
            }
          />

          <Route
            path="/drivers"
            element={<Drivers />}
          />

          <Route
            path="/drivers/:id"
            element={
              <PrivateRoute>
                <DriverProfile />
              </PrivateRoute>
            }
          />

          <Route
            path="/driver-discovery"
            element={<DriverDiscovery />}
          />

          <Route
            path="/delivery/:id"
            element={
              <PrivateRoute>
                <DeliveryTracking />
              </PrivateRoute>
            }
          />

          <Route
            path="/delivery-detail/:id"
            element={
              <PrivateRoute>
                <DeliveryDetail />
              </PrivateRoute>
            }
          />

          <Route
            path="/moderator"
            element={
              <PrivateRoute>
                <ModeratorDashboard />
              </PrivateRoute>
            }
          />

          <Route
            path="/moderators"
            element={<Moderators />}
          />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />

          <Route
            path="/privacy"
            element={<PrivacyPolicy />}
          />

          <Route
            path="/terms"
            element={<TermsOfService />}
          />

          <Route
            path="*"
            element={<Navigate to="/" replace />}
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
