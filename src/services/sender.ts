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
