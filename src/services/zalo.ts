import { Zalo, LoginQRCallbackEventType, type API } from "zca-js";
import { existsSync, mkdirSync } from "fs";
import sharp from "sharp";
import fs from "node:fs";

const DATA_DIR = "./data";
const CRED_PATH = `${DATA_DIR}/credentials.json`;
const QR_PATH = `${DATA_DIR}/qr.png`;

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

let api: API | null = null;
let loginState: "idle" | "waiting_qr" | "logged_in" | "error" = "idle";
let loginError = "";
let qrReady = false;
let loginInProgress = false;
let qrTimestamp = 0; // track when QR was last generated

async function imageMetadataGetter(filePath: string) {
  const data = await fs.promises.readFile(filePath);
  const metadata = await sharp(data).metadata();
  return {
    height: metadata.height!,
    width: metadata.width!,
    size: metadata.size || data.length,
  };
}

export function getApi() { return api; }
export function isLoggedIn() { return loginState === "logged_in" && api !== null; }
export function isQrReady() { return qrReady; }
export function getQrTimestamp() { return qrTimestamp; }
export function getLoginState() {
  return { state: loginState, error: loginError, qrReady, qrTimestamp };
}

export async function loginQR(): Promise<{ ok: boolean; error?: string }> {
  // Prevent multiple login attempts
  if (loginInProgress) return { ok: false, error: "Login đang chạy, vui lòng chờ quét QR" };
  if (isLoggedIn()) return { ok: true };

  loginInProgress = true;
  try {
    loginState = "waiting_qr";
    loginError = "";
    qrReady = false;

    const zalo = new Zalo({ imageMetadataGetter });

    api = await zalo.loginQR(
      { qrPath: QR_PATH },
      (event) => {
        switch (event.type) {
          case LoginQRCallbackEventType.QRCodeGenerated:
            event.actions.saveToFile(QR_PATH).then(() => {
              qrReady = true;
              qrTimestamp = Date.now();
              console.log("📱 QR code ready, chờ quét...");
            });
            break;
          case LoginQRCallbackEventType.QRCodeExpired:
            console.log("⏰ QR expired, tạo lại...");
            qrReady = false;
            event.actions.retry();
            break;
          case LoginQRCallbackEventType.QRCodeScanned:
            console.log(`✅ Đã quét bởi: ${event.data.display_name}`);
            loginState = "waiting_qr";
            qrReady = false;
            break;
          case LoginQRCallbackEventType.QRCodeDeclined:
            console.log("❌ Bị từ chối, tạo QR mới...");
            event.actions.retry();
            break;
          case LoginQRCallbackEventType.GotLoginInfo:
            Bun.write(CRED_PATH, JSON.stringify(event.data, null, 2));
            console.log("💾 Credentials đã lưu");
            break;
        }
      }
    );

    loginState = "logged_in";
    qrReady = false;
    loginInProgress = false;
    console.log("🎉 Đăng nhập Zalo thành công!");
    return { ok: true };
  } catch (err: any) {
    loginState = "error";
    loginError = err.message || "Login failed";
    qrReady = false;
    loginInProgress = false;
    return { ok: false, error: loginError };
  }
}

export async function tryAutoLogin(): Promise<boolean> {
  if (!existsSync(CRED_PATH)) return false;
  try {
    const creds = await Bun.file(CRED_PATH).json();
    const zalo = new Zalo({ imageMetadataGetter });
    api = await zalo.login(creds);
    loginState = "logged_in";
    console.log("🎉 Auto-login thành công!");
    return true;
  } catch (err: any) {
    console.log("⚠️ Auto-login failed:", err.message);
    loginState = "idle";
    return false;
  }
}

let friendCache: any[] | null = null;
let friendCacheTime = 0;
const FRIEND_CACHE_TTL = 30 * 60 * 1000; // 30 phút
const FRIEND_FILE = "./data/friends_cache.json";

export async function getFriendList() {
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  // Return memory cache if fresh
  if (friendCache && (Date.now() - friendCacheTime) < FRIEND_CACHE_TTL) {
    return friendCache;
  }

  // Try load from file first
  if (existsSync(FRIEND_FILE)) {
    try {
      friendCache = await Bun.file(FRIEND_FILE).json();
      friendCacheTime = Date.now();
      console.log("📋 Loaded " + (friendCache?.length || 0) + " friends from cache file");
      return friendCache!;
    } catch {}
  }

  // Fetch from API
  return await refreshFriendList();
}

export async function refreshFriendList() {
  if (!api) throw new Error("Chưa đăng nhập Zalo");

  const friends = await api.getAllFriends(5000, 1);

  // Load aliases
  try {
    const allAliases: { userId: string; alias: string }[] = [];
    let aliasPage = 1;
    while (true) {
      const aliasData = await api.getAliasList(200, aliasPage);
      if (!aliasData?.items?.length) break;
      allAliases.push(...aliasData.items);
      if (aliasData.items.length < 200) break;
      aliasPage++;
      await new Promise(r => setTimeout(r, 500));
    }
    if (allAliases.length) {
      const aliasMap = new Map<string, string>();
      for (const a of allAliases) {
        if (a.alias) aliasMap.set(a.userId, a.alias);
      }
      for (const f of friends) {
        const alias = aliasMap.get(f.userId);
        if (alias) (f as any).alias = alias;
      }
      console.log("📋 Loaded " + allAliases.length + " aliases");
    }
  } catch (err: any) {
    console.log("⚠️ Alias error:", err.message);
  }

  // Save to file
  friendCache = friends;
  friendCacheTime = Date.now();
  await Bun.write(FRIEND_FILE, JSON.stringify(friends, null, 2));
  console.log("📋 Saved " + friends.length + " friends to cache file");
  return friends;
}

export function getQrPath() { return QR_PATH; }

export function logout() {
  api = null;
  loginState = "idle";
  loginError = "";
  qrReady = false;
  loginInProgress = false;
  friendCache = null;
}
