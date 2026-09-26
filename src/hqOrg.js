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
// Every seat STARTS in one of three states:
//   you       — the owner's own seat
//   training  — hired, waiting on a one-time connection before the first shift
//   open      — a position on the org chart nobody fills yet
// and what the crew actually does moves it on (liveSeats, below):
//   working   — has done real work (logged a shift or filed something)
//   on-shift  — clocked in right now

export const ROOMS = [
  { id: "owner",     floor: 4, name: "Your Office",       tagline: "Where every decision lands",
    uses: "Everything that needs your OK ends up on your desk here. Nothing is sent, paid or published without you." },
  { id: "chief",     floor: 4, name: "Chief of Staff",    tagline: "Runs the building day to day",
    uses: "Collects every department's work into one morning brief, so you read one page instead of six." },
  { id: "finance",   floor: 3, name: "Finance",           tagline: "Money in, money out",
    uses: "A weekly look at your books from QuickBooks: what came in, what went out, and anything that looks off." },
  { id: "ops",       floor: 3, name: "Operations & Tech", tagline: "Keeps the website, Glidna and the tools running",
    uses: "Watches your Claude plan and Glidna, and looks after the website, so you hear about a problem before a client does." },
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
// `duties` is EVERYTHING the seat is responsible for (Kevin: "when I click on
// the specific agent ... it tells me all of the jobs that they are responsible
// for"); `job` is the one-line version. `keywords` are the other words people
// use for the same work, so the search finds the right person for a problem
// ("website", "prices", "failed card"), not only for a title.
export const SEATS = [
  // ── Your Office ───────────────────────────────────────────────────────────
  { id: "owner", room: "owner", role: "owner", title: "Owner & Head Coach", short: "You", status: "you",
    job: "Sets direction and approves anything that goes out: messages to clients, money and changes to the live app.",
    duties: [
      "Sets the direction for Smooth Training and every department.",
      "Approves anything that goes out: messages to clients, posts, prices and changes to the website or Glidna.",
      "Signs off on anything to do with money.",
      "Coaches clients.",
    ],
    keywords: ["kevin", "owner", "me", "boss", "head coach", "approve", "approval"] },

  // ── Chief of Staff ────────────────────────────────────────────────────────
  { id: "chief-of-staff", room: "chief", role: "head", title: "Chief of Staff", short: "Chief", status: "open",
    job: "Gathers each department's work, writes your morning brief and puts anything that needs you on your desk.",
    hireWhen: "After Finance and the Front Office are running",
    duties: [
      "Writes your morning brief: what every department did and what needs you today.",
      "Puts anything urgent at the top of your desk.",
      "Keeps every department's work moving and flags anything stuck.",
      "Keeps track of what you've decided, so the whole crew follows it.",
    ],
    keywords: ["brief", "briefing", "summary", "daily", "morning", "priorities", "overview", "today", "coordinate", "assistant", "executive", "chief", "to do", "urgent"] },

  // ── Finance ───────────────────────────────────────────────────────────────
  { id: "finance-manager", room: "finance", role: "head", title: "Finance Manager", short: "Finance", status: "training",
    engine: "chat", waitingOn: "your first conversation with it", apps: ["Intuit QuickBooks (reports only)", "Glidna"],
    job: "Heads Finance: talks through your prices and plans with you, checks the Bookkeeper's numbers and writes the monthly money summary.",
    duties: [
      "Talks through your prices and plans with you: what each one earns against your time and costs, and what other Miami trainers charge.",
      "Double-checks the Bookkeeper's numbers before they reach you.",
      "Writes a monthly money summary: what came in, what went out and what was left, in plain words.",
      "Plans ahead for slow months, taxes and big purchases, and lists the questions for your accountant.",
      "Keeps an eye on what the business pays for, like software and subscriptions, and what's worth keeping.",
    ],
    keywords: ["finance officer", "head of finance", "cfo", "pricing", "prices", "price", "rates", "packages", "plans", "budget",
      "profit", "money", "revenue", "income", "forecast", "cash", "taxes", "costs", "expenses", "subscriptions", "accountant", "financial"] },
  { id: "bookkeeper", room: "finance", role: "worker", title: "Bookkeeper", short: "Bookkeeper", status: "training",
    firstHire: true, engine: "claude", waitingOn: "its routine is set up from the crew's repository (QuickBooks + Glidna)",
    apps: ["Intuit QuickBooks (reports only)", "Glidna"],
    job: "Checks your QuickBooks every Monday: money in, money out, who owes you and anything unusual.",
    duties: [
      "Reads your QuickBooks every Monday: money in, money out and anything unusual.",
      "Lists who owes you money, and for how long.",
      "Flags transactions that look wrong or have no category, for you to check.",
      "Puts a weekly money report on your desk.",
    ],
    keywords: ["quickbooks", "bookkeeping", "transactions", "expenses", "income", "receipts", "owes", "owed", "unpaid",
      "accounts", "categorize", "categories", "weekly report", "profit and loss", "p&l"] },
  { id: "billing-specialist", room: "finance", role: "worker", title: "Billing Specialist", short: "Billing", status: "open",
    job: "Watches session payments: failed cards, refunds to review and clients with no card on file.",
    duties: [
      "Watches session payments: failed cards and clients with no card on file.",
      "Lists refunds for you to review. It never issues one.",
      "Drafts friendly payment reminders for you to send.",
      "Checks every session you delivered was charged the right amount.",
    ],
    keywords: ["billing", "payments", "payment", "invoice", "invoices", "charge", "charged", "card", "failed card", "declined",
      "refund", "refunds", "stripe", "collect", "overdue", "late payment", "paid"] },

  // ── Operations & Tech ─────────────────────────────────────────────────────
  { id: "operations-manager", room: "ops", role: "head", title: "Operations Manager", short: "Manager", status: "open",
    job: "Keeps the tools running and decides which problems are worth your time.",
    duties: [
      "Decides which problems are worth your time, and in what order.",
      "Checks the Watchdog's and the Web Designer's work before it reaches you.",
      "Keeps a list of the tools and accounts the business runs on.",
      "Plans fixes and upgrades with you.",
    ],
    keywords: ["operations", "ops", "tools", "systems", "tech", "technology", "accounts", "logins", "process", "workflow", "software"] },
  { id: "systems-watchdog", room: "ops", role: "worker", title: "Systems Watchdog", short: "Watchdog", status: "training",
    engine: "mac", waitingOn: "its first evening check on your Mac", apps: ["Your Claude app (its usage meter)", "Glidna"],
    job: "Every evening, checks how much of your Claude plan you and the crew have used and whether every crew run went through, and puts a note on your desk when it's time to upgrade.",
    duties: [
      "Checks every evening how much of your Claude plan you and the crew have used.",
      "Makes sure every crew shift actually ran.",
      "Tells you when it's time to upgrade, with the options from cheapest up.",
      "Later: opens glidna.com every morning and reports anything broken.",
    ],
    keywords: ["claude", "claude plan", "usage", "limit", "limits", "upgrade", "max", "pro", "monitor", "uptime", "outage", "down",
      "broken", "bug", "errors", "not working", "crashed", "tests", "glidna"] },
  { id: "web-designer", room: "ops", role: "worker", title: "Web Designer", short: "Web Design", status: "training",
    engine: "chat", waitingOn: "your first conversation with it", apps: ["Glidna"],
    job: "Looks after the website, Glidna and any other platform we build or edit: reviews them, designs improvements and prepares changes for your OK.",
    duties: [
      "Keeps smoothtraining.com up to date: its pages, prices, photos and the way people book.",
      "Reviews the website and Glidna, and lists what to improve first.",
      "Designs new pages and screens, and writes their words with Marketing.",
      "Prepares every change for you to approve. Nothing goes live until you say so.",
      "Looks after any other platform the business builds or edits.",
    ],
    keywords: ["website", "web", "site", "squarespace", "webflow", "design", "designer", "homepage", "home page", "landing page",
      "page", "pages", "domain", "seo", "google search", "app", "screens", "layout", "platform", "redesign", "logo", "photos",
      "booking page", "wix"] },

  // ── Marketing ─────────────────────────────────────────────────────────────
  { id: "marketing-manager", room: "marketing", role: "head", title: "Marketing Manager", short: "Manager", status: "open",
    job: "Plans the content calendar and reviews every post before you see it.",
    duties: [
      "Plans the content calendar.",
      "Reviews every post before you see it.",
      "Keeps the brand consistent: its voice, its look and its offers.",
      "Tracks what brings new clients in.",
    ],
    keywords: ["marketing", "brand", "branding", "campaign", "ads", "advertising", "promotion", "promote", "strategy",
      "content calendar", "leads", "social", "audience"] },
  { id: "content-creator", room: "marketing", role: "worker", title: "Content Creator", short: "Content", status: "open",
    job: "Drafts posts from real client wins, and only with that client's permission.",
    duties: [
      "Drafts posts from real client wins, and only with that client's permission.",
      "Writes captions, newsletters and scripts for short videos.",
      "Turns your workouts and tips into posts.",
    ],
    keywords: ["instagram", "tiktok", "facebook", "social media", "posts", "post", "content", "captions", "caption", "reels",
      "video", "videos", "newsletter", "blog", "stories"] },
  { id: "reviews-referrals", room: "marketing", role: "worker", title: "Reviews & Referrals Coordinator", short: "Referrals", status: "open",
    job: "Drafts review and referral requests for clients who are happy with their results.",
    duties: [
      "Drafts review requests for clients who are happy with their results.",
      "Drafts referral asks and thank-you notes.",
      "Keeps track of new reviews, and of who referred whom.",
    ],
    keywords: ["reviews", "review", "google reviews", "yelp", "testimonials", "testimonial", "referrals", "referral",
      "word of mouth", "thank you", "rating"] },

  // ── Research & Growth ─────────────────────────────────────────────────────
  { id: "growth-manager", room: "research", role: "head", title: "Growth Manager", short: "Manager", status: "open",
    job: "Turns research into a short list of ideas worth your time.",
    duties: [
      "Turns research into a short list of ideas worth your time.",
      "Sizes up each idea: what it could earn and what it would take.",
      "Keeps track of the ideas you've tried and how they went.",
    ],
    keywords: ["growth", "grow", "ideas", "strategy", "expansion", "expand", "new services", "opportunities", "business plan"] },
  { id: "market-researcher", room: "research", role: "worker", title: "Market Researcher", short: "Research", status: "open",
    job: "Tracks Miami competitors, their pricing and what's trending in fitness.",
    duties: [
      "Tracks Miami competitors and what they charge.",
      "Watches what's trending in fitness and nutrition.",
      "Answers research questions you ask.",
    ],
    keywords: ["research", "competitors", "competitor", "competition", "market", "trends", "trending", "what others charge",
      "benchmark", "other trainers"] },
  { id: "partnerships-scout", room: "research", role: "worker", title: "Partnerships Scout", short: "Partners", status: "open",
    job: "Finds partners worth meeting: gyms, physical therapists and companies that want wellness programs.",
    duties: [
      "Finds partners worth meeting: gyms, physical therapists and companies that want wellness programs.",
      "Drafts introduction emails for you to send.",
      "Keeps a list of partners and where each conversation stands.",
    ],
    keywords: ["partners", "partner", "partnerships", "gyms", "gym", "physical therapists", "physical therapy", "corporate",
      "wellness", "companies", "collaboration", "collaborations", "sponsorship"] },

  // ── Front Office ──────────────────────────────────────────────────────────
  { id: "front-office-manager", room: "front", role: "head", title: "Front Office Manager", short: "Manager", status: "open",
    job: "Checks every drafted reply before it reaches you and keeps track of how fast people hear back.",
    duties: [
      "Checks every drafted reply before it reaches you.",
      "Keeps track of how fast people hear back.",
      "Keeps the fact sheet the crew answers from (prices, area, hours, policies) up to date with you.",
    ],
    keywords: ["front office", "customer service", "response time", "replies", "communications", "fact sheet", "facts", "policies"] },
  { id: "front-desk", room: "front", role: "worker", title: "Front Desk Coordinator", short: "Front Desk", status: "training",
    firstHire: true, engine: "claude", waitingOn: "its routine is set up from the crew's repository (Gmail + Glidna, drafts only)",
    apps: ["Gmail (drafts only)", "Glidna"],
    job: "Reads new inquiries in your email and drafts replies in your voice. You send them yourself.",
    duties: [
      "Reads new inquiries in your email twice every weekday.",
      "Drafts replies in your voice, waiting in Gmail for you to send.",
      "Flags anything urgent: a same-day cancellation, a complaint or an injury.",
      "Answers only from the fact sheet, and leaves a blank for you rather than guess a price.",
    ],
    keywords: ["email", "emails", "gmail", "inbox", "inquiries", "inquiry", "leads", "questions", "reply", "respond",
      "messages", "contact", "prospects", "new people"] },
  { id: "scheduling", room: "front", role: "worker", title: "Scheduling Coordinator", short: "Scheduling", status: "open",
    job: "Keeps an eye on sessions, reschedules and no-shows, and drafts reminders.",
    duties: [
      "Keeps an eye on sessions, reschedules and no-shows.",
      "Drafts reminders and offers of a new time for you to send.",
      "Spots double bookings and gaps in your week.",
    ],
    keywords: ["schedule", "scheduling", "calendar", "appointments", "appointment", "sessions", "session", "booking", "bookings",
      "reschedule", "cancel", "cancellation", "no-show", "no show", "acuity", "availability", "reminders"] },
  { id: "onboarding", room: "front", role: "worker", title: "Client Onboarding Specialist", short: "Onboarding", status: "open",
    job: "Gets new clients ready: welcome message, intake questions, waiver and first-session details.",
    duties: [
      "Gets new clients ready: a welcome message, intake questions, the waiver and first-session details.",
      "Makes sure every new client has a card on file and a plan in Glidna.",
      "Checks in after their first week.",
    ],
    keywords: ["onboarding", "new client", "new clients", "welcome", "intake", "waiver", "sign up", "signup", "first session",
      "getting started", "forms", "start"] },

  // ── Coaching ──────────────────────────────────────────────────────────────
  { id: "client-success-manager", room: "coaching", role: "head", title: "Client Success Manager", short: "Manager", status: "open",
    job: "Reviews every check-in and progress note before it reaches you.",
    duties: [
      "Reviews every check-in and progress note before it reaches you.",
      "Watches how happy clients are, and who might be thinking of leaving.",
      "Plans how to keep every client on track.",
    ],
    keywords: ["client success", "retention", "happy", "happiness", "satisfaction", "leaving", "quit", "quitting", "cancel membership", "keep clients"] },
  { id: "progress-analyst", room: "coaching", role: "worker", title: "Progress Analyst", short: "Progress", status: "training",
    firstHire: true, engine: "claude", waitingOn: "its routine is set up from the crew's repository (Glidna only)",
    apps: ["Glidna"],
    job: "Reads Glidna each week to see who's slipping, who's winning and who needs a call, and drafts check-ins for you to send.",
    duties: [
      "Reads Glidna every week: who's slipping, who's winning and who needs a call.",
      "Spots clients who stopped logging food, weigh-ins or workouts.",
      "Drafts check-in messages for you to send.",
    ],
    keywords: ["progress", "results", "stalled", "slipping", "plateau", "weight loss", "logging", "analytics", "tracking",
      "clients", "who needs", "data", "weigh-ins", "nutrition"] },
  { id: "check-in-coordinator", room: "coaching", role: "worker", title: "Check-In Coordinator", short: "Check-ins", status: "open",
    job: "Drafts personal check-in messages for your clients, for you to approve.",
    duties: [
      "Drafts personal check-in messages for your clients, for you to approve.",
      "Keeps each client's check-ins coming at the right rhythm.",
      "Remembers birthdays and milestones.",
    ],
    keywords: ["check-in", "check in", "checkins", "follow up", "follow-up", "message clients", "texts", "motivation",
      "accountability", "birthday", "milestones"] },
];

// The rules every worker follows, whatever department it sits in. The HQ screen
// prints them, and the worker engine will enforce them in code rather than
// trusting a prompt to remember them.
export const CREW_RULES = [
  { title: "Drafts, never sends", body: "Workers write the email, the post or the reminder. You read it and send it yourself." },
  { title: "Never moves money", body: "No payments, refunds or transfers. Finance reports on money; it never touches it." },
  { title: "Never deletes", body: "Nothing in your inbox, your books or Glidna gets deleted by a worker." },
  { title: "Only the tools the job needs", body: "Each worker gets only the apps its job needs, and a guard in front of every worker refuses any tool that could send, pay, delete or change something. The Front Desk can write a Gmail draft; it can't send one." },
  { title: "Every shift is logged", body: "Each worker keeps a time card: when it clocked in, what it looked at and what it produced." },
  { title: "A manager checks the work", body: "Each department head reviews its team's work before it reaches your desk." },
  { title: "Advice stays with the pros", body: "No tax, legal, investment or medical advice. Those questions go to your accountant, lawyer or doctor." },
];

// Where a worker's thinking runs (S238, Kevin: "I'm already paying $200 ...
// and I want to be able to use that as well"). The plan is Claude Pro, paid
// yearly: $200 a YEAR, not a month (confirmed from the app, round 5).
//   claude — a Claude routine on the owner's own Claude plan, in Anthropic's
//            cloud: no extra bill within the plan's limits, runs with his Mac
//            closed, and reaches QuickBooks / Gmail through the connectors he
//            has already signed into. At most hourly; shares the plan's limits
//            with his own use of Claude, and Pro caps how many can run a day.
//   mac    — a scheduled task in the Claude app on the owner's Mac. Runs when
//            the app is open (or the next time it opens). Only for what the
//            cloud can't see, like the plan's own usage meter.
//   chat   — nothing runs on a schedule: Kevin talks to it when he needs it,
//            in an ordinary chat in his Claude app (not Claude Code), started
//            from the brief on its HQ profile (agentBrief, below).
//   cloud  — a Glidna Cloud Function on Google's servers, paying per use from
//            Glidna's own Anthropic account: any schedule, always on, but every
//            outside connection has to be built into Glidna first.
export const ENGINES = {
  claude: { label: "Your Claude plan", short: "Claude" },
  mac: { label: "The Claude app on your Mac", short: "Mac" },
  chat: { label: "A chat you start in your Claude app", short: "Chat" },
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
  { id: "office", title: "The crew's own office: handbook, jobs and a guard", status: "built",
    use: "A private repository every routine works from. A guard in it refuses any tool that could send, pay, delete or change something, in code." },
  { id: "watchdog", title: "The Systems Watchdog: your plan's usage", status: "built",
    use: "Every evening it reads your Claude plan's usage meter and checks every crew run went through. When it's time to upgrade, a note lands on your desk." },
  { id: "profiles", title: "Every agent's profile, and a search to find the right one", status: "built",
    use: "Tap anyone to see everything they're responsible for, or type a name, a job or a problem to find who handles it." },
  { id: "finance", title: "The first shifts: Bookkeeper, Front Desk and Progress Analyst", status: "next",
    use: "Each gets its own routine on your Claude plan, with only its own apps. The Bookkeeper reads QuickBooks every Monday and puts a money report on your desk." },
  { id: "front", title: "Front Office: the Front Desk, on your Claude plan", status: "planned",
    use: "Twice each weekday it drafts replies to new inquiries in your Gmail. You send them yourself." },
  { id: "coaching", title: "Coaching: the Progress Analyst, on your Claude plan", status: "planned",
    use: "Every Tuesday it reads Glidna, shows who's slipping or winning, and drafts check-ins for you to send." },
  { id: "cloud", title: "Glidna cloud workers", status: "planned",
    use: "Round-the-clock jobs that watch Glidna itself, like the Systems Watchdog." },
  { id: "chief", title: "Chief of Staff: your morning brief", status: "planned",
    use: "One page each morning: what every department did and what needs you." },
];

export const roomById = (id) => ROOMS.find((r) => r.id === id) || null;

// Who a seat answers to: a worker to its department's head, a department head
// to the Chief of Staff, and the Chief of Staff to the owner.
export function reportsTo(seat, seats = SEATS) {
  if (!seat || seat.role === "owner") return null;
  const owner = seats.find((s) => s.role === "owner") || null;
  if (seat.role === "head") {
    if (seat.room === "chief") return owner;
    return seats.find((s) => s.room === "chief" && s.role === "head") || owner;
  }
  return seats.find((s) => s.room === seat.room && s.role === "head") || owner;
}

// ── Finding the right person ────────────────────────────────────────────────
// Kevin: "some type of search where I can type a name, job type, etc and it
// should point me in the right direction on who is the agent that can assist
// me on that particular issue". Everyone on the chart can be found, hired or
// not, so a question about the website finds the Web Designer before the day
// it is hired, and says so.
const STOP_WORDS = new Set(("a an and are be can could do does for from get go got has have help how i im in into is it its " +
  "me my need needs of on or our please should some someone something that the their them this to up we what when where " +
  "which who whom will with would you your agent worker person handles handle deal about anyone does").split(" "));

function words(text) {
  return String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// A rough stem, so "invoices" finds "invoice", "pricing" finds "prices" and
// "scheduling" finds "schedule". Both sides of a match go through it.
export function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && /(er|ed)$/.test(s)) s = s.slice(0, -2);
  if (s.length > 4 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

// A query word matches a word on the chart when they share a stem, or when
// it is the start of one (someone still typing "webs" is after "website").
const matches = (q, w) => q === w || (q.length >= 3 && w.startsWith(q));

// How much each place a word can turn up counts: a seat's own title says the
// most about who it is; a word buried in one of its duties the least.
const FIELD_WEIGHTS = [["title", 6], ["short", 4], ["keywords", 4], ["job", 2], ["duties", 2], ["room", 1]];

function fieldsOf(seat) {
  const room = roomById(seat.room);
  return {
    title: seat.title, short: seat.short, keywords: (seat.keywords || []).join(" "),
    job: seat.job, duties: (seat.duties || []).join(" "), room: room ? `${room.name} ${room.tagline}` : "",
  };
}

export function findAgents(query, seats = SEATS, { limit = 5 } = {}) {
  const asked = [...new Set(words(query).filter((w) => !STOP_WORDS.has(w)).map(stem))];
  if (!asked.length) return [];
  const phrase = words(query).join(" ");
  const found = [];
  for (const seat of seats) {
    const fields = fieldsOf(seat);
    const stems = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, words(v).map(stem)]));
    let score = 0, hit = 0;
    for (const q of asked) {
      let best = 0;
      for (const [field, weight] of FIELD_WEIGHTS) {
        if (weight > best && stems[field].some((w) => matches(q, w))) best = weight;
      }
      if (best) { score += best; hit++; }
    }
    if (!score) continue;
    // The whole thing typed, word for word, in a title or a keyword: a strong sign.
    if (phrase.includes(" ") && [fields.title, fields.keywords].some((f) => words(f).join(" ").includes(phrase))) score += 6;
    // Why this seat: the duty that shares the most words with what was asked.
    const duties = seat.duties && seat.duties.length ? seat.duties : [seat.job];
    let why = duties[0], whyHits = -1;
    for (const d of duties) {
      const ds = words(d).map(stem);
      const n = asked.filter((q) => ds.some((w) => matches(q, w))).length;
      if (n > whyHits) { why = d; whyHits = n; }
    }
    found.push({ seat, score, hit, why });
  }
  const hired = (s) => (s.status === "open" ? 0 : 1);
  found.sort((a, b) => b.hit - a.hit || b.score - a.score || hired(b.seat) - hired(a.seat)
    || (a.seat.role === "head" ? 1 : 0) - (b.seat.role === "head" ? 1 : 0));
  // Only the people who really fit: a seat that shares one passing word with
  // the question (the owner's duties mention prices, too) isn't a lead.
  const top = Math.max(...found.map((f) => f.score));
  return found.filter((f) => f.score * 2 > top).slice(0, limit);
}

