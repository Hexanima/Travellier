import type { TripPostApi } from "./trip-post-api.js";

type Posts = Pick<TripPostApi, "create" | "update" | "get">;
const strip = <T extends { id?: string; newActivity?: { id?: string } }>(input: T): T => {
  const copy = { ...input };
  delete copy.id;
  if (copy.newActivity !== undefined) { copy.newActivity = { ...copy.newActivity }; delete copy.newActivity.id; }
  return copy;
};
/**
 * Test helper for the composer suites that are not about the retry key: the mocks see the input without the per-attempt ids (a random value),
 * so those suites keep asserting the content that was sent. The ids are covered in `PostComposer.retry.test.tsx`.
 */
export const ignoreRetryIds = (posts: Posts): Posts => ({ get: posts.get,
  create: (tripId, input, ...rest) => posts.create(tripId, strip(input), ...rest),
  update: (tripId, postId, input, ...rest) => posts.update(tripId, postId, strip(input), ...rest) });
