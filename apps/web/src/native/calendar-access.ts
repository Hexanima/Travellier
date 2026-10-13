import type { CalendarAccessPort } from "app-domain";
import type { NativeDependencies, NativePlatform } from "./capabilities.js";
import { nativeResult } from "./native-result.js";

export function createCalendarAccess(calendar: NativeDependencies["calendar"], platform: NativePlatform): CalendarAccessPort {
  return {
    checkAccess: () => nativeResult(platform, async () => {
      const status = await calendar.checkPermissions();
      return { read: status.readCalendar, write: status.writeCalendar };
    }),
    requestAccess: (access) => nativeResult(platform, async () => {
      const status = await calendar.requestPermissions({ permissions: access === "manage" ? ["readCalendar", "writeCalendar"] : ["writeCalendar"] });
      return { read: status.readCalendar, write: status.writeCalendar };
    }),
  };
}
