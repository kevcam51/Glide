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
