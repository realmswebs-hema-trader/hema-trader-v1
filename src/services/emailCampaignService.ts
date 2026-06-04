import { getFunctions, httpsCallable } from 'firebase/functions';

export type EmailAudience = 'all_users' | 'selected_users' | 'moderators';

export interface AdminEmailCampaignInput {
  audience: EmailAudience;
  recipientIds?: string[];
  subject: string;
  preheader?: string;
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

export interface AdminEmailCampaignResult {
  ok: boolean;
  campaignId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
}

export const sendAdminEmailCampaign = async (
  input: AdminEmailCampaignInput
) => {
  const functions = getFunctions();
  const sendCampaign = httpsCallable<
    AdminEmailCampaignInput,
    AdminEmailCampaignResult
  >(functions, 'sendAdminEmailCampaign');

  const result = await sendCampaign({
    ...input,
    subject: input.subject.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    recipientIds: input.recipientIds || []
  });

  return result.data;
};
