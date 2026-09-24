// Draw Roll Race — light moderation for names people type (player names, room names).
// Not a full filter: it catches common profanity, including simple l33t spellings and
// letters separated by spaces or dots, and replaces the whole name.

const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard',
  'asshole', 'wank', 'twat', 'prick', 'nazi', 'rape', 'porn', 'penis', 'vagina',
];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

function squash(text) {
  return String(text).toLowerCase()
    .replace(/[0134578@$!]/g, c => LEET[c])
    .replace(/[^a-z]/g, '')        // drop spaces, dots, dashes between letters
    .replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}

export function isAllowedName(text) {
  const s = squash(text);
  const squeezed = s.replace(/(.)\1+/g, '$1');
  return !BLOCKED.some(w => s.includes(w) || squeezed.includes(w));
}

// Returns the name, or the fallback if it isn't allowed.
export function moderateName(text, fallback) {
  return text && isAllowedName(text) ? text : fallback;
}
