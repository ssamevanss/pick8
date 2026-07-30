export type TeamAsset = {
  label: string;
  assetPath?: string;
  initials: string;
  tone: "country" | "club" | "fallback";
  isRemote?: boolean;
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
  france: {
    label: "France",
    assetPath: "/team-assets/flags/france.svg",
    initials: "FRA",
    tone: "country",
  },
  morocco: {
    label: "Morocco",
    assetPath: "/team-assets/flags/morocco.svg",
    initials: "MAR",
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
  arsenal: {
    label: "Arsenal",
    initials: "ARS",
    tone: "club",
  },
  "aston villa": {
    label: "Aston Villa",
    assetPath: "/team-assets/crests/aston-villa.svg",
    initials: "AVL",
    tone: "club",
  },
  bournemouth: {
    label: "AFC Bournemouth",
    assetPath: "/team-assets/crests/afc-bournemouth.svg",
    initials: "BOU",
    tone: "club",
  },
  brentford: {
    label: "Brentford",
    initials: "BRE",
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
  chelsea: {
    label: "Chelsea",
    initials: "CHE",
    tone: "club",
  },
  "coventry city": {
    label: "Coventry City",
    initials: "COV",
    tone: "club",
  },
  "crystal palace": {
    label: "Crystal Palace",
    initials: "CRY",
    tone: "club",
  },
  everton: {
    label: "Everton",
    initials: "EVE",
    tone: "club",
  },
  fulham: {
    label: "Fulham",
    assetPath: "/team-assets/crests/fulham.svg",
    initials: "FUL",
    tone: "club",
  },
  "hull city": {
    label: "Hull City",
    initials: "HUL",
    tone: "club",
  },
  "ipswich town": {
    label: "Ipswich Town",
    initials: "IPS",
    tone: "club",
  },
  "leeds united": {
    label: "Leeds United",
    initials: "LEE",
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
  "manchester united": {
    label: "Manchester United",
    initials: "MUN",
    tone: "club",
  },
  "newcastle united": {
    label: "Newcastle United",
    assetPath: "/team-assets/crests/newcastle-united.svg",
    initials: "NEW",
    tone: "club",
  },
  "nottingham forest": {
    label: "Nottingham Forest",
    initials: "NFO",
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

const teamAliases: Record<string, string> = {
  "a.f.c. bournemouth": "afc bournemouth",
  "bournemouth": "afc bournemouth",
  usa: "united states",
  usmnt: "united states",
  "u.s.a.": "united states",
  "brighton and hove albion": "brighton & hove albion",
  brighton: "brighton & hove albion",
  "crystal palace": "crystal palace",
  "crystal palace eagles": "crystal palace",
  "man city": "manchester city",
  "man united": "manchester united",
  "man utd": "manchester united",
  "nott'm forest": "nottingham forest",
  "nottingham": "nottingham forest",
  wolves: "wolverhampton wanderers",
  spurs: "tottenham hotspur",
  "west ham": "west ham united",
  "newcastle": "newcastle united",
};

const teamCodeAliases: Record<string, string> = {
  ARG: "argentina",
  BEL: "belgium",
  BRA: "brazil",
  COL: "colombia",
  EGY: "egypt",
  ENG: "england",
  ESP: "spain",
  FRA: "france",
  MAR: "morocco",
  MEX: "mexico",
  NOR: "norway",
  POR: "portugal",
  SUI: "switzerland",
  USA: "united states",
  ARS: "arsenal",
  BOU: "afc bournemouth",
  AVL: "aston villa",
  BHA: "brighton & hove albion",
  BRE: "brentford",
  BUR: "burnley",
  CHE: "chelsea",
  COV: "coventry city",
  CRP: "crystal palace",
  CRY: "crystal palace",
  EVE: "everton",
  FUL: "fulham",
  HUL: "hull city",
  IPS: "ipswich town",
  LEE: "leeds united",
  LIV: "liverpool",
  MCI: "manchester city",
  MUN: "manchester united",
  NEW: "newcastle united",
  NFO: "nottingham forest",
  SUN: "sunderland",
  TOT: "tottenham hotspur",
  WHU: "west ham united",
  WOL: "wolverhampton wanderers",
};

type TeamAssetInput = {
  teamName: string;
  teamCode?: string | null;
  crestUrl?: string | null;
};

type ProviderTeamPayload = {
  name?: unknown;
  shortName?: unknown;
  tla?: unknown;
  crest?: unknown;
};

type ProviderMatchPayload = {
  homeTeam?: ProviderTeamPayload;
  awayTeam?: ProviderTeamPayload;
};

export type ProviderTeamIdentity = {
  teamCode: string | null;
  crestUrl: string | null;
  displayName: string | null;
  shortName: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getProviderTeamIdentityFromRawPayload(
  rawPayload: unknown,
  side: "home" | "away",
): ProviderTeamIdentity {
  const empty = {
    teamCode: null,
    crestUrl: null,
    displayName: null,
    shortName: null,
  };

  if (!isRecord(rawPayload)) {
    return empty;
  }

  const payload = rawPayload as ProviderMatchPayload;
  const team = side === "home" ? payload.homeTeam : payload.awayTeam;

  if (!team || !isRecord(team)) {
    return empty;
  }

  const crestUrl = getString(team.crest);

  return {
    teamCode: getString(team.tla),
    crestUrl: isSafeProviderCrestUrl(crestUrl) ? crestUrl : null,
    displayName: getString(team.name),
    shortName: getString(team.shortName),
  };
}

// To add a future local team asset, place the SVG in public/team-assets/flags or
// public/team-assets/crests, then add a normalized provider team-name key here.
function normalizeTeamName(teamName: string) {
  return teamName
    .toLowerCase()
    .replace(/\b(fc|afc|cf|club)\b/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeProviderCrestUrl(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith("football-data.org");
  } catch {
    return false;
  }
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

export function getTeamAsset(input: string | TeamAssetInput): TeamAsset {
  const teamName = typeof input === "string" ? input : input.teamName;
  const teamCode = typeof input === "string" ? null : input.teamCode;
  const crestUrl = typeof input === "string" ? null : input.crestUrl;
  const normalized = normalizeTeamName(teamName);
  const aliasKey = teamAliases[normalized] ?? normalized;
  const codeKey = teamCode ? teamCodeAliases[teamCode.toUpperCase()] : null;
  const asset = teamAssets[aliasKey] ?? (codeKey ? teamAssets[codeKey] : null);

  if (asset?.tone === "country") {
    return asset;
  }

  if (isSafeProviderCrestUrl(crestUrl)) {
    return {
      label: teamName,
      assetPath: crestUrl ?? undefined,
      initials: teamCode?.toUpperCase() ?? getInitials(teamName),
      tone: "club",
      isRemote: true,
    };
  }

  if (asset) {
    return asset;
  }

  return {
    label: teamName,
    initials: getInitials(teamName),
    tone: "fallback",
  };
}

export function getTeamShortLabel(teamName: string) {
  const asset = getTeamAsset(teamName);

  if (asset.tone !== "fallback" && asset.initials) {
    return asset.initials;
  }

  if (asset.label) {
    return asset.label;
  }

  return asset.initials || teamName || getInitials(teamName);
}