// The apps from a seat's list that are connectors, the switches in a chat's
// tools menu, without their notes: "Gmail (drafts only)" → "Gmail". The
// Watchdog's usage meter is the Claude app itself, not a switch.
const CONNECTORS = /^(Gmail|Google Calendar|Intuit QuickBooks|Glidna)\b/;
export function chatApps(seat) {
  return (seat && seat.apps ? seat.apps : []).filter((a) => CONNECTORS.test(a)).map((a) => a.replace(/ \(.*\)$/, ""));
}

// What to paste into a new chat to talk to this agent (Kevin: do I "make a new
// chat that is separate from Claude code"? — yes, this is how it starts). Only
// the seat's own structure goes in it: no business data lives in this file.
export function agentBrief(seat, seats = SEATS) {
  if (!seat || seat.role === "owner") return "";
  const room = roomById(seat.room);
  const boss = reportsTo(seat, seats);
  const lines = [
    `You are the ${seat.title} on the Smooth Training HQ crew${room ? `, in ${room.name}` : ""}. Smooth Training is Kevin Cameron's personal-training business in Miami, and I'm Kevin, the owner.`,
    "",
    "What you're responsible for:",
    ...(seat.duties && seat.duties.length ? seat.duties : [seat.job]).map((d) => `- ${d}`),
    "",
    "How you work:",
    "- You draft; you never send, pay, publish, delete or change anything yourself. I do that.",
    "- Only real numbers: quote what you actually read, and tell me when you're estimating.",
    "- No tax, legal, investment or medical advice. Those questions go to my accountant, lawyer or doctor.",
    "- Never suggest anyone eat below 1,200 calories a day.",
  ];
  const apps = (seat.apps || []).filter((a) => CONNECTORS.test(a));
  if (apps.length) lines.push(`- The apps you may use here: ${apps.join(", ")}.`);
  if (boss && boss.role !== "owner") lines.push(`- Check your own work the way the ${boss.title} would before you give it to me.`);
  // With Glidna switched on, the conversation shows on the HQ like any shift:
  // at the desk while it lasts, and anything worth keeping lands on Kevin's.
  if (chatApps(seat).includes("Glidna")) {
    lines.push("", `My HQ: when we start, clock in with Glidna's hq_clock_in (worker: "${seat.id}"). When we're done, put anything I should keep (a decision, a draft, a plan) on my desk with hq_file_report, or log our conversation with hq_log_shift.`);
  }
  lines.push("", "Here's what I need:");
  return lines.join("\n");
}
export const seatById = (id) => SEATS.find((s) => s.id === id) || null;
export const seatsIn = (roomId) => SEATS.filter((s) => s.room === roomId);
export const headOf = (roomId) => SEATS.find((s) => s.room === roomId && (s.role === "head" || s.role === "owner")) || null;
export const roomsOnFloor = (floor) => ROOMS.filter((r) => r.floor === floor);

