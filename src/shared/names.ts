// Default player names, "Adjective Noun", picked by the player's public hash. A player who
// hasn't chosen a name is shown this one, the same on every device and in every list.

export const ADJECTIVES = [
  'Agile', 'Bold', 'Brave', 'Bright', 'Brilliant', 'Calm', 'Clever', 'Daring',
  'Dashing', 'Driven', 'Dynamic', 'Eager', 'Electric', 'Elite', 'Energetic', 'Epic',
  'Fast', 'Fearless', 'Fierce', 'Fit', 'Flying', 'Focused', 'Gifted', 'Glorious',
  'Golden', 'Graceful', 'Gritty', 'Happy', 'Heroic', 'Jolly', 'Keen', 'Legendary',
  'Lively', 'Loyal', 'Lucky', 'Mighty', 'Nimble', 'Noble', 'Plucky', 'Proud',
  'Quick', 'Radiant', 'Rapid', 'Ready', 'Relentless', 'Resilient', 'Rising', 'Skilled',
  'Smart', 'Speedy', 'Spirited', 'Steady', 'Strong', 'Sturdy', 'Super', 'Swift',
  'Talented', 'Tenacious', 'Tireless', 'Tough', 'Unstoppable', 'Valiant', 'Vibrant', 'Zippy',
] as const;

export const NOUNS = [
  'Runner', 'Sprinter', 'Sprint', 'Athlete', 'Champion', 'Racer', 'Dasher', 'Jumper',
  'Hurdler', 'Vaulter', 'Striker', 'Keeper', 'Skater', 'Cyclist', 'Rider', 'Swimmer',
  'Diver', 'Rower', 'Paddler', 'Climber', 'Boxer', 'Wrestler', 'Fencer', 'Archer',
  'Gymnast', 'Tumbler', 'Lifter', 'Thrower', 'Pitcher', 'Batter', 'Catcher', 'Kicker',
  'Dribbler', 'Slugger', 'Surfer', 'Skier', 'Marathoner', 'Pacer', 'Anchor', 'Captain',
  'Rookie', 'Veteran', 'Medalist', 'Contender', 'Challenger', 'Finisher', 'Olympian', 'Titan',
  'Ace', 'Legend', 'Star', 'Hero', 'Winner', 'Victor', 'Trailblazer', 'Pro',
  'Coach', 'Teammate', 'Jogger', 'Hiker', 'Goalie', 'Quarterback', 'Decathlete', 'Relay',
] as const;

/** The default name for a player hash (32 hex digits): its first byte picks the adjective, the second the noun. */
export function nameFromHash(hash: string): string {
  const byte = (i: number) => Number.parseInt(hash.slice(i * 2, i * 2 + 2), 16) || 0;
  return `${ADJECTIVES[byte(0) % ADJECTIVES.length]} ${NOUNS[byte(1) % NOUNS.length]}`;
}
