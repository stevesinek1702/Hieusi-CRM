import { getApi } from "./zalo";
import { ThreadType } from "zca-js";
import { canSend, increment, getRemaining } from "./ratelimit";

export interface StrangerEntry {
  phone: string;
  name: string;
  status?: "pending" | "sent" | "failed";
  error?: string;
  zaloUid?: string;
  zaloName?: string;
}

export interface StrangerProgress {
  total: number;
  sent: number;
  failed: number;
  current: string;
  status: "idle" | "sending" | "done" | "error";
  results: StrangerEntry[];
}

let progress: StrangerProgress = {
  total: 0, sent: 0, failed: 0, current: "", status: "idle", results: [],
};

export function getStrangerProgress() { return { ...progress }; }

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return 8000 + Math.random() * 7000; } // 8-15s (slower for strangers)

export async function startStrangerSend(
  entries: StrangerEntry[],
  messageTemplate: string,
  imagePath?: string
) {
  const api = getApi();
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  progress = {
    total: entries.length, sent: 0, failed: 0,
    current: "", status: "sending",
    results: entries.map(e => ({ ...e, status: "pending" as const })),
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = progress.results[i];
    try {
      progress.current = entry.phone + (entry.name ? " (" + entry.name + ")" : "");

      // Normalize phone
      let phone = entry.phone;
      if (phone.startsWith("0")) phone = "84" + phone.slice(1);

      // Find user by phone
      const user = await api.findUser(phone);
      if (!user || !user.uid) {
        entry.status = "failed";
        entry.error = "Không tìm thấy user";
        progress.failed++;
        await sleep(randomDelay());
        continue;
      }

      entry.zaloUid = user.uid;
      entry.zaloName = user.display_name || user.zalo_name || "";

      const name = entry.name || entry.zaloName || "";
      const danhXung = user.gender === 1 ? "Chị" : user.gender === 0 ? "Anh" : "";
      const msg = messageTemplate.replace(/\{ten\}/g, name).replace(/\{danh_xung\}/g, danhXung);

      // Send message to stranger
      if (imagePath) {
        await api.sendMessage(
          { msg, attachments: imagePath },
          user.uid,
          ThreadType.User
        );
      } else {
        await api.sendMessage(msg, user.uid, ThreadType.User);
      }

      entry.status = "sent";
      progress.sent++;
    } catch (err: any) {
      entry.status = "failed";
      entry.error = err.message || "Lỗi";
      progress.failed++;
    }

    if (i < entries.length - 1) {
      await sleep(randomDelay());
    }
  }

  progress.status = "done";
  progress.current = "";

  try {
    await Bun.write("./data/stranger_results.json", JSON.stringify(progress.results, null, 2));
  } catch {}
}
