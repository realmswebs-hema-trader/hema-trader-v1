/*
  One-time script: make realmscity@gmail.com a verified Hema Moderator.

  Place this file at:
  scripts/seedVerifiedModerator.js

  Run it from your project root after setting GOOGLE_APPLICATION_CREDENTIALS
  to your Firebase service account JSON:

  node scripts/seedVerifiedModerator.js
*/

const admin = require('firebase-admin');

const DEFAULT_MODERATOR_EMAIL = 'realmscity@gmail.com';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

const moderatorPatch = {
  isModerator: true,
  moderatorVerified: true,
  moderatorStatus: 'approved',
  moderatorApplicationStatus: 'approved',
  moderatorAvailability: 'available',
  moderatorCity: 'Cameroon',
  moderatorRegions: ['Douala', 'Bamenda', 'Bafoussam', 'Yaounde'],
  moderatorRoutes: [
    'Douala-Bamenda',
    'Douala-Bafoussam',
    'Douala-Yaounde',
    'Bamenda-Bafoussam',
    'Yaounde-Bafoussam'
  ],
  moderatorTransportCapacity:
    'Verified Hema Moderator for long-distance marketplace delivery coordination.',
  moderatorCanWithdrawImmediately: true,
  moderatorApprovedBy: 'seedVerifiedModerator',
  moderatorApprovedAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
};

const run = async () => {
  const usersSnap = await db
    .collection('users')
    .where('email', '==', DEFAULT_MODERATOR_EMAIL)
    .limit(1)
    .get();

  if (usersSnap.empty) {
    throw new Error(
      `${DEFAULT_MODERATOR_EMAIL} was not found. Sign in once with that account first, then rerun this script.`
    );
  }

  const userDoc = usersSnap.docs[0];
  const userData = userDoc.data();
  const roles = Array.from(
    new Set([...(Array.isArray(userData.roles) ? userData.roles : []), 'moderator'])
  );

  await userDoc.ref.set(
    {
      ...moderatorPatch,
      roles
    },
    { merge: true }
  );

  await db.collection('moderatorApplications').doc(userDoc.id).set(
    {
      userId: userDoc.id,
      email: DEFAULT_MODERATOR_EMAIL,
      displayName:
        userData.displayName ||
        userData.name ||
        'Hema Verified Moderator',
      phoneNumber: userData.phoneNumber || '',
      cityOrRegion: 'Cameroon',
      routes: moderatorPatch.moderatorRoutes,
      transportCapacity: moderatorPatch.moderatorTransportCapacity,
      acceptedTerms: true,
      status: 'approved',
      reviewedBy: 'seedVerifiedModerator',
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt:
        userData.createdAt ||
        admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await db.collection('adminLogs').add({
    adminId: 'seedVerifiedModerator',
    adminEmail: 'system',
    action: 'DEFAULT_MODERATOR_SEEDED',
    targetId: userDoc.id,
    reason: `${DEFAULT_MODERATOR_EMAIL} verified as moderator`,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log(`${DEFAULT_MODERATOR_EMAIL} is now a verified Hema Moderator.`);
};

run()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
