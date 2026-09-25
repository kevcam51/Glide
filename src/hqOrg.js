// Smooth Training HQ — the org chart (S238, Kevin).
//
// Kevin's own business crew: AI workers organized like a real company, with a
// department head over every team and Kevin as the owner. He was shown an
// Instagram reel of a pixel-art "AI agent space dungeon sweatshop" and liked the
// SYSTEM while rejecting the framing, in his words: "I want workers, not
// slaves." So the structure below is a workplace on purpose — every seat has a
// title, a job description and a boss, and nothing leaves the building without
// the owner's OK.
//
// ⚠️ THIS FILE IS STRUCTURE, NEVER BUSINESS DATA. It ships in a lazy chunk that
// only the admin menu row loads, but a chunk is still a public file on the CDN.
// Titles and job descriptions are fine to ship; a QuickBooks figure, a client's
// name or a drafted email must live server-side behind an admin check, never
// here.
//
// Every seat is one of four states:
//   you       — the owner's own seat
//   training  — hired, waiting on a one-time connection before the first shift
//   open      — a position on the org chart nobody fills yet
// (Live states — on shift, working — arrive with the worker engine.)

export const ROOMS = [
  { id: "owner",     floor: 4, name: "Your Office",       tagline: "Where every decision lands",
    uses: "Everything that needs your OK ends up on your desk here. Nothing is sent, paid or published without you." },
  { id: "chief",     floor: 4, name: "Chief of Staff",    tagline: "Runs the building day to day",
    uses: "Collects every department's work into one morning brief, so you read one page instead of six." },
  { id: "finance",   floor: 3, name: "Finance",           tagline: "Money in, money out",
    uses: "A weekly look at your books from QuickBooks: what came in, what went out, and anything that looks off." },
  { id: "ops",       floor: 3, name: "Operations & Tech", tagline: "Keeps Glidna and the tools running",
    uses: "Checks glidna.com and runs the tests every morning, so you hear about a problem before a client does." },
  { id: "marketing", floor: 2, name: "Marketing",         tagline: "Bringing in new clients",
    uses: "Drafts posts from real client wins and asks happy clients for reviews, all waiting for your OK." },
  { id: "research",  floor: 2, name: "Research & Growth", tagline: "What's next for the business",
    uses: "Keeps an eye on Miami competitors and pricing, and finds partners worth a conversation." },
  { id: "front",     floor: 1, name: "Front Office",      tagline: "Clients and new inquiries",
    uses: "Reads new inquiries and drafts replies in your voice. You read, tweak and send them yourself." },
  { id: "coaching",  floor: 1, name: "Coaching",          tagline: "Client results",
    uses: "Reads Glidna each week to show who's slipping and who's winning, and drafts check-ins for you to send." },
];

export const FLOORS = [4, 3, 2, 1];

