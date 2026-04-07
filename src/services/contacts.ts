import * as XLSX from "xlsx";

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

// Calculate similarity score between two strings (0-100)
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);

  // Exact match
  if (na === nb) return 100;

  // One contains the other
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.round(70 + ratio * 25); // 70-95
  }

  // Check if last word(s) match (Vietnamese names: last word = tên gọi)
  const wordsA = na.split(" ");
  const wordsB = nb.split(" ");
  const lastA = wordsA[wordsA.length - 1];
  const lastB = wordsB[wordsB.length - 1];

  if (lastA === lastB && wordsA.length > 1 && wordsB.length > 1) {
    // Last name matches, check more overlap
    const commonWords = wordsA.filter((w) => wordsB.includes(w));
    const ratio = commonWords.length / Math.max(wordsA.length, wordsB.length);
    return Math.round(50 + ratio * 40); // 50-90
  }

  // Levenshtein-based similarity
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 100;
  const score = Math.round((1 - dist / maxLen) * 100);
  return Math.max(0, score);
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
    for (let j = 1; j <= n; j++) {
      if (i === 0) { dp[0][j] = j; continue; }
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

const MATCH_THRESHOLD = 60; // minimum score to consider a match

export function matchContactsWithFriends(contacts: Contact[], friends: any[]): Contact[] {
  const friendList = friends.map((f: any) => ({
    userId: f.userId,
    displayName: f.displayName || "",
    zaloName: f.zaloName || "",
    alias: f.alias || "",
  }));

  return contacts.map((c) => {
    let bestScore = 0;
    let bestFriend: typeof friendList[0] | null = null;
    let bestName = "";

    for (const f of friendList) {
      // Check against alias (tên danh bạ), displayName, and zaloName
      for (const fname of [f.alias, f.displayName, f.zaloName]) {
        if (!fname) continue;
        const score = similarity(c.tenDanhBa, fname);
        if (score > bestScore) {
          bestScore = score;
          bestFriend = f;
          bestName = fname;
        }
      }
    }

    if (bestFriend && bestScore >= MATCH_THRESHOLD) {
      return {
        ...c,
        zaloId: bestFriend.userId,
        zaloName: bestName,
        matched: true,
        matchScore: bestScore,
      };
    }
    return { ...c, matched: false, matchScore: 0 };
  });
}
