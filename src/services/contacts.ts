import * as XLSX from "xlsx";
import { existsSync } from "fs";
import { lookupCustomer } from "./customerdb";

export interface Contact {
  tenDanhBa: string;
  danhXung: string;
  tenGoi: string;
  zaloId?: string;
  zaloName?: string;  // tên friend đã match
  matched?: boolean;
  matchScore?: number; // 0-100, 100 = exact
  label?: string;      // label/nhóm phân loại
}

// Saved contacts & stranger/addfriend results as fallback sources
interface SavedEntry {
  userId: string;
  name: string;
  zaloName?: string;
}

async function loadSavedSources(): Promise<SavedEntry[]> {
  const entries: SavedEntry[] = [];

  // 1. contacts_saved.json - danh bạ đã lưu trước đó (có zaloId)
  try {
    const f = Bun.file("./data/contacts_saved.json");
    if (await f.exists()) {
      const saved: any[] = await f.json();
      for (const s of saved) {
        if (s.zaloId && s.tenDanhBa) {
          entries.push({ userId: s.zaloId, name: s.tenDanhBa, zaloName: s.zaloName || "" });
        }
      }
    }
  } catch {}

  // 2. addfriend_results.json - kết quả kết bạn (có zaloUid)
  try {
    const f = Bun.file("./data/addfriend_results.json");
    if (await f.exists()) {
      const results: any[] = await f.json();
      for (const r of results) {
        if (r.zaloUid && r.name) {
          entries.push({ userId: r.zaloUid, name: r.name, zaloName: r.zaloName || "" });
        }
      }
    }
  } catch {}

  // 3. stranger_results.json - kết quả gửi stranger (có zaloUid)
  try {
    const f = Bun.file("./data/stranger_results.json");
    if (await f.exists()) {
      const results: any[] = await f.json();
      for (const r of results) {
        if (r.zaloUid && r.name) {
          entries.push({ userId: r.zaloUid, name: r.name, zaloName: r.zaloName || "" });
        }
      }
    }
  } catch {}

  return entries;
}

let contacts: Contact[] = [];

export function getContacts() { return contacts; }
export function setContacts(c: Contact[]) { contacts = c; }

export function parseContactFile(buffer: Buffer, filename: string): Contact[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const startIdx = isHeader(rows[0]) ? 1 : 0;
  const parsed: Contact[] = [];

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    parsed.push({
      tenDanhBa: String(row[0]).trim(),
      danhXung: String(row[1] || "").trim(),
      tenGoi: String(row[2] || "").trim(),
      matched: false,
    });
  }
  return parsed;
}

function isHeader(row: any[]): boolean {
  if (!row) return false;
  const first = String(row[0]).toLowerCase();
  return first.includes("tên") || first.includes("ten") || first.includes("name") || first.includes("danh");
}

// Normalize Vietnamese text: remove diacritics, lowercase
function normalize(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/\s+/g, " ");
}

