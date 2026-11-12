import { createActivity, type Activity } from "../../entities/activity.js";
import type { ActivityConflict } from "../../entities/activity-conflict.js";
import type { ActivityParticipation } from "../../entities/activity-participation.js";
import { resolveActivityDayId } from "../../entities/activity-schedule.js";
import { applyPostExpense, describePostExpense, parsePostExpenseInput, type PostExpense, type PostExpenseView, type PostExpensePlan } from "../../entities/post-expense.js";
import type { PostPhotoRef } from "../../entities/post-photo.js";
import { isSameRequest } from "../../entities/post-save-request.js";
import { createPost, hasPostContent, MAX_POST_CHAIN_DEPTH, relinkPost, requirePostContent, resolvePostChain, type CreatePostContext, type Post, type PostLinks } from "../../entities/post.js";
import { PostNotFoundError } from "../../errors/post-not-found-error.js";
import { PostRequestConflictError } from "../../errors/post-request-conflict-error.js";
import { TripNotFoundError } from "../../errors/trip-not-found-error.js";
import { UnauthorizedError } from "../../errors/unauthorized-error.js";
import { UnknownError } from "../../errors/unknown-error.js";
import { ValidationError } from "../../errors/validation-error.js";
import type { ObjectStoragePort } from "../../ports/object-storage-port.js";
import type { TripPostPort, TripPostReadScope, TripPostScope } from "../../ports/trip-post-port.js";
import type { TaggedError } from "../../types/error.js";
import { err, ok, type AsyncResult, type Result } from "../../types/result.js";
import type { UseCase } from "../../types/usecase.js";
import { createObjectId, type ObjectId } from "../../value-objects/object-id.js";
import { applyAuthorPlan, evaluatePlanChange } from "./agenda-plan-change.js";
import { planPostPhotos, registerPostPhotos, verifyOptionalPhotoUploads } from "./manage-post-photos.js";
import { emitToMembers, type MemberNotification } from "./notification-emission.js";

export interface TripPostPayload { tripId: ObjectId; authenticatedUserId: ObjectId }
export interface PostDetailPayload extends TripPostPayload { postId: ObjectId }
export type PostEditableFields = Pick<Post, "description" | "mapsUrl" | keyof PostLinks>;
/** `id` is optional and client-generated: the retry of a PATCH that carried it is recognized as the same save (T87). */
export type NewPostActivity = Pick<Activity, "title" | "scheduledAt"> &
  Partial<Pick<Activity, "id" | "description" | "mapsUrl" | "durationMinutes">>;
/** Plan-change confirmation the author gave for the new activity (checked against the current agenda). */
interface PlanConfirmation {
  /** Conflicts the author saw when confirming. */ confirmedConflicts?: unknown;
  /** Schedule of the new activity the author saw when confirming. */ confirmedActivity?: unknown;
}
/**
 * `dayId` only feeds the new activity and is optional: when absent the slice is derived from `scheduledAt`.
 * The post itself never stores or validates a day.
 */
export type CreateTripPostPayload = TripPostPayload & Partial<PostEditableFields> & PlanConfirmation & PhotoReferences & ExpenseReference & {
  dayId?: ObjectId;
  newActivity?: NewPostActivity;
  /**
   * Client-generated id of the post (T87), used as its `_id`: sending the same id again is a retry that answers the saved result
   * without writing. Without it the server generates the id and a retry creates another post.
   */
  postId?: ObjectId;
};
/** Photos of the save: `{ key }` references of uploads authorized by `createTripPhotoUploads`; validated by the use case. */
interface PhotoReferences { photos?: unknown }
/** Expense of the save (`{ totalAmount?, currency?, breakdown? }`, merge-patch over the stored expense); validated by the use case. */
interface ExpenseReference { expense?: unknown }
export type UpdateTripPostPayload = PostDetailPayload & Partial<PostEditableFields> & PhotoReferences & ExpenseReference;
/** The post; when the save carried `photos` it also lists the photos of the post (`id`, `order`), and with `expense` the saved expense. */
export type UpdateTripPostResult = Post & { photos?: PostPhotoRef[]; expense?: PostExpenseView };
export type LinkTripPostToNewActivityPayload = PostDetailPayload & Partial<PostEditableFields> & PlanConfirmation & PhotoReferences & ExpenseReference & {
  dayId?: ObjectId;
  newActivity: NewPostActivity;
};
/** The author's agenda has conflicts that were not confirmed (or the confirmation is stale): nothing was written. */
export interface PostConfirmationRequired {
  outcome: "confirmation_required";
  conflicts: ActivityConflict[];
  activity: { scheduledAt: Date; durationMinutes: number | null };
}
export type CreateTripPostResult =
  | { outcome: "created"; post: Post; activity?: Activity; participation?: ActivityParticipation; photos?: PostPhotoRef[]; expense?: PostExpenseView }
  | PostConfirmationRequired;
