export type TeamAsset = {
  label: string;
  assetPath?: string;
  initials: string;
  tone: "country" | "club" | "fallback";
};

const teamAssets: Record<string, TeamAsset> = {
  argentina: {
    label: "Argentina",
    assetPath: "/team-assets/flags/argentina.svg",
    initials: "ARG",
    tone: "country",
  },
  belgium: {
    label: "Belgium",
    assetPath: "/team-assets/flags/belgium.svg",
    initials: "BEL",
    tone: "country",
  },
  brazil: {
    label: "Brazil",
    assetPath: "/team-assets/flags/brazil.svg",
    initials: "BRA",
    tone: "country",
  },
  england: {
    label: "England",
    assetPath: "/team-assets/flags/england.svg",
    initials: "ENG",
    tone: "country",
  },
  colombia: {
    label: "Colombia",
    assetPath: "/team-assets/flags/colombia.svg",
    initials: "COL",
    tone: "country",
  },
  egypt: {
    label: "Egypt",
    assetPath: "/team-assets/flags/egypt.svg",
    initials: "EGY",
    tone: "country",
  },
  mexico: {
    label: "Mexico",
    assetPath: "/team-assets/flags/mexico.svg",
    initials: "MEX",
    tone: "country",
  },
  norway: {
    label: "Norway",
    assetPath: "/team-assets/flags/norway.svg",
    initials: "NOR",
    tone: "country",
  },
  portugal: {
    label: "Portugal",
    assetPath: "/team-assets/flags/portugal.svg",
    initials: "POR",
    tone: "country",
  },
  spain: {
    label: "Spain",
    assetPath: "/team-assets/flags/spain.svg",
    initials: "ESP",
    tone: "country",
  },
  switzerland: {
    label: "Switzerland",
    assetPath: "/team-assets/flags/switzerland.svg",
    initials: "SUI",
    tone: "country",
  },
  "united states": {
    label: "United States",
    assetPath: "/team-assets/flags/united-states.svg",
    initials: "USA",
    tone: "country",
  },
  "united states of america": {
    label: "United States",
    assetPath: "/team-assets/flags/united-states.svg",
    initials: "USA",
    tone: "country",
  },

  "afc bournemouth": {
    label: "AFC Bournemouth",
    assetPath: "/team-assets/crests/afc-bournemouth.svg",
    initials: "BOU",
    tone: "club",
  },
  "aston villa": {
    label: "Aston Villa",
    assetPath: "/team-assets/crests/aston-villa.svg",
    initials: "AVL",
    tone: "club",
  },
  "brighton & hove albion": {
    label: "Brighton & Hove Albion",
    assetPath: "/team-assets/crests/brighton.svg",
    initials: "BHA",
    tone: "club",
  },
  burnley: {
    label: "Burnley",
    assetPath: "/team-assets/crests/burnley.svg",
    initials: "BUR",
    tone: "club",
  },
  fulham: {
    label: "Fulham",
    assetPath: "/team-assets/crests/fulham.svg",
    initials: "FUL",
    tone: "club",
  },
  liverpool: {
    label: "Liverpool",
    assetPath: "/team-assets/crests/liverpool.svg",
    initials: "LIV",
    tone: "club",
  },
  "manchester city": {
    label: "Manchester City",
    assetPath: "/team-assets/crests/manchester-city.svg",
    initials: "MCI",
    tone: "club",
  },
  "newcastle united": {
    label: "Newcastle United",
    assetPath: "/team-assets/crests/newcastle-united.svg",
    initials: "NEW",
    tone: "club",
  },
  sunderland: {
    label: "Sunderland",
    assetPath: "/team-assets/crests/sunderland.svg",
    initials: "SUN",
    tone: "club",
  },
  "tottenham hotspur": {
    label: "Tottenham Hotspur",
    assetPath: "/team-assets/crests/tottenham.svg",
    initials: "TOT",
    tone: "club",
  },
  "west ham united": {
    label: "West Ham United",
    assetPath: "/team-assets/crests/west-ham.svg",
    initials: "WHU",
    tone: "club",
  },
  "wolverhampton wanderers": {
    label: "Wolverhampton Wanderers",
    assetPath: "/team-assets/crests/wolves.svg",
    initials: "WOL",
    tone: "club",
  },
};

// To add a future team asset, place the SVG in public/team-assets/flags or
// public/team-assets/crests, then add a normalized provider team-name key here.
function normalizeTeamName(teamName: string) {
  return teamName
    .toLowerCase()
    .replace(/\b(fc|afc|cf|club)\b/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function getInitials(teamName: string) {
  const words = teamName
    .replace(/&/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  return words
    .slice(0, 3)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

export function getTeamAsset(teamName: string): TeamAsset {
  const normalized = normalizeTeamName(teamName);
  const asset = teamAssets[normalized];

  if (asset) {
    return asset;
  }

  return {
    label: teamName,
    initials: getInitials(teamName),
    tone: "fallback",
  };
}
