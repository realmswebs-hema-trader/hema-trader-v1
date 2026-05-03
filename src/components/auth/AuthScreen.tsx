import { useAuth } from './AuthContext';
import { LogIn } from 'lucide-react';

export default function AuthScreen() {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-black text-white px-6">
      <h1 className="text-3xl font-bold mb-6">Welcome to Hema Trader</h1>

      <button
        onClick={signInWithGoogle}
        className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 px-6 py-3 rounded-lg font-bold uppercase tracking-wide"
      >
        <LogIn className="h-5 w-5" />
        Continue with Google
      </button>
    </div>
  );
}