export type LinkTripPostToNewActivityResult =
  | { outcome: "linked"; post: Post; activity: Activity; participation: ActivityParticipation; photos?: PostPhotoRef[]; expense?: PostExpenseView }
  | PostConfirmationRequired;
export type PostSummary = Pick<Post, "id" | "authorId" | "createdAt" | "description">;
export interface TripPostChainResult {
  post: Post;
  parent: PostSummary | null;
  children: PostSummary[];
  /** Activity of the highest ancestor; null when the root has none or stored data is inconsistent. */
  rootActivityId: ObjectId | null;
  /** Saved expense of the post (with derived completeness and former members); the key is absent when the post has none. */
  expense?: PostExpenseView;
}
/** An expense plan with the current members among the users it names (to derive `formerMemberIds` after the write). */
type PlannedExpense = PostExpensePlan & { memberIds: ObjectId[] };
interface Dependencies { posts: TripPostPort }
/** `storage` is only needed (and used) when a save carries `photos`. */
interface PhotoDependencies { storage?: ObjectStoragePort }
interface CreationDependencies extends Dependencies, PhotoDependencies { createId: () => ObjectId; now: () => Date }
interface UpdateDependencies extends Dependencies, PhotoDependencies { createId?: () => ObjectId; now?: () => Date }

/** Builds and validates the spontaneous activity (day derived when omitted, duration and window checked); never writes. */
const buildNewActivity = async (scope: TripPostScope, trip: { id: ObjectId }, input: { tripId: ObjectId; authenticatedUserId: ObjectId;
  dayId?: ObjectId | null; newActivity: NewPostActivity }, id: ObjectId, createdAt: Date): AsyncResult<Activity> => {
  const days = await scope.listDays();
  if (!days.ok) return days;
  let dayId = input.dayId;
  if (dayId == null) {
    const resolved = resolveActivityDayId(days.value, input.tripId, input.newActivity.scheduledAt);
    if (!resolved.ok) return resolved;
    dayId = resolved.value;
  }
  return createActivity({ id, tripId: input.tripId, dayId, title: input.newActivity.title, scheduledAt: input.newActivity.scheduledAt,
    durationMinutes: input.newActivity.durationMinutes, description: input.newActivity.description, mapsUrl: input.newActivity.mapsUrl,
    createdBy: input.authenticatedUserId, createdAt }, { trip, days: days.value });
};
/** Reviews the author's agenda (same snapshot as the writes); the caller writes nothing until the plan is ready. */
const planAuthorAgenda = async (scope: TripPostScope, payload: TripPostPayload & PlanConfirmation, activity: Activity) => {
  const activities = await scope.listActivities();
  if (!activities.ok) return activities;
  const records = await scope.listUserParticipations(payload.authenticatedUserId);
  if (!records.ok) return records;
  const plan = evaluatePlanChange({ candidate: activity, userId: payload.authenticatedUserId, tripId: payload.tripId,
    activities: activities.value, participations: records.value, confirmedConflicts: payload.confirmedConflicts,
    confirmedActivity: payload.confirmedActivity });
  return plan.ok ? ok({ plan: plan.value, records: records.value }) : plan;
};

const authorize = async (scope: TripPostReadScope, payload: TripPostPayload) => {
  const member = await scope.findMemberRole(payload.authenticatedUserId);
  if (!member.ok) return member;
  if (member.value !== "admin" && member.value !== "participant") return err(new TripNotFoundError());
  const trip = await scope.findTrip();
  if (!trip.ok) return trip;
  return trip.value?.id === payload.tripId ? ok(trip.value) : err(new TripNotFoundError());
};
/**
 * Only when the save carries `photos`: a plain snapshot (no Trip lock) rejects non-members with 404 before any storage call.
 * The transaction still revalidates membership under the lock.
 */
const requireMemberBeforeStorage = async (posts: TripPostPort, payload: TripPostPayload & PhotoReferences): AsyncResult<undefined> => {
  if (payload.photos === undefined) return ok(undefined);
  const member = await posts.withReadSnapshot(payload.tripId, (scope) => authorize(scope, payload));
  return member.ok ? ok(undefined) : member;
};

const find = async (scope: TripPostReadScope, payload: PostDetailPayload): AsyncResult<Post> => {
  const post = await scope.find(payload.postId);
  if (!post.ok) return post;
  return post.value?.id === payload.postId && post.value.tripId === payload.tripId ? ok(post.value) : err(new PostNotFoundError());
};
/** Fields of the save that edit the content of the memory (T124); `null` counts as supplied, only `undefined` is absent. */
const CONTENT_KEYS = ["description", "mapsUrl", "activityId", "parentPostId", "transportId", "photos", "newActivity"] as const;
const touchesContent = (payload: object): boolean => CONTENT_KEYS.some((key) => Object.hasOwn(payload, key) && (payload as Record<string, unknown>)[key] !== undefined);
/** Only the author edits the content (also in a PATCH mixed with `expense`); expense-only saves stay open to every current member. */
const requireAuthor = (post: Post, payload: TripPostPayload): Result<undefined, UnauthorizedError> =>
  !touchesContent(payload) || post.authorId === payload.authenticatedUserId ? ok(undefined) : err(new UnauthorizedError());
