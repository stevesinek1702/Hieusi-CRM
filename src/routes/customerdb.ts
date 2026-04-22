import { Hono } from "hono";
import {
  getCustomerDb, setCustomerDb, loadCustomerDb, saveCustomerDb,
  parseCustomerFile, exportCustomerDbToXlsx, mergeIntoDb,
  type CustomerEntry,
} from "../services/customerdb";
import { getApi, getFriendList } from "../services/zalo";

export const customerDbRoutes = new Hono();

// Xuất tất cả label members ra Excel (để user fix tay Xưng hô + Tên)
customerDbRoutes.get("/labels/export", async (c) => {
  try {
    const api = getApi();
    if (!api) return c.json({ ok: false, error: "Chưa đăng nhập" }, 401);

    // 1. Load labels
    const labelData = await api.getLabels();
    const labels = labelData.labelData || [];

    // 2. Collect all userIds (filter groups)
    const uidLabels = new Map<string, string>();
    for (const label of labels) {
      for (const uid of label.conversations) {
        if (uid[0] !== "g" && !uidLabels.has(uid)) {
          uidLabels.set(uid, label.text);
        }
      }
    }
    const allUserIds = Array.from(uidLabels.keys());

    // 3. Load aliases
    const aliasMap = new Map<string, string>();
    try {
      let page = 1;
      while (true) {
        const data = await api.getAliasList(200, page);
        if (!data?.items?.length) break;
        for (const a of data.items) {
          if (a.alias) aliasMap.set(a.userId, a.alias);
        }
        if (data.items.length < 200) break;
        page++;
        await new Promise(r => setTimeout(r, 300));
      }
    } catch {}

    // 4. Load friends
    const friends = await getFriendList();
    const friendMap = new Map<string, any>();
    for (const f of friends) friendMap.set(f.userId, f);

    // 5. getUserInfo for non-friends
    const profileMap = new Map<string, any>();
    const nonFriendIds = allUserIds.filter(uid => !friendMap.has(uid));
    for (let i = 0; i < nonFriendIds.length; i += 50) {
      const batch = nonFriendIds.slice(i, i + 50);
      try {
        const info = await api.getUserInfo(batch);
        for (const [uid, p] of Object.entries(info?.changed_profiles || {})) profileMap.set(uid, p);
        for (const [uid, p] of Object.entries(info?.unchanged_profiles || {})) {
          if (!profileMap.has(uid)) profileMap.set(uid, p);
        }
      } catch {}
      if (i + 50 < nonFriendIds.length) await new Promise(r => setTimeout(r, 500));
    }

    // 6. Load existing customer DB for pre-filling Xưng hô + Tên
    const existingDb = await loadCustomerDb();
    const dbMap = new Map<string, CustomerEntry>();
    for (const e of existingDb) {
      if (e.userId) dbMap.set(e.userId, e);
    }

    // 7. Build entries
    const entries: CustomerEntry[] = allUserIds.map(uid => {
      const alias = aliasMap.get(uid) || "";
      const friend = friendMap.get(uid);
      const profile = profileMap.get(uid);
      const isFriend = !!friend;
      const existing = dbMap.get(uid);

      const danhBaZalo = alias || friend?.displayName || friend?.alias || (profile as any)?.displayName || (profile as any)?.zaloName || "";
      const tenZalo = friend?.zaloName || (profile as any)?.zaloName || (profile as any)?.zalo_name || "";
      const label = uidLabels.get(uid) || "";

      return {
        danhBaZalo,
        danhXung: existing?.danhXung || "",
        tenGoi: existing?.tenGoi || "",
        tenZalo,
        userId: uid,
        label,
        isFriend,
      };
    });

    // 8. Export to xlsx
    const buffer = exportCustomerDbToXlsx(entries);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=all_labels_customers.xlsx",
      },
    });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Import Excel đã fix tay → merge vào Customer DB
customerDbRoutes.post("/import", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    if (!file) return c.json({ ok: false, error: "No file" }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const entries = parseCustomerFile(buffer);
    const result = mergeIntoDb(entries);
    await saveCustomerDb();

    return c.json({ ok: true, ...result, total: getCustomerDb().length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Lưu DB hiện tại
customerDbRoutes.post("/save", async (c) => {
  const count = await saveCustomerDb();
  return c.json({ ok: true, saved: count });
});

// Load DB từ file
customerDbRoutes.post("/load", async (c) => {
  const db = await loadCustomerDb();
  return c.json({ ok: true, total: db.length });
});

// Xem DB
customerDbRoutes.get("/", (c) => {
  const db = getCustomerDb();
  return c.json({ ok: true, total: db.length, entries: db });
});

// Export DB ra xlsx
customerDbRoutes.get("/export", (c) => {
  const db = getCustomerDb();
  if (!db.length) return c.json({ ok: false, error: "DB trống" }, 400);
  const buffer = exportCustomerDbToXlsx(db);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=customer_db.xlsx",
    },
  });
});

// Xóa toàn bộ DB
customerDbRoutes.post("/clear", async (c) => {
  setCustomerDb([]);
  await saveCustomerDb();
  return c.json({ ok: true });
});
