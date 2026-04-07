import { Hono } from "hono";
import { createSchedule, getSchedule, pauseSchedule, resumeSchedule, deleteSchedule, type ScheduleEntry } from "../services/scheduler";

export const schedulerRoutes = new Hono();

schedulerRoutes.get("/", (c) => {
  const s = getSchedule();
  if (!s) return c.json({ ok: true, schedule: null });
  return c.json({
    ok: true,
    schedule: {
      total: s.entries.length,
      perDay: s.perDay,
      fromHour: s.fromHour,
      toHour: s.toHour,
      currentIndex: s.currentIndex,
      remaining: s.entries.length - s.currentIndex,
      status: s.status,
      daysLeft: Math.ceil((s.entries.length - s.currentIndex) / s.perDay),
      log: s.log,
    },
  });
});

schedulerRoutes.post("/create", async (c) => {
  try {
    const { entries, message, perDay, fromHour, toHour, imagePath } = await c.req.json();
    if (!entries?.length) return c.json({ ok: false, error: "Nhập danh sách" }, 400);

    const s = await createSchedule({
      entries: entries as ScheduleEntry[],
      message: message || "Chào {danh_xung} {ten}!",
      imagePath,
      perDay: perDay || 30,
      fromHour: fromHour ?? 8,
      toHour: toHour ?? 17,
    });
    return c.json({
      ok: true,
      total: s.entries.length,
      perDay: s.perDay,
      daysNeeded: Math.ceil(s.entries.length / s.perDay),
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

schedulerRoutes.post("/pause", async (c) => { await pauseSchedule(); return c.json({ ok: true }); });
schedulerRoutes.post("/resume", async (c) => { await resumeSchedule(); return c.json({ ok: true }); });
schedulerRoutes.post("/delete", async (c) => { await deleteSchedule(); return c.json({ ok: true }); });