/**
 * Like `requireMemberBeforeStorage` for an existing post: a save with `photos` reads the post in the same snapshot and answers 404 or 403
 * before any storage call.
 */
const requireAuthorBeforeStorage = async (posts: TripPostPort, payload: PostDetailPayload & PhotoReferences): AsyncResult<undefined> => {
  if (payload.photos === undefined) return ok(undefined);
  return posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await find(scope, payload);
    if (!post.ok) return post;
    return requireAuthor(post.value, payload);
  });
};
const resolve = async (scope: TripPostReadScope, post: Pick<Post, "tripId"> & Partial<PostLinks>,
  activity?: Activity): AsyncResult<CreatePostContext> => {
  const resolvedActivity = activity ? ok(activity) : post.activityId == null ? ok(undefined) : await scope.findActivity(post.activityId);
  if (!resolvedActivity.ok) return resolvedActivity;
  const parent = post.parentPostId == null ? ok(undefined) : await scope.find(post.parentPostId);
  if (!parent.ok) return parent;
  const transport = post.transportId == null ? ok(undefined) : await scope.findTransport(post.transportId);
  if (!transport.ok) return transport;
  return ok({ trip: { id: post.tripId },
    activity: resolvedActivity.value, parentPost: parent.value, transport: transport.value });
};

const summarize = (post: Post): PostSummary =>
  ({ id: post.id, authorId: post.authorId, createdAt: post.createdAt, description: post.description });
/** Loads the ancestors of `startId` (inclusive) inside the scope; stops on a revisited post or flags `truncated` at the technical limit. */
const loadAncestors = async (scope: TripPostReadScope, tripId: ObjectId, startId: ObjectId):
  AsyncResult<{ posts: Post[]; truncated: boolean }> => {
  const visited = new Set<ObjectId>(), loaded: Post[] = [];
  let next: ObjectId | null = startId;
  while (next !== null && !visited.has(next)) {
    if (loaded.length >= MAX_POST_CHAIN_DEPTH) return ok({ posts: loaded, truncated: true });
    visited.add(next);
    const found = await scope.find(next);
    if (!found.ok) return found;
    if (found.value === undefined || found.value.tripId !== tripId) break;
    loaded.push(found.value);
    next = found.value.parentPostId;
  }
  return ok({ posts: loaded, truncated: false });
};

/**
 * Inside the post transaction, after `authorize` and before any write: validates the `expense` of the save against the stored one
 * (1:1 by `postId`) and decides insert or update. No `expense` means nothing to do. Writes nothing.
 */
const planPostExpense = async (scope: TripPostScope, input: { tripId: ObjectId; postId: ObjectId; expense: unknown;
  createId: () => ObjectId; createdAt: Date }): AsyncResult<PlannedExpense | undefined> => {
  if (input.expense === undefined) return ok(undefined);
  const parsed = parsePostExpenseInput(input.expense);
  if (!parsed.ok) return parsed;
  const existing = await scope.findExpense(input.postId);
  if (!existing.ok) return existing;
  // Membership of every user the expense will name (sent now or already stored), read in the same snapshot and under the Trip lock
  // as `authorize`: an expulsion and this save are serialized.
  const referenced = new Set<ObjectId>();
  for (const row of [...(parsed.value.payments ?? []), ...(parsed.value.shares ?? []), ...(existing.value?.payments ?? []), ...(existing.value?.shares ?? [])]) {
    const userId = typeof row?.userId === "string" ? createObjectId(row.userId) : undefined;
    if (userId?.ok) referenced.add(userId.value);
  }
  const members = referenced.size === 0 ? ok([] as ObjectId[]) : await scope.listMemberUserIds([...referenced]);
  if (!members.ok) return members;
  const plan = applyPostExpense({ existing: existing.value, input: parsed.value, tripId: input.tripId, postId: input.postId,
    id: existing.value?.id ?? input.createId(), createdAt: input.createdAt, memberIds: members.value });
  return plan.ok ? ok({ ...plan.value, memberIds: members.value }) : plan;
};
/** Writes the planned expense; call it after the post itself is stored in the same transaction. Answers the expense with its derived completeness. */
const registerPostExpense = async (scope: TripPostScope, plan: PlannedExpense): AsyncResult<PostExpenseView> => {
  const written = plan.mode === "insert" ? await scope.insertExpense(plan.expense) : await scope.updateExpenseFields(plan.expense, plan.changed);
  return written.ok ? ok(describePostExpense(plan.expense, plan.memberIds)) : written;
};

