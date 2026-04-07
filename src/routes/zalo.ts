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

zaloRoutes.post("/logout", (c) => {
  logout();
  return c.json({ ok: true });
});
