import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../components/auth/AuthContext';
import { useNotifications } from '../components/notifications/NotificationContext';
import { collection, addDoc, serverTimestamp, query, where, getDocs, limit } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { ImagePlus, X, Loader2 } from 'lucide-react';

export default function CreateListing() {
  const { user, profile } = useAuth();
  const { sendNotification } = useNotifications();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    quantity: '',
    category: 'Animals',
    location: '',
  });

  const [metadata, setMetadata] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setImages(prev => [...prev, ...newFiles]);
      const newUrls = newFiles.map(file => URL.createObjectURL(file as File));
      setPreviewUrls(prev => [...prev, ...newUrls]);
    }
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setPreviewUrls(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (profile.verificationStatus !== 'verified') {
      alert('Verification protocol required for listing initialization.');
      navigate('/profile');
      return;
    }

    setLoading(true);

    try {
      const imageUrls: string[] = [];
      for (const image of images) {
        const imageRef = ref(storage, `listings/${profile.userId}/${Date.now()}_${image.name}`);
        const snapshot = await uploadBytes(imageRef, image);
        const url = await getDownloadURL(snapshot.ref);
        imageUrls.push(url);
      }

      const listingDoc = await addDoc(collection(db, 'listings'), {
        ownerId: profile.userId,
        title: formData.title,
        description: formData.description,
        price: parseFloat(formData.price),
        quantity: formData.quantity,
        category: formData.category,
        metadata: metadata,
        location: formData.location,
        latitude: profile.latitude || null,
        longitude: profile.longitude || null,
        images: imageUrls,
        status: 'active',
        createdAt: serverTimestamp(),
      });

      // Notify Followers
      if (user) {
        const followersQ = query(
          collection(db, 'follows'),
          where('followingId', '==', user.uid),
          limit(100)
        );
        const followersSnap = await getDocs(followersQ);
        
        followersSnap.docs.forEach(doc => {
          const followerId = doc.data().followerId;
          sendNotification(followerId, {
            title: `New from ${profile.displayName || 'Marketplace'}`,
            body: `Just posted: ${formData.title}`,
            type: 'new_listing',
            targetId: listingDoc.id
          });
        });
      }

      navigate('/');
    } catch (error) {
      console.error('Submit error', error);
      alert('Listing authorization failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <header className="px-2">
        <h2 className="font-serif text-4xl text-white">Create New Listing</h2>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">Share your products with the marketplace</p>
      </header>
      
      <form onSubmit={handleSubmit} className="space-y-8 rounded-[2.5rem] bg-brand-card p-10 shadow-2xl border border-white/5">
        {/* Profile Warning */}
        {(!profile?.latitude || !profile?.longitude) && (
          <div className="rounded-2xl bg-amber-500/5 p-5 border border-amber-500/20 text-center">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-500">Location coordinates missing from profile. Distance filtering will be unavailable for this listing.</p>
          </div>
        )}

        {/* Image Upload */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
              Photos
            </label>
            <span className="text-[8px] font-bold text-slate-600 uppercase tracking-widest italic">Clear photos increase trust by 80%</span>
          </div>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {previewUrls.map((url, i) => (
              <div key={i} className="group relative aspect-square overflow-hidden rounded-xl border border-white/5 bg-black/40">
                <img src={url} alt="Preview" className="h-full w-full object-cover grayscale-[0.3] group-hover:grayscale-0 transition-all" />
                <button 
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-2 text-white hover:bg-red-500 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex aspect-square flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] transition-all hover:border-amber-500/50 hover:bg-amber-500/5 group"
            >
              <ImagePlus className="mb-2 h-6 w-6 text-slate-700 group-hover:text-amber-500" />
              <span className="text-[9px] font-black uppercase tracking-tighter text-slate-600 group-hover:text-amber-500">Append Image</span>
            </button>
          </div>
          <input 
            type="file" 
            hidden 
            ref={fileInputRef} 
            onChange={handleImageChange} 
            multiple 
            accept="image/*" 
          />
        </div>

        {/* Title */}
        <div className="space-y-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
            Title
          </label>
          <input
            required
            type="text"
            value={formData.title}
            onChange={e => setFormData({ ...formData, title: e.target.value })}
            placeholder="e.g. Organic Hybrid Maize, Brahman Bull..."
            className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
          />
        </div>

        {/* Price & Quantity & Category */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
              Price ($)
            </label>
            <input
              required
              type="number"
              value={formData.price}
              onChange={e => setFormData({ ...formData, price: e.target.value })}
              placeholder="0.00"
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          <div className="space-y-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
              Quantity
            </label>
            <input
              required
              type="text"
              value={formData.quantity}
              onChange={e => setFormData({ ...formData, quantity: e.target.value })}
              placeholder="e.g. 50 Bags, 20 Heads..."
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
          <div className="space-y-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
              Category
            </label>
            <select
              value={formData.category}
              onChange={e => {
                setFormData({ ...formData, category: e.target.value });
                setMetadata({}); // Reset metadata on category change
              }}
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white appearance-none focus:border-amber-500/50 focus:outline-none"
            >
              {['Animals', 'Farming Products', 'Electronics', 'Equipment', 'Seeds'].map(c => (
                <option key={c} value={c} className="bg-brand-card">{c}</option>
              ))}
            </select>
          </div>
          <div className="space-y-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
              Location
            </label>
            <input
              required
              type="text"
              value={formData.location}
              onChange={e => setFormData({ ...formData, location: e.target.value })}
              placeholder="District, Village..."
              className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
        </div>

        {/* Dynamic Category Fields */}
        {formData.category === 'Animals' && (
          <div className="grid grid-cols-3 gap-4">
            {['Breed', 'Age', 'Weight'].map(f => (
              <div key={f} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{f}</label>
                <input
                  type="text"
                  value={metadata[f] || ''}
                  onChange={e => setMetadata({ ...metadata, [f]: e.target.value })}
                  placeholder={f}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        {formData.category === 'Seeds' && (
          <div className="grid grid-cols-2 gap-4">
            {['Variety', 'Germination %'].map(f => (
              <div key={f} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{f}</label>
                <input
                  type="text"
                  value={metadata[f] || ''}
                  onChange={e => setMetadata({ ...metadata, [f]: e.target.value })}
                  placeholder={f}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        {['Electronics', 'Equipment'].includes(formData.category) && (
          <div className="grid grid-cols-2 gap-4">
            {['Year/Model', 'Condition'].map(f => (
              <div key={f} className="space-y-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-600">{f}</label>
                <input
                  type="text"
                  value={metadata[f] || ''}
                  onChange={e => setMetadata({ ...metadata, [f]: e.target.value })}
                  placeholder={f}
                  className="w-full rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-white focus:border-amber-500/30 focus:outline-none"
                />
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        <div className="space-y-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <div className="h-1.5 w-1.5 bg-amber-500 rounded-full" />
            Description
          </label>
          <textarea
            required
            rows={4}
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe quality, condition, and any other important details..."
            className="w-full rounded-xl border border-white/5 bg-black/40 p-4 text-sm text-white placeholder:text-slate-700 focus:border-amber-500/50 focus:outline-none resize-none"
          />
        </div>

        <button
          disabled={loading}
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-5 text-[10px] font-bold uppercase tracking-widest text-black shadow-2xl hover:bg-amber-500 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Post Listing'}
        </button>
      </form>
    </div>
  );
}