/**
 * A memory keeps at least text, a location or a photo. Photos already published count; they are only read when the post has neither
 * text nor location, so a save with content never pays for the extra read. Writes nothing.
 */
const requireSavedContent = async (scope: TripPostScope, post: Pick<Post, "id" | "description" | "mapsUrl">, newPhotos: number): AsyncResult<undefined> => {
  if (hasPostContent({ description: post.description, mapsUrl: post.mapsUrl, photoCount: newPhotos })) return ok(undefined);
  const published = await scope.listPhotos(post.id);
  if (!published.ok) return published;
  return requirePostContent({ description: post.description, mapsUrl: post.mapsUrl, photoCount: newPhotos + published.value.length });
};

const requestConflict = () => err(new PostRequestConflictError());
/** The requester's own post of this Trip exists with other content than the retry: safe to say it was already saved. */
const alreadySaved = (postId: ObjectId) => err(new PostRequestConflictError({ reason: "already_saved", postId }));
const rowsKey = (rows: readonly { userId: unknown; unit: unknown; value: unknown }[]) => JSON.stringify(rows.map((row) => [row.userId, row.unit, row.value ?? null]));
/**
 * Whether the `expense` of a retry equals the stored one (no member check: they may have left since). A POST is normalized as a creation;
 * a PATCH is applied as the partial edit it is over the stored expense, and matches when no field would change.
 */
const expenseMatchesStored = (raw: unknown, stored: PostExpense | undefined, mode: "create" | "patch" = "create"): boolean => {
  if (raw === undefined || stored === undefined) return false;
  const parsed = parsePostExpenseInput(raw);
  if (!parsed.ok) return false;
  const plan = applyPostExpense({ existing: mode === "patch" ? stored : undefined, input: parsed.value, tripId: stored.tripId, postId: stored.postId, id: stored.id,
    createdAt: stored.createdAt, memberIds: [...stored.payments, ...stored.shares].map((row) => row.userId) });
  if (!plan.ok) return false;
  const { expense } = plan.value;
  return expense.totalAmount === stored.totalAmount && expense.currency === stored.currency && expense.breakdown === stored.breakdown
    && rowsKey(expense.payments) === rowsKey(stored.payments) && rowsKey(expense.shares) === rowsKey(stored.shares);
};
/** What the first successful save left stored for this post, read inside the transaction (a retry never writes). */
const readSavedPost = async (scope: TripPostScope, post: Post, userId: ObjectId) => {
  const photos = await scope.listPhotos(post.id);
  if (!photos.ok) return photos;
  const expense = await scope.findExpense(post.id);
  if (!expense.ok) return expense;
  let activity: Activity | undefined, participation: ActivityParticipation | undefined;
  if (post.activityId !== null) {
    const activities = await scope.listActivities();
    if (!activities.ok) return activities;
    activity = activities.value.find((candidate) => candidate.id === post.activityId);
    const records = await scope.listUserParticipations(userId);
    if (!records.ok) return records;
    participation = records.value.find((record) => record.activityId === post.activityId);
  }
  const named = expense.value === undefined ? [] : [...new Set([...expense.value.payments, ...expense.value.shares].map((row) => row.userId))];
  const members = named.length === 0 ? ok([] as ObjectId[]) : await scope.listMemberUserIds(named);
  if (!members.ok) return members;
  return ok({ photos: photos.value, expenseRecord: expense.value, activity, participation,
    expense: expense.value === undefined ? undefined : describePostExpense(expense.value, members.value) });
};
/**
 * A client post id that already exists. It is the retry of this author's own save when the body is the same one stored (answers the saved
 * result, reconstructed from what is persisted, without writing); a post of another Trip or author, or a different body, is the same
 * generic conflict. Nothing here writes.
 */
