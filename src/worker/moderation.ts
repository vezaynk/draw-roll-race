// Light moderation for names people type (player names, room names). Not a full filter: it
// catches common profanity, including simple l33t spellings and letters separated by spaces or
// dots, and replaces the whole name.

const BLOCKED = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard',
  'asshole', 'wank', 'twat', 'prick', 'nazi', 'rape', 'porn', 'penis', 'vagina',
];

const LEET: Record<string, string> = {
  0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i',
};

function squash(text: string): string {
  return text.toLowerCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '') // drop spaces, dots and dashes between letters
    .replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}

export function isAllowedName(text: string): boolean {
  const s = squash(text);
  const squeezed = s.replace(/(.)\1+/g, '$1');
  return !BLOCKED.some((word) => s.includes(word) || squeezed.includes(word));
}

/** The name if it is allowed, otherwise the fallback. */
export function moderateName<T extends string | null>(text: string, fallback: T): string | T {
  return text && isAllowedName(text) ? text : fallback;
}
