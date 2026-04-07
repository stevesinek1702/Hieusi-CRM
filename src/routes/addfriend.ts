import { Hono } from "hono";
import { startAddFriends, getAddFriendProgress, type AddFriendEntry } from "../services/addfriend";

export const addFriendRoutes = new Hono();

addFriendRoutes.post("/start", async (c) => {
  try {
    const { entries, message } = await c.req.json();
    if (!entries || !entries.length) return c.json({ ok: false, error: "Nhập danh sách" }, 400);

    startAddFriends(entries as AddFriendEntry[], message || "Xin chào, mình muốn kết bạn!");
    return c.json({ ok: true, total: entries.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

addFriendRoutes.get("/progress", (c) => {
  return c.json(getAddFriendProgress());
});

addFriendRoutes.get("/lookup", async (c) => {
  try {
    let phone = (c.req.query("phone") || "").trim();
    if (!phone) return c.json({ ok: false, error: "Thiếu SĐT" }, 400);

    // Normalize phone: 0xxx -> 84xxx
    if (phone.startsWith("0")) phone = "84" + phone.slice(1);

    const { getApi } = await import("../services/zalo");
    const api = getApi();
    if (!api) return c.json({ ok: false, error: "Chưa đăng nhập" }, 401);

    let user;
    try {
      user = await api.findUser(phone);
    } catch (findErr: any) {
      return c.json({ ok: false, error: "Không tìm thấy user Zalo cho SĐT này" }, 404);
    }
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

addFriendRoutes.get("/results", async (c) => {
  try {
    const file = Bun.file("./data/addfriend_results.json");
    if (await file.exists()) {
      const data = await file.json();
      return c.json({ ok: true, results: data });
    }
    return c.json({ ok: true, results: [] });
  } catch {
    return c.json({ ok: true, results: [] });
  }
});
