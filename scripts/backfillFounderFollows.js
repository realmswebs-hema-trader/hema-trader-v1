/*
  One-time Hema Trader follow migration.

  What it does:
  - Finds the founder user by email: realmswebs@gmail.com
  - Migrates legacy `followers` docs into standard `follows` docs
  - Makes every existing non-founder user follow the founder
  - Recalculates followersCount and followingCount for every user

  Run from a trusted admin environment only.

  Example:
  GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" node scripts/backfillFounderFollows.js
*/

const admin = require('firebase-admin');

const FOUNDER_EMAIL = 'realmswebs@gmail.com';
const USERS_COLLECTION = 'users';
const FOLLOWS_COLLECTION = 'follows';
const LEGACY_FOLLOWERS_COLLECTION = 'followers';
const WRITE_CHUNK_SIZE = 450;

admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const buildFollowId = (followerId, followingId) => `${followerId}_${followingId}`;

const chunk = (items, size) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const commitInChunks = async operations => {
  for (const operationChunk of chunk(operations, WRITE_CHUNK_SIZE)) {
    const batch = db.batch();

    operationChunk.forEach(operation => operation(batch));

    await batch.commit();
  }
};

const main = async () => {
  const usersSnap = await db.collection(USERS_COLLECTION).get();
  const users = usersSnap.docs.map(docSnap => ({
    id: docSnap.id,
    ...docSnap.data()
  }));

  const founder = users.find(
    user => String(user.email || '').toLowerCase() === FOUNDER_EMAIL
  );

  if (!founder) {
    throw new Error(`Founder user with email ${FOUNDER_EMAIL} was not found.`);
  }

  console.log(`Founder found: ${founder.id}`);
  console.log(`Users found: ${users.length}`);

  const followMap = new Map();
  const standardFollowsSnap = await db.collection(FOLLOWS_COLLECTION).get();

  standardFollowsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const followerId = data.followerId;
    const followingId = data.followingId;

    if (!followerId || !followingId || followerId === followingId) return;

    followMap.set(buildFollowId(followerId, followingId), {
      followerId,
      followingId,
      autoFollowedFounder: Boolean(data.autoFollowedFounder)
    });
  });

  const legacyFollowsSnap = await db.collection(LEGACY_FOLLOWERS_COLLECTION).get();

  legacyFollowsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    const followerId = data.followerId;
    const followingId = data.followingId;

    if (!followerId || !followingId || followerId === followingId) return;

    followMap.set(buildFollowId(followerId, followingId), {
      followerId,
      followingId,
      autoFollowedFounder: Boolean(data.autoFollowedFounder)
    });
  });

  users.forEach(user => {
    if (user.id === founder.id) return;

    followMap.set(buildFollowId(user.id, founder.id), {
      followerId: user.id,
      followingId: founder.id,
      autoFollowedFounder: true
    });
  });

  const followWrites = Array.from(followMap.entries()).map(([followId, follow]) => batch => {
    const followRef = db.collection(FOLLOWS_COLLECTION).doc(followId);

    batch.set(
      followRef,
      {
        followerId: follow.followerId,
        followingId: follow.followingId,
        participantIds: [follow.followerId, follow.followingId],
        participants: [follow.followerId, follow.followingId],
        autoFollowedFounder: follow.autoFollowedFounder,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });

  await commitInChunks(followWrites);

  const followersCount = new Map();
  const followingCount = new Map();

  Array.from(followMap.values()).forEach(follow => {
    followersCount.set(
      follow.followingId,
      (followersCount.get(follow.followingId) || 0) + 1
    );
    followingCount.set(
      follow.followerId,
      (followingCount.get(follow.followerId) || 0) + 1
    );
  });

  const counterWrites = users.map(user => batch => {
    batch.set(
      db.collection(USERS_COLLECTION).doc(user.id),
      {
        followersCount: followersCount.get(user.id) || 0,
        followingCount: followingCount.get(user.id) || 0,
        updatedAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  });

  await commitInChunks(counterWrites);

  console.log(`Standard follows written: ${followMap.size}`);
  console.log(`Founder followersCount: ${followersCount.get(founder.id) || 0}`);
  console.log('Done.');
};

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