export function orgCounts(seats = SEATS) {
  const count = (status) => seats.filter((s) => s.status === status).length;
  return {
    total: seats.length, you: count("you"), training: count("training"), open: count("open"),
    working: count("working"), onShift: count("on-shift"),
  };
}

// The seats as the crew has actually left them. The chart above says where a
// seat starts; real events move it: a worker clocked in right now is on
// shift, and one that has ever logged a shift or filed work is working —
// hired, and doing the job. Nothing here reads business data beyond WHO did
// something, and the owner's seat never changes.
export function liveSeats(seats = SEATS, { shifts = [], open = [], recent = [], active = [] } = {}) {
  const onShift = new Set((active || []).map((a) => a && a.worker));
  const worked = new Set([...(shifts || []), ...(open || []), ...(recent || [])].map((x) => x && x.worker));
  return seats.map((s) => {
    if (s.status === "you") return s;
    if (onShift.has(s.id)) return { ...s, status: "on-shift" };
    if (worked.has(s.id)) return { ...s, status: "working" };
    return s;
  });
}

// One line under a room's name: what state its seats are in, in plain words.
export function roomSummary(roomId, seats = SEATS) {
  const mine = seats.filter((s) => s.room === roomId);
  const n = (status) => mine.filter((s) => s.status === status).length;
  const parts = [];
  if (mine.some((s) => s.status === "you")) parts.push("You");
  if (n("on-shift")) parts.push(`${n("on-shift")} on shift`);
  if (n("working")) parts.push(`${n("working")} working`);
  if (n("training")) parts.push(`${n("training")} in training`);
  if (n("open")) parts.push(`${n("open")} open`);
  return parts.join(" · ");
}
