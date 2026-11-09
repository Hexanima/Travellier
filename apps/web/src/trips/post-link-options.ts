import { formatActivityClock } from "./activity-time-format.js";

const maxLabel = 60;

/** The edited post plus all its descendants (BFS on `parentPostId`); tolerant to cycles in old data. Nothing is excluded when creating. */
export const excludedPostIds = (posts: readonly { id: string; parentPostId: string | null }[], selfId?: string): ReadonlySet<string> => {
  if (selfId === undefined) return new Set<string>();
  const visited = new Set<string>([selfId]);
  const queue = [selfId];
  for (let index = 0; index < queue.length; index += 1) {
    for (const post of posts) {
      if (post.parentPostId === queue[index] && !visited.has(post.id)) { visited.add(post.id); queue.push(post.id); }
    }
  }
  return visited;
};
export const postOptionLabel = (post: { description: string | null }): string => {
  const text = (post.description ?? "").trim();
  if (text === "") return "Recuerdo sin texto";
  return text.length > maxLabel ? `${text.slice(0, maxLabel)}…` : text;
};
/** Summary read by the composer's link button: «Sin vínculo», «Recuerdo: …» or «Actividad: …». */
export const linkSummary = (link: { kind: "post" | "activity"; label?: string } | null): string =>
  link === null ? "Sin vínculo" : link.kind === "post" ? `Recuerdo: ${link.label ?? "recuerdo seleccionado"}` : `Actividad: ${link.label ?? "actividad seleccionada"}`;
export const activityOptionLabel =(activity: { title: string; scheduledAt: string }, timeZone: string): string => {
  const at = new Date(activity.scheduledAt);
  const day = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short" }).format(at);
  return `${activity.title} — ${day}, ${formatActivityClock(activity.scheduledAt, timeZone)}`;
};
