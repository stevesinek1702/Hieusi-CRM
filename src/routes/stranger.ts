import { Hono } from "hono";
import { startStrangerSend, getStrangerProgress, type StrangerEntry } from "../services/stranger";
import { mkdirSync, existsSync } from "fs";

const UPLOAD_DIR = "./data/uploads";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

export const strangerRoutes = new Hono();

strangerRoutes.post("/send", async (c) => {
  try {
    const formData = await c.req.formData();
    const entriesRaw = formData.get("entries") as string;
    const message = formData.get("message") as string;
    const image = formData.get("image") as File | null;

    if (!entriesRaw) return c.json({ ok: false, error: "Nhập danh sách" }, 400);
    if (!message) return c.json({ ok: false, error: "Nhập tin nhắn" }, 400);

    const entries: StrangerEntry[] = JSON.parse(entriesRaw);
    if (!entries.length) return c.json({ ok: false, error: "Danh sách rỗng" }, 400);

    let imagePath: string | undefined;
    if (image) {
      imagePath = `${UPLOAD_DIR}/${Date.now()}_${image.name}`;
      await Bun.write(imagePath, image);
    }

    startStrangerSend(entries, message, imagePath);
    return c.json({ ok: true, total: entries.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

strangerRoutes.get("/lookup", async (c) => {
  try {
    let phone = (c.req.query("phone") || "").trim();
    if (!phone) return c.json({ ok: false, error: "Thiếu SĐT" }, 400);

    if (phone.startsWith("0")) phone = "84" + phone.slice(1);

    const { getApi } = await import("../services/zalo");
    const api = getApi();
    if (!api) return c.json({ ok: false, error: "Chưa đăng nhập" }, 401);

    const user = await api.findUser(phone);
    if (!user || !user.uid) return c.json({ ok: false, error: "Không tìm thấy" }, 404);

    const fullName = user.display_name || user.zalo_name || "";
    const nameParts = fullName.trim().split(/\s+/);
    const tenGoi = nameParts.length > 0 ? nameParts[nameParts.length - 1] : fullName;
    const danhXung = user.gender === 1 ? "Chị" : user.gender === 0 ? "Anh" : "";

    return c.json({
      ok: true,
      uid: user.uid,
      name: fullName,
      tenGoi,
      gender: user.gender,
      danhXung,
      avatar: user.avatar || "",
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

strangerRoutes.get("/progress", (c) => {
  return c.json(getStrangerProgress());
});
