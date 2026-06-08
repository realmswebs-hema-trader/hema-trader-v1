import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import admin from 'firebase-admin';

const {
  PORT = '10000',
  FIREBASE_SERVICE_ACCOUNT_JSON,
  MAILCHIMP_API_KEY,
  MAILCHIMP_SERVER_PREFIX = 'us7',
  MAILCHIMP_AUDIENCE_ID = '5aa53b8bae',
  APP_BASE_URL = 'https://hema-trader-v1.onrender.com',
  ADMIN_EMAIL = 'realmswebs@gmail.com',
  CORS_ORIGINS = 'https://hema-trader-v1-web.onrender.com,https://hema-trader-v1.onrender.com,http://localhost:5173,http://localhost:3000'
} = process.env;

if (!admin.apps.length) {
  if (FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);

    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }
}

const db = admin.firestore();
const app = express();
const allowedOrigins = CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
const maxRecipientsPerCampaign = 5000;
const recipientPageSize = 500;

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true
  })
);

const normalizeEmail = email => String(email || '').trim().toLowerCase();

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const subscriberHash = email =>
  crypto.createHash('md5').update(normalizeEmail(email)).digest('hex');

const displayName = recipient =>
  recipient.displayName || recipient.name || recipient.email || 'Hema Trader user';

const splitName = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
};

const isModerator = recipient =>
  recipient.roles?.includes('moderator') ||
  (recipient.isModerator === true &&
    recipient.moderatorVerified === true &&
    recipient.moderatorStatus === 'approved');

const getListingSellerId = listing =>
  listing.sellerId || listing.ownerId || listing.userId || listing.createdBy || '';

const getListingImages = listing => {
  if (Array.isArray(listing.images) && listing.images.length > 0) return listing.images;
  if (Array.isArray(listing.imageUrls) && listing.imageUrls.length > 0) return listing.imageUrls;
  return [];
};

const formatListingPrice = listing => {
  if (listing.priceDisplay) return listing.priceDisplay;

  const amount = Number(listing.price || 0);
  const currency = listing.currencyCode || listing.currency || 'XAF';

  if (!Number.isFinite(amount) || amount <= 0) return 'Price available in app';

  return `${amount.toLocaleString('fr-CM')} ${currency === 'XAF' ? 'FCFA' : currency}`;
};

const requireMailchimp = () => {
  if (!MAILCHIMP_API_KEY) {
    const error = new Error('MAILCHIMP_API_KEY is not configured on the Render email engine.');
    error.statusCode = 500;
    throw error;
  }
};