const answerPostRetry = async (scope: TripPostScope, payload: CreateTripPostPayload, owner: { id: ObjectId; tripId: ObjectId; authorId: ObjectId },
  keys: string[] | undefined): AsyncResult<CreateTripPostResult> => {
  if (owner.tripId !== payload.tripId || owner.authorId !== payload.authenticatedUserId) return requestConflict();
  const post = await scope.find(owner.id);
  if (!post.ok) return post;
  if (post.value === undefined) return requestConflict();
  const saved = await readSavedPost(scope, post.value, payload.authenticatedUserId);
  if (!saved.ok) return saved;
  const { photos, expenseRecord, activity, participation, expense } = saved.value;
  const same = isSameRequest({ post: post.value, activity: activity ?? null, photoKeys: photos.map((photo) => photo.s3Key), hasExpense: expenseRecord !== undefined },
    { description: payload.description, mapsUrl: payload.mapsUrl, activityId: payload.activityId, parentPostId: payload.parentPostId,
      transportId: payload.transportId, newActivity: payload.newActivity, photoKeys: keys, expenseSent: payload.expense !== undefined,
      expenseMatches: expenseMatchesStored(payload.expense, expenseRecord) });
  if (!same) return alreadySaved(post.value.id);
  if (payload.newActivity !== undefined && (activity === undefined || participation === undefined)) return alreadySaved(post.value.id);
  return ok({ outcome: "created" as const, post: post.value,
    ...(payload.newActivity !== undefined && activity !== undefined && participation !== undefined ? { activity, participation } : {}),
    ...(keys !== undefined ? { photos: photos.map((photo) => ({ id: photo.id, order: photo.order })) } : {}),
    ...(expense ? { expense } : {}) });
};
/** The PATCH with `newActivity.id` whose activity is already linked to the post: same save when the content is the stored one. */
const answerLinkRetry = async (scope: TripPostScope, payload: LinkTripPostToNewActivityPayload, post: Post, keys: string[] | undefined):
  AsyncResult<LinkTripPostToNewActivityResult> => {
  const saved = await readSavedPost(scope, post, payload.authenticatedUserId);
  if (!saved.ok) return saved;
  const { photos, expenseRecord, activity, participation, expense } = saved.value, wanted = payload.newActivity;
  // An activity with that id created by someone else is not the requester's save: generic conflict, no reason.
  if (activity !== undefined && activity.createdBy !== payload.authenticatedUserId) return requestConflict();
  const fields = ["description", "mapsUrl", "parentPostId", "transportId"] as const;
  const postSame = fields.every((field) => !Object.hasOwn(payload, field) || payload[field] === undefined || payload[field] === post[field]);
  const photosSame = keys === undefined || keys.every((key) => photos.some((photo) => photo.s3Key === key));
  const expenseSame = payload.expense === undefined || expenseMatchesStored(payload.expense, expenseRecord, "patch");
  const activitySame = activity !== undefined && wanted.title === activity.title && wanted.scheduledAt.getTime() === activity.scheduledAt.getTime()
    && (wanted.durationMinutes ?? null) === activity.durationMinutes && (wanted.description ?? null) === activity.description
    && (wanted.mapsUrl ?? null) === activity.mapsUrl;
  if (!postSame || !photosSame || !expenseSame || !activitySame || participation === undefined) return alreadySaved(post.id);
  return ok({ outcome: "linked" as const, post, activity, participation,
    ...(keys !== undefined ? { photos: photos.map((photo) => ({ id: photo.id, order: photo.order })) } : {}),
    ...(payload.expense !== undefined && expense ? { expense } : {}) });
};

/** `post.created` (and `activity.created` when the save created a spontaneous activity): ids and instants only, never the actor. */
const savedNotifications = (input: { tripId: ObjectId; actorId: ObjectId; post?: Post; activity?: Activity }): MemberNotification[] => [
  ...(input.post === undefined ? [] : [{ type: "post.created" as const, tripId: input.tripId, operationRef: input.post.id, actorId: input.actorId,
    exclude: [input.actorId], createdAt: input.post.createdAt,
    payload: { postId: input.post.id, actorId: input.actorId, activityId: input.post.activityId } }]),
  ...(input.activity === undefined ? [] : [{ type: "activity.created" as const, tripId: input.tripId, operationRef: input.activity.id, actorId: input.actorId,
    exclude: [input.actorId], createdAt: input.activity.createdAt, payload: { activityId: input.activity.id, actorId: input.actorId,
      scheduledAt: input.activity.scheduledAt, durationMinutes: input.activity.durationMinutes } }]),
];

const conflictingActivityLink = () => err(new ValidationError([{ field: "activityId", code: "conflict",
  message: "Choose an existing activity or create a new one." }]));

