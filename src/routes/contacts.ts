import { Hono } from "hono";
import {
  parseContactFile,
  matchContactsWithFriends,
  getContacts,
  setContacts,
} from "../services/contacts";
import { getFriendList } from "../services/zalo";

export const contactRoutes = new Hono();

contactRoutes.get("/", (c) => {
  const contacts = getContacts();
  const matched = contacts.filter((x) => x.matched).length;
  return c.json({ total: contacts.length, matched, contacts });
});

contactRoutes.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    if (!file) return c.json({ ok: false, error: "No file" }, 400);

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseContactFile(buffer, file.name);

    // Auto-match with friend list
    try {
      const friends = await getFriendList();
      const matched = await matchContactsWithFriends(parsed, friends);
      setContacts(matched);
      const matchedCount = matched.filter((x) => x.matched).length;
      return c.json({ ok: true, total: matched.length, matched: matchedCount });
    } catch {
      // Not logged in yet, save without matching
      setContacts(parsed);
      return c.json({ ok: true, total: parsed.length, matched: 0, note: "Chưa đăng nhập Zalo, chưa match được" });
    }
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

contactRoutes.post("/match", async (c) => {
  try {
    const contacts = getContacts();
    if (!contacts.length) return c.json({ ok: false, error: "Chưa có danh bạ" }, 400);

    let friends;
    try {
      friends = await getFriendList();
    } catch (err: any) {
      return c.json({ ok: false, error: "Lỗi lấy danh bạ Zalo (thử lại sau vài giây): " + err.message }, 429);
    }

    const matched = matchContactsWithFriends(contacts, friends);
    setContacts(matched);
    const matchedCount = matched.filter((x) => x.matched).length;
    return c.json({ ok: true, total: matched.length, matched: matchedCount });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

contactRoutes.post("/add", async (c) => {
  try {
    const { tenDanhBa, danhXung, tenGoi, label } = await c.req.json();
    if (!tenDanhBa) return c.json({ ok: false, error: "Thiếu tên danh bạ" }, 400);

    const contacts = getContacts();
    const newContact: any = { tenDanhBa, danhXung: danhXung || "", tenGoi: tenGoi || "", matched: false, label: label || "" };

    // Try match with friend list
    try {
      const friends = await getFriendList();
      const [matched] = matchContactsWithFriends([newContact], friends);
      contacts.push({ ...matched, label: label || "" });
    } catch {
      contacts.push(newContact);
    }

    setContacts(contacts);
    const matchedCount = contacts.filter((x) => x.matched).length;
    return c.json({ ok: true, total: contacts.length, matched: matchedCount });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

contactRoutes.post("/delete", async (c) => {
  try {
    const { index } = await c.req.json();
    const contacts = getContacts();
    if (index < 0 || index >= contacts.length) {
      return c.json({ ok: false, error: "Index không hợp lệ" }, 400);
    }
    contacts.splice(index, 1);
    setContacts(contacts);
    const matchedCount = contacts.filter((x) => x.matched).length;
    return c.json({ ok: true, total: contacts.length, matched: matchedCount });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

contactRoutes.post("/clear", (c) => {
  setContacts([]);
  return c.json({ ok: true, total: 0, matched: 0 });
});

contactRoutes.post("/save", async (c) => {
  const contacts = getContacts();
  const filePath = "./data/contacts_saved.json";
  await Bun.write(filePath, JSON.stringify(contacts, null, 2));
  return c.json({ ok: true, saved: contacts.length });
});

contactRoutes.post("/load", async (c) => {
  try {
    const file = Bun.file("./data/contacts_saved.json");
    if (await file.exists()) {
      const saved = await file.json();
      setContacts(saved);
      const matchedCount = saved.filter((x: any) => x.matched).length;
      return c.json({ ok: true, total: saved.length, matched: matchedCount });
    }
    return c.json({ ok: false, error: "Chưa có file đã lưu" }, 404);
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

contactRoutes.post("/update", async (c) => {
  try {
    const { index, field, value } = await c.req.json();
    const contacts = getContacts();
    if (index < 0 || index >= contacts.length) {
      return c.json({ ok: false, error: "Index không hợp lệ" }, 400);
    }
    const allowed = ["danhXung", "tenGoi", "label"];
    if (!allowed.includes(field)) {
      return c.json({ ok: false, error: "Field không hợp lệ" }, 400);
    }
    (contacts[index] as any)[field] = value;
    setContacts(contacts);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});
