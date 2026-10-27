/* The Do Big portfolio, as listed on https://dobig.com/games.
   placeId, universeId, playing, visits, favorites, maxPlayers, created, genres and descriptions
   are real values read from games.roblox.com/v1/games on 2026-10-26 (SNAPSHOT_AT). Thumbnails are
   the 512px icons dobig.com serves, re-encoded to 384px WebP. */

export const SNAPSHOT_AT = '2026-10-26T23:20:00Z'

export interface Game {
  id: string
  /** Display name exactly as it appears on Roblox, event tags included. */
  name: string
  /** Name without the event tag, for tight UI. */
  shortName: string
  /** The core noun of the game loop, used to flavour mock data ("egg", "fish"). */
  noun: string
  placeId: number
  universeId: number
  playing: number
  visits: number
  favorites: number
  maxPlayers: number
  created: string
  updated: string
  genre: string
  subgenre: string
  thumb: string
  description: string
}

export const games: Game[] = [
  {
    id: 'steal-an-egg',
    name: 'Steal An Egg',
    shortName: 'Steal An Egg',
    noun: 'egg',
    placeId: 107778070777162,
    universeId: 10563114921,
    playing: 795017,
    visits: 9585805995,
    favorites: 8784121,
    maxPlayers: 7,
    created: '2026-07-25',
    updated: '2026-10-26',
    genre: 'Simulation',
    subgenre: 'Tycoon',
    thumb: '/games/steal-an-egg.webp',
    description:
      '🥚 Welcome to Steal An Egg!\n\nHow to Play:\n🥚 Steal eggs from pets\n🐣 Hatch eggs to collect rare pets\n💰 Earn money from your pets\n⬆️ Upgrade your treadmill and base\n🏃 Train on the treadmill to gain Speed\n🥷 Steal eggs from other players\n✨ Discover rarer eggs, pets, sizes, and mutations!\n\n🎮 Supports Desktop, Console, Mobile, and Tablet players',
  },
  {
    id: 'steal-a-brainrot',
    name: '[💀] Steal a Brainrot',
    shortName: 'Steal a Brainrot',
    noun: 'brainrot',
    placeId: 109983668079237,
    universeId: 7709344486,
    playing: 165517,
    visits: 74181295665,
    favorites: 29636197,
    maxPlayers: 8,
    created: '2025-05-16',
    updated: '2026-10-25',
    genre: 'Simulation',
    subgenre: 'Tycoon',
    thumb: '/games/steal-a-brainrot.webp',
    description:
      '🗣️ Welcome to Steal a Brainrot!\n\n👍 Like the game and join the group\n\nHow to Play:\n👽 Buy a Brainrot\n🥷 Steal Brainrots from other players\n💸 Generate money\n🐦‍🔥 Rebirth\n✋ Buy slaps and troll gear to troll other players!\n\n💻 Supports Desktop, Mobile and Tablet players',
  },
  {
    id: 'fisch',
    name: 'Fisch 👻 [HORSEMAN]',
    shortName: 'Fisch',
    noun: 'fish',
    placeId: 16732694052,
    universeId: 5750914919,
    playing: 45258,
    visits: 5069961200,
    favorites: 3705021,
    maxPlayers: 20,
    created: '2024-03-13',
    updated: '2026-10-24',
    genre: 'Simulation',
    subgenre: 'Fishing',
    thumb: '/games/fisch.webp',
    description:
      '🦈 Welcome to Fisch 🦈\n\nDive into Fisch, the ultimate fishing adventure where exploration and progression are yours to control. Cast your line to catch rare and unique fish, each with 400,000+ possible variations. Explore a growing world with your trusty rod, and maybe even reel in some new friends along the way!',
  },
  {
    id: 'murderers-vs-sheriffs',
    name: '[🎃DUELS] Murderers VS Sheriffs',
    shortName: 'Murderers VS Sheriffs',
    noun: 'duel',
    placeId: 135856908115931,
    universeId: 7219654364,
    playing: 30962,
    visits: 2001288723,
    favorites: 16731570,
    maxPlayers: 30,
    created: '2025-02-09',
    updated: '2026-10-26',
    genre: 'Action',
    subgenre: 'Battlegrounds & Fighting',
    thumb: '/games/murderers-vs-sheriffs.webp',
    description:
      'Welcome to [DUELS] Murderers VS Sheriffs\n\nDuel, improve your aim and have fun\n\nWARNING:\nExploits or cheating of any kind is bannable\n\nTags: 1vs1, 2vs2, 3vs3',
  },
  {
    id: 'ride-a-pet',
    name: '[💫] Ride A Pet',
    shortName: 'Ride A Pet',
    noun: 'pet',
    placeId: 124216119978534,
    universeId: 10035204815,
    playing: 18368,
    visits: 432366147,
    favorites: 410237,
    maxPlayers: 6,
    created: '2026-04-14',
    updated: '2026-10-26',
    genre: 'Simulation',
    subgenre: 'Tycoon',
    thumb: '/games/ride-a-pet.webp',
    description:
      '🐶 Ride A Pet!\n\nHow to Play:\n🥚 Find Eggs Around The Map\n🐎 Hatch Rarer & Faster Pets to Find Rarer Eggs\n⚡ Mutate your Pets to go even faster\n\n🎮 Supports Desktop, Console, Mobile, and Tablet players',
  },
  {
    id: 'fake-an-egg',
    name: '[🎃] Fake an Egg',
    shortName: 'Fake an Egg',
    noun: 'egg',
    placeId: 97289366402005,
    universeId: 10769384180,
    playing: 16351,
    visits: 27481980,
    favorites: 44792,
    maxPlayers: 10,
    created: '2026-10-04',
    updated: '2026-10-26',
    genre: 'Simulation',
    subgenre: 'Tycoon',
    thumb: '/games/fake-an-egg.webp',
    description:
      "Not every egg is what it seems... 🥚👀\n\n1. Disguise as an egg and wait for a victim! 🎭\n2. Steal their best pet while they're not looking! 😈\n\nIf you're having fun, don't forget to like the game :D 👍",
  },
  {
    id: 'grow-a-garden',
    name: '[🎃] Grow a Garden 🌶️',
    shortName: 'Grow a Garden',
    noun: 'seed',
    placeId: 126884695634066,
    universeId: 7436755782,
    playing: 14486,
    visits: 35992721516,
    favorites: 11458118,
    maxPlayers: 4,
    created: '2025-03-25',
    updated: '2026-10-24',
    genre: 'Simulation',
    subgenre: 'Tycoon',
    thumb: '/games/grow-a-garden.webp',
    description:
      '🍅Welcome to Grow a Garden🍅\n\nAre you ready to grow your very own garden? Buy seeds from the shop when they restock, plant them, wait for them to grow, and collect the profits! Flex fruits and finds on friends, and have fun!',
  },
  {
    id: 'blade-ball',
    name: 'Blade Ball',
    shortName: 'Blade Ball',
    noun: 'ball',
    placeId: 13772394625,
    universeId: 4777817887,
    playing: 9387,
    visits: 6510148813,
    favorites: 13060438,
    maxPlayers: 16,
    created: '2023-06-17',
    updated: '2026-10-26',
    genre: 'Action',
    subgenre: 'Battlegrounds & Fighting',
    thumb: '/games/blade-ball.webp',
    description:
      '⚡  In this game of focus, timing, and strategy, your skill is tested as a deflectable homing ball hunts players with increasing speed. But there\'s more than what meets the eye.\n\n🔥  Gain new abilities and upgrade them to compliment your playstyle. Rise through the ranks by mastering your skill, and stand out with a variety of iconic weapon skins and finisher effects.',
  },
  {
    id: 'tower-defense-simulator',
    name: '[🌙 NIGHT 3] Tower Defense Simulator',
    shortName: 'Tower Defense Simulator',
    noun: 'tower',
    placeId: 3260590327,
    universeId: 1176784616,
    playing: 9042,
    visits: 5042261191,
    favorites: 3532147,
    maxPlayers: 50,
    created: '2019-06-05',
    updated: '2026-10-23',
    genre: 'Strategy',
    subgenre: 'Tower Defense',
    thumb: '/games/tower-defense-simulator.webp',
    description:
      'Place units to defend against hordes of zombies! Team up with friends and face against even stronger bosses to unlock new units!\n\n👍 Thumbs up and favorite for more quality updates! 🌟\n\nVersion 2.16.0\n🌙 Solar Requiem Night III Release\n🎃 Hollow Crate',
  },
  {
    id: 'blue-lock-rivals',
    name: '[QOL] Blue Lock: Rivals',
    shortName: 'Blue Lock: Rivals',
    noun: 'goal',
    placeId: 18668065416,
    universeId: 6325068386,
    playing: 7182,
    visits: 5016299774,
    favorites: 6314297,
    maxPlayers: 10,
    created: '2024-07-26',
    updated: '2026-10-24',
    genre: 'Sports & Racing',
    subgenre: 'Sports',
    thumb: '/games/blue-lock-rivals.webp',
    description:
      '⚽Enter the high-stakes world of Blue Lock: Rivals, inspired by the groundbreaking anime Blue Lock! Compete in electrifying 5v5 soccer matches, where ego and skill shine.\n\n🔥Choose a character class with unique abilities inspired by the show and dominate the pitch.',
  },
  {
    id: 'a-dusty-trip',
    name: 'a dusty trip [🎃SHOP]',
    shortName: 'a dusty trip',
    noun: 'car',
    placeId: 16389395869,
    universeId: 5650396773,
    playing: 6244,
    visits: 2601478729,
    favorites: 2343198,
    maxPlayers: 25,
    created: '2024-02-16',
    updated: '2026-10-25',
    genre: 'Adventure',
    subgenre: 'Driving',
    thumb: '/games/a-dusty-trip.webp',
    description:
      'Press R to start engine\n\n🚗 Welcome to "Dusty Trip," where adventures never cease! Embark on an epic journey through vast desert landscapes, where the road stretches endlessly before you.',
  },
  {
    id: 'knife-duels',
    name: '[🎃] KNIFE DUELS',
    shortName: 'KNIFE DUELS',
    noun: 'knife',
    placeId: 112731528776884,
    universeId: 9641502068,
    playing: 5756,
    visits: 152081265,
    favorites: 275783,
    maxPlayers: 60,
    created: '2026-01-29',
    updated: '2026-10-25',
    genre: 'Shooter',
    subgenre: 'Deathmatch Shooter',
    thumb: '/games/knife-duels.webp',
    description:
      'Welcome to KNIFE DUELS, a unique fast-paced first person shooter centered around knife combat! Challenge other players in 1v1 to 4v4 duels where the first to 6 wins!\n\n🆚 Challenge other players by stepping on a duel pad!\n🔪 Earn coins to unlock new knife skins!\n🤝 Trade your skins with others!',
  },
]

export const gamesById: Record<string, Game> = Object.fromEntries(games.map((g) => [g.id, g]))

export const portfolio = {
  playing: games.reduce((a, g) => a + g.playing, 0),
  visits: games.reduce((a, g) => a + g.visits, 0),
  favorites: games.reduce((a, g) => a + g.favorites, 0),
  /** dobig.com lists 591 more games beyond the 12 shown. */
  totalGames: 603,
}

export function robloxGameUrl(game: Game) {
  return `https://www.roblox.com/games/${game.placeId}`
}