export const createTripPost: UseCase<CreationDependencies, CreateTripPostPayload, CreateTripPostResult, TaggedError> = {
  execute: async ({ posts, createId, now, storage }, payload) => {
    // Storage I/O happens before the transaction: the Trip lock is never held while S3 answers.
    const member = await requireMemberBeforeStorage(posts, payload);
    if (!member.ok) return member;
    const verified = await verifyOptionalPhotoUploads(storage, { tripId: payload.tripId, userId: payload.authenticatedUserId, photos: payload.photos });
    if (!verified.ok) return verified;
    const keys = verified.value;
    return posts.withTransaction<CreateTripPostResult>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    if (payload.postId !== undefined) {
      const owner = await scope.findPostOwner(payload.postId);
      if (!owner.ok) return owner;
      if (owner.value !== undefined) return answerPostRetry(scope, payload, owner.value, keys);
    }
    const postId = payload.postId ?? createId(), createdAt = now();
    let activity: Activity | undefined;
    if (payload.newActivity !== undefined) {
      if (payload.activityId != null) return conflictingActivityLink();
      const built = await buildNewActivity(scope, trip.value, { ...payload, newActivity: payload.newActivity }, createId(), createdAt);
      if (!built.ok) return built;
      activity = built.value;
    }
    const input = { id: postId, tripId: payload.tripId, authorId: payload.authenticatedUserId,
      createdAt, description: payload.description, mapsUrl: payload.mapsUrl,
      activityId: activity?.id ?? payload.activityId, parentPostId: payload.parentPostId, transportId: payload.transportId };
    const resolved = await resolve(scope, input, activity);
    if (!resolved.ok) return resolved;
    const post = createPost(input, resolved.value);
    if (!post.ok) return post;
    const content = requirePostContent({ description: post.value.description, mapsUrl: post.value.mapsUrl, photoCount: keys?.length ?? 0 });
    if (!content.ok) return content;
    const photoPlan = keys === undefined || activity ? undefined : await planPostPhotos(scope, { tripId: payload.tripId, postId,
      uploaderId: payload.authenticatedUserId, keys, createId, uploadedAt: createdAt });
    if (photoPlan && !photoPlan.ok) return photoPlan;
    const expensePlan = await planPostExpense(scope, { tripId: payload.tripId, postId, expense: payload.expense, createId, createdAt });
    if (!expensePlan.ok) return expensePlan;
    if (!activity) {
      const saved = await scope.insert(post.value);
      if (!saved.ok) return saved;
      const photos = photoPlan && await registerPostPhotos(scope, photoPlan.value);
      if (photos && !photos.ok) return photos;
      const expense = expensePlan.value && await registerPostExpense(scope, expensePlan.value);
      if (expense && !expense.ok) return expense;
      const emitted = await emitToMembers(scope, savedNotifications({ tripId: payload.tripId, actorId: payload.authenticatedUserId, post: post.value }));
      if (!emitted.ok) return emitted;
      return ok({ outcome: "created" as const, post: post.value, ...(photos ? { photos: photos.value } : {}),
        ...(expense ? { expense: expense.value } : {}) });
    }
    const reviewed = await planAuthorAgenda(scope, payload, activity);
    if (!reviewed.ok) return reviewed;
    const { plan, records } = reviewed.value;
    // Nothing is written before a required confirmation: no activity, post or participation.
    if (plan.status === "confirmation_required") return ok({ outcome: "confirmation_required" as const,
      conflicts: plan.conflicts, activity: plan.activity });
    const activityPhotoPlan = keys === undefined ? undefined : await planPostPhotos(scope, { tripId: payload.tripId, postId,
      uploaderId: payload.authenticatedUserId, keys, createId, uploadedAt: createdAt });
    if (activityPhotoPlan && !activityPhotoPlan.ok) return activityPhotoPlan;
    const insertedActivity = await scope.insertActivity(activity);
    if (!insertedActivity.ok) return insertedActivity;
    const inserted = await scope.insert(post.value);
    if (!inserted.ok) return inserted;
    const photos = activityPhotoPlan && await registerPostPhotos(scope, activityPhotoPlan.value);
    if (photos && !photos.ok) return photos;
    const expense = expensePlan.value && await registerPostExpense(scope, expensePlan.value);
    if (expense && !expense.ok) return expense;
    const participation = await applyAuthorPlan(scope, { activity, userId: payload.authenticatedUserId, tripId: payload.tripId,
      conflicts: plan.conflicts, records, createId, updatedAt: createdAt });
    if (!participation.ok) return participation;
    const emitted = await emitToMembers(scope, savedNotifications({ tripId: payload.tripId, actorId: payload.authenticatedUserId, post: post.value, activity }));
    if (!emitted.ok) return emitted;
    return ok({ outcome: "created" as const, post: post.value, activity, participation: participation.value,
      ...(photos ? { photos: photos.value } : {}), ...(expense ? { expense: expense.value } : {}) });
    });
  },
};

