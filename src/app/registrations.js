/**
 * What a registered business is actually called in each country, and which anchor it becomes.
 *
 * Asking a Dubai trader for an "EIN" or an American for a "trade licence" reads as a form built
 * by someone who has never traded there. Naming the right document is a small thing that signals
 * you know the ground — and it materially raises the chance the number entered is the one that
 * can actually be verified, rather than whichever registration number came to hand.
 *
 * `anchorType` maps to Corridor's ANCHOR_STRENGTH table (see corridor/src/trust-rules.ts).
 * Where a country's registration has no dedicated type, it maps to `trade_licence` — not laziness:
 * a national business registration has the same properties that make a trade licence worth 1.0,
 * namely state-issued, revocable, and tied to a legal person who can be pursued.
 */

const DEFAULT = {
  label: 'Business registration number',
  placeholder: 'as it appears on your registration certificate',
  anchorType: 'trade_licence',
  hint: 'Whatever your country issues to registered businesses.',
};

export const REGISTRATIONS = {
  AE: {
    label: 'Trade licence number',
    placeholder: 'e.g. 1043829',
    anchorType: 'trade_licence',
    hint: 'Issued by the DED or your free zone authority. On the licence itself, not the establishment card.',
  },
  IN: {
    label: 'GSTIN',
    placeholder: 'e.g. 27AAPFU0939F1ZV',
    anchorType: 'gstin',
    hint: '15 characters. If you also hold a CIN or IEC you can add those later — GSTIN verifies fastest.',
  },
  US: {
    label: 'EIN (Employer Identification Number)',
    placeholder: 'e.g. 12-3456789',
    anchorType: 'trade_licence',
    hint: 'Nine digits from the IRS. State registration numbers are not interchangeable with this.',
  },
  CN: {
    label: 'Unified Social Credit Code',
    placeholder: 'e.g. 91310000MA1FL0T21X',
    anchorType: 'trade_licence',
    hint: '18 characters, on your business licence (营业执照).',
  },
  GB: {
    label: 'Company number',
    placeholder: 'e.g. 09177215',
    anchorType: 'trade_licence',
    hint: 'Eight characters from Companies House.',
  },
  SA: {
    label: 'Commercial Registration (CR) number',
    placeholder: 'e.g. 1010123456',
    anchorType: 'trade_licence',
    hint: 'Ten digits from the Ministry of Commerce.',
  },
  PK: {
    label: 'NTN (National Tax Number)',
    placeholder: 'e.g. 1234567-8',
    anchorType: 'trade_licence',
    hint: 'Issued by the FBR.',
  },
  BD: { label: 'Trade licence number', placeholder: 'as on your trade licence', anchorType: 'trade_licence',
        hint: 'Issued by your City Corporation or Union Parishad.' },
  KE: { label: 'Business registration / KRA PIN', placeholder: 'e.g. P051234567X', anchorType: 'trade_licence',
        hint: 'The certificate of registration, or your KRA PIN.' },
  NG: { label: 'CAC registration number', placeholder: 'e.g. RC1234567', anchorType: 'trade_licence',
        hint: 'From the Corporate Affairs Commission.' },
  EG: { label: 'Commercial register number', placeholder: 'e.g. 12345', anchorType: 'trade_licence',
        hint: 'From the General Authority for Investment.' },
  TR: { label: 'Mersis number', placeholder: 'e.g. 0123456789012345', anchorType: 'trade_licence',
        hint: '16 digits from the trade registry.' },
  SG: { label: 'UEN', placeholder: 'e.g. 201234567A', anchorType: 'trade_licence',
        hint: 'Unique Entity Number from ACRA.' },
  DE: { label: 'Handelsregisternummer', placeholder: 'e.g. HRB 12345', anchorType: 'trade_licence',
        hint: 'From the commercial register.' },
  FR: { label: 'SIRET', placeholder: 'e.g. 12345678900012', anchorType: 'trade_licence', hint: '14 digits.' },
  NL: { label: 'KvK number', placeholder: 'e.g. 12345678', anchorType: 'trade_licence',
        hint: 'Eight digits from the Chamber of Commerce.' },
  ZA: { label: 'CIPC registration number', placeholder: 'e.g. 2015/123456/07', anchorType: 'trade_licence',
        hint: 'From the Companies and Intellectual Property Commission.' },
  ID: { label: 'NIB', placeholder: 'e.g. 1234567890123', anchorType: 'trade_licence',
        hint: 'Business Identification Number from OSS.' },
  VN: { label: 'Enterprise registration number', placeholder: 'e.g. 0123456789', anchorType: 'trade_licence',
        hint: 'From the Department of Planning and Investment.' },
  QA: { label: 'Commercial Registration number', placeholder: 'e.g. 123456', anchorType: 'trade_licence', hint: 'From the MOCI.' },
  KW: { label: 'Commercial licence number', placeholder: 'e.g. 123456', anchorType: 'trade_licence', hint: 'From the MOCI.' },
  OM: { label: 'Commercial Registration number', placeholder: 'e.g. 1234567', anchorType: 'trade_licence', hint: 'From the MOCIIP.' },
  BH: { label: 'CR number', placeholder: 'e.g. 12345-1', anchorType: 'trade_licence', hint: 'From the MOIC.' },
};

export const registrationFor = (countryCode) => REGISTRATIONS[countryCode] ?? DEFAULT;
