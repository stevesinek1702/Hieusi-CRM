import { getApi } from "./zalo";
import type { Contact } from "./contacts";
import { ThreadType } from "zca-js";
import { canSend, increment, getRemaining } from "./ratelimit";

export interface SendProgress {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  current: string;
  status: "idle" | "sending" | "done" | "error" | "rate_limited";
  errors: { name: string; error: string }[];
}

let progress: SendProgress = {
  total: 0, sent: 0, failed: 0, skipped: 0, current: "", status: "idle", errors: [],
};

export function getProgress(): SendProgress { return { ...progress }; }
export function resetProgress() {
  progress = { total: 0, sent: 0, failed: 0, skipped: 0, current: "", status: "idle", errors: [] };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randomDelay() { return 5000 + Math.random() * 5000; }

function renderTemplate(template: string, contact: Contact): string {
  return template
    .replace(/\{danh_xung\}/g, contact.danhXung)
    .replace(/\{ten\}/g, contact.tenGoi);
}

const MAX_RETRIES = 2;

async function sendWithRetry(api: any, contact: Contact, msg: string, imagePath?: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (imagePath) {
        await api.sendMessage({ msg, attachments: imagePath }, contact.zaloId!, ThreadType.User);
      } else {
        await api.sendMessage(msg, contact.zaloId!, ThreadType.User);
      }
      return;
    } catch (err: any) {
      if (attempt === MAX_RETRIES) throw err;
      // Chờ lâu hơn trước khi retry
      await sleep(3000 + attempt * 2000);
    }
  }
}

export async function startBulkSend(
  contacts: Contact[],
  template: string,
  imagePath?: string
) {
  const api = getApi();
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  const remaining = getRemaining("bulk");
  if (remaining <= 0) {
    progress = { total: 0, sent: 0, failed: 0, skipped: 0, current: "", status: "rate_limited", errors: [] };
    throw new Error("Đã đạt giới hạn gửi tin hôm nay (80 tin/ngày). Thử lại ngày mai.");
  }

  const matched = contacts.filter((c) => c.matched && c.zaloId);
  const toSend = matched.slice(0, remaining); // Chỉ gửi trong giới hạn
  const skipped = matched.length - toSend.length;

  progress = {
    total: toSend.length, sent: 0, failed: 0, skipped,
    current: "", status: "sending", errors: [],
  };

  if (skipped > 0) {
    console.log(`[Bulk] Rate limited: gửi ${toSend.length}/${matched.length}, bỏ qua ${skipped}`);
  }

  for (const contact of toSend) {
    if (!canSend("bulk")) {
      progress.status = "rate_limited";
      progress.skipped += (toSend.length - progress.sent - progress.failed);
      console.log("[Bulk] Đạt giới hạn giữa chừng, dừng gửi.");
      break;
    }

    try {
      progress.current = contact.tenDanhBa;
      const msg = renderTemplate(template, contact);
      await sendWithRetry(api, contact, msg, imagePath);
      increment("bulk");
      progress.sent++;
    } catch (err: any) {
      progress.failed++;
      progress.errors.push({
        name: contact.tenDanhBa,
        error: err.message || "Unknown error",
      });
    }

    // Delay 5-10s between messages
    if (progress.sent + progress.failed < toSend.length) {
      await sleep(randomDelay());
    }
  }

  if (progress.status !== "rate_limited") {
    progress.status = "done";
  }
  progress.current = "";

  // Log kết quả
  console.log(`[Bulk] Done: sent=${progress.sent}, failed=${progress.failed}, skipped=${progress.skipped}`);
}
