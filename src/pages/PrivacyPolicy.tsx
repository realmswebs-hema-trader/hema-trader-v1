import { motion } from 'motion/react';
import { Shield, Lock, Eye, FileText, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();
  const lastUpdated = "May 1, 2026";

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-20">
      <button 
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors group"
      >
        <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
        <span className="text-[10px] font-black uppercase tracking-widest">Back</span>
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <h1 className="font-serif text-4xl text-white tracking-tight">Privacy Policy</h1>
        <p className="text-slate-500 text-xs font-medium">Last Updated: {lastUpdated}</p>
      </motion.div>

      <section className="space-y-6">
        <div className="p-6 rounded-[2rem] bg-brand-card border border-white/5 space-y-4">
          <div className="flex items-center gap-3 text-amber-500">
            <Shield className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">Our Commitment</h2>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            At Hema Trader, we respect your privacy. This policy explains how we collect, use, and protect your personal information when you use our marketplace in Cameroon.
          </p>
        </div>

        <div className="space-y-8">
          <div className="space-y-3">
            <h3 className="text-white font-bold text-lg">1. Data We Collect</h3>
            <ul className="list-disc list-inside text-slate-400 text-sm space-y-2 ml-2">
              <li><span className="text-slate-200 font-semibold">Account Information:</span> Name, email, phone number, and profile picture.</li>
              <li><span className="text-slate-200 font-semibold">Transaction Data:</span> Details of trades, items bought/sold, and payment references.</li>
              <li><span className="text-slate-200 font-semibold">Location Data:</span> Real-time location for driver matching and delivery tracking.</li>
              <li><span className="text-slate-200 font-semibold">Usage Info:</span> Device details, IP addresses, and how you interact with the app.</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-white font-bold text-lg">2. How We Use Your Data</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              We process your data to:
            </p>
            <ul className="list-disc list-inside text-slate-400 text-sm space-y-2 ml-2">
              <li>Facilitate secure trades and escrow services.</li>
              <li>Match drivers with delivery requests based on proximity.</li>
              <li>Prevent fraud and ensure marketplace safety.</li>
              <li>Send important transaction notifications and updates.</li>
              <li>Verify participant identities and reputation scoring.</li>
            </ul>
          </div>

          <div className="space-y-4 p-6 rounded-3xl bg-amber-500/5 border border-amber-500/10">
            <div className="flex items-center gap-3 text-amber-500">
              <Lock className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase tracking-widest">3. Payment Security</h3>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              Hema Trader does <span className="text-slate-200 font-semibold">not</span> store your full financial details. Payments are processed by licensed third-party providers (e.g., MTN MoMo, Orange Money partners). We only receive status confirmation and transaction IDs to unlock the escrow.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-white font-bold text-lg">4. Data Sharing</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              We <span className="text-slate-200 font-semibold">never sell</span> your personal data. We only share info with:
            </p>
            <ul className="list-disc list-inside text-slate-400 text-sm space-y-2 ml-2">
              <li><span className="text-slate-200 font-semibold">Your Trade Partners:</span> To facilitate communication and delivery.</li>
              <li><span className="text-slate-200 font-semibold">Service Providers:</span> Partners who help us with payments and maps.</li>
              <li><span className="text-slate-200 font-semibold">Law Enforcement:</span> Only if required by Cameroonian law.</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-white font-bold text-lg">5. Your Rights</h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              You can update your profile information at any time in settings. If you wish to permanently delete your account and all associated data, please contact our support team. Some transaction records may be retained for accounting and legal compliance.
            </p>
          </div>

          <div className="p-10 rounded-[3rem] bg-gradient-to-br from-brand-card to-black border border-white/5 text-center space-y-6">
            <div className="inline-flex p-4 rounded-full bg-slate-800/50 text-slate-400">
              <Eye className="h-6 w-6" />
            </div>
            <h3 className="text-xl text-white font-serif">Questions?</h3>
            <p className="text-slate-400 text-sm">
              If you have any questions about this Privacy Policy, please contact us at:
            </p>
            <a 
              href="mailto:realmswebs@gmail.com"
              className="inline-block text-amber-500 font-black text-sm uppercase tracking-widest hover:underline"
            >
              realmswebs@gmail.com
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
