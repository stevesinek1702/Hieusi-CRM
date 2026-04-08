import * as XLSX from "xlsx";
import { existsSync } from "fs";

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
 * Thuật toán match kiểu Zalo:
 * - Tách tên danh bạ thành các từ (search words)
 * - Tách tên friend thành các từ (target words)
 * - Mỗi search word phải khớp với 1 target word (exact hoặc prefix)
 * - Các target word phải khớp theo đúng thứ tự (không nhảy ngược)
 * - Score dựa trên: tỷ lệ search words khớp + tỷ lệ ký tự khớp chính xác
 *
 * Ví dụ:
 *   search "a hiep 4757678" vs target "a hiep 4757678 0907260810"
 *   → "a" khớp "a", "hiep" khớp "hiep", "4757678" khớp "4757678" → 3/3 = 100%
 *
 *   search "tran thu trinh" vs target "tra"
 *   → "tran" vs "tra": "tra" là prefix của "tran"? Không. "tran" startsWith "tra"? Có nhưng chỉ 1/3 từ → thấp
 */
function calcMatchScore(searchNorm: string, targetNorm: string): number {
  // Exact match
  if (targetNorm === searchNorm) return 100;

  // Full string contains (target chứa toàn bộ search hoặc ngược lại)
  if (targetNorm.includes(searchNorm)) return 98;
  if (searchNorm.includes(targetNorm)) {
    const ratio = targetNorm.length / searchNorm.length;
    if (ratio >= 0.7) return 95;
  }

  // Word-based matching (kiểu Zalo search)
  const searchWords = getWords(searchNorm);
  const targetWords = getWords(targetNorm);
  if (!searchWords.length || !targetWords.length) return 0;

  // Mỗi search word tìm target word khớp (exact hoặc prefix), theo thứ tự
  let matchedWords = 0;
  let matchedChars = 0;
  let totalSearchChars = 0;
  let lastTargetIdx = -1;

  for (const sw of searchWords) {
    totalSearchChars += sw.length;
    let bestIdx = -1;
    let bestMatchLen = 0;

    for (let ti = lastTargetIdx + 1; ti < targetWords.length; ti++) {
      const tw = targetWords[ti];
      if (tw === sw) {
        // Exact word match
        bestIdx = ti;
        bestMatchLen = sw.length;
        break;
      }
      if (tw.startsWith(sw)) {
        // Search word là prefix của target word: "hiep" matches "hiep4757678"
        // Nhưng chỉ khi search word đủ dài (>= 2 ký tự) để tránh match "a" với "abc"
        if (sw.length >= 2 || sw === tw) {
          bestIdx = ti;
          bestMatchLen = sw.length;
          break;
        }
      }
      if (sw.startsWith(tw)) {
        // Target word là prefix của search word: "4757678" target, "47576780907" search
        // Chỉ khi target word đủ dài
        if (tw.length >= 2) {
          bestIdx = ti;
          bestMatchLen = tw.length;
          break;
        }
      }
    }

    if (bestIdx >= 0) {
      matchedWords++;
      matchedChars += bestMatchLen;
      lastTargetIdx = bestIdx;
    }
  }

  if (matchedWords === 0) return 0;

  // Tỷ lệ từ khớp
  const wordRatio = matchedWords / searchWords.length;
  // Tỷ lệ ký tự khớp
  const charRatio = totalSearchChars > 0 ? matchedChars / totalSearchChars : 0;

  // Phải khớp ít nhất 50% số từ
  if (wordRatio < 0.5) return 0;

  // Nếu tất cả search words đều khớp exact
  if (matchedWords === searchWords.length && matchedChars === totalSearchChars) {
    // Tính score dựa trên tỷ lệ coverage của target
    const targetTotalChars = targetWords.reduce((s, w) => s + w.length, 0);
    const coverage = totalSearchChars / targetTotalChars;
    if (coverage >= 0.9) return 98;
    if (coverage >= 0.7) return 95;
    if (coverage >= 0.5) return 92;
    return 90;
  }

  // Score = trung bình giữa word ratio và char ratio, scale 60-89
  const rawScore = (wordRatio * 0.6 + charRatio * 0.4);
  return Math.round(60 + rawScore * 29);
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
      return { ...c, zaloId: bestFn.friend.userId, zaloName: bestFn.raw, matched: true, matchScore: bestScore };
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
      return { ...c, zaloId: bestSaved.entry.userId, zaloName: bestSaved.raw, matched: true, matchScore: bestSavedScore };
    }

    return { ...c, matched: false, matchScore: 0 };
  });
}

// Strict scoring: chỉ match khi thực sự chắc chắn, không match lung tung
function calcMatchScore(searchNorm: string, targetNorm: string): number {
  // Exact match
  if (targetNorm === searchNorm) return 100;

  // Target chứa toàn bộ search (alias dài hơn nhưng chứa đầy đủ tên danh bạ)
  // e.g. target="chu tao mbb 0913044884" contains search="chu tao mbb 0913044884"
  if (targetNorm.includes(searchNorm)) {
    return 95;
  }

  // Search chứa toàn bộ target - CHỈ khi target đủ dài (>= 70% search)
  // Tránh "a vu" match với "a vu 735903"
  if (searchNorm.includes(targetNorm)) {
    const ratio = targetNorm.length / searchNorm.length;
    if (ratio >= 0.7) return 90;
    // Quá ngắn → không match
    return 0;
  }

  return 0;
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