// `short` is the name tag drawn over the seat in the building, so it has to fit
// a quarter of a phone-width room. `title` is the real title everywhere else.
export const SEATS = [
  // ── Your Office ───────────────────────────────────────────────────────────
  { id: "owner", room: "owner", role: "owner", title: "Owner & Head Coach", short: "You", status: "you",
    job: "Sets direction and approves anything that goes out: messages to clients, money and changes to the live app." },

  // ── Chief of Staff ────────────────────────────────────────────────────────
  { id: "chief-of-staff", room: "chief", role: "head", title: "Chief of Staff", short: "Chief", status: "open",
    job: "Gathers each department's work, writes your morning brief and puts anything that needs you on your desk.",
    hireWhen: "After Finance and the Front Office are running" },

  // ── Finance ───────────────────────────────────────────────────────────────
  { id: "finance-manager", room: "finance", role: "head", title: "Finance Manager", short: "Manager", status: "open",
    job: "Double-checks the Bookkeeper's numbers before they reach you and writes the monthly money summary." },
  { id: "bookkeeper", room: "finance", role: "worker", title: "Bookkeeper", short: "Bookkeeper", status: "training",
    firstHire: true, engine: "claude", waitingOn: "you connect Glidna to your Claude account",
    job: "Checks your QuickBooks every Monday: money in, money out, who owes you and anything unusual." },
  { id: "billing-specialist", room: "finance", role: "worker", title: "Billing Specialist", short: "Billing", status: "open",
    job: "Watches session payments: failed cards, refunds to review and clients with no card on file." },

  // ── Operations & Tech ─────────────────────────────────────────────────────
  { id: "operations-manager", room: "ops", role: "head", title: "Operations Manager", short: "Manager", status: "open",
    job: "Keeps the tools running and decides which problems are worth your time." },
  { id: "systems-watchdog", room: "ops", role: "worker", title: "Systems Watchdog", short: "Watchdog", status: "open",
    job: "Opens glidna.com and runs the tests every morning, and reports anything broken." },

  // ── Marketing ─────────────────────────────────────────────────────────────
  { id: "marketing-manager", room: "marketing", role: "head", title: "Marketing Manager", short: "Manager", status: "open",
    job: "Plans the content calendar and reviews every post before you see it." },
  { id: "content-creator", room: "marketing", role: "worker", title: "Content Creator", short: "Content", status: "open",
    job: "Drafts posts from real client wins, and only with that client's permission." },
  { id: "reviews-referrals", room: "marketing", role: "worker", title: "Reviews & Referrals Coordinator", short: "Referrals", status: "open",
    job: "Drafts review and referral requests for clients who are happy with their results." },

  // ── Research & Growth ─────────────────────────────────────────────────────
  { id: "growth-manager", room: "research", role: "head", title: "Growth Manager", short: "Manager", status: "open",
    job: "Turns research into a short list of ideas worth your time." },
  { id: "market-researcher", room: "research", role: "worker", title: "Market Researcher", short: "Research", status: "open",
    job: "Tracks Miami competitors, their pricing and what's trending in fitness." },
  { id: "partnerships-scout", room: "research", role: "worker", title: "Partnerships Scout", short: "Partners", status: "open",
    job: "Finds partners worth meeting: gyms, physical therapists and companies that want wellness programs." },

  // ── Front Office ──────────────────────────────────────────────────────────
  { id: "front-office-manager", room: "front", role: "head", title: "Front Office Manager", short: "Manager", status: "open",
    job: "Checks every drafted reply before it reaches you and keeps track of how fast people hear back." },
  { id: "front-desk", room: "front", role: "worker", title: "Front Desk Coordinator", short: "Front Desk", status: "training",
    firstHire: true, engine: "claude", waitingOn: "Glidna and Gmail are connected to your Claude account",
    job: "Reads new inquiries in your email and drafts replies in your voice. You send them yourself." },
  { id: "scheduling", room: "front", role: "worker", title: "Scheduling Coordinator", short: "Scheduling", status: "open",
    job: "Keeps an eye on sessions, reschedules and no-shows, and drafts reminders." },
  { id: "onboarding", room: "front", role: "worker", title: "Client Onboarding Specialist", short: "Onboarding", status: "open",
    job: "Gets new clients ready: welcome message, intake questions, waiver and first-session details." },

  // ── Coaching ──────────────────────────────────────────────────────────────
  { id: "client-success-manager", room: "coaching", role: "head", title: "Client Success Manager", short: "Manager", status: "open",
    job: "Reviews every check-in and progress note before it reaches you." },
  { id: "progress-analyst", room: "coaching", role: "worker", title: "Progress Analyst", short: "Progress", status: "open",
    job: "Reads Glidna each week to see who's slipping, who's winning and who needs a call." },
  { id: "check-in-coordinator", room: "coaching", role: "worker", title: "Check-In Coordinator", short: "Check-ins", status: "open",
    job: "Drafts personal check-in messages for your clients, for you to approve." },
];

