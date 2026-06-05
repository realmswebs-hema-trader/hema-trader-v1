import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as crypto from 'crypto';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAILCHIMP_API_KEY = defineSecret('MAILCHIMP_API_KEY');
const ADMIN_CC_EMAIL = defineSecret('ADMIN_CC_EMAIL');
const APP_BASE_URL = defineSecret('APP_BASE_URL');

type EmailAudience = 'all_users' | 'selected_users' | 'moderators';

interface AdminEmailCampaignInput {
  audience: EmailAudience;
  recipientIds?: string[];
  subject: string;
  preheader?: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
  heroImageUrl?: string;
}

interface Recipient {
  id: string;
  email: string;
  displayName?: string;
  name?: string;
  roles?: string[];
  isModerator?: boolean;
  moderatorVerified?: boolean;
  moderatorStatus?: string;
}

interface ListingEmailData {
  id: string;
  title?: string;
  description?: string;
  price?: number | string;
  priceDisplay?: string;
  currency?: string;
  currencyCode?: string;
  currencyLocale?: string;
  category?: string;
  location?: string;
  locationName?: string;
  images?: string[];
  imageUrls?: string[];
  ownerId?: string;
  sellerId?: string;
  userId?: string;
  createdBy?: string;
  status?: string;
  listingStatus?: string;
}

const ADMIN_EMAIL = 'realmswebs@gmail.com';
const MAILCHIMP_SERVER_PREFIX = 'us7';
const MAILCHIMP_AUDIENCE_ID = '5aa53b8bae';
const FROM_NAME = 'Hema Trader';
const MAX_RECIPIENTS_PER_CAMPAIGN = 5000;
const RECIPIENT_PAGE_SIZE = 500;

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const normalizeEmail = (email?: string) => (email || '').trim().toLowerCase();

const subscriberHash = (email: string) =>
  crypto.createHash('md5').update(normalizeEmail(email)).digest('hex');

const displayName = (recipient: Recipient) =>
  recipient.displayName || recipient.name || 'Hema Trader user';

const getListingSellerId = (listing: ListingEmailData) =>
  listing.sellerId || listing.ownerId || listing.userId || listing.createdBy || '';

const getListingImages = (listing: ListingEmailData) => {
  if (Array.isArray(listing.images) && listing.images.length > 0) {
    return listing.images;
  }

  if (Array.isArray(listing.imageUrls) && listing.imageUrls.length > 0) {
    return listing.imageUrls;
  }

  return [];
};

const formatListingPrice = (listing: ListingEmailData) => {
  if (listing.priceDisplay) return listing.priceDisplay;

  const amount = Number(listing.price || 0);
  const currency = listing.currencyCode || listing.currency || 'XAF';

  if (!Number.isFinite(amount) || amount <= 0) return 'Price available in app';

  return `${amount.toLocaleString('fr-CM')} ${currency === 'XAF' ? 'FCFA' : currency}`;
};

const splitName = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
};

const isModerator = (recipient: Recipient) =>
  recipient.roles?.includes('moderator') ||
  (recipient.isModerator === true &&
    recipient.moderatorVerified === true &&
    recipient.moderatorStatus === 'approved');

const assertAdmin = async (uid?: string, email?: string) => {
  if (!uid || !email) {
    throw new HttpsError('unauthenticated', 'Please sign in as an admin.');
  }

  if (normalizeEmail(email) === ADMIN_EMAIL) return;

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const roles = Array.isArray(user.roles) ? user.roles : [];

  if (user.isAdmin === true || user.admin === true || roles.includes('admin')) {
    return;
  }

  throw new HttpsError('permission-denied', 'Admin access required.');
};

const assertCampaignInput = (input: AdminEmailCampaignInput) => {
  if (!['all_users', 'selected_users', 'moderators'].includes(input.audience)) {
    throw new HttpsError('invalid-argument', 'Invalid email audience.');
  }

  if (!input.subject?.trim()) {
    throw new HttpsError('invalid-argument', 'Email subject is required.');
  }

  if (!input.title?.trim()) {
    throw new HttpsError('invalid-argument', 'Email title is required.');
  }

  if (!input.body?.trim()) {
    throw new HttpsError('invalid-argument', 'Email body is required.');
  }

  if (input.audience === 'selected_users' && !input.recipientIds?.length) {
    throw new HttpsError('invalid-argument', 'Select at least one recipient.');
  }
};

