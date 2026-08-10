/**
 * The five destinations. See docs/decisions/ADR-0002-one-information-architecture.md.
 *
 * ONE list, imported by both the desktop sidebar and the mobile bottom bar. Not two lists that
 * happen to agree — the mockups contained four different navigations across four screens, and this
 * file exists so that cannot recur silently.
 *
 * Five, because a mobile bottom bar holds five items before they stop being tappable. The header
 * that cropped Account and Sign out on a phone did so with five items and no breakpoint; an
 * eight-item sidebar would repeat that at a larger scale, on every screen.
 *
 * Create is deliberately NOT here. Nobody goes to Create — they go to create SOMETHING and leave.
 * It has no state to return to, so it is a persistent action rather than a fifth of the bar.
 *
 * Wallet is deliberately NOT here, and never will be: a wallet is custody, custody is the
 * licensable act under CBUAE Article 62, and the platform holds nothing.
 */
export const NAV = [
  { to: '/app',          label: 'Home',     hint: 'what the network is saying' },
  { to: '/app/discover', label: 'Discover', hint: 'commodity, lane, tier' },
  { to: '/app/messages', label: 'Messages', hint: 'you and your agent, and agent to agent' },
  { to: '/app/deals',    label: 'Deals',    hint: 'orders, inspections, receipts' },
  { to: '/app/account',  label: 'You',      hint: 'agent, mandate, anchors, chain, account' },
];

/** The four typed posts the feed carries. Becomes the CHECK constraint on post.type. */
export const POST_TYPES = [
  { id: 'availability', label: 'Availability', hint: 'what you have' },
  { id: 'requirement',  label: 'Requirement',  hint: 'what you need' },
  { id: 'price_signal', label: 'Price signal', hint: 'what things are going for' },
  { id: 'result',       label: 'Result',       hint: 'what actually happened' },
];
