import { getApi } from "./zalo";
import type { Contact } from "./contacts";
import { ThreadType } from "zca-js";

export interface SendProgress {
  total: number;
  sent: number;
  failed: number;
  current: string;
  status: "idle" | "sending" | "done" | "error";
  errors: { name: string; error: string }[];
}

let progress: SendProgress = {
  total: 0, sent: 0, failed: 0, current: "", status: "idle", errors: [],
};

export function getProgress(): SendProgress { return { ...progress }; }
export function resetProgress() {
  progress = { total: 0, sent: 0, failed: 0, current: "", status: "idle", errors: [] };
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randomDelay() { return 5000 + Math.random() * 5000; }

function renderTemplate(template: string, contact: Contact): string {
  return template
    .replace(/\{danh_xung\}/g, contact.danhXung)
    .replace(/\{ten\}/g, contact.tenGoi);
}

export async function startBulkSend(
  contacts: Contact[],
  template: string,
  imagePath?: string
) {
  const api = getApi();
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  const matched = contacts.filter((c) => c.matched && c.zaloId);
  progress = {
    total: matched.length, sent: 0, failed: 0,
    current: "", status: "sending", errors: [],
  };

  for (const contact of matched) {
    try {
      progress.current = contact.tenDanhBa;
      const msg = renderTemplate(template, contact);

      // Send message (with optional image attachment)
      if (imagePath) {
        await api.sendMessage(
          { msg, attachments: imagePath },
          contact.zaloId!,
          ThreadType.User
        );
      } else {
        await api.sendMessage(msg, contact.zaloId!, ThreadType.User);
      }

      progress.sent++;
    } catch (err: any) {
      progress.failed++;
      progress.errors.push({
        name: contact.tenDanhBa,
        error: err.message || "Unknown error",
      });
    }

    // Delay 5-10s between messages
    if (progress.sent + progress.failed < matched.length) {
      await sleep(randomDelay());
    }
  }

  progress.status = "done";
  progress.current = "";
}