const mailchimpRequest = async (path, options = {}) => {
  requireMailchimp();

  const response = await fetch(
    `https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0${path}`,
    {
      method: options.method || 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`hema:${MAILCHIMP_API_KEY}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailchimp ${options.method || 'GET'} ${path} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) return {};

  return response.json();
};

const syncRecipientToMailchimp = async recipient => {
  const email = normalizeEmail(recipient.email);
  const name = splitName(displayName(recipient));

  if (!email) return;

  await mailchimpRequest(
    `/lists/${MAILCHIMP_AUDIENCE_ID}/members/${subscriberHash(email)}`,
    {
      method: 'PUT',
      body: {
        email_address: email,
        email_type: 'html',
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: name.firstName || 'Trader',
          LNAME: name.lastName || ''
        }
      }
    }
  );

  try {
    await mailchimpRequest(
      `/lists/${MAILCHIMP_AUDIENCE_ID}/members/${subscriberHash(email)}/tags`,
      {
        method: 'POST',
        body: {
          tags: [
            { name: 'Hema Trader', status: 'active' },
            { name: isModerator(recipient) ? 'Moderator' : 'User', status: 'active' }
          ]
        }
      }
    );
  } catch (error) {
    console.warn('Mailchimp tag sync failed, continuing:', error);
  }
};

const createStaticSegment = async (name, emails) => {
  const segment = await mailchimpRequest(`/lists/${MAILCHIMP_AUDIENCE_ID}/segments`, {
    method: 'POST',
    body: {
      name,
      static_segment: emails
    }
  });

  return segment.id;
};

const buildHtmlEmail = input => {
  const safeSubject = escapeHtml(input.subject);
  const safePreheader = escapeHtml(input.preheader || input.subject);
  const safeTitle = escapeHtml(input.title);
  const safeBody = escapeHtml(input.body).replace(/\n/g, '<br />');
  const safeCtaLabel = escapeHtml(input.ctaLabel || '');
  const safeCtaUrl = input.ctaUrl || APP_BASE_URL;
  const safeHeroImageUrl = input.heroImageUrl || '';
  const showCta = Boolean(safeCtaLabel && safeCtaUrl);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;background:#070707;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">${safePreheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#151515;border:1px solid #2a2a2a;border-radius:22px;overflow:hidden;">
            <tr>
              <td style="padding:28px;background:#0b0b0b;border-bottom:1px solid #2a2a2a;">
                <div style="display:inline-block;background:#f59e0b;color:#000;font-weight:900;font-size:20px;border-radius:12px;padding:10px 14px;">H</div>
                <span style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#fff;margin-left:10px;vertical-align:middle;">Hema Trader</span>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 30px;">
                <p style="margin:0 0 14px;color:#94a3b8;font-size:14px;">Hello *|FNAME|*,</p>
                <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:32px;line-height:1.18;color:#ffffff;">${safeTitle}</h1>
                ${
                  safeHeroImageUrl
                    ? `<div style="margin:0 0 24px;border-radius:18px;overflow:hidden;border:1px solid #2a2a2a;background:#0b0b0b;">
                        <img src="${escapeHtml(safeHeroImageUrl)}" alt="${safeTitle}" style="display:block;width:100%;max-height:360px;object-fit:cover;" />
                      </div>`
                    : ''
                }
                <div style="font-size:16px;line-height:1.75;color:#cbd5e1;">${safeBody}</div>
                ${
                  showCta
                    ? `<div style="margin-top:28px;">
                        <a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block;background:#f59e0b;color:#000;text-decoration:none;font-size:12px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;border-radius:14px;padding:15px 22px;">${safeCtaLabel}</a>
                      </div>`
                    : ''
                }
              </td>
            </tr>
            <tr>
              <td style="padding:24px 30px;background:#0b0b0b;border-top:1px solid #2a2a2a;color:#64748b;font-size:12px;line-height:1.6;">
                <p style="margin:0 0 8px;">Funds are protected by escrow. Sellers are paid after buyer confirmation. Verified sellers and moderators receive more buyer trust.</p>
                <p style="margin:0 0 8px;">You are receiving this because you joined Hema Trader. <a href="*|UNSUB|*" style="color:#f59e0b;">Unsubscribe</a> from marketing emails.</p>
                <p style="margin:0;">*|LIST:ADDRESS|*</p>
                <p style="margin:14px 0 0;color:#94a3b8;">Hema Trader | Cameroon Marketplace</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const createAndSendCampaign = async input => {
  const segmentId = await createStaticSegment(
    `Hema ${input.source || 'campaign'} ${new Date().toISOString()}`,
    input.recipients.map(recipient => normalizeEmail(recipient.email)).filter(Boolean)
  );

  const campaign = await mailchimpRequest('/campaigns', {
    method: 'POST',
    body: {
      type: 'regular',
      recipients: {
        list_id: MAILCHIMP_AUDIENCE_ID,
        segment_opts: {
          match: 'all',
          conditions: [
            {
              condition_type: 'StaticSegment',
              field: 'static_segment',
              op: 'static_is',
              value: segmentId
            }
          ]
        }
      },
      settings: {
        subject_line: input.subject,
        preview_text: input.preheader || input.subject,
        title: `Hema Trader - ${input.title}`,
        from_name: 'Hema Trader',
        reply_to: ADMIN_EMAIL
      },
      tracking: {
        opens: true,
        html_clicks: true,
        text_clicks: true
      }
    }
  });

  await mailchimpRequest(`/campaigns/${campaign.id}/content`, {
    method: 'PUT',
    body: {
      html: buildHtmlEmail(input),
      plain_text: `${input.title}\n\n${input.body}\n\n${input.ctaUrl || APP_BASE_URL}\n\nUnsubscribe: *|UNSUB|*`
    }
  });

  await mailchimpRequest(`/campaigns/${campaign.id}/actions/send`, {
    method: 'POST'
  });

  return { campaign, segmentId };
};

const sendToRecipients = async ({ recipients, input, source, sourceId, createdBy = 'server' }) => {
  const uniqueByEmail = new Map();

  recipients
    .filter(recipient => normalizeEmail(recipient.email))
    .forEach(recipient => {
      uniqueByEmail.set(normalizeEmail(recipient.email), recipient);
    });

  const uniqueRecipients = Array.from(uniqueByEmail.values());

  if (uniqueRecipients.length === 0) {
    throw new Error('No valid recipients found.');
  }

  const campaignRef = db.collection('emailCampaigns').doc();

  await campaignRef.set({
    provider: 'render-mailchimp',
    source,
    sourceId: sourceId || '',
    subject: input.subject,
    title: input.title,
    recipientCount: uniqueRecipients.length,
    status: 'sending',
    createdBy,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const failures = [];
  const syncedRecipients = [];

  for (const recipient of uniqueRecipients) {
    try {
      await syncRecipientToMailchimp(recipient);
      syncedRecipients.push(recipient);
    } catch (error) {
      failures.push({
        email: normalizeEmail(recipient.email),
        error: error instanceof Error ? error.message : 'Unknown sync error'
      });
    }
  }

  if (syncedRecipients.length === 0) {
    console.error('Mailchimp recipient sync failures:', failures.slice(0, 10));

    await campaignRef.set(
      {
        status: 'failed',
        failedCount: failures.length,
        failures: failures.slice(0, 50),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    const firstFailure = failures[0]?.error || 'No recipients could be synced to Mailchimp.';
    throw new Error(`No recipients could be synced to Mailchimp. First error: ${firstFailure}`);
  }

  const { campaign, segmentId } = await createAndSendCampaign({
    ...input,
    recipients: syncedRecipients,
    source
  });

  await campaignRef.set(
    {
      status: 'sent',
      sentCount: syncedRecipients.length,
      failedCount: failures.length,
      failures: failures.slice(0, 50),
      mailchimpCampaignId: campaign.id,
      mailchimpSegmentId: segmentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    campaignId: campaignRef.id,
    mailchimpCampaignId: campaign.id,
    recipientCount: uniqueRecipients.length,
    sentCount: syncedRecipients.length,
    failedCount: failures.length
  };
};

const verifyToken = async (request, response, next) => {
  try {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      response.status(401).json({ error: 'Missing Firebase ID token.' });
      return;
    }

    request.auth = await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : 'Invalid Firebase ID token.'
    });
  }
};

const isAdminUser = async auth => {
  if (normalizeEmail(auth.email) === ADMIN_EMAIL) return true;

  const userSnap = await db.collection('users').doc(auth.uid).get();
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const roles = Array.isArray(user.roles) ? user.roles : [];

  return user.isAdmin === true || user.admin === true || roles.includes('admin');
};

const requireAdmin = async (request, response, next) => {
  if (await isAdminUser(request.auth)) {
    next();
    return;
  }

  response.status(403).json({ error: 'Admin access required.' });
};

const getAllUsers = async () => {
  const recipients = [];
  let lastDoc = null;

  while (recipients.length < maxRecipientsPerCampaign) {
    const pageSize = Math.min(
      recipientPageSize,
      maxRecipientsPerCampaign - recipients.length
    );

    let query = db
      .collection('users')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();

    if (snap.empty) break;

    recipients.push(
      ...snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    );

    lastDoc = snap.docs[snap.docs.length - 1];

    if (snap.size < pageSize) break;
  }

  return recipients.filter(user => normalizeEmail(user.email));
};

const getSelectedUsers = async recipientIds => {
  const recipients = [];
  const uniqueIds = Array.from(new Set((recipientIds || []).filter(Boolean)));

  for (let i = 0; i < uniqueIds.length; i += 10) {
    const batchIds = uniqueIds.slice(i, i + 10);
    const snap = await db
      .collection('users')
      .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
      .get();

    recipients.push(
      ...snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
    );
  }

  return recipients.filter(user => normalizeEmail(user.email));
};

const getCampaignRecipients = async (audience, recipientIds = []) => {
  if (audience === 'selected_users') {
    return getSelectedUsers(recipientIds);
  }

  const allUsers = await getAllUsers();

  if (audience === 'moderators') {
    return allUsers.filter(user => isModerator(user));
  }

  return allUsers;
};

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'hema-trader-email-engine',
    provider: 'mailchimp',
    serverPrefix: MAILCHIMP_SERVER_PREFIX,
    audienceId: MAILCHIMP_AUDIENCE_ID,
    mailchimpConfigured: Boolean(MAILCHIMP_API_KEY)
  });
});

app.post('/api/email/admin-campaign', verifyToken, requireAdmin, async (request, response) => {
  try {
    const input = request.body || {};

    if (!input.subject || !input.title || !input.body) {
      response.status(400).json({ error: 'Subject, title, and body are required.' });
      return;
    }

    const recipients = await getCampaignRecipients(input.audience || 'all_users', input.recipientIds || []);
    const result = await sendToRecipients({
      recipients,
      input,
      source: 'admin',
      createdBy: request.auth.uid
    });

    await db.collection('adminLogs').add({
      adminId: request.auth.uid,
      adminEmail: request.auth.email || '',
      action: 'RENDER_EMAIL_CAMPAIGN_SENT',
      targetId: result.campaignId,
      reason: `Admin campaign sent to ${result.sentCount}/${result.recipientCount} users`,
      metadata: result,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    response.json({ ok: true, ...result });
  } catch (error) {
    console.error('Admin email campaign failed:', error);
    response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : 'Email campaign failed.'
    });
  }
});

app.post('/api/email/welcome-user', verifyToken, async (request, response) => {
  try {
    const userId = request.body?.userId || request.auth.uid;
    const adminAccess = await isAdminUser(request.auth);

    if (userId !== request.auth.uid && !adminAccess) {
      response.status(403).json({ error: 'You can only send your own welcome email.' });
      return;
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      response.status(404).json({ error: 'User profile not found.' });
      return;
    }

    const user = {
      id: userSnap.id,
      ...userSnap.data()
    };

    if (!normalizeEmail(user.email)) {
      response.status(400).json({ error: 'User email missing.' });
      return;
    }

    if (user.welcomeEmailSentAt) {
      response.json({ ok: true, skipped: true, reason: 'Welcome email already sent.' });
      return;
    }

    const result = await sendToRecipients({
      recipients: [user],
      source: 'welcome',
      sourceId: userId,
      input: {
        audience: 'selected_users',
        subject: 'Welcome to Hema Trader',
        preheader: 'Your secure marketplace account is ready.',
        title: 'Welcome to Hema Trader',
        body:
          'Hema Trader helps people in Cameroon buy, sell, deliver, and complete trades with more confidence.\n\n' +
          'Here is how to get started:\n\n' +
          '1. Browse the marketplace to discover products near you.\n' +
          '2. Open a trade when you are ready to buy.\n' +
          '3. Keep messages inside Hema Trader for safety.\n' +
          '4. Use escrow so seller payment is protected until buyer confirmation.\n' +
          '5. Request delivery or a verified moderator when a trade needs extra support.\n\n' +
          'Sellers can create listings, boost products, and build trust through verification. Drivers and moderators can serve users through delivery and assisted trade support.',
        ctaLabel: 'Open Hema Trader',
        ctaUrl: APP_BASE_URL
      },
      createdBy: request.auth.uid
    });

    await userRef.set(
      {
        welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        mailchimpSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
        mailchimpWelcomeCampaignId: result.mailchimpCampaignId
      },
      { merge: true }
    );

    response.json({ ok: true, ...result });
  } catch (error) {
    console.error('Welcome email failed:', error);
    response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : 'Welcome email failed.'
    });
  }
});

app.post('/api/email/new-listing', verifyToken, async (request, response) => {
  try {
    const { listingId } = request.body || {};

    if (!listingId) {
      response.status(400).json({ error: 'listingId is required.' });
      return;
    }

    const listingRef = db.collection('listings').doc(listingId);
    const listingSnap = await listingRef.get();

    if (!listingSnap.exists) {
      response.status(404).json({ error: 'Listing not found.' });
      return;
    }

    const listing = {
      id: listingSnap.id,
      ...listingSnap.data()
    };

    const sellerId = getListingSellerId(listing);
    const adminAccess = await isAdminUser(request.auth);

    if (sellerId !== request.auth.uid && !adminAccess) {
      response.status(403).json({ error: 'Only listing owner or admin can announce this listing.' });
      return;
    }

    if (listing.newListingEmailSentAt) {
      response.json({ ok: true, skipped: true, reason: 'New listing email already sent.' });
      return;
    }

    const status = listing.status || 'active';
    const listingStatus = listing.listingStatus || 'available';

    if (status !== 'active' || ['sold', 'cancelled'].includes(listingStatus)) {
      response.json({ ok: true, skipped: true, reason: 'Listing is not active.' });
      return;
    }

    const sellerSnap = sellerId ? await db.collection('users').doc(sellerId).get() : null;
    const seller = sellerSnap?.exists ? sellerSnap.data() || {} : {};
    const sellerName = seller.displayName || seller.name || 'A Hema Trader seller';
    const recipients = (await getAllUsers()).filter(user => user.id !== sellerId);
    const listingUrl = `${APP_BASE_URL}/listing/${listingId}`;
    const imageUrl = getListingImages(listing)[0] || '';
    const location = listing.locationName || listing.location || 'Cameroon';
    const price = formatListingPrice(listing);
    const description = String(listing.description || '').slice(0, 260);

    const result = await sendToRecipients({
      recipients,
      source: 'new_listing',
      sourceId: listingId,
      input: {
        audience: 'all_users',
        subject: `New product on Hema Trader: ${listing.title || 'New listing'}`,
        preheader: `${sellerName} posted ${listing.title || 'a new product'}.`,
        title: listing.title || 'New product on Hema Trader',
        body:
          `${sellerName} just posted a new product on Hema Trader.\n\n` +
          `Price: ${price}\n` +
          `Category: ${listing.category || 'Marketplace'}\n` +
          `Location: ${location}\n\n` +
          `${description || 'Open the listing to view photos, seller details, and trade options.'}`,
        ctaLabel: 'View Product',
        ctaUrl: listingUrl,
        heroImageUrl: imageUrl
      },
      createdBy: request.auth.uid
    });

    await listingRef.set(
      {
        newListingEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        newListingEmailCampaignId: result.mailchimpCampaignId,
        newListingEmailRecipientCount: result.sentCount
      },
      { merge: true }
    );

    response.json({ ok: true, ...result });
  } catch (error) {
    console.error('New listing email failed:', error);
    response.status(error.statusCode || 500).json({
      error: error instanceof Error ? error.message : 'New listing email failed.'
    });
  }
});

app.use((error, _request, response, _next) => {
  console.error('Email engine request failed:', error);
  response.status(error.statusCode || 500).json({
    error: error instanceof Error ? error.message : 'Email engine request failed.'
  });
});

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Hema Trader email engine running on port ${PORT}`);
});
