import { getApi } from "./zalo";
import { canSend, increment, getRemaining } from "./ratelimit";

export interface AddFriendEntry {
  phone: string;
  name: string;
  danhXung?: string;
  status?: "pending" | "sent" | "failed";
  error?: string;
  zaloUid?: string;
  zaloName?: string;
}

export interface AddFriendProgress {
  total: number;
  sent: number;
  failed: number;
  current: string;
  status: "idle" | "sending" | "done" | "error";
  results: AddFriendEntry[];
}

let progress: AddFriendProgress = {
  total: 0, sent: 0, failed: 0, current: "", status: "idle", results: [],
};

export function getAddFriendProgress() { return { ...progress }; }

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return 5000 + Math.random() * 5000; }

export async function startAddFriends(entries: AddFriendEntry[], messageTemplate: string) {
  const api = getApi();
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  progress = {
    total: entries.length, sent: 0, failed: 0,
    current: "", status: "sending", results: entries.map(e => ({ ...e, status: "pending" as const })),
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
      if (!entry.danhXung) {
        entry.danhXung = user.gender === 1 ? "Chị" : user.gender === 0 ? "Anh" : "";
      }

      // Render message with {ten}
      const name = entry.name || entry.zaloName || "";
      const msg = messageTemplate.replace(/\{ten\}/g, name).replace(/\{danh_xung\}/g, entry.danhXung || "");

      // Send friend request
      await api.sendFriendRequest(msg, user.uid);

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

  // Save results to file
  try {
    const filePath = "./data/addfriend_results.json";
    await Bun.write(filePath, JSON.stringify(progress.results, null, 2));
  } catch {}
}
