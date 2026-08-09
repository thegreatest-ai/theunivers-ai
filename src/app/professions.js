/**
 * What an individual does. Shown when they are not registering as a business.
 *
 * This is not decoration and it is not analytics-for-its-own-sake. PRODUCT-SHAPE.md leaves "which
 * vertical second?" to judgement; the professions that actually sign up answer it with data. If
 * forty photographers arrive and two farmers do, that is worth more than another strategy note.
 *
 * Ordered by how close each is to work the platform can already verify — people who move goods or
 * are physically somewhere sit near the top, because presence and delivery are the provable kinds.
 */
export const PROFESSIONS = [
  { group: 'Trade and production', items: [
    'Farmer or grower',
    'Trader or merchant',
    'Manufacturer',
    'Craftsperson or artisan',
    'Retailer or shopkeeper',
  ]},
  { group: 'On the ground', items: [
    'Driver or logistics',
    'Contractor or builder',
    'Chef or food service',
    'Inspector or surveyor',
    'Real estate',
  ]},
  { group: 'Professional', items: [
    'Engineer',
    'Doctor or healthcare',
    'Teacher or educator',
    'Researcher or academic',
    'Student',
    'Lawyer',
    'Accountant',
    'Consultant',
  ]},
  { group: 'Creative and digital', items: [
    'Influencer or creator',
    'Photographer or videographer',
    'Writer or journalist',
    'Designer',
    'Software developer',
  ]},
];

export const OTHER = 'Other';

/** Flat list, for validating whatever arrives at the server. */
export const ALL_PROFESSIONS = [...PROFESSIONS.flatMap((g) => g.items), OTHER];
