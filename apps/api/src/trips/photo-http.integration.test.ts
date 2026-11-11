import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { handleApiRequest } from "../app.js";
import { PostFixture, domainId } from "../../test/post-fixture.js";
import { FakeObjectStorage } from "../../test/fake-object-storage.js";

describe("photo protocol HTTP API", () => {
  const f = new PostFixture();
  let fake: FakeObjectStorage;
  beforeAll(() => f.start("photo_http"), 120_000);
  afterAll(() => f.stop());
  beforeEach(async () => { vi.restoreAllMocks(); fake = new FakeObjectStorage(); f.storage = fake; await f.reset(); });

  const jpeg = { contentType: "image/jpeg", sizeBytes: 1000 };
  const body = (response: { body?: string }) => JSON.parse(response.body ?? "null");
  const addMember = async (role: "admin" | "participant" = "participant", tripId = f.trip) => {
    const userId = new ObjectId();
    await f.db.collection("tripMembers").insertOne({ tripId, userId, role, joinedAt: new Date() });
    return userId;
  };
  const addTrip = async () => {
    const tripId = new ObjectId(), member = new ObjectId();
    await f.db.collection("trips").insertOne({ _id: tripId, inviteCode: tripId.toHexString(), visibility: "public", votingEnabled: false, expenseMode: "register" });
    await f.db.collection("tripMembers").insertOne({ tripId, userId: member, role: "participant", joinedAt: new Date() });
    return { tripId, member };
  };
  const reserve = async (files: unknown[] = [jpeg], user = f.actor, trip = f.trip) => {
    const response = await f.request("POST", `/trips/${trip}/photo-uploads`, { files }, user);
    expect(response.statusCode, response.body).toBe(201);
    return body(response).uploads as Array<{ key: string; uploadUrl: string; headers: Record<string, string>; expiresAt: string }>;
  };
  /** Reserve and upload `count` jpeg files, returning the keys. */
  const uploaded = async (count = 1, user = f.actor, trip = f.trip) => {
    const uploads = await reserve(Array.from({ length: count }, () => jpeg), user, trip);
    for (const upload of uploads) fake.put(upload.key);
    return uploads.map((upload) => upload.key);
  };
  const refs = (keys: string[]) => keys.map((key) => ({ key }));
  const publish = (keys: string[], fields: object = {}, user = f.actor, trip = f.trip) =>
    f.request("POST", `/trips/${trip}/posts`, { description: "Fotos", photos: refs(keys), ...fields }, user);
  const saved = async (keys: string[], fields: object = {}, user = f.actor, trip = f.trip) => {
    const response = await publish(keys, fields, user, trip);
    expect(response.statusCode, response.body).toBe(201);
    return body(response) as { post: { id: string }; photos: Array<{ id: string; order: number }> };
  };
  /** `[status, error code]` that never throws on a success body, so a failing assertion names the real status. */
  const outcome = (response: { statusCode: number; body?: string }) => [response.statusCode, body(response)?.error?.code];
  const fields = (response: { body?: string }) => body(response).error.fields.map((issue: { field: string; code: string }) => `${issue.field}/${issue.code}`);
  const data = async () => Promise.all(["posts", "postPhotos", "activities", "activityParticipations"]
    .map((name) => f.db.collection(name).find().sort({ _id: 1 }).toArray()));
  const expel = async (admin: ObjectId, target = f.actor) => {
    if (target === f.actor) await f.releaseOwnership();
    return f.api.expelMember!({ tripId: domainId(f.trip), actorUserId: domainId(admin), targetUserId: domainId(target) });
  };
  const photoView = ["expiresAt", "id", "order", "postId", "uploadedAt", "uploaderId", "url"];

  describe("authentication, ids and membership", () => {
    const routes = (photoId = new ObjectId().toHexString()) => [
      ["POST", `/trips/${f.trip}/photo-uploads`, { files: [jpeg] }],
      ["GET", `/trips/${f.trip}/posts/${new ObjectId()}/photos`, undefined],
      ["GET", `/trips/${f.trip}/photos/${photoId}`, undefined],
    ] as const;

    it("answers 401 without an authenticated user", async () => {
      for (const [method, url, payload] of routes()) {
        const response = await handleApiRequest({ method, url, body: payload }, { trips: f.api });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it("answers 400 for malformed ids and bodies", async () => {
      expect((await f.request("POST", "/trips/nope/photo-uploads", { files: [jpeg] })).statusCode).toBe(400);
      expect((await f.request("GET", `/trips/nope/posts/${new ObjectId()}/photos`)).statusCode).toBe(400);
      expect((await f.request("GET", `/trips/${f.trip}/posts/nope/photos`)).statusCode).toBe(400);
      expect((await f.request("GET", "/trips/nope/photos/" + new ObjectId())).statusCode).toBe(400);
      expect((await f.request("GET", `/trips/${f.trip}/photos/nope`)).statusCode).toBe(400);
      expect((await f.request("POST", `/trips/${f.trip}/photo-uploads`, "not json")).statusCode).toBe(400);
      expect((await f.request("POST", `/trips/${f.trip}/photo-uploads`, [1])).statusCode).toBe(400);
    });

    it("answers 404 TripNotFoundError to a user who is not a member, and to a former member", async () => {
      const keys = await uploaded(1), post = await saved(keys), stranger = new ObjectId(), admin = await addMember("admin");
      const check = async (user: ObjectId) => {
        for (const response of [
          await f.request("POST", `/trips/${f.trip}/photo-uploads`, { files: [jpeg] }, user),
          await f.request("GET", `/trips/${f.trip}/posts/${post.post.id}/photos`, undefined, user),
          await f.request("GET", `/trips/${f.trip}/photos/${post.photos[0]!.id}`, undefined, user),
        ]) {
          expect(outcome(response), response.body).toEqual([404, "TripNotFoundError"]);
        }
      };
      await check(stranger);
      expect((await expel(admin)).ok).toBe(true);
      await check(f.actor);
    });

    it("answers 404 PostNotFoundError and PhotoNotFoundError for unknown resources of the Trip", async () => {
      const missingPost = await f.request("GET", `/trips/${f.trip}/posts/${new ObjectId()}/photos`);
      expect(outcome(missingPost)).toEqual([404, "PostNotFoundError"]);
      const missingPhoto = await f.request("GET", `/trips/${f.trip}/photos/${new ObjectId()}`);
      expect(outcome(missingPhoto)).toEqual([404, "PhotoNotFoundError"]);
    });
  });

  describe("batch authorization", () => {
    it("returns 201 with one signed PUT per file on a fresh key under the user's prefix of the Trip", async () => {
      const response = await f.request("POST", `/trips/${f.trip}/photo-uploads`, { files: [jpeg, { contentType: "image/webp", sizeBytes: 2000 }] });
      expect(response.statusCode, response.body).toBe(201);
      const { uploads } = body(response);
      expect(uploads).toHaveLength(2);
      const pattern = (ext: string) => new RegExp(`^trips/${f.trip}/photos/${f.actor}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${ext}$`);
      expect(uploads[0].key).toMatch(pattern("jpg")); expect(uploads[1].key).toMatch(pattern("webp"));
      expect(uploads[0]).toEqual({ key: uploads[0].key, uploadUrl: `https://s3.test/put/${uploads[0].key}?expires=900`,
        headers: { "content-type": "image/jpeg" }, expiresAt: "2026-11-09T10:15:00.000Z" });
      expect(fake.uploads).toEqual([
        { objectKey: uploads[0].key, contentType: "image/jpeg", expiresInSeconds: 900, contentLength: 1000 },
        { objectKey: uploads[1].key, contentType: "image/webp", expiresInSeconds: 900, contentLength: 2000 }]);
    });

    it("issues new keys on every call and writes nothing to the database", async () => {
      const before = await data(), revision = (await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision;
      const [first] = await reserve(), [second] = await reserve();
      expect(first!.key).not.toBe(second!.key);
      expect(await data()).toEqual(before);
      expect((await f.db.collection("trips").findOne({ _id: f.trip }))!.destinationOrderRevision).toBe(revision);
      expect(await f.db.collection("storageDeletionJobs").countDocuments({})).toBe(0);
    });

    it("answers 422 with every failing field and signs nothing", async () => {
      const cases: Array<[unknown, string[]]> = [
        [undefined, ["files/required"]], [[], ["files/required"]],
        [Array.from({ length: 11 }, () => jpeg), ["files/too_many"]],
        [[{ contentType: "image/heic", sizeBytes: 5 }, { contentType: "image/png", sizeBytes: 0 }, { contentType: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 }],
          ["files[0].contentType/unsupported", "files[1].sizeBytes/invalid", "files[2].sizeBytes/too_large"]],
      ];
      for (const [files, expected] of cases) {
        const response = await f.request("POST", `/trips/${f.trip}/photo-uploads`, files === undefined ? {} : { files });
        expect(outcome(response)).toEqual([422, "ValidationError"]);
        expect(fields(response)).toEqual(expected);
      }
      expect(fake.uploads).toEqual([]);
    });

    it("accepts a batch of exactly 10 files", async () => {
      expect(await reserve(Array.from({ length: 10 }, () => jpeg))).toHaveLength(10);
    });
  });

  describe("finishing the photos with the post save", () => {
    it("answers exactly as before when no photos are sent, without touching the storage", async () => {
      const created = await f.request("POST", f.path(), { description: "Sin fotos" });
      expect(created.statusCode).toBe(201);
      expect(Object.keys(body(created))).toEqual(["post"]);
      const edited = await f.request("PATCH", `${f.path()}/${body(created).post.id}`, { description: "Editado" });
      expect(edited.statusCode).toBe(200);
      expect(Object.keys(body(edited))).toEqual(["post"]);
      expect(fake.heads).toEqual([]);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
    });

    it("creates the post with its photos in order and stores exactly the PRD fields", async () => {
      const keys = await uploaded(3);
      const response = await publish(keys);
      expect(response.statusCode, response.body).toBe(201);
      const { post, photos } = body(response);
      expect(Object.keys(body(response)).sort()).toEqual(["photos", "post"]);
      expect(photos.map((photo: { order: number }) => photo.order)).toEqual([1, 2, 3]);
      const stored = await f.db.collection("postPhotos").find().sort({ order: 1 }).toArray();
      expect(stored.map((doc) => doc.s3Key)).toEqual(keys);
      for (const [index, doc] of stored.entries()) {
        expect(Object.keys(doc).sort()).toEqual(["_id", "order", "postId", "s3Key", "tripId", "uploadedAt", "uploaderId"]);
        expect(doc).toMatchObject({ postId: new ObjectId(post.id), tripId: f.trip, uploaderId: f.actor, order: index + 1 });
        expect(doc._id).toBeInstanceOf(ObjectId); expect(doc.uploadedAt).toBeInstanceOf(Date);
        expect(doc._id.toHexString()).toBe(photos[index].id);
      }
      expect(JSON.stringify(body(response))).not.toContain("trips/");
    });

    it("lists every failure and saves neither post nor photos for invalid confirmations", async () => {
      const [mine] = await uploaded(1), { tripId: otherTrip, member: otherMember } = await addTrip(), other = await addMember("participant");
      const [theirs] = await uploaded(1, other), [foreignTrip] = await uploaded(1, otherMember, otherTrip);
      const [missing] = await reserve(), [big] = await reserve(), [text] = await reserve(), [mismatch] = await reserve();
      fake.put(big!.key, "image/jpeg", 10 * 1024 * 1024 + 1); fake.put(text!.key, "text/plain"); fake.put(mismatch!.key, "image/png");
      const before = await data();
      const cases: Array<[string[], string[]]> = [
        [[theirs!], ["photos[0].key/invalid"]],
        [[foreignTrip!], ["photos[0].key/invalid"]],
        [["avatars/" + f.actor + "/x.jpg", mine!.replace("jpg", "gif")], ["photos[0].key/invalid", "photos[1].key/invalid"]],
        [[mine!, mine!], ["photos[1].key/duplicate"]],
        [[missing!.key, mine!, big!.key, text!.key, mismatch!.key], ["photos[0].key/not_uploaded", "photos[2].key/too_large",
          "photos[3].key/content_type_mismatch", "photos[4].key/content_type_mismatch"]],
      ];
      for (const [keys, expected] of cases) {
        const response = await publish(keys);
        expect(outcome(response), response.body).toEqual([422, "ValidationError"]);
        expect(fields(response)).toEqual(expected);
        expect(await data()).toEqual(before);
      }
      for (const photos of ["x", null, [], [{}], [{ key: 3 }]]) {
        expect((await f.request("POST", f.path(), { description: "x", photos })).statusCode).toBe(422);
      }
      expect(await data()).toEqual(before);
      expect((await f.request("POST", f.path(), { description: "x", photos: refs(Array.from({ length: 11 }, () => mine!)) })).statusCode).toBe(422);
    });

    it("answers 500 and writes nothing when the storage check fails for another reason than a missing object", async () => {
      const keys = await uploaded(2); fake.failHeadFor.add(keys[1]!);
      const before = await data();
      const response = await publish(keys);
      expect(outcome(response)).toEqual([500, "InternalError"]);
      expect(await data()).toEqual(before);
    });

    it("appends photos with PATCH after the existing ones, also with only photos, without changing the post", async () => {
      const first = await uploaded(2), post = await saved(first, { description: "Original", mapsUrl: "Maps" });
      const more = await uploaded(2);
      const response = await f.request("PATCH", `${f.path()}/${post.post.id}`, { photos: refs(more) });
      expect(response.statusCode, response.body).toBe(200);
      const patched = body(response);
      expect(patched.post).toMatchObject({ id: post.post.id, description: "Original", mapsUrl: "Maps" });
      expect(patched.photos.map((photo: { order: number }) => photo.order)).toEqual([1, 2, 3, 4]);
      expect(patched.photos.slice(0, 2)).toEqual(post.photos);
      const stored = await f.db.collection("postPhotos").find({ postId: new ObjectId(post.post.id) }).sort({ order: 1 }).toArray();
      expect(stored.map((doc) => doc.s3Key)).toEqual([...first, ...more]);
      const get = body(await f.request("GET", `${f.path()}/${post.post.id}`));
      expect(get.post).toEqual(patched.post);
    });

    it("caps a post at 10 photos across saves", async () => {
      const post = await saved(await uploaded(9)), extra = await uploaded(2), before = await data();
      const response = await f.request("PATCH", `${f.path()}/${post.post.id}`, { photos: refs(extra) });
      expect(response.statusCode).toBe(422);
      expect(fields(response)).toEqual(["photos/too_many"]);
      expect(await data()).toEqual(before);
      expect((await f.request("PATCH", `${f.path()}/${post.post.id}`, { photos: refs(extra.slice(0, 1)) })).statusCode).toBe(200);
    });

    it("retries without duplicating: the same key in the same post is a no-op and a repeated POST answers 409", async () => {
      const keys = await uploaded(2), post = await saved(keys);
      const retry = await f.request("PATCH", `${f.path()}/${post.post.id}`, { photos: refs([...keys].reverse()) });
      expect(retry.statusCode, retry.body).toBe(200);
      expect(body(retry).photos).toEqual(post.photos);
      const again = await publish(keys);
      expect(outcome(again)).toEqual([409, "PhotoConflictError"]);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(2);
      expect(await f.db.collection("posts").countDocuments({})).toBe(1);
    });

    it("answers 409 PhotoConflictError when a key is registered in another post, writing nothing", async () => {
      const keys = await uploaded(1), post = await saved(keys);
      const second = await f.request("POST", f.path(), { description: "Otro" });
      const secondId = body(second).post.id, before = await data();
      const response = await f.request("PATCH", `${f.path()}/${secondId}`, { photos: refs(keys) });
      expect(outcome(response)).toEqual([409, "PhotoConflictError"]);
      expect(await data()).toEqual(before);
      expect(post.photos).toHaveLength(1);
    });

    it("answers 409 PhotoConflictError when the unique index (11000) fires on insert, and writes nothing", async () => {
      const keys = await uploaded(1);
      await saved(keys);
      const before = await data();
      // The planning lookup is blinded, so only the unique s3Key index can detect the duplicate.
      const collection = f.db.collection("postPhotos"), original = f.db.collection.bind(f.db);
      const real = (collection.find as (...args: unknown[]) => unknown).bind(collection);
      vi.spyOn(collection, "find").mockImplementation(((filter: Record<string, unknown> | undefined, ...rest: unknown[]) =>
        real(filter !== undefined && "s3Key" in filter ? { _id: { $in: [] } } : filter, ...rest)) as never);
      const insert = vi.spyOn(collection, "insertOne");
      vi.spyOn(f.db, "collection").mockImplementation((key, options) => key === "postPhotos" ? collection : original(key, options));
      const response = await publish(keys);
      expect(outcome(response), response.body).toEqual([409, "PhotoConflictError"]);
      expect(insert).toHaveBeenCalledTimes(1);
      expect(await data()).toEqual(before);
    });

    it("answers 404 when the post does not exist and when the actor is no longer a member", async () => {
      const keys = await uploaded(1), admin = await addMember("admin");
      const missing = await f.request("PATCH", `${f.path()}/${new ObjectId()}`, { photos: refs(keys) });
      expect(outcome(missing)).toEqual([404, "PostNotFoundError"]);
      expect((await expel(admin)).ok).toBe(true);
      const denied = await publish(keys);
      expect(outcome(denied)).toEqual([404, "TripNotFoundError"]);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    it("answers 404 and writes no photos when the member is expelled between the object check and the save", async () => {
      const keys = await uploaded(1), admin = await addMember("admin");
      let expelled = false;
      fake.afterHead = async () => { if (!expelled) { expelled = true; expect((await expel(admin)).ok).toBe(true); } };
      const response = await publish(keys);
      expect(outcome(response)).toEqual([404, "TripNotFoundError"]);
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    it("answers 404 TripNotFoundError to a non-member and a former member with valid photos of their own prefix, never calling the storage", async () => {
      const mine = await uploaded(1), post = await saved(await uploaded(1)), admin = await addMember("admin");
      const stranger = new ObjectId(), strangerKey = `trips/${f.trip}/photos/${stranger}/00000000-0000-4000-8000-0000000000aa.jpg`;
      fake.put(strangerKey);
      const newActivity = { title: "Cena", scheduledAt: "2026-09-25T12:00:00.456Z", durationMinutes: 60 };
      const before = await data();
      fake.heads.length = 0; // the setup save above legitimately inspected its own object
      const attempt = async (user: ObjectId, keys: string[]) => {
        for (const response of [await publish(keys, {}, user),
          await f.request("PATCH", `${f.path()}/${post.post.id}`, { photos: refs(keys) }, user),
          await f.request("PATCH", `${f.path()}/${post.post.id}`, { newActivity, photos: refs(keys) }, user)]) {
          expect(outcome(response), response.body).toEqual([404, "TripNotFoundError"]);
        }
      };
      await attempt(stranger, [strangerKey]);
      expect((await expel(admin)).ok).toBe(true);
      await attempt(f.actor, mine);
      expect(fake.heads).toEqual([]);
      expect(await data()).toEqual(before);
    });

    it("answers 404 (not 500) to a non-member with photos when the Trip API has no storage", async () => {
      f.storage = undefined; await f.reset();
      const stranger = new ObjectId(), key = `trips/${f.trip}/photos/${stranger}/00000000-0000-4000-8000-0000000000bb.jpg`;
      const response = await publish([key], {}, stranger);
      expect(outcome(response), response.body).toEqual([404, "TripNotFoundError"]);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
    });

    describe("with a new activity", () => {
      const newActivity = { title: "Cena", scheduledAt: "2026-09-25T12:00:00.456Z", durationMinutes: 60 };
      const seedConflict = async () => {
        const created = await f.api.createActivity!({ ...f.context(), dayId: domainId(f.day), title: "Plan", scheduledAt: new Date("2026-09-25T12:30:00Z"), durationMinutes: 60 });
        if (!created.ok || created.value.outcome !== "created") throw new Error("seed failed");
        return created.value.activity.id;
      };

      it("publishes post, activity, participation and photos together on POST", async () => {
        const keys = await uploaded(2);
        const response = await publish(keys, { newActivity });
        expect(response.statusCode, response.body).toBe(201);
        expect(Object.keys(body(response)).sort()).toEqual(["activity", "participation", "photos", "post"]);
        expect(body(response).photos.map((photo: { order: number }) => photo.order)).toEqual([1, 2]);
        expect(await f.db.collection("postPhotos").countDocuments({})).toBe(2);
      });

      it("answers 409 without any write on an agenda conflict and saves the photos after the confirmation", async () => {
        await seedConflict();
        const keys = await uploaded(1), before = await data();
        const conflict = await publish(keys, { newActivity });
        expect(outcome(conflict)).toEqual([409, "ParticipationConflictError"]);
        expect(await data()).toEqual(before);
        expect(await f.db.collection("postPhotos").countDocuments({})).toBe(0);
        const { conflicts, activity } = body(conflict).error;
        const confirmed = await publish(keys, { newActivity, confirmedConflicts: conflicts, confirmedActivity: activity });
        expect(confirmed.statusCode, confirmed.body).toBe(201);
        expect(await f.db.collection("postPhotos").countDocuments({})).toBe(1);
      });

      it("links an existing post to a new activity on PATCH adding photos, and answers 409 without writes on conflict", async () => {
        const post = await saved(await uploaded(1)), more = await uploaded(1);
        await seedConflict();
        const before = await data();
        const conflict = await f.request("PATCH", `${f.path()}/${post.post.id}`, { newActivity, photos: refs(more) });
        expect(outcome(conflict)).toEqual([409, "ParticipationConflictError"]);
        expect(await data()).toEqual(before);
        const { conflicts, activity } = body(conflict).error;
        const linked = await f.request("PATCH", `${f.path()}/${post.post.id}`, { newActivity, photos: refs(more), confirmedConflicts: conflicts, confirmedActivity: activity });
        expect(linked.statusCode, linked.body).toBe(200);
        expect(Object.keys(body(linked)).sort()).toEqual(["activity", "participation", "photos", "post"]);
        expect(body(linked).photos.map((photo: { order: number }) => photo.order)).toEqual([1, 2]);
      });
    });
  });

  describe("signed reads", () => {
    it("serves the photos of a post in order with a 300 s GET URL and no S3 key", async () => {
      const keys = await uploaded(3), post = await saved(keys);
      const response = await f.request("GET", `${f.path()}/${post.post.id}/photos`);
      expect(response.statusCode, response.body).toBe(200);
      const { photos } = body(response);
      expect(photos.map((photo: { order: number }) => photo.order)).toEqual([1, 2, 3]);
      for (const [index, photo] of photos.entries()) {
        expect(Object.keys(photo).sort()).toEqual(photoView);
        expect(photo).toMatchObject({ id: post.photos[index]!.id, postId: post.post.id, uploaderId: f.actor.toHexString(),
          url: `https://s3.test/get/${keys[index]}?expires=300` });
        expect(Date.parse(photo.expiresAt)).toBeGreaterThan(Date.now());
        expect(Date.parse(photo.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
      }
      expect(fake.downloads).toEqual(keys.map((objectKey) => ({ objectKey, expiresInSeconds: 300 })));
      expect(JSON.stringify(photos)).not.toContain("s3Key");
    });

    it("serves one photo by id and never persists the URL", async () => {
      const keys = await uploaded(1), post = await saved(keys);
      const response = await f.request("GET", `/trips/${f.trip}/photos/${post.photos[0]!.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect(Object.keys(body(response)).sort()).toEqual(["photo"]);
      expect(Object.keys(body(response).photo).sort()).toEqual(photoView);
      expect(JSON.stringify(await f.db.collection("postPhotos").find().toArray())).not.toContain("s3.test");
    });

    it("returns an empty list for a post without photos", async () => {
      const created = body(await f.request("POST", f.path(), { description: "Sin fotos" }));
      expect(body(await f.request("GET", `${f.path()}/${created.post.id}/photos`))).toEqual({ photos: [] });
    });

    it("denies cross-Trip access: a member of A cannot reach the photo or the post of B through A or B", async () => {
      const { tripId: tripB, member: memberB } = await addTrip();
      const post = await saved(await uploaded(1, memberB, tripB), {}, memberB, tripB);
      const photoId = post.photos[0]!.id;
      const check = async (url: string, status: number, code: string) => {
        const response = await f.request("GET", url);
        expect(outcome(response), url).toEqual([status, code]);
      };
      await check(`/trips/${f.trip}/photos/${photoId}`, 404, "PhotoNotFoundError");
      await check(`/trips/${tripB}/photos/${photoId}`, 404, "TripNotFoundError");
      await check(`/trips/${f.trip}/posts/${post.post.id}/photos`, 404, "PostNotFoundError");
      await check(`/trips/${tripB}/posts/${post.post.id}/photos`, 404, "TripNotFoundError");
      expect((await f.request("POST", `/trips/${tripB}/photo-uploads`, { files: [jpeg] })).statusCode).toBe(404);
      expect(fake.downloads).toEqual([]);
      const own = await f.request("GET", `/trips/${tripB}/photos/${photoId}`, undefined, memberB);
      expect(own.statusCode).toBe(200);
    });

    it("keeps serving a former member's photos to current members while denying the former member, with 300 s URLs", async () => {
      const admin = await addMember("admin"), keys = await uploaded(1), post = await saved(keys);
      expect((await expel(admin)).ok).toBe(true);
      const list = await f.request("GET", `${f.path()}/${post.post.id}/photos`, undefined, admin);
      expect(list.statusCode, list.body).toBe(200);
      expect(body(list).photos[0]).toMatchObject({ uploaderId: f.actor.toHexString(), url: `https://s3.test/get/${keys[0]}?expires=300` });
      expect((await f.request("GET", `/trips/${f.trip}/photos/${post.photos[0]!.id}`, undefined, admin)).statusCode).toBe(200);
      expect((await f.request("GET", `${f.path()}/${post.post.id}/photos`)).statusCode).toBe(404);
      expect((await f.request("GET", `/trips/${f.trip}/photos/${post.photos[0]!.id}`)).statusCode).toBe(404);
      expect(fake.downloads).toHaveLength(2);
    });
  });

  describe("group gallery (GET /trips/:tripId/photos)", () => {
    const url = (query = "", trip: ObjectId = f.trip) => `/trips/${trip}/photos${query}`;
    const get = (query = "", user = f.actor, trip: ObjectId = f.trip) => f.request("GET", url(query, trip), undefined, user);
    const entry = ["expiresAt", "id", "order", "post", "postId", "uploadedAt", "uploaderId", "url"];
    const withActivity = { newActivity: { title: "Cena", scheduledAt: "2026-09-25T12:00:00.456Z", durationMinutes: 60 } };

    it("answers 200 with the exact body: photos with their post data, the signed URL and an explicit null cursor", async () => {
      const keys = await uploaded(2), post = await saved(keys);
      const response = await get();
      expect(response.statusCode, response.body).toBe(200);
      const result = body(response);
      expect(Object.keys(result).sort()).toEqual(["nextCursor", "photos"]);
      expect(result.nextCursor).toBeNull();
      expect(result.photos).toHaveLength(2);
      for (const [index, photo] of result.photos.entries()) {
        expect(Object.keys(photo).sort()).toEqual(entry);
        expect(Object.keys(photo.post).sort()).toEqual(["authorId", "createdAt", "rootActivityId", "rootTransportId"]);
        expect(photo).toMatchObject({ id: post.photos[index]!.id, postId: post.post.id, order: index + 1, uploaderId: f.actor.toHexString(),
          url: `https://s3.test/get/${keys[index]}?expires=300`,
          post: { authorId: f.actor.toHexString(), rootActivityId: null, rootTransportId: null } });
      }
      expect(new Set(result.photos.map((photo: { expiresAt: string }) => photo.expiresAt)).size).toBe(1);
      expect(JSON.stringify(result)).not.toContain("s3Key");
      expect(await f.db.collection("postPhotos").countDocuments({})).toBe(2);
    });

    it("pages with limit and cursor over several posts, newest first, without duplicates", async () => {
      const first = await saved(await uploaded(2)), second = await saved(await uploaded(1)), third = await saved(await uploaded(2));
      const seen: Array<{ postId: string; order: number }> = [];
      let cursor: string | null = null, pages = 0;
      do {
        const response = await get(`?limit=2${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`);
        expect(response.statusCode, response.body).toBe(200);
        const result = body(response);
        expect(result.photos.length).toBeLessThanOrEqual(2);
        seen.push(...result.photos);
        cursor = result.nextCursor;
        pages++;
      } while (cursor !== null && pages < 10);
      expect(pages).toBe(3);
      expect(seen.map((p) => [p.postId, p.order])).toEqual([[third.post.id, 1], [third.post.id, 2], [second.post.id, 1], [first.post.id, 1], [first.post.id, 2]]);
      expect(fake.downloads).toHaveLength(5);
    });

    it("filters by the activity of a post and leaves out photos of other posts", async () => {
      const linked = body(await publish(await uploaded(1), withActivity));
      await saved(await uploaded(2));
      const response = await get(`?activityId=${linked.activity.id}`);
      expect(response.statusCode, response.body).toBe(200);
      expect(body(response).photos.map((p: { postId: string; post: { rootActivityId: string } }) => [p.postId, p.post.rootActivityId]))
        .toEqual([[linked.post.id, linked.activity.id]]);
      expect(fake.downloads).toHaveLength(1);
      expect(body(await get("?limit=60")).photos).toHaveLength(3);
    });

    it("answers 401 without a session", async () => {
      const response = await handleApiRequest({ method: "GET", url: url() }, { trips: f.api });
      expect(outcome(response)[0]).toBe(401);
    });

    it("answers 400 for a malformed Trip, activity or transport id", async () => {
      for (const target of ["/trips/nope/photos", url("?activityId=zzz"), url("?transportId=zzz"), url(`?activityId=${new ObjectId()}&transportId=1`)]) {
        const response = await f.request("GET", target);
        expect(outcome(response), target).toEqual([400, "InvalidRequest"]);
      }
      expect(fake.downloads).toEqual([]);
    });

    it("answers 404 to non-members and former members, whatever the query, without signing anything", async () => {
      const admin = await addMember("admin"), { member: stranger } = await addTrip();
      await saved(await uploaded(1));
      for (const query of ["", "?limit=0", "?cursor=x", `?activityId=${new ObjectId()}`]) {
        expect(outcome(await get(query, stranger)), query).toEqual([404, "TripNotFoundError"]);
      }
      expect((await expel(admin)).ok).toBe(true);
      expect(outcome(await get())).toEqual([404, "TripNotFoundError"]);
      expect(outcome(await get("?limit=0"))).toEqual([404, "TripNotFoundError"]);
      expect(fake.downloads).toEqual([]);
      const current = await get("", admin);
      expect(current.statusCode).toBe(200);
      expect(body(current).photos[0]).toMatchObject({ uploaderId: f.actor.toHexString() });
    });

    it("answers 404 when the activity or transport does not exist in this Trip, also when it belongs to another one", async () => {
      const { tripId: tripB, member: memberB } = await addTrip();
      const foreignActivity = new ObjectId(), foreignTransport = new ObjectId();
      await f.db.collection("activities").insertOne({ _id: foreignActivity, tripId: tripB, dayId: new ObjectId(), title: "B", scheduledAt: new Date() });
      await f.db.collection("transports").insertOne({ _id: foreignTransport, tripId: tripB, destinationId: new ObjectId() });
      await saved(await uploaded(1));
      expect(outcome(await get(`?activityId=${new ObjectId()}`))).toEqual([404, "ActivityNotFoundError"]);
      expect(outcome(await get(`?activityId=${foreignActivity}`))).toEqual([404, "ActivityNotFoundError"]);
      expect(outcome(await get(`?transportId=${new ObjectId()}`))).toEqual([404, "TransportNotFoundError"]);
      expect(outcome(await get(`?transportId=${foreignTransport}`))).toEqual([404, "TransportNotFoundError"]);
      expect((await get(`?activityId=${foreignActivity}`, memberB, tripB)).statusCode).toBe(200);
      expect(fake.downloads).toEqual([]);
    });

    it("answers 422 with the offending fields", async () => {
      await saved(await uploaded(2));
      const check = async (query: string, expected: string[]) => {
        const response = await get(query);
        expect(response.statusCode, `${query} -> ${response.body}`).toBe(422);
        expect(fields(response), query).toEqual(expected);
      };
      for (const query of ["?limit=0", "?limit=61", "?limit=abc", "?limit=1.5", "?limit=-1", "?limit="]) await check(query, ["limit/invalid"]);
      for (const query of ["?cursor=garbage", "?cursor=", `?cursor=${btoa("{}")}`]) await check(query, ["cursor/invalid"]);
      await check(`?activityId=${new ObjectId()}&transportId=${new ObjectId()}`, ["filter/conflict"]);
      await check("?limit=0&cursor=x", ["limit/invalid", "cursor/invalid"]);
      await check("?other=1", ["query/unknown_parameter"]);
      await check("?limit=1&limit=2", ["query/duplicate_parameter"]);
      expect(fake.downloads).toEqual([]);
    });

    it("rejects a cursor taken from another Trip or from another filter", async () => {
      await saved(await uploaded(3));
      const { tripId: tripB, member: memberB } = await addTrip();
      await saved(await uploaded(3, memberB, tripB), {}, memberB, tripB);
      const linked = body(await publish(await uploaded(2), withActivity));
      const mine = body(await get("?limit=1")).nextCursor as string;
      const theirs = body(await get("?limit=1", memberB, tripB)).nextCursor as string;
      const filtered = body(await get(`?limit=1&activityId=${linked.activity.id}`)).nextCursor as string;
      expect([mine, theirs, filtered].every((cursor) => typeof cursor === "string")).toBe(true);
      expect(outcome(await get(`?cursor=${encodeURIComponent(theirs)}`))).toEqual([422, "ValidationError"]);
      expect(fields(await get(`?cursor=${encodeURIComponent(theirs)}`))).toEqual(["cursor/invalid"]);
      expect(fields(await get(`?cursor=${encodeURIComponent(filtered)}`))).toEqual(["cursor/invalid"]);
      expect(fields(await get(`?cursor=${encodeURIComponent(mine)}&activityId=${linked.activity.id}`))).toEqual(["cursor/invalid"]);
      expect((await get(`?cursor=${encodeURIComponent(mine)}`)).statusCode).toBe(200);
      expect((await get(`?cursor=${encodeURIComponent(filtered)}&activityId=${linked.activity.id}`)).statusCode).toBe(200);
    });

    it("leaves the single photo and post photo reads working", async () => {
      const keys = await uploaded(1), post = await saved(keys);
      expect((await f.request("GET", `/trips/${f.trip}/photos/${post.photos[0]!.id}`)).statusCode).toBe(200);
      expect((await f.request("GET", `${f.path()}/${post.post.id}/photos`)).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
    });
  });

  describe("service wiring", () => {
    it("answers 503 when the endpoints are not wired and 500 when the Trip API has no storage", async () => {
      const unwired = { trips: { joinByCode: vi.fn() } };
      for (const [method, url, payload] of [["POST", `/trips/${f.trip}/photo-uploads`, { files: [jpeg] }],
        ["GET", `/trips/${f.trip}/posts/${new ObjectId()}/photos`, undefined], ["GET", `/trips/${f.trip}/photos/${new ObjectId()}`, undefined],
        ["GET", `/trips/${f.trip}/photos`, undefined], ["GET", `/trips/${f.trip}/photos?limit=5`, undefined]] as const) {
        const response = await handleApiRequest({ method, url, body: payload, authenticatedUserId: domainId(f.actor) }, unwired);
        expect(outcome(response), url).toEqual([503, "ServiceUnavailable"]);
      }
      f.storage = undefined; await f.reset();
      const keyless = `trips/${f.trip}/photos/${f.actor}/00000000-0000-4000-8000-000000000001.jpg`;
      for (const response of [
        await f.request("POST", `/trips/${f.trip}/photo-uploads`, { files: [jpeg] }),
        await f.request("GET", `/trips/${f.trip}/photos/${new ObjectId()}`),
        await f.request("GET", `/trips/${f.trip}/photos`),
        await f.request("POST", f.path(), { description: "x", photos: [{ key: keyless }] }),
      ]) expect(outcome(response)).toEqual([500, "InternalError"]);
      expect(await f.db.collection("posts").countDocuments({})).toBe(0);
      const plain = await f.request("POST", f.path(), { description: "Sin fotos" });
      expect(plain.statusCode).toBe(201);
    });
  });
});
