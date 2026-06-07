import type { User } from 'firebase/auth';

import { auth } from '../lib/firebase';

export type EmailAudience = 'all_users' | 'selected_users' | 'moderators';

export interface SendAdminEmailCampaignInput {
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

export interface EmailCampaignResult {
  ok: boolean;
  campaignId?: string;
  mailchimpCampaignId?: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  skipped?: boolean;
  reason?: string;
}

const getEmailApiBaseUrl = () => {
  const baseUrl = import.meta.env.VITE_EMAIL_API_BASE_URL;

  if (!baseUrl) {
    throw new Error('VITE_EMAIL_API_BASE_URL is not configured.');
  }

  return String(baseUrl).replace(/\/$/, '');
};

const getCurrentUser = (user?: User | null) => {
  const currentUser = user || auth.currentUser;

  if (!currentUser) {
    throw new Error('Please sign in before sending email.');
  }

  return currentUser;
};

const callEmailEngine = async <T>(
  path: string,
  body: Record<string, unknown>,
  user?: User | null
): Promise<T> => {
  const currentUser = getCurrentUser(user);
  const token = await currentUser.getIdToken();
  const response = await fetch(`${getEmailApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Email engine request failed.');
  }

  return data as T;
};

export const sendAdminEmailCampaign = async (
  input: SendAdminEmailCampaignInput,
  user?: User | null
) =>
  callEmailEngine<EmailCampaignResult>(
    '/api/email/admin-campaign',
    input,
    user
  );

export const sendWelcomeEmail = async (user?: User | null) =>
  callEmailEngine<EmailCampaignResult>(
    '/api/email/welcome-user',
    {},
    user
  );

export const sendNewListingEmail = async (
  listingId: string,
  user?: User | null
) =>
  callEmailEngine<EmailCampaignResult>(
    '/api/email/new-listing',
    { listingId },
    user
  );
