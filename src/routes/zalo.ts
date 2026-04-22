import { Hono } from "hono";
import { loginQR, getLoginState, isLoggedIn, getFriendList, logout, getQrPath, isQrReady, getApi, refreshFriendList } from "../services/zalo";

export const zaloRoutes = new Hono();

zaloRoutes.get("/status", (c) => {
  return c.json({ ...getLoginState(), loggedIn: isLoggedIn() });
});

zaloRoutes.post("/login", async (c) => {
  if (isLoggedIn()) return c.json({ ok: true, loggedIn: true });

  // Start login in background
  loginQR().then((result) => {
    if (!result.ok) console.error("Login failed:", result.error);
  });

  return c.json({ ok: true, message: "Đang tạo QR..." });
});

zaloRoutes.get("/qr", async (c) => {
  if (!isQrReady()) {
    return c.json({ error: "QR chưa sẵn sàng" }, 404);
  }
  const file = Bun.file(getQrPath());
  if (await file.exists()) {
    return new Response(await file.arrayBuffer(), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    });
  }
  return c.json({ error: "QR not found" }, 404);
});

zaloRoutes.get("/friends", async (c) => {
  try {
    const friends = await getFriendList();
    return c.json({ ok: true, count: friends.length, friends });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

zaloRoutes.post("/friends/refresh", async (c) => {
  try {
    const friends = await refreshFriendList();
    return c.json({ ok: true, count: friends.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

zaloRoutes.get("/labels", async (c) => {
  try {
    const api = getApi();
    if (!api) return c.json({ ok: false, error: "Chưa đăng nhập" }, 401);
    const data = await api.getLabels();
    return c.json({ ok: true, labels: data.labelData });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// Lấy profile tất cả members trong các label đã chọn (kể cả không phải bạn bè)
zaloRoutes.post("/labels/members", async (c) => {
  try {
    const api = getApi();
    if (!api) return c.json({ ok: false, error: "Chưa đăng nhập" }, 401);

    const { userIds } = await c.req.json<{ userIds: string[] }>();
    if (!userIds?.length) return c.json({ ok: false, error: "Không có userId" });
    console.log("[labels/members] Received", userIds.length, "userIds");

    // 1. Load toàn bộ alias list (tên danh bạ bạn đã đặt, kể cả non-friends)
    const aliasMap = new Map<string, string>();
    try {
      let aliasPage = 1;
      while (true) {
        const aliasData = await api.getAliasList(200, aliasPage);
        if (!aliasData?.items?.length) break;
        for (const a of aliasData.items) {
          if (a.alias) aliasMap.set(a.userId, a.alias);
        }
        if (aliasData.items.length < 200) break;
        aliasPage++;
        await new Promise(r => setTimeout(r, 300));
      }
      console.log("[labels/members] Loaded", aliasMap.size, "aliases");
    } catch (err: any) {
      console.log("⚠️ Alias load error:", err.message);
    }

    // 2. Lấy danh sách bạn bè
    const friends = await getFriendList();
    const friendMap = new Map<string, any>();
    for (const f of friends) {
      friendMap.set(f.userId, f);
    }

    // 3. Tách: bạn bè vs không phải bạn bè
    const results: any[] = [];
    const nonFriendIds: string[] = [];

    for (const uid of userIds) {
      const alias = aliasMap.get(uid) || "";
      const friend = friendMap.get(uid);
      if (friend) {
        results.push({
          userId: uid,
          displayName: alias || friend.displayName || friend.alias || "",
          zaloName: friend.zaloName || "",
          alias: alias || friend.alias || "",
          phoneNumber: friend.phoneNumber || "",
          isFriend: true,
        });
      } else {
        nonFriendIds.push(uid);
      }
    }

    // 4. Gọi getUserInfo cho non-friends (batch 50) để lấy zaloName
    const profileMap = new Map<string, any>();
    for (let i = 0; i < nonFriendIds.length; i += 50) {
      const batch = nonFriendIds.slice(i, i + 50);
      try {
        const info = await api.getUserInfo(batch);
        for (const [uid, profile] of Object.entries(info?.changed_profiles || {})) {
          profileMap.set(uid, profile);
        }
        for (const [uid, profile] of Object.entries(info?.unchanged_profiles || {})) {
          if (!profileMap.has(uid)) profileMap.set(uid, profile);
        }
      } catch (err: any) {
        console.log("⚠️ getUserInfo batch error:", err.message);
      }
      if (i + 50 < nonFriendIds.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 5. Build results cho non-friends
    for (const uid of nonFriendIds) {
      const alias = aliasMap.get(uid) || "";
      const profile = profileMap.get(uid);
      const zaloName = (profile as any)?.zaloName || (profile as any)?.zalo_name || (profile as any)?.displayName || (profile as any)?.display_name || "";
      const phone = (profile as any)?.phoneNumber || "";

      results.push({
        userId: uid,
        displayName: alias || zaloName || "",
        zaloName: zaloName,
        alias: alias,
        phoneNumber: phone,
        isFriend: false,
      });
    }

    console.log("[labels/members] Results:", results.length, "friends:", results.filter(r => r.isFriend).length, "non-friends:", results.filter(r => !r.isFriend).length, "with alias:", results.filter(r => r.alias).length);
    return c.json({ ok: true, members: results, total: results.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

zaloRoutes.post("/logout", (c) => {
  logout();
  return c.json({ ok: true });
});