// The rules every worker follows, whatever department it sits in. The HQ screen
// prints them, and the worker engine will enforce them in code rather than
// trusting a prompt to remember them.
export const CREW_RULES = [
  { title: "Drafts, never sends", body: "Workers write the email, the post or the reminder. You read it and send it yourself." },
  { title: "Never moves money", body: "No payments, refunds or transfers. Finance reports on money; it never touches it." },
  { title: "Never deletes", body: "Nothing in your inbox, your books or Glidna gets deleted by a worker." },
  { title: "Only the tools the job needs", body: "The Bookkeeper can read QuickBooks but not your email. The Front Desk can draft emails but not send them." },
  { title: "Every shift is logged", body: "Each worker keeps a time card: when it clocked in, what it looked at and what it produced." },
  { title: "A manager checks the work", body: "Each department head reviews its team's work before it reaches your desk." },
  { title: "Advice stays with the pros", body: "No tax, legal, investment or medical advice. Those questions go to your accountant, lawyer or doctor." },
];

// Where a worker's thinking runs (S238, Kevin: "I'm already paying $200 a
// month and I want to be able to use that as well").
//   claude — a Claude routine on the owner's own Claude plan, in Anthropic's
//            cloud: no extra bill within the plan's limits, runs with his Mac
//            closed, and reaches QuickBooks / Gmail through the connectors he
//            has already signed into. At most hourly; shares the plan's limits.
//   cloud  — a Glidna Cloud Function on Google's servers, paying per use from
//            Glidna's own Anthropic account: any schedule, always on, but every
//            outside connection has to be built into Glidna first.
export const ENGINES = {
  claude: { label: "Your Claude plan", short: "Claude" },
  cloud: { label: "Glidna cloud", short: "Cloud" },
  manual: { label: "By hand", short: "Manual" },
};

// The HQ is built one piece at a time (Kevin: "every time we build something
// please let me know what it is that was built and how we're going to use
// this piece"). The screen shows this list so the plan lives where he looks.
export const BLUEPRINT = [
  { id: "building", title: "The station and the org chart", status: "built",
    use: "Watch the crew on the map, with every department's numbers down the sides." },
  { id: "desk", title: "Your desk and time cards", status: "built",
    use: "One tray for everything waiting on your OK, and a log of every shift." },
  { id: "door", title: "The crew's front door", status: "built",
    use: "Workers running on your Claude plan hand their work to this desk through the Glidna connector." },
  { id: "finance", title: "Finance: the Bookkeeper, on your Claude plan", status: "next",
    use: "Every Monday it reads QuickBooks and puts a money report on your desk." },
  { id: "front", title: "Front Office: the Front Desk, on your Claude plan", status: "planned",
    use: "Drafts replies to new inquiries in your Gmail. You send them yourself." },
  { id: "cloud", title: "Glidna cloud workers", status: "planned",
    use: "Round-the-clock jobs that watch Glidna itself, like the Systems Watchdog." },
  { id: "chief", title: "Chief of Staff: your morning brief", status: "planned",
    use: "One page each morning: what every department did and what needs you." },
];

export const roomById = (id) => ROOMS.find((r) => r.id === id) || null;
export const seatById = (id) => SEATS.find((s) => s.id === id) || null;
export const seatsIn = (roomId) => SEATS.filter((s) => s.room === roomId);
export const headOf = (roomId) => SEATS.find((s) => s.room === roomId && (s.role === "head" || s.role === "owner")) || null;
export const roomsOnFloor = (floor) => ROOMS.filter((r) => r.floor === floor);

export function orgCounts(seats = SEATS) {
  const count = (status) => seats.filter((s) => s.status === status).length;
  return { total: seats.length, you: count("you"), training: count("training"), open: count("open") };
}

// One line under a room's name: what state its seats are in, in plain words.
export function roomSummary(roomId) {
  const seats = seatsIn(roomId);
  const training = seats.filter((s) => s.status === "training").length;
  const open = seats.filter((s) => s.status === "open").length;
  const parts = [];
  if (seats.some((s) => s.status === "you")) parts.push("You");
  if (training) parts.push(`${training} in training`);
  if (open) parts.push(`${open} open`);
  return parts.join(" · ");
}