const getRecipients = async (
  audience: EmailAudience,
  recipientIds: string[] = []
): Promise<Recipient[]> => {
  let recipients: Recipient[] = [];

  if (audience === 'selected_users') {
    const uniqueIds = Array.from(new Set(recipientIds.filter(Boolean)));

    for (let i = 0; i < uniqueIds.length; i += 10) {
      const batchIds = uniqueIds.slice(i, i + 10);
      const snap = await db
        .collection('users')
        .where(admin.firestore.FieldPath.documentId(), 'in', batchIds)
        .get();

      recipients.push(
        ...snap.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Omit<Recipient, 'id'>)
        }))
      );
    }
  } else {
    let lastDoc: any = null;

    while (recipients.length < MAX_RECIPIENTS_PER_CAMPAIGN) {
      const pageSize = Math.min(
        RECIPIENT_PAGE_SIZE,
        MAX_RECIPIENTS_PER_CAMPAIGN - recipients.length
      );

      let usersQuery = db
        .collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(pageSize);

      if (lastDoc) {
        usersQuery = usersQuery.startAfter(lastDoc);
      }

      const snap = await usersQuery.get();

      if (snap.empty) break;

      recipients.push(
        ...snap.docs.map(doc => ({
          id: doc.id,
          ...(doc.data() as Omit<Recipient, 'id'>)
        }))
      );

      lastDoc = snap.docs[snap.docs.length - 1];

      if (snap.size < pageSize) break;
    }
  }

  const uniqueByEmail = new Map<string, Recipient>();

  recipients
    .filter(recipient => Boolean(normalizeEmail(recipient.email)))
    .filter(recipient => audience !== 'moderators' || isModerator(recipient))
    .forEach(recipient => {
      uniqueByEmail.set(normalizeEmail(recipient.email), recipient);
    });

  return Array.from(uniqueByEmail.values()).slice(0, MAX_RECIPIENTS_PER_CAMPAIGN);
};

const buildHtmlEmail = (
  input: AdminEmailCampaignInput,
  appBaseUrl: string
) => {
  const safeSubject = escapeHtml(input.subject.trim());
  const safePreheader = escapeHtml(input.preheader?.trim() || input.subject.trim());
  const safeTitle = escapeHtml(input.title.trim());
  const safeBody = escapeHtml(input.body.trim()).replace(/\n/g, '<br />');
  const safeCtaLabel = escapeHtml(input.ctaLabel?.trim() || '');
  const safeCtaUrl = input.ctaUrl?.trim() || appBaseUrl;
  const safeHeroImageUrl = input.heroImageUrl?.trim() || '';
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

const buildPlainTextEmail = (input: AdminEmailCampaignInput, appBaseUrl: string) =>
  `${input.title}

${input.body}

${input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}\n\n` : ''}Hema Trader
${appBaseUrl}

Unsubscribe: *|UNSUB|*`;

const mailchimpRequest = async <T>(
  apiKey: string,
  path: string,
  options: { method?: string; body?: Record<string, any> } = {}
): Promise<T> => {
  const url = `https://${MAILCHIMP_SERVER_PREFIX}.api.mailchimp.com/3.0${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`hema:${apiKey}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mailchimp ${options.method || 'GET'} ${path} failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};

