// Example desk items and time cards for the DEV-ONLY HQ preview (/?hq-preview).
//
// ⚠️ NEVER SHIPPED AND NEVER REAL. main.jsx imports this file only inside its
// `import.meta.env.DEV` branch, which a production build removes, and
// scripts/test-hq.mjs fails if HQ.jsx or App.jsx ever import it. Every item is
// written as an obvious example with no figures from anyone's books, so a
// screenshot of the preview can never be mistaken for a real report.

const now = Date.now();
const MIN = 60000, HOUR = 3600000, DAY = 86400000;

export const SAMPLE = {
  open: [
    {
      id: "example-report", worker: "bookkeeper", dept: "finance", kind: "report", engine: "claude",
      title: "Monday money check (example)",
      summary: "Example text: money in held steady, one software subscription went up, and nobody owes you money. Your real report will quote QuickBooks' own numbers.",
      headNote: "Example note: the totals match QuickBooks' own report month by month. September looks strong partly because payroll hasn't posted yet.",
      body: "EXAMPLE REPORT\n\nMoney in\n- Steady week over week.\n\nMoney out\n- One subscription went up.\n\nWho owes you\n- Nobody.\n\nQuestions for your accountant\n- Should the new subscription be split between business and personal use?",
      link: null, status: "open", createdAt: now - 2 * HOUR, updatedAt: now - 2 * HOUR, resolvedAt: null,
    },
    {
      id: "example-draft", worker: "front-desk", dept: "front", kind: "draft", engine: "claude",
      title: "Reply to a new inquiry about in-home training (example)",
      summary: "Example: someone asked about in-home sessions near Brickell. A friendly reply with your two open times is waiting in Gmail drafts.",
      headNote: "Example note: the tone matches your past replies. Double-check the Tuesday time before you send it.",
      body: "",
      link: { label: "Open draft in Gmail", url: "https://mail.google.com/mail/u/0/#drafts" },
      status: "open", createdAt: now - 25 * MIN, updatedAt: now - 25 * MIN, resolvedAt: null,
    },
  ],
  recent: [
    {
      id: "example-done", worker: "bookkeeper", dept: "finance", kind: "question", engine: "claude",
      title: "Is last month's equipment purchase a business expense? (example)",
      summary: "Example question you already answered.",
      headNote: null, body: "", link: null,
      status: "done", createdAt: now - 3 * DAY, updatedAt: now - 2 * DAY, resolvedAt: now - 2 * DAY,
    },
  ],
  shifts: [
    {
      id: "example-shift-1", worker: "front-desk", dept: "front", engine: "claude", status: "done",
      startedAt: now - 27 * MIN, endedAt: now - 25 * MIN,
      summary: "Example: read 3 new emails, found 1 inquiry, drafted 1 reply.",
      actions: ["Checked the inbox for new messages", "Found 1 new inquiry", "Drafted a reply in Gmail", "Put it on your desk"],
      deskItems: ["example-draft"], usage: null, costCents: null,
    },
    {
      id: "example-shift-2", worker: "bookkeeper", dept: "finance", engine: "claude", status: "done",
      startedAt: now - 2 * HOUR - 4 * MIN, endedAt: now - 2 * HOUR,
      summary: "Example: pulled last week's and last month's reports and checked them against each other.",
      actions: ["Read the profit and loss for each month", "Checked who owes you money", "Wrote the Monday money check"],
      deskItems: ["example-report"], usage: null, costCents: null,
    },
  ],
};

// Example spending for the preview's spending sheet: made-up amounts on the
// real calendar, labelled as examples, so the chart and the time-frame
// buttons can be tried without an owner's account.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (d) => d.toISOString().slice(0, 10);
function wobble(key) {
  let h = 7;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
}
SAMPLE.spend = (period, offset = 0) => {
  const t = new Date();
  const today = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
  let start, end, unit = "day", label;
  if (period === "year") {
    const y = today.getUTCFullYear() + offset;
    start = new Date(Date.UTC(y, 0, 1)); end = new Date(Date.UTC(y, 11, 31)); unit = "month"; label = `${y} (example)`;
  } else if (period === "month") {
    start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()} (example)`;
  } else {
    const len = period === "week" ? 7 : 14;
    const monday = new Date(today); monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const lastMonday = new Date(monday); lastMonday.setUTCDate(monday.getUTCDate() + offset * len);
    start = new Date(lastMonday); if (len === 14) start.setUTCDate(start.getUTCDate() - 7);
    end = new Date(start); end.setUTCDate(start.getUTCDate() + len - 1);
    label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCDate()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCDate()} (example)`;
  }
  const buckets = [];
  if (unit === "day") {
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = ymd(d);
      const future = d > today;
      const w = future ? 0 : wobble(key);
      buckets.push({ key, future, glidnaMicros: Math.round(w * 900000), calls: Math.round(w * 90), crewCents: 0, claudeShifts: 0 });
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const key = `${start.getUTCFullYear()}-${String(m + 1).padStart(2, "0")}`;
      const future = new Date(Date.UTC(start.getUTCFullYear(), m, 1)) > today;
      const w = future ? 0 : wobble(key);
      buckets.push({ key, future, glidnaMicros: Math.round(w * 18000000), calls: Math.round(w * 1800), crewCents: 0, claudeShifts: 0 });
    }
  }
  const micros = buckets.reduce((a, b) => a + b.glidnaMicros, 0);
  const calls = buckets.reduce((a, b) => a + b.calls, 0);
  const days = Math.round((end - start) / DAY) + 1;
  const monthsCounted = (() => {
    let n = 0;
    for (let m = 0; m < 12; m++) {
      const first = new Date(Date.UTC(start.getUTCFullYear(), m, 1));
      if (first >= new Date(Date.UTC(2026, 8, 1)) && first <= today) n++;
    }
    return n;
  })();
  const share = period === "month" ? 20000 : period === "year" ? 20000 * monthsCounted : Math.round((20000 * days) / 30.44);
  return {
    period, offset, label, start: ymd(start), end: ymd(end), unit, today: ymd(today), hasNext: offset < 0, buckets,
    glidna: { cents: micros / 10000, costMicros: micros, calls, untrackedTokens: 0 },
    crew: { cloudCents: 0, cloudShifts: 0, claudeShifts: 2, claudeMinutes: 6 },
    claude: { planCents: 20000, planName: "Claude plan", since: "2026-09", edited: false, shareCents: share, meter: null },
    totalCents: micros / 10000 + share,
  };
};

