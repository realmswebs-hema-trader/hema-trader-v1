import { motion } from 'motion/react';
import { Scale, Gavel, UserCheck, CreditCard, Ban, ChevronLeft, HelpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function TermsOfService() {
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
        <h1 className="font-serif text-4xl text-white tracking-tight">Terms of Service</h1>
        <p className="text-slate-500 text-xs font-medium">Last Updated: {lastUpdated}</p>
      </motion.div>

      <section className="space-y-6">
        <div className="p-6 rounded-[2rem] bg-brand-card border border-white/5 space-y-4">
          <div className="flex items-center gap-3 text-amber-500">
            <Scale className="h-5 w-5" />
            <h2 className="text-sm font-black uppercase tracking-widest">Platform Role</h2>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed">
            Hema Trader is an intermediary marketplace. We connect buyers, sellers, and drivers. We do not own the products sold nor employ the drivers. We provide the platform and secure escrow for your transactions.
          </p>
        </div>

        <div className="space-y-8">
          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-slate-400" />
              1. User Responsibilities
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-white/5 space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sellers</h4>
                <p className="text-xs text-slate-400">Must provide accurate photos/descriptions and honor trade commitments.</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Buyers</h4>
                <p className="text-xs text-slate-400">Must fund escrow promptly and confirm receipt accurately.</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 space-y-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">Drivers</h4>
                <p className="text-xs text-slate-400">Must handle products with care and update status in real-time.</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-slate-400" />
              2. Payments & Escrow
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              When a buyer makes a payment, the funds are held securely in the <span className="text-slate-200 font-semibold">Hema Escrow Wallet</span>. 
            </p>
            <ul className="list-disc list-inside text-slate-400 text-sm space-y-2 ml-2">
              <li>Funds are released to the seller and driver only when the buyer confirms successful receipt.</li>
              <li>Hema Trader deducts a small platform fee for each successful trade.</li>
              <li>If a delivery fails or is not confirmed, the funds remain in escrow until resolved.</li>
            </ul>
          </div>

          <div className="space-y-4">
            <h3 className="text-white font-bold text-lg flex items-center gap-2">
              <Gavel className="h-5 w-5 text-slate-400" />
              3. Disputes & Resolutions
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed">
              In case of a disagreement (e.g., poor quality, no delivery), any party can open a <span className="text-slate-200 font-semibold">Dispute</span>.
            </p>
            <ul className="list-disc list-inside text-slate-400 text-sm space-y-2 ml-2">
              <li>Our moderation team will review chat logs, delivery status, and photos.</li>
              <li>Administrative decisions on fund release are final.</li>
              <li>Intentional false disputes are grounds for immediate suspension.</li>
            </ul>
          </div>

          <div className="space-y-4 p-6 rounded-3xl bg-red-500/5 border border-red-500/10">
            <div className="flex items-center gap-3 text-red-500">
              <Ban className="h-5 w-5" />
              <h3 className="text-sm font-black uppercase tracking-widest">4. Prohibited Activities</h3>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed">
              Users found engaging in the following will be banned:
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
              <li className="text-[10px] bg-black/40 p-3 rounded-lg border border-white/5 text-slate-300 font-bold uppercase tracking-wider">Fraud & Scamming</li>
              <li className="text-[10px] bg-black/40 p-3 rounded-lg border border-white/5 text-slate-300 font-bold uppercase tracking-wider">Off-platform Payments</li>
              <li className="text-[10px] bg-black/40 p-3 rounded-lg border border-white/5 text-slate-300 font-bold uppercase tracking-wider">Harassment of users</li>
              <li className="text-[10px] bg-black/40 p-3 rounded-lg border border-white/5 text-slate-300 font-bold uppercase tracking-wider">Fake Listing data</li>
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="text-white font-bold text-lg text-amber-500">5. Limitation of Liability</h3>
            <p className="text-slate-400 text-sm leading-relaxed italic">
              Hema Trader acts as a platform. We are not liable for the condition of goods, behavior of drivers, or losses occurring outside our controlled escrow system. Users trade at their own risk within the rules provided.
            </p>
          </div>

          <div className="p-10 rounded-[3rem] bg-gradient-to-br from-brand-card to-black border border-white/5 text-center space-y-6">
            <div className="inline-flex p-4 rounded-full bg-slate-800/50 text-slate-400">
              <HelpCircle className="h-6 w-6" />
            </div>
            <h3 className="text-xl text-white font-serif">Need Clarification?</h3>
            <p className="text-slate-400 text-sm">
              If you have any questions regarding these terms, please contact our legal team at:
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
