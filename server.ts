import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, getDoc, serverTimestamp, query, collection, where, getDocs, runTransaction, limit } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase for Backend Use
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY;

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: process.env.NODE_ENV });
});

import { geohashForLocation, distanceBetween } from 'geofire-common';

/**
 * Driver Search (Scalable Location Query)
 */
app.get('/api/drivers/nearby', async (req, res) => {
  const { lat, lng, radiusKm = 10 } = req.query;
  
  if (!lat || !lng) {
    return res.status(400).json({ error: 'Center coordinates required' });
  }

  try {
    const center: [number, number] = [Number(lat), Number(lng)];
    const driversQuery = query(
      collection(db, 'users'), 
      where('roles', 'array-contains', 'driver'),
      where('verificationStatus', '==', 'verified'),
      limit(100)
    );
    
    const snap = await getDocs(driversQuery);
    const drivers = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as any))
      .filter(d => {
        if (!d.location) return false;
        const driverPos: [number, number] = [d.location.lat, d.location.lng];
        const distance = distanceBetween(driverPos, center);
        return distance <= Number(radiusKm);
      })
      .sort((a, b) => (b.reliabilityScore || 0) - (a.reliabilityScore || 0));

    res.json(drivers);
  } catch (e) {
    res.status(500).json({ error: 'Driver search failed' });
  }
});
async function calculateUserRisk(userId: string): Promise<{ level: 'none' | 'low' | 'medium' | 'high', flags: string[] }> {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return { level: 'none', flags: [] };
  
  const data = userSnap.data();
  const flags: string[] = [];
  let score = 0;

  // New Account Risk
  const ageInHours = (Date.now() - (data.createdAt?.toMillis() || Date.now())) / 3600000;
  if (ageInHours < 24) {
    flags.push('New Account');
    score += 30;
  }

  // Warning Risk
  if ((data.warningCount || 0) > 0) {
    flags.push(`${data.warningCount} Warnings`);
    score += (data.warningCount * 20);
  }

  // Reliability Risk
  if (data.reliabilityScore !== undefined && data.reliabilityScore < 70) {
    flags.push('Low Reliability');
    score += 40;
  }

  const level = score >= 80 ? 'high' : score >= 40 ? 'medium' : score >= 10 ? 'low' : 'none';
  return { level, flags };
}

/**
 * Verify Flutterwave Transaction with Idempotency
 */
app.post('/api/payments/verify', async (req, res) => {
  const { transactionId, tradeId } = req.body;

  if (!transactionId || !tradeId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // 0. Check for Idempotency (Already used reference)
    const existingPaymentQuery = query(collection(db, 'trades'), where('paymentReference', '==', transactionId));
    const paidSnap = await getDocs(existingPaymentQuery);
    if (!paidSnap.empty) {
      return res.status(400).json({ error: 'Duplicate transaction detected' });
    }

    const response = await axios.get(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );

    const transaction = response.data.data;
    if (transaction.status === 'successful') {
      const tradeRef = doc(db, 'trades', tradeId);
      const tradeSnap = await getDoc(tradeRef);
      if (!tradeSnap.exists()) return res.status(404).json({ error: 'Trade not found' });

      // Risk Evaluation for high-value trades
      if (transaction.amount > 500000) { // 500k CFA threshold
        const buyerRisk = await calculateUserRisk(tradeSnap.data().buyerId);
        if (buyerRisk.level === 'high') {
          await updateDoc(tradeRef, { isDisputed: true, disputeStatus: 'reviewing', adminNote: 'High-value transaction flagged for risk verification' });
        }
      }

      await updateDoc(tradeRef, {
        paymentStatus: 'paid',
        paymentReference: transactionId,
        status: 'funded',
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return res.json({ success: true });
    }
    res.status(400).json({ success: false });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Escrow Release (Centralized & Atomic)
 * Moves funds from escrow to seller/driver wallets in a single transaction
 */
app.post('/api/trades/finalize', async (req, res) => {
  const { tradeId, userId } = req.body;

  if (!tradeId || !userId) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    await runTransaction(db, async (transaction) => {
      const tradeRef = doc(db, 'trades', tradeId);
      const tradeSnap = await transaction.get(tradeRef);
      if (!tradeSnap.exists()) throw new Error('Trade not found');
      
      const trade = tradeSnap.data();
      if (trade.status !== 'shipped' && !(trade.status === 'funded' && trade.deliveryType === 'pickup')) {
        throw new Error('Invalid trade state for finalization');
      }
      
      if (trade.buyerId !== userId) {
        throw new Error('Unauthorized finalization attempt');
      }

      // 1. Calculate Payouts
      const platformFee = trade.platformFee || 0;
      const driverComm = trade.driverCommission || 0;
      const totalAmount = trade.amount + (trade.deliveryFee || 0);
      const sellerPayout = totalAmount - platformFee - driverComm;

      // 2. Update Seller
      const sellerRef = doc(db, 'users', trade.sellerId);
      const sellerSnap = await transaction.get(sellerRef);
      if (sellerSnap.exists()) {
        const sData = sellerSnap.data();
        transaction.update(sellerRef, {
          totalEarnings: (sData.totalEarnings || 0) + sellerPayout,
          totalTrades: (sData.totalTrades || 0) + 1,
          updatedAt: serverTimestamp()
        });
      }

      // 3. Update Driver
      if (trade.driverId) {
        const driverRef = doc(db, 'users', trade.driverId);
        const driverSnap = await transaction.get(driverRef);
        if (driverSnap.exists()) {
          const dData = driverSnap.data();
          transaction.update(driverRef, {
            totalEarnings: (dData.totalEarnings || 0) + driverComm,
            deliveriesCount: (dData.deliveriesCount || 0) + 1,
            updatedAt: serverTimestamp()
          });
        }
      }

      // 4. Update Trade
      transaction.update(tradeRef, {
        status: 'completed',
        lastActivityAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 5. Create Notification Task (Queueing)
      const notifRef = doc(collection(db, 'notifications'));
      transaction.set(notifRef, {
        userId: trade.sellerId,
        title: 'Funds Released',
        body: `You received ${sellerPayout} CFA for trade #${tradeId.slice(-6)}`,
        type: 'payment_received',
        status: 'pending',
        createdAt: serverTimestamp()
      });
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Finalization Error:', error);
    res.status(500).json({ error: error.message || 'Escrow release failed' });
  }
});

// Vite middleware setup
async function setupVite() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });

  // Simulated Background Job: Notification Queue Processor
  setInterval(async () => {
    try {
      const q = query(collection(db, 'notifications'), where('status', '==', 'pending'), limit(10));
      const snap = await getDocs(q);
      
      for (const d of snap.docs) {
        // In a real system, you would call FCM/Push API here
        console.log(`[Queue] Sending notification to ${d.data().userId}: ${d.data().title}`);
        await updateDoc(doc(db, 'notifications', d.id), { 
          status: 'sent', 
          updatedAt: serverTimestamp() 
        });
      }
    } catch (e) {
      console.error('Queue Error:', e);
    }
  }, 10000); // Every 10s
}

setupVite();
