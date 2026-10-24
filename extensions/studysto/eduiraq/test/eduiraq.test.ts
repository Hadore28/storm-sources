import { expect, test } from "bun:test";
import { SourceHost } from "@storm-sources/host";
import eduiraq from "../src/index";

// everything but playback comes from the bundled catalog, so no request may go out
const host = new SourceHost({ fetch: () => Promise.reject(new Error("no network in this test")) });
host.register(eduiraq);

test("lists teachers from the catalog", async () => {
  const page = await host.list<{ id: string; subject?: string }>("eduiraq", "teachers", 1);
  expect(page.items.length).toBeGreaterThanOrEqual(10);
  expect(page.items.filter((t) => t.subject).length / page.items.length).toBeGreaterThanOrEqual(0.8);
});

test("a teacher's course, chapters and lectures", async () => {
  const [first] = (await host.list<{ id: string }>("eduiraq", "teachers", 1)).items;
  const t = await host.details<{ courses: { id: string }[] }>("eduiraq", first.id);
  expect(t.courses.map((c) => c.id)).toEqual(["2027"]);
  const chapters = await host.lectures("eduiraq", first.id, "2027");
  const lectures = chapters.flatMap((c) => c.lectures);
  expect(lectures.length).toBeGreaterThan(0);
  expect(lectures.some((l) => !l.locked)).toBe(true);
});

test("paid lectures are locked and can't be played", async () => {
  const teachers = (await host.list<{ id: string }>("eduiraq", "teachers", 1)).items;
  for (const t of teachers) {
    const locked = (await host.lectures("eduiraq", t.id, "2027")).flatMap((c) => c.lectures).find((l) => l.locked);
    if (!locked) continue;
    await expect(host.servers("eduiraq", t.id, locked.id)).rejects.toThrow();
    return;
  }
});
