import { existsSync } from "fs";
import { getApi } from "./zalo";
import { ThreadType } from "zca-js";

const SCHEDULE_FILE = "./data/schedule.json";

export interface ScheduleEntry {
  tenDanhBa: string;
  danhXung: string;
  tenGoi: string;
  zaloId?: string;
  status?: "pending" | "sent" | "failed";
  error?: string;
}

export interface Schedule {
  entries: ScheduleEntry[];
  message: string;
  imagePath?: string;
  perDay: number;
  fromHour: number;
  toHour: number;
  currentIndex: number;
  status: "active" | "paused" | "done";
  log: { date: string; sent: number; failed: number }[];
}

let schedule: Schedule | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function getSchedule() { return schedule; }

export async function loadSchedule() {
  if (existsSync(SCHEDULE_FILE)) {
    try {
      schedule = await Bun.file(SCHEDULE_FILE).json();
      if (schedule && schedule.status === "active") {
        scheduleNextRun();
      }
      console.log("📅 Schedule loaded:", schedule?.entries.length, "entries, index:", schedule?.currentIndex);
    } catch {}
  }
}

async function saveSchedule() {
  if (schedule) {
    await Bun.write(SCHEDULE_FILE, JSON.stringify(schedule, null, 2));
  }
}

export async function createSchedule(data: {
  entries: ScheduleEntry[];
  message: string;
  imagePath?: string;
  perDay: number;
  fromHour: number;
  toHour: number;
}): Promise<Schedule> {
  schedule = {
    entries: data.entries.map(e => ({ ...e, status: "pending" as const })),
    message: data.message,
    imagePath: data.imagePath,
    perDay: Math.min(data.perDay, 100),
    fromHour: data.fromHour,
    toHour: data.toHour,
    currentIndex: 0,
    status: "active",
    log: [],
  };
  await saveSchedule();
  scheduleNextRun();
  return schedule;
}

export async function pauseSchedule() {
  if (schedule) {
    schedule.status = "paused";
    if (timer) { clearTimeout(timer); timer = null; }
    await saveSchedule();
  }
}

export async function resumeSchedule() {
  if (schedule && schedule.status === "paused") {
    schedule.status = "active";
    await saveSchedule();
    scheduleNextRun();
  }
}

export async function deleteSchedule() {
  schedule = null;
  if (timer) { clearTimeout(timer); timer = null; }
  if (existsSync(SCHEDULE_FILE)) {
    await Bun.write(SCHEDULE_FILE, "null");
  }
}

function scheduleNextRun() {
  if (!schedule || schedule.status !== "active") return;
  if (schedule.currentIndex >= schedule.entries.length) {
    schedule.status = "done";
    saveSchedule();
    return;
  }

  const now = new Date();
  const next = new Date();
  next.setHours(schedule.fromHour, 0, 0, 0);

  // If time already passed today, schedule for tomorrow
  if (now.getHours() >= schedule.toHour) {
    next.setDate(next.getDate() + 1);
  } else if (now >= next) {
    // Within window, run soon
    next.setTime(now.getTime() + 60000); // 1 min from now
  }

  const delay = Math.max(next.getTime() - now.getTime(), 10000);
  console.log("📅 Next run:", next.toLocaleString(), "(" + Math.round(delay / 60000) + " min)");

  if (timer) clearTimeout(timer);
  timer = setTimeout(runScheduledBatch, delay);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return 5000 + Math.random() * 5000; }

async function runScheduledBatch() {
  if (!schedule || schedule.status !== "active") return;

  const api = getApi();
  if (!api) {
    console.log("📅 Chưa đăng nhập, thử lại sau 5 phút");
    timer = setTimeout(runScheduledBatch, 300000);
    return;
  }

  const batch = schedule.entries.slice(
    schedule.currentIndex,
    schedule.currentIndex + schedule.perDay
  );

  if (!batch.length) {
    schedule.status = "done";
    await saveSchedule();
    return;
  }

  console.log("📅 Sending batch:", batch.length, "messages");
  let sent = 0, failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    const now = new Date();
    // Stop if outside time window
    if (now.getHours() >= schedule.toHour) {
      console.log("📅 Hết giờ gửi, dừng lại");
      break;
    }

    try {
      if (!entry.zaloId) {
        entry.status = "failed";
        entry.error = "Thiếu zaloId";
        failed++;
        continue;
      }

      const msg = schedule.message
        .replace(/\{danh_xung\}/g, entry.danhXung || "")
        .replace(/\{ten\}/g, entry.tenGoi || "");

      if (schedule.imagePath) {
        await api.sendMessage({ msg, attachments: schedule.imagePath }, entry.zaloId, ThreadType.User);
      } else {
        await api.sendMessage(msg, entry.zaloId, ThreadType.User);
      }

      entry.status = "sent";
      sent++;
    } catch (err: any) {
      entry.status = "failed";
      entry.error = err.message || "Lỗi";
      failed++;
    }

    schedule.currentIndex++;
    if (i < batch.length - 1) await sleep(randomDelay());
  }

  schedule.log.push({
    date: new Date().toISOString().split("T")[0],
    sent,
    failed,
  });

  if (schedule.currentIndex >= schedule.entries.length) {
    schedule.status = "done";
  }

  await saveSchedule();

  if (schedule.status === "active") {
    scheduleNextRun();
  }

  console.log("📅 Batch done: " + sent + " sent, " + failed + " failed");
}
