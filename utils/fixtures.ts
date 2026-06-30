import { fromZonedTime } from "date-fns-tz";

export function getKickoffIso(rawKickoff: string) {
  if (!rawKickoff) {
    return null;
  }

  return fromZonedTime(rawKickoff, "Europe/London").toISOString();
}
