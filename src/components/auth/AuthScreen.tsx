import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mail, 
  Lock, 
  User, 
  Phone, 
  ChevronRight, 
  ArrowLeft, 
  AlertCircle, 
  Loader2, 
  ShieldCheck, 
  Smartphone 
} from 'lucide-react';

type AuthMode = 'signin' | 'signup' | 'phone';

export default function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { 
    user, 
    signInWithGoogle, 
    signInWithEmail, 
    signUpWithEmail, 
    setupRecaptcha, 
    signInWithPhone 
  } = useAuth();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);

  const from = (location.state as any)?.from?.pathname || "/";

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [user, navigate, from]);

  useEffect(() => {
    let interval: any;
    if (timer > 0) {
      interval = setInterval(() => setTimer(prev => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        if (password.length < 6) throw new Error("Password must be at least 6 characters");
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const verifier = await setupRecaptcha('recaptcha-container');
      const result = await signInWithPhone(phoneNumber, verifier);
      setConfirmationResult(result);
      setTimer(60);
    } catch (err: any) {
      setError(err.message || "Phone verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await confirmationResult.confirm(verificationCode);
      navigate(from, { replace: true });
    } catch (err: any) {
      setError("Invalid verification code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-8 rounded-[2.5rem] bg-brand-card p-10 border border-white/5 shadow-2xl"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500 text-black">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <h2 className="font-serif text-3xl text-white tracking-tight">
            {mode === 'signin' ? 'Welcome Back' : mode === 'signup' ? 'Join Hema' : 'Phone Connect'}
          </h2>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
            Secure marketplace authentication
          </p>
        </div>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 flex items-start gap-3"
            >
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider leading-relaxed">
                {error}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-6">
          {/* Social Auth */}
          <button
            onClick={() => signInWithGoogle()}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400 transition-all shadow-xl active:scale-95"
          >
            <img src="https://www.google.com/favicon.ico" className="h-4 w-4" alt="Google" />
            Continue with Google
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/5"></div></div>
            <div className="relative flex justify-center text-[8px] font-black uppercase tracking-widest">
              <span className="bg-brand-card px-4 text-slate-600">Secure Protocol</span>
            </div>
          </div>

          {/* Tab Selection */}
          <div className="flex bg-black/40 rounded-2xl p-1.5 border border-white/5">
             {(['signin', 'signup', 'phone'] as AuthMode[]).map((m) => (
               <button
                key={m}
                onClick={() => { setMode(m); setError(null); setConfirmationResult(null); }}
                className={`flex-1 py-3 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                  mode === m 
                    ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' 
                    : 'text-slate-500 hover:text-slate-300'
                }`}
               >
                 {m === 'signin' ? 'Login' : m === 'signup' ? 'Register' : 'Phone'}
               </button>
             ))}
          </div>

          {/* Forms */}
          {mode !== 'phone' ? (
            <form onSubmit={handleEmailAuth} className="space-y-4">
              {mode === 'signup' && (
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 transition-colors group-focus-within:text-amber-500" />
                  <input
                    required
                    type="text"
                    placeholder="FULL NAME"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl bg-black/40 border border-white/10 py-4 pl-12 pr-4 text-[10px] font-bold text-white uppercase tracking-widest focus:border-amber-500/50 outline-none transition-all"
                  />
                </div>
              )}
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 transition-colors group-focus-within:text-amber-500" />
                <input
                  required
                  type="email"
                  placeholder="EMAIL ADDRESS"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 py-4 pl-12 pr-4 text-[10px] font-bold text-white uppercase tracking-widest focus:border-amber-500/50 outline-none transition-all"
                />
              </div>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 transition-colors group-focus-within:text-amber-500" />
                <input
                  required
                  type="password"
                  placeholder="PASSWORD"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl bg-black/40 border border-white/10 py-4 pl-12 pr-4 text-[10px] font-bold text-white uppercase tracking-widest focus:border-amber-500/50 outline-none transition-all"
                />
              </div>
              <button
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600/20 border border-amber-500/30 py-4 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:bg-amber-600 hover:text-white transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <>
                    Initialize {mode === 'signin' ? 'Session' : 'Account'}
                    <ChevronRight className="h-3 w-3" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {!confirmationResult ? (
                <form onSubmit={handlePhoneSubmit} className="space-y-4">
                  <div className="relative group">
                    <Smartphone className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 transition-colors group-focus-within:text-amber-500" />
                    <input
                      required
                      type="tel"
                      placeholder="+237 Phone Number"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="w-full rounded-2xl bg-black/40 border border-white/10 py-4 pl-12 pr-4 text-[10px] font-bold text-white uppercase tracking-widest focus:border-amber-500/50 outline-none transition-all"
                    />
                  </div>
                  <div id="recaptcha-container"></div>
                  <button
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-600/20 border border-amber-500/30 py-4 text-[10px] font-black uppercase tracking-widest text-amber-500 hover:bg-amber-600 hover:text-white transition-all disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Verification Code'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleOTPSubmit} className="space-y-4">
                  <div className="relative group text-center space-y-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Verify code sent to {phoneNumber}</p>
                    <input
                      required
                      type="text"
                      placeholder="6-DIGIT CODE"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      className="w-full rounded-2xl bg-black/40 border border-white/10 py-6 text-center text-2xl font-serif text-amber-500 tracking-[0.5em] focus:border-amber-500/50 outline-none transition-all"
                      maxLength={6}
                    />
                  </div>
                  <button
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-4 text-[10px] font-black uppercase tracking-widest text-black hover:bg-white transition-all disabled:opacity-50 shadow-xl"
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm Identity'}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setConfirmationResult(null)}
                    className="w-full text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white flex items-center justify-center gap-2"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    Change Number
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="text-center pt-4">
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-600 leading-relaxed max-w-[200px] mx-auto">
            By authenticating, you agree to our Terms of Service & Privacy Protocols.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
