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
