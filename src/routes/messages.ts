import { Hono } from "hono";
import { getContacts } from "../services/contacts";
import { startBulkSend, getProgress } from "../services/sender";
import { mkdirSync, existsSync } from "fs";

const UPLOAD_DIR = "./data/uploads";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

export const messageRoutes = new Hono();

messageRoutes.get("/progress", (c) => {
  return c.json(getProgress());
});

messageRoutes.post("/send", async (c) => {
  try {
    const formData = await c.req.formData();
    const template = formData.get("template") as string;
    const image = formData.get("image") as File | null;

    if (!template) return c.json({ ok: false, error: "Thiếu template tin nhắn" }, 400);

    const contacts = getContacts();
    const matched = contacts.filter((x) => x.matched);
    if (!matched.length) return c.json({ ok: false, error: "Không có contact nào đã match" }, 400);

    let imagePath: string | undefined;
    if (image) {
      imagePath = `${UPLOAD_DIR}/${Date.now()}_${image.name}`;
      await Bun.write(imagePath, image);
    }

    // Start sending in background
    startBulkSend(contacts, template, imagePath);

    return c.json({ ok: true, sending: matched.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

messageRoutes.post("/preview", async (c) => {
  const { template } = await c.req.json();
  const contacts = getContacts();
  const sample = contacts.find((x) => x.matched) || contacts[0];
  if (!sample) return c.json({ ok: false, error: "Chưa có contact" }, 400);

  const preview = template
    .replace(/\{danh_xung\}/g, sample.danhXung)
    .replace(/\{ten\}/g, sample.tenGoi);

  return c.json({ ok: true, preview, contact: sample.tenDanhBa });
});