/** Creates a spontaneous activity for an existing post (T55 exclusive link applies); the post keeps its publication time. */
export const linkTripPostToNewActivity: UseCase<CreationDependencies, LinkTripPostToNewActivityPayload, LinkTripPostToNewActivityResult, TaggedError> = {
  execute: async ({ posts, createId, now, storage }, payload) => {
    const member = await requireAuthorBeforeStorage(posts, payload);
    if (!member.ok) return member;
    const verified = await verifyOptionalPhotoUploads(storage, { tripId: payload.tripId, userId: payload.authenticatedUserId, photos: payload.photos });
    if (!verified.ok) return verified;
    const keys = verified.value;
    return posts.withTransaction<LinkTripPostToNewActivityResult>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    if (!current.ok) return current;
    const author = requireAuthor(current.value, payload);
    if (!author.ok) return author;
    if (payload.activityId != null) return conflictingActivityLink();
    const wantedActivityId = payload.newActivity.id;
    if (wantedActivityId !== undefined) {
      if (current.value.activityId === wantedActivityId) return answerLinkRetry(scope, payload, current.value, keys);
      const taken = await scope.listActivities();
      if (!taken.ok) return taken;
      const occupant = taken.value.find((candidate) => candidate.id === wantedActivityId);
      // Own activity of this Trip that the post no longer points to (relinked by someone else): the save already happened.
      if (occupant !== undefined) return occupant.tripId === payload.tripId && occupant.createdBy === payload.authenticatedUserId
        ? alreadySaved(payload.postId) : requestConflict();
    }
    const createdAt = now();
    const built = await buildNewActivity(scope, trip.value, payload, wantedActivityId ?? createId(), createdAt);
    if (!built.ok) return built;
    const activity = built.value;
    const fields = ["description", "mapsUrl", "parentPostId", "transportId"] as const;
    const supplied = fields.filter((field) => Object.hasOwn(payload, field) && payload[field] !== undefined);
    const merged: Post = { ...current.value, ...Object.fromEntries(supplied.map((field) => [field, payload[field]])), activityId: activity.id };
    const resolved = await resolve(scope, merged, activity);
    if (!resolved.ok) return resolved;
    const post = relinkPost(merged, {}, resolved.value);
    if (!post.ok) return post;
    if (supplied.includes("description") || supplied.includes("mapsUrl")) {
      const content = await requireSavedContent(scope, post.value, keys?.length ?? 0);
      if (!content.ok) return content;
    }
    const expensePlan = await planPostExpense(scope, { tripId: payload.tripId, postId: payload.postId, expense: payload.expense, createId, createdAt });
    if (!expensePlan.ok) return expensePlan;
    const reviewed = await planAuthorAgenda(scope, payload, activity);
    if (!reviewed.ok) return reviewed;
    const { plan, records } = reviewed.value;
    if (plan.status === "confirmation_required") return ok({ outcome: "confirmation_required" as const,
      conflicts: plan.conflicts, activity: plan.activity });
    const photoPlan = keys === undefined ? undefined : await planPostPhotos(scope, { tripId: payload.tripId, postId: payload.postId,
      uploaderId: payload.authenticatedUserId, keys, createId, uploadedAt: createdAt });
    if (photoPlan && !photoPlan.ok) return photoPlan;
    const insertedActivity = await scope.insertActivity(activity);
    if (!insertedActivity.ok) return insertedActivity;
    const replaced = await scope.replace(post.value);
    if (!replaced.ok) return replaced;
    const photos = photoPlan && await registerPostPhotos(scope, photoPlan.value);
    if (photos && !photos.ok) return photos;
    const expense = expensePlan.value && await registerPostExpense(scope, expensePlan.value);
    if (expense && !expense.ok) return expense;
    const participation = await applyAuthorPlan(scope, { activity, userId: payload.authenticatedUserId, tripId: payload.tripId,
      conflicts: plan.conflicts, records, createId, updatedAt: createdAt });
    if (!participation.ok) return participation;
    // The post already existed (and was announced when it was published): only the new activity is an event.
    const emitted = await emitToMembers(scope, savedNotifications({ tripId: payload.tripId, actorId: payload.authenticatedUserId, activity }));
    if (!emitted.ok) return emitted;
    return ok({ outcome: "linked" as const, post: post.value, activity, participation: participation.value,
      ...(photos ? { photos: photos.value } : {}), ...(expense ? { expense: expense.value } : {}) });
    });
  },
};

export const listTripPosts: UseCase<Dependencies, TripPostPayload, Post[], TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const result = await scope.list();
    return result.ok ? ok(result.value.filter((p) => p.tripId === payload.tripId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))) : result;
  }),
};

export const getTripPost: UseCase<Dependencies, PostDetailPayload, Post, TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    return trip.ok ? find(scope, payload) : trip;
  }),
};