// Normalize for matching: remove diacritics, dots, extra spaces
function normalizeMatch(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .replace(/[.\-_,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Split into words for word-level matching
function getWords(str: string): string[] {
  return normalizeMatch(str).split(" ").filter(w => w.length > 0);
}

const MATCH_THRESHOLD = 80;

/**
 * Thuật toán match kiểu Zalo search:
 * - Lấy nguyên chuỗi tenDanhBa, tách thành các từ (search words)
 * - Lấy tên friend, tách thành các từ (target words)
 * - Mỗi search word phải tìm thấy trong target words (exact hoặc target word startsWith search word, hoặc ngược lại)
 * - KHÔNG cần theo thứ tự, chỉ cần TẤT CẢ search words đều có mặt
 *
 * Ví dụ:
 *   search "A. Hiệp 4757678" → words ["a", "hiep", "4757678"]
 *   target "A. Hiệp 4757678 0907260810" → words ["a", "hiep", "4757678", "0907260810"]
 *   → "a"✓ "hiep"✓ "4757678"✓ → 3/3 match → score cao
 *
 *   search "Tran Thu Trinh" → words ["tran", "thu", "trinh"]
 *   target "Tra" → words ["tra"]
 *   → "tran" vs "tra": tra startsWith tran? No. tran startsWith tra? Yes nhưng chỉ 1/3 → thấp
 */
function calcMatchScore(searchNorm: string, targetNorm: string): number {
  // Exact full string match
  if (targetNorm === searchNorm) return 100;

  // Full string contains
  if (targetNorm.includes(searchNorm)) return 98;
  if (searchNorm.includes(targetNorm)) {
    const ratio = targetNorm.length / searchNorm.length;
    if (ratio >= 0.7) return 95;
  }

  // Word-based matching (kiểu Zalo search)
  const searchWords = getWords(searchNorm);
  const targetWords = getWords(targetNorm);
  if (!searchWords.length || !targetWords.length) return 0;

  let matchedCount = 0;
  let exactChars = 0;
  let totalSearchChars = 0;
  const usedTargetIdx = new Set<number>();

  for (const sw of searchWords) {
    totalSearchChars += sw.length;
    let found = false;

    for (let ti = 0; ti < targetWords.length; ti++) {
      if (usedTargetIdx.has(ti)) continue;
      const tw = targetWords[ti];

      if (tw === sw) {
        // Exact word match
        matchedCount++;
        exactChars += sw.length;
        usedTargetIdx.add(ti);
        found = true;
        break;
      }
      if (tw.startsWith(sw) && sw.length >= 2) {
        // Search word là prefix của target word
        matchedCount++;
        exactChars += sw.length;
        usedTargetIdx.add(ti);
        found = true;
        break;
      }
      if (sw.startsWith(tw) && tw.length >= 2) {
        // Target word là prefix của search word
        matchedCount++;
        exactChars += tw.length;
        usedTargetIdx.add(ti);
        found = true;
        break;
      }
    }
  }

  if (matchedCount === 0) return 0;

  const wordRatio = matchedCount / searchWords.length;

  // Phải khớp ít nhất 60% số từ search
  if (wordRatio < 0.6) return 0;

  // Tất cả search words đều khớp
  if (matchedCount === searchWords.length) {
    // Tính coverage: bao nhiêu % target words được dùng
    const targetCoverage = usedTargetIdx.size / targetWords.length;
    if (wordRatio === 1 && targetCoverage >= 0.8) return 97;
    if (wordRatio === 1 && targetCoverage >= 0.5) return 94;
    return 90;
  }

  // Một phần search words khớp
  const charRatio = totalSearchChars > 0 ? exactChars / totalSearchChars : 0;
  return Math.round(60 + (wordRatio * 0.6 + charRatio * 0.4) * 25);
}

export async function matchContactsWithFriends(contacts: Contact[], friends: any[]): Promise<Contact[]> {
  const friendList = friends.map((f: any) => ({
    userId: f.userId,
    displayName: f.displayName || "",
    zaloName: f.zaloName || "",
    alias: f.alias || "",
  }));

  // Build all name entries from friends
  const friendNames: { friend: typeof friendList[0]; raw: string; norm: string }[] = [];
  for (const f of friendList) {
    for (const name of [f.alias, f.displayName, f.zaloName]) {
      if (name) {
        friendNames.push({ friend: f, raw: name, norm: normalizeMatch(name) });
      }
    }
  }

  // Load saved sources as fallback (contacts_saved, addfriend_results, stranger_results)
  const savedSources = await loadSavedSources();
  const savedNames: { entry: SavedEntry; raw: string; norm: string }[] = [];
  for (const s of savedSources) {
    if (s.name) savedNames.push({ entry: s, raw: s.name, norm: normalizeMatch(s.name) });
    if (s.zaloName) savedNames.push({ entry: s, raw: s.zaloName, norm: normalizeMatch(s.zaloName) });
  }

  return contacts.map((c) => {
    const searchNorm = normalizeMatch(c.tenDanhBa);

    // 1. Score all friends first
    let bestScore = 0;
    let bestFn: typeof friendNames[0] | null = null;

    for (const fn of friendNames) {
      const score = calcMatchScore(searchNorm, fn.norm);
      if (score > bestScore) {
        bestScore = score;
        bestFn = fn;
      }
    }

    if (bestFn && bestScore >= MATCH_THRESHOLD) {
      const result = { ...c, zaloId: bestFn.friend.userId, zaloName: bestFn.raw, matched: true, matchScore: bestScore };
      // Lookup Xưng hô + Tên từ Customer DB nếu chưa có
      if (!result.danhXung || !result.tenGoi) {
        const dbLookup = lookupCustomer(bestFn.friend.userId, c.tenDanhBa);
        if (dbLookup) {
          if (!result.danhXung && dbLookup.danhXung) result.danhXung = dbLookup.danhXung;
          if (!result.tenGoi && dbLookup.tenGoi) result.tenGoi = dbLookup.tenGoi;
        }
      }
      return result;
    }

    // 2. Fallback: match from saved sources (contacts_saved, addfriend, stranger)
    let bestSavedScore = 0;
    let bestSaved: typeof savedNames[0] | null = null;

    for (const sn of savedNames) {
      const score = calcMatchScore(searchNorm, sn.norm);
      if (score > bestSavedScore) {
        bestSavedScore = score;
        bestSaved = sn;
      }
    }

    if (bestSaved && bestSavedScore >= MATCH_THRESHOLD) {
      const result = { ...c, zaloId: bestSaved.entry.userId, zaloName: bestSaved.raw, matched: true, matchScore: bestSavedScore };
      if (!result.danhXung || !result.tenGoi) {
        const dbLookup = lookupCustomer(bestSaved.entry.userId, c.tenDanhBa);
        if (dbLookup) {
          if (!result.danhXung && dbLookup.danhXung) result.danhXung = dbLookup.danhXung;
          if (!result.tenGoi && dbLookup.tenGoi) result.tenGoi = dbLookup.tenGoi;
        }
      }
      return result;
    }

    return { ...c, matched: false, matchScore: 0 };
  });
}

export function exportContactsToXlsx(contacts: Contact[]): Buffer {
  const data = contacts.map((c) => ({
    "Danh bạ Zalo": c.tenDanhBa,
    "Danh xưng": c.danhXung,
    "Tên gọi": c.tenGoi,
    "Label": c.label || "",
    "Match": c.matched ? (c.zaloName || "✓") : "",
    "Score": c.matchScore || "",
    "Zalo ID": c.zaloId || "",
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Danh bạ");
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}