const syncRecipientToMailchimp = async (
  apiKey: string,
  recipient: Recipient
) => {
  const email = normalizeEmail(recipient.email);
  const name = splitName(displayName(recipient));

  await mailchimpRequest(
    apiKey,
    `/lists/${MAILCHIMP_AUDIENCE_ID}/members/${subscriberHash(email)}`,
    {
      method: 'PUT',
      body: {
        email_address: email,
        email_type: 'html',
        status_if_new: 'subscribed',
        merge_fields: {
          FNAME: name.firstName || 'Trader',
          LNAME: name.lastName,
          USERID: recipient.id
        }
      }
    }
  );

  await mailchimpRequest(
    apiKey,
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
};

const createStaticSegment = async (
  apiKey: string,
  name: string,
  emails: string[]
) => {
  const segment = await mailchimpRequest<{ id: number }>(
    apiKey,
    `/lists/${MAILCHIMP_AUDIENCE_ID}/segments`,
    {
      method: 'POST',
      body: {
        name,
        static_segment: emails
      }
    }
  );

  return segment.id;
};

const createAndSendMailchimpCampaign = async (
  apiKey: string,
  input: AdminEmailCampaignInput,
  segmentId: number,
  appBaseUrl: string,
  adminReplyEmail: string
) => {
  const campaign = await mailchimpRequest<{ id: string; web_id?: number }>(
    apiKey,
    '/campaigns',
    {
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
          subject_line: input.subject.trim(),
          preview_text: input.preheader?.trim() || input.subject.trim(),
          title: `Hema Trader - ${input.title.trim()}`,
          from_name: FROM_NAME,
          reply_to: adminReplyEmail
        },
        tracking: {
          opens: true,
          html_clicks: true,
          text_clicks: true
        }
      }
    }
  );

  await mailchimpRequest(apiKey, `/campaigns/${campaign.id}/content`, {
    method: 'PUT',
    body: {
      html: buildHtmlEmail(input, appBaseUrl),
      plain_text: buildPlainTextEmail(input, appBaseUrl)
    }
  });

  await mailchimpRequest(apiKey, `/campaigns/${campaign.id}/actions/send`, {
    method: 'POST'
  });

  return campaign;
};