export const getTripPostChain: UseCase<Dependencies, PostDetailPayload, TripPostChainResult, TaggedError> = {
  execute: ({ posts }, payload) => posts.withReadSnapshot(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const post = await find(scope, payload);
    if (!post.ok) return post;
    const children = await scope.listChildren(post.value.id);
    if (!children.ok) return children;
    const loaded = post.value.parentPostId === null ? ok({ posts: [] as Post[], truncated: false })
      : await loadAncestors(scope, payload.tripId, post.value.parentPostId);
    if (!loaded.ok) return loaded;
    const ancestors = { ok: true as const, value: loaded.value.posts };
    const byId = new Map(ancestors.value.map((ancestor) => [ancestor.id, ancestor]));
    const chain = resolvePostChain(post.value, (id) => byId.get(id));
    const expense = await scope.findExpense(post.value.id);
    if (!expense.ok) return expense;
    const named = expense.value === undefined ? [] : [...new Set([...expense.value.payments, ...expense.value.shares].map((row) => row.userId))];
    const members = named.length === 0 ? ok([] as ObjectId[]) : await scope.listMemberUserIds(named);
    if (!members.ok) return members;
    return ok({ post: post.value, parent: ancestors.value[0] !== undefined && ancestors.value[0].id === post.value.parentPostId
      ? summarize(ancestors.value[0]) : null,
    children: children.value.filter((child) => child.tripId === payload.tripId && child.parentPostId === post.value.id)
      .map(summarize), rootActivityId: chain.ok ? chain.value.rootActivityId : null,
    ...(expense.value === undefined ? {} : { expense: describePostExpense(expense.value, members.value) }) });
  }),
};

/** Edits the post and/or appends photos to it (never removes or reorders them); retrying a key already in the post is a no-op. */
export const updateTripPost: UseCase<UpdateDependencies, UpdateTripPostPayload, UpdateTripPostResult, TaggedError> = {
  execute: async ({ posts, storage, createId, now }, payload) => {
    const member = await requireAuthorBeforeStorage(posts, payload);
    if (!member.ok) return member;
    const verified = await verifyOptionalPhotoUploads(storage, { tripId: payload.tripId, userId: payload.authenticatedUserId, photos: payload.photos });
    if (!verified.ok) return verified;
    const keys = verified.value;
    if ((keys !== undefined || payload.expense !== undefined) && (createId === undefined || now === undefined)) {
      return err(new UnknownError("Photo and expense registration is not configured."));
    }
    return posts.withTransaction<UpdateTripPostResult>(payload.tripId, async (scope) => {
    const trip = await authorize(scope, payload);
    if (!trip.ok) return trip;
    const current = await find(scope, payload);
    if (!current.ok) return current;
    const author = requireAuthor(current.value, payload);
    if (!author.ok) return author;
    const fields = ["description", "mapsUrl", "activityId", "parentPostId", "transportId"] as const;
    const supplied = fields.filter((field) => Object.hasOwn(payload, field) && payload[field] !== undefined);
    if (supplied.length === 0 && keys === undefined && payload.expense === undefined) {
      return err(new ValidationError([{ field: "post", code: "required", message: "An editable field is required." }]));
    }
    const merged: Post = { ...current.value, ...Object.fromEntries(supplied.map((field) => [field, payload[field]])) };
    const resolved = await resolve(scope, merged);
    if (!resolved.ok) return resolved;
    const post = relinkPost(merged, {}, resolved.value);
    if (!post.ok) return post;
    const parentId = post.value.parentPostId;
    if (parentId !== null && parentId !== current.value.parentPostId && parentId !== post.value.id) {
      // Same scope as the write: the Trip lock serializes concurrent link edits.
      const ancestors = await loadAncestors(scope, payload.tripId, parentId);
      if (!ancestors.ok) return ancestors;
      if (ancestors.value.posts.some((ancestor) => ancestor.id === post.value.id)) {
        return err(new ValidationError([{ field: "parentPostId", code: "cycle", message: "Post cannot become a descendant of itself." }]));
      }
      if (ancestors.value.truncated) {
        return err(new ValidationError([{ field: "parentPostId", code: "too_deep", message: "Post chain exceeds the supported depth." }]));
      }
    }
    if (supplied.includes("description") || supplied.includes("mapsUrl")) {
      const content = await requireSavedContent(scope, post.value, keys?.length ?? 0);
      if (!content.ok) return content;
    }
    const photoPlan = keys === undefined ? undefined : await planPostPhotos(scope, { tripId: payload.tripId, postId: payload.postId,
      uploaderId: payload.authenticatedUserId, keys, createId: createId!, uploadedAt: now!() });
    if (photoPlan && !photoPlan.ok) return photoPlan;
    const expensePlan = payload.expense === undefined ? ok(undefined)
      : await planPostExpense(scope, { tripId: payload.tripId, postId: payload.postId, expense: payload.expense, createId: createId!, createdAt: now!() });
    if (!expensePlan.ok) return expensePlan;
    // A photos-only or expense-only edit leaves the stored post untouched.
    if (supplied.length > 0) {
      const saved = await scope.replace(post.value);
      if (!saved.ok) return saved;
    }
    const photos = photoPlan && await registerPostPhotos(scope, photoPlan.value);
    if (photos && !photos.ok) return photos;
    const expense = expensePlan.value && await registerPostExpense(scope, expensePlan.value);
    if (expense && !expense.ok) return expense;
    return ok(photos || expense ? { ...post.value, ...(photos ? { photos: photos.value } : {}), ...(expense ? { expense: expense.value } : {}) } : post.value);
    });
  },
};
