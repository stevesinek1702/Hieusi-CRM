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

    // Lấy danh sách bạn bè để biết ai đã là bạn
    const friends = await getFriendList();
    const friendMap = new Map<string, any>();
    for (const f of friends) {
      friendMap.set(f.userId, f);
    }

    // Tách: bạn bè lấy từ cache, không phải bạn bè gọi getUserInfo
    const results: any[] = [];
    const nonFriendIds: string[] = [];

    for (const uid of userIds) {
      const friend = friendMap.get(uid);
      if (friend) {
        results.push({
          userId: uid,
          displayName: friend.displayName || "",
          zaloName: friend.zaloName || "",
          alias: friend.alias || "",
          phoneNumber: friend.phoneNumber || "",
          isFriend: true,
        });
      } else {
        nonFriendIds.push(uid);
      }
    }

    // Gọi getUserInfo cho những người chưa là bạn bè (batch 50)
    const foundUids = new Set<string>();
    for (let i = 0; i < nonFriendIds.length; i += 50) {
      const batch = nonFriendIds.slice(i, i + 50);
      try {
        const info = await api.getUserInfo(batch);
        console.log("[labels/members] getUserInfo batch", i, "changed:", Object.keys(info?.changed_profiles || {}).length, "unchanged:", Object.keys(info?.unchanged_profiles || {}).length);

        // Lấy từ changed_profiles
        if (info?.changed_profiles) {
          for (const [uid, profile] of Object.entries(info.changed_profiles)) {
            foundUids.add(uid);
            results.push({
              userId: uid,
              displayName: (profile as any).displayName || (profile as any).zaloName || "",
              zaloName: (profile as any).zaloName || "",
              alias: "",
              phoneNumber: (profile as any).phoneNumber || "",
              isFriend: false,
            });
          }
        }

        // Lấy từ unchanged_profiles (có thể cũng chứa profile data)
        if (info?.unchanged_profiles) {
          for (const [uid, profile] of Object.entries(info.unchanged_profiles)) {
            if (!foundUids.has(uid)) {
              foundUids.add(uid);
              results.push({
                userId: uid,
                displayName: (profile as any)?.displayName || (profile as any)?.zaloName || (profile as any)?.display_name || (profile as any)?.zalo_name || "",
                zaloName: (profile as any)?.zaloName || (profile as any)?.zalo_name || "",
                alias: "",
                phoneNumber: (profile as any)?.phoneNumber || "",
                isFriend: false,
              });
            }
          }
        }
      } catch (err: any) {
        console.log("⚠️ getUserInfo batch error:", err.message);
      }
      // Delay giữa các batch
      if (i + 50 < nonFriendIds.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Những userId không tìm thấy (có thể là group conversation) → gọi từng cái
    for (const uid of nonFriendIds) {
      if (!foundUids.has(uid)) {
        try {
          const info = await api.getUserInfo(uid);
          const profile = info?.changed_profiles?.[uid] || info?.unchanged_profiles?.[uid];
          if (profile) {
            foundUids.add(uid);
            results.push({
              userId: uid,
              displayName: (profile as any).displayName || (profile as any).zaloName || (profile as any).display_name || (profile as any).zalo_name || "",
              zaloName: (profile as any).zaloName || (profile as any).zalo_name || "",
              alias: "",
              phoneNumber: (profile as any).phoneNumber || "",
              isFriend: false,
            });
          } else {
            console.log("[labels/members] No profile for uid:", uid, "response:", JSON.stringify(info).slice(0, 200));
            results.push({
              userId: uid,
              displayName: "",
              zaloName: "",
              alias: "",
              phoneNumber: "",
              isFriend: false,
            });
          }
        } catch (err: any) {
          console.log("[labels/members] Single getUserInfo error for", uid, ":", err.message);
          results.push({
            userId: uid,
            displayName: "",
            zaloName: "",
            alias: "",
            phoneNumber: "",
            isFriend: false,
          });
        }
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log("[labels/members] Results:", results.length, "friends:", results.filter(r => r.isFriend).length, "non-friends:", results.filter(r => !r.isFriend).length);
    return c.json({ ok: true, members: results, total: results.length });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

zaloRoutes.post("/logout", (c) => {
  logout();
  return c.json({ ok: true });
});
