/**
 * The one public contact address (privacy, terms, About, corrections). A
 * deployment may override it with CLOSE_KNIT_CONTACT_EMAIL; it is never a
 * personal address. Read at request time on the server.
 */
export const DEFAULT_CONTACT_EMAIL = "hello@getcloseknit.com";

export function contactEmail(env: Record<string, string | undefined> = process.env): string {
  return env.CLOSE_KNIT_CONTACT_EMAIL?.trim() || DEFAULT_CONTACT_EMAIL;
}

/** A mailto: link with a subject line; nothing is sent or stored by Close Knit itself. */
export function contactMailto(subject: string, env: Record<string, string | undefined> = process.env): string {
  return `mailto:${contactEmail(env)}?subject=${encodeURIComponent(subject)}`;
}

/**
 * News (it no longer says the product is closed) and the research sign-up (proposal #17) are plain e-mails to
 * the contact address: no form, nothing stored, no personal data in the link.
 */
export const NEWS_SUBJECT = "Tell me what's new on Close Knit";
export const RESEARCH_SUBJECT = "Take part in a 30-minute research session";