const sendMailchimpCampaignToRecipients = async (
  params: {
    apiKey: string;
    recipients: Recipient[];
    input: AdminEmailCampaignInput;
    appBaseUrl: string;
    adminReplyEmail: string;
    source: 'admin' | 'welcome' | 'new_listing';
    sourceId?: string;
    createdBy?: string;
    createdByEmail?: string;
  }
) => {
  const campaignRef = db.collection('emailCampaigns').doc();

  await campaignRef.set({
    id: campaignRef.id,
    provider: 'mailchimp',
    source: params.source,
    sourceId: params.sourceId || '',
    audience: params.input.audience,
    subject: params.input.subject.trim(),
    title: params.input.title.trim(),
    preheader: params.input.preheader || '',
    ctaLabel: params.input.ctaLabel || '',
    ctaUrl: params.input.ctaUrl || '',
    heroImageUrl: params.input.heroImageUrl || '',
    recipientCount: params.recipients.length,
    sentCount: 0,
    failedCount: 0,
    status: 'sending',
    mailchimpAudienceId: MAILCHIMP_AUDIENCE_ID,
    createdBy: params.createdBy || 'server',
    createdByEmail: params.createdByEmail || '',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  let failedCount = 0;
  const failures: Array<{ email: string; error: string }> = [];

  for (const recipient of params.recipients) {
    try {
      await syncRecipientToMailchimp(params.apiKey, recipient);
    } catch (error) {
      failedCount += 1;
      failures.push({
        email: normalizeEmail(recipient.email),
        error: error instanceof Error ? error.message : 'Unknown Mailchimp sync error'
      });
    }
  }

  const syncedRecipients = params.recipients.filter(
    recipient => !failures.some(failure => failure.email === normalizeEmail(recipient.email))
  );

  if (syncedRecipients.length === 0) {
    await campaignRef.set(
      {
        failedCount,
        failures: failures.slice(0, 50),
        status: 'failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    throw new Error('No recipients could be synced to Mailchimp.');
  }

  const segmentName = `Hema ${params.source} ${new Date().toISOString()} ${campaignRef.id.slice(0, 6)}`;
  const segmentId = await createStaticSegment(
    params.apiKey,
    segmentName,
    syncedRecipients.map(recipient => normalizeEmail(recipient.email))
  );

  const mailchimpCampaign = await createAndSendMailchimpCampaign(
    params.apiKey,
    params.input,
    segmentId,
    params.appBaseUrl,
    params.adminReplyEmail
  );

  await campaignRef.set(
    {
      sentCount: syncedRecipients.length,
      failedCount,
      failures: failures.slice(0, 50),
      status: 'sent',
      mailchimpSegmentId: segmentId,
      mailchimpCampaignId: mailchimpCampaign.id,
      mailchimpWebId: mailchimpCampaign.web_id || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  return {
    campaignRef,
    mailchimpCampaign,
    syncedRecipients,
    failedCount,
    failures
  };
};

export const sendAdminEmailCampaign = onCall(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [MAILCHIMP_API_KEY, ADMIN_CC_EMAIL, APP_BASE_URL]
  },
  async request => {
    await assertAdmin(request.auth?.uid, request.auth?.token.email as string | undefined);

    const input = request.data as AdminEmailCampaignInput;
    assertCampaignInput(input);

    const apiKey = MAILCHIMP_API_KEY.value();
    const adminReplyEmail = ADMIN_CC_EMAIL.value() || ADMIN_EMAIL;
    const appBaseUrl = APP_BASE_URL.value() || 'https://hema-trader-v1.onrender.com';

    if (!apiKey) {
      throw new HttpsError(
        'failed-precondition',
        'Mailchimp API key is not configured. Set MAILCHIMP_API_KEY in Firebase Functions secrets.'
      );
    }

    const recipients = await getRecipients(input.audience, input.recipientIds || []);

    if (recipients.length === 0) {
      throw new HttpsError('failed-precondition', 'No email recipients found.');
    }

    try {
      const result = await sendMailchimpCampaignToRecipients({
        apiKey,
        recipients,
        input,
        appBaseUrl,
        adminReplyEmail,
        source: 'admin',
        createdBy: request.auth?.uid || '',
        createdByEmail: request.auth?.token.email || ''
      });

      await db.collection('adminLogs').add({
        adminId: request.auth?.uid || '',
        adminEmail: request.auth?.token.email || '',
        action: 'MAILCHIMP_EMAIL_CAMPAIGN_SENT',
        targetId: result.campaignRef.id,
        reason: `Mailchimp campaign sent to ${result.syncedRecipients.length}/${recipients.length} recipients`,
        metadata: {
          audience: input.audience,
          subject: input.subject.trim(),
          sentCount: result.syncedRecipients.length,
          failedCount: result.failedCount,
          mailchimpCampaignId: result.mailchimpCampaign.id,
          mailchimpAudienceId: MAILCHIMP_AUDIENCE_ID
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return {
        ok: true,
        provider: 'mailchimp',
        campaignId: result.campaignRef.id,
        mailchimpCampaignId: result.mailchimpCampaign.id,
        recipientCount: recipients.length,
        sentCount: result.syncedRecipients.length,
        failedCount: result.failedCount
      };
    } catch (error) {
      console.error('Mailchimp campaign failed:', error);

      throw new HttpsError(
        'internal',
        error instanceof Error
          ? error.message
          : 'Mailchimp campaign failed.'
      );
    }
  }
);

export const sendWelcomeEmailOnUserCreate = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'users/{userId}',
    timeoutSeconds: 300,
    memory: '512MiB',
    secrets: [MAILCHIMP_API_KEY, ADMIN_CC_EMAIL, APP_BASE_URL]
  },
  async event => {
    const apiKey = MAILCHIMP_API_KEY.value();
    const appBaseUrl = APP_BASE_URL.value() || 'https://hema-trader-v1.onrender.com';
    const adminReplyEmail = ADMIN_CC_EMAIL.value() || ADMIN_EMAIL;
    const userData = event.data?.data() || {};
    const userId = event.params.userId;
    const email = normalizeEmail(userData.email);

    if (!apiKey || !email || userData.welcomeEmailSentAt) {
      return;
    }

    const recipient: Recipient = {
      id: userId,
      email,
      displayName: userData.displayName,
      name: userData.name,
      roles: Array.isArray(userData.roles) ? userData.roles : [],
      isModerator: userData.isModerator,
      moderatorVerified: userData.moderatorVerified,
      moderatorStatus: userData.moderatorStatus
    };

    const input: AdminEmailCampaignInput = {
      audience: 'selected_users',
      recipientIds: [userId],
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
      ctaUrl: appBaseUrl
    };

    try {
      const result = await sendMailchimpCampaignToRecipients({
        apiKey,
        recipients: [recipient],
        input,
        appBaseUrl,
        adminReplyEmail,
        source: 'welcome',
        sourceId: userId
      });

      await db.collection('users').doc(userId).set(
        {
          welcomeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          mailchimpSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
          mailchimpWelcomeCampaignId: result.mailchimpCampaign.id
        },
        { merge: true }
      );
    } catch (error) {
      console.error('Welcome email failed:', {
        userId,
        email,
        error
      });

      await db.collection('adminLogs').add({
        action: 'WELCOME_EMAIL_FAILED',
        targetId: userId,
        reason: error instanceof Error ? error.message : 'Welcome email failed',
        metadata: { email },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
);

export const sendNewListingEmailOnListingCreate = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'listings/{listingId}',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [MAILCHIMP_API_KEY, ADMIN_CC_EMAIL, APP_BASE_URL]
  },
  async event => {
    const apiKey = MAILCHIMP_API_KEY.value();
    const appBaseUrl = APP_BASE_URL.value() || 'https://hema-trader-v1.onrender.com';
    const adminReplyEmail = ADMIN_CC_EMAIL.value() || ADMIN_EMAIL;
    const listingId = event.params.listingId;
    const listing = {
      id: listingId,
      ...(event.data?.data() || {})
    } as ListingEmailData;

    if (!apiKey || !listing.title) return;

    const status = listing.status || 'active';
    const listingStatus = listing.listingStatus || 'available';

    if (status !== 'active' || ['sold', 'cancelled'].includes(listingStatus)) {
      return;
    }

    const sellerId = getListingSellerId(listing);
    const recipients = (await getRecipients('all_users')).filter(
      recipient => recipient.id !== sellerId
    );

    if (recipients.length === 0) return;

    const sellerSnap = sellerId ? await db.collection('users').doc(sellerId).get() : null;
    const seller = sellerSnap?.exists ? sellerSnap.data() || {} : {};
    const sellerName = seller.displayName || seller.name || 'A Hema Trader seller';
    const listingUrl = `${appBaseUrl}/listing/${listingId}`;
    const imageUrl = getListingImages(listing)[0] || '';
    const location = listing.locationName || listing.location || 'Cameroon';
    const price = formatListingPrice(listing);
    const description = (listing.description || '').slice(0, 260);

    const input: AdminEmailCampaignInput = {
      audience: 'all_users',
      subject: `New product on Hema Trader: ${listing.title}`,
      preheader: `${sellerName} posted ${listing.title}.`,
      title: `${listing.title}`,
      body:
        `${sellerName} just posted a new product on Hema Trader.\n\n` +
        `Price: ${price}\n` +
        `Category: ${listing.category || 'Marketplace'}\n` +
        `Location: ${location}\n\n` +
        `${description || 'Open the listing to view photos, seller details, and trade options.'}`,
      ctaLabel: 'View Product',
      ctaUrl: listingUrl,
      heroImageUrl: imageUrl
    };

    try {
      const result = await sendMailchimpCampaignToRecipients({
        apiKey,
        recipients,
        input,
        appBaseUrl,
        adminReplyEmail,
        source: 'new_listing',
        sourceId: listingId
      });

      await db.collection('listings').doc(listingId).set(
        {
          newListingEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          newListingEmailCampaignId: result.mailchimpCampaign.id,
          newListingEmailRecipientCount: result.syncedRecipients.length
        },
        { merge: true }
      );

      await db.collection('adminLogs').add({
        action: 'NEW_LISTING_EMAIL_SENT',
        targetId: listingId,
        reason: `New listing email sent to ${result.syncedRecipients.length} users`,
        metadata: {
          listingId,
          listingTitle: listing.title,
          sellerId,
          imageUrl,
          mailchimpCampaignId: result.mailchimpCampaign.id
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('New listing email failed:', {
        listingId,
        title: listing.title,
        error
      });

      await db.collection('adminLogs').add({
        action: 'NEW_LISTING_EMAIL_FAILED',
        targetId: listingId,
        reason: error instanceof Error ? error.message : 'New listing email failed',
        metadata: {
          listingId,
          listingTitle: listing.title,
          sellerId
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }
);

export const testAdminEmailCampaignSetup = onCall(
  {
    region: 'us-central1',
    cors: true,
    secrets: [MAILCHIMP_API_KEY, ADMIN_CC_EMAIL, APP_BASE_URL]
  },
  async request => {
    await assertAdmin(request.auth?.uid, request.auth?.token.email as string | undefined);

    const apiKey = MAILCHIMP_API_KEY.value();

    if (apiKey) {
      await mailchimpRequest(apiKey, '/');
    }

    return {
      ok: true,
      provider: 'mailchimp',
      serverPrefix: MAILCHIMP_SERVER_PREFIX,
      audienceId: MAILCHIMP_AUDIENCE_ID,
      mailchimpApiKeyConfigured: Boolean(apiKey),
      adminCcConfigured: Boolean(ADMIN_CC_EMAIL.value()),
      appBaseUrlConfigured: Boolean(APP_BASE_URL.value()),
      callerEmail: request.auth?.token.email || ''
    };
  }
);
