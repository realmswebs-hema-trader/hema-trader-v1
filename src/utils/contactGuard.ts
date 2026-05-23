export const CONTACT_BLOCK_ERROR = 'CONTACT_BLOCKED';

const emailPattern = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const urlPattern = /(https?:\/\/|www\.|\.com\b|\.net\b|\.org\b|\.io\b)/i;
const phoneLikePattern = /(?:\+?\d[\s().-]*){7,}/;
const contactIntentPattern =
  /\b(phone|number|whatsapp|telegram|call me|text me|sms|contact me|mobile|momo number|orange money number|mtn number)\b/i;

export class ContactInfoBlockedError extends Error {
  constructor() {
    super(
      'For safety, do not share phone numbers, WhatsApp, email, or outside contact details. Please keep the trade inside Hema Trader.'
    );
    this.name = CONTACT_BLOCK_ERROR;
  }
}

export const containsContactInfo = (value: string) => {
  const text = value.trim();

  if (!text) return false;
  if (emailPattern.test(text)) return true;
  if (urlPattern.test(text)) return true;
  if (phoneLikePattern.test(text)) return true;

  const digitCount = text.replace(/\D/g, '').length;
  return contactIntentPattern.test(text) && digitCount >= 5;
};

export const assertNoContactInfo = (value: string) => {
  if (containsContactInfo(value)) {
    throw new ContactInfoBlockedError();
  }
};

export const sanitizeContactText = (value: string) =>
  value
    .replace(emailPattern, '[contact hidden]')
    .replace(urlPattern, '[link hidden]')
    .replace(phoneLikePattern, '[number hidden]');
