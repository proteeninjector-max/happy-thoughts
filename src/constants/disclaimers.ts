export const DOMAIN_DISCLAIMERS: Record<string, string> = {
  medicine:
    "This thought is for informational purposes only. It is not medical advice and does not replace consultation with a licensed healthcare professional.",
  legal:
    "This thought is for informational purposes only. It does not constitute legal advice. Consult a licensed attorney for legal decisions.",
  finance:
    "This thought is not investment advice. Not a solicitation to buy or sell any asset. Past performance does not guarantee future results.",
  trading:
    "This thought is not investment advice. Not a solicitation to buy or sell any asset. Past performance does not guarantee future results.",
  crypto:
    "This thought is not investment advice. Not a solicitation to buy or sell any asset. Past performance does not guarantee future results."
};

export function getDomainDisclaimer(specialty: string): string | null {
  const [domain] = specialty.split("/");
  return DOMAIN_DISCLAIMERS[domain] ?? null;
}
