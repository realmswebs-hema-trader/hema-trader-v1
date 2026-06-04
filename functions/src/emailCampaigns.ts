import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import nodemailer from 'nodemailer';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAILBOX_SMTP_USER = defineSecret('MAILBOX_SMTP_USER');
const MAILBOX_SMTP_PASSWORD = defineSecret('MAILBOX_SMTP_PASSWORD');
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

const ADMIN_EMAIL = 'realmswebs@gmail.com';
const FROM_EMAIL = 'hematrader@mailbox.org';
const MAX_RECIPIENTS_PER_CAMPAIGN = 500;

const escapeHtml = (value = '') =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const normalizeEmail = (email?: string) => (email || '').trim().toLowerCase();

const displayName = (recipient: Recipient) =>
  recipient.displayName || recipient.name || 'Hema Trader user';

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
    const snap = await db.collection('users').limit(MAX_RECIPIENTS_PER_CAMPAIGN).get();

    recipients = snap.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as Omit<Recipient, 'id'>)
    }));
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
  recipient: Recipient,
  appBaseUrl: string
) => {
  const safeSubject = escapeHtml(input.subject.trim());
  const safePreheader = escapeHtml(input.preheader?.trim() || input.subject.trim());
  const safeTitle = escapeHtml(input.title.trim());
  const safeBody = escapeHtml(input.body.trim()).replace(/\n/g, '<br />');
  const safeName = escapeHtml(displayName(recipient));
  const safeCtaLabel = escapeHtml(input.ctaLabel?.trim() || '');
  const safeCtaUrl = input.ctaUrl?.trim() || appBaseUrl;
  const showCta = Boolean(safeCtaLabel && safeCtaUrl);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;background:#070707;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
    <div style="display:none;max-height:0;overflow:hidden;color:transparent;">
      ${safePreheader}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070707;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#151515;border:1px solid #2a2a2a;border-radius:22px;overflow:hidden;">
            <tr>
              <td style="padding:28px;background:#0b0b0b;border-bottom:1px solid #2a2a2a;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td>
                      <div style="display:inline-block;background:#f59e0b;color:#000;font-weight:900;font-size:20px;border-radius:12px;padding:10px 14px;">H</div>
                      <span style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#fff;margin-left:10px;vertical-align:middle;">Hema Trader</span>
                    </td>
                    <td align="right" style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#f59e0b;font-weight:700;">
                      Marketplace Update
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 30px;">
                <p style="margin:0 0 14px;color:#94a3b8;font-size:14px;">Hello ${safeName},</p>
                <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:32px;line-height:1.18;color:#ffffff;">${safeTitle}</h1>
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
                <p style="margin:0;">You are receiving this because you have a Hema Trader account. Reply to this email for support, or reply “Unsubscribe” to stop promotional emails.</p>
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

export const sendAdminEmailCampaign = onCall(
  {
    region: 'us-central1',
    cors: [
      'https://hema-trader-v1.onrender.com',
      'http://localhost:5173',
      'http://localhost:3000'
    ],
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [
      MAILBOX_SMTP_USER,
      MAILBOX_SMTP_PASSWORD,
      ADMIN_CC_EMAIL,
      APP_BASE_URL
    ]
  },
  async request => {
    await assertAdmin(request.auth?.uid, request.auth?.token.email as string | undefined);

    const input = request.data as AdminEmailCampaignInput;
    assertCampaignInput(input);

    const smtpUser = MAILBOX_SMTP_USER.value() || FROM_EMAIL;
    const smtpPassword = MAILBOX_SMTP_PASSWORD.value();
    const adminReplyEmail = ADMIN_CC_EMAIL.value() || ADMIN_EMAIL;
    const appBaseUrl = APP_BASE_URL.value() || 'https://hema-trader-v1.onrender.com';

    if (!smtpPassword) {
      throw new HttpsError(
        'failed-precondition',
        'Mailbox SMTP password is not configured. Set MAILBOX_SMTP_PASSWORD in Firebase Functions secrets.'
      );
    }

    const recipients = await getRecipients(input.audience, input.recipientIds || []);

    if (recipients.length === 0) {
      throw new HttpsError('failed-precondition', 'No email recipients found.');
    }

    const campaignRef = db.collection('emailCampaigns').doc();

    await campaignRef.set({
      id: campaignRef.id,
      audience: input.audience,
      subject: input.subject.trim(),
      title: input.title.trim(),
      preheader: input.preheader || '',
      ctaLabel: input.ctaLabel || '',
      ctaUrl: input.ctaUrl || '',
      recipientCount: recipients.length,
      sentCount: 0,
      failedCount: 0,
      status: 'sending',
      createdBy: request.auth?.uid || '',
      createdByEmail: request.auth?.token.email || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const transporter = nodemailer.createTransport({
      host: 'smtp.mailbox.org',
      port: 465,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPassword
      }
    });

    let sentCount = 0;
    let failedCount = 0;
    const failures: Array<{ email: string; error: string }> = [];

    for (const recipient of recipients) {
      const to = normalizeEmail(recipient.email);

      try {
        await transporter.sendMail({
          from: `Hema Trader <${smtpUser}>`,
          to,
          replyTo: `${FROM_EMAIL}, ${adminReplyEmail}`,
          subject: input.subject.trim(),
          html: buildHtmlEmail(input, recipient, appBaseUrl),
          text: `${input.title}\n\nHello ${displayName(recipient)},\n\n${input.body}\n\n${input.ctaLabel && input.ctaUrl ? `${input.ctaLabel}: ${input.ctaUrl}\n\n` : ''}Hema Trader\n${appBaseUrl}`
        });

        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        failures.push({
          email: to,
          error: error instanceof Error ? error.message : 'Unknown email error'
        });
      }
    }

    await campaignRef.set(
      {
        sentCount,
        failedCount,
        failures: failures.slice(0, 50),
        status: failedCount === recipients.length ? 'failed' : 'sent',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    await db.collection('adminLogs').add({
      adminId: request.auth?.uid || '',
      adminEmail: request.auth?.token.email || '',
      action: 'EMAIL_CAMPAIGN_SENT',
      targetId: campaignRef.id,
      reason: `Email campaign sent to ${sentCount}/${recipients.length} recipients`,
      metadata: {
        audience: input.audience,
        subject: input.subject.trim(),
        sentCount,
        failedCount
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      ok: true,
      campaignId: campaignRef.id,
      recipientCount: recipients.length,
      sentCount,
      failedCount
    };
  }
);
