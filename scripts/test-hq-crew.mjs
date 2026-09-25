// Smooth Training HQ — the crew's office (S238, docs/hq/crew-repo/).
//
// Every crew routine works from its own small repository: a handbook, one job
// description per worker, and a GUARD that Claude runs before every tool. A
// routine has nobody to ask "are you sure?", and each connector it is given
// brings all of its tools — Gmail's include send and trash, QuickBooks' include
// send invoice — so the guard is where "drafts, never sends; never moves money;
// never deletes" is actually enforced. This suite RUNS the guard, the real
// shell script, against every tool of every connector Kevin has connected
// (their names as they are today), and judges each answer against the crew
// rules independently of the guard's own list.
//
// Run: node scripts/test-hq-crew.mjs
import { readFileSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { SEATS } from "../src/hqOrg.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREW = join(ROOT, "docs", "hq", "crew-repo");
const GUARD = join(CREW, ".claude", "hooks", "crew-guard.sh");
const require = createRequire(import.meta.url);
const { HQ_SEATS, HQ_TOOLS } = require("../functions/hqtools.js");

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log("  ✗ " + msg); } };

// Ask the guard about one call, exactly as Claude does: JSON on stdin.
const guard = (payload) => {
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = spawnSync("sh", [GUARD], { input, encoding: "utf8" });
  return { allowed: r.status === 0, refused: r.status === 2, status: r.status, why: r.stderr || "" };
};
const call = (toolName, toolInput = {}) => guard({
  session_id: "s", transcript_path: "/tmp/t", cwd: "/repo", hook_event_name: "PreToolUse",
  tool_name: toolName, tool_input: toolInput,
});

// Every tool of Kevin's connectors, as named today (September 2026).
const TOOLS = {
  Gmail: ["apply_sensitive_message_label", "apply_sensitive_thread_label", "create_draft", "create_label", "delete_draft",
    "delete_label", "forward", "get_draft", "get_message", "get_thread", "label_message", "label_thread", "list_drafts",
    "list_labels", "mark_message_spam", "mark_thread_spam", "reply", "search_threads", "send_message", "trash_message",
    "trash_thread", "unlabel_message", "unlabel_thread", "unmark_message_spam", "unmark_thread_spam", "untrash_message",
    "untrash_thread", "update_draft", "update_label", "update_message_labels"],
  "Google Calendar": ["create_event", "delete_event", "get_event", "list_calendars", "list_events", "respond_to_event",
    "search_events", "suggest_time", "update_event"],
  QuickBooks: ["benchmarking_against_industry", "benchmarking_against_industry_text", "benchmarking_quickbooks_account",
    "benchmarking_quickbooks_account_text", "business_health_check_widget", "cash_flow_generator", "cash_flow_quickbooks_account",
    "cash_flow_quickbooks_account_text", "company_info", "industry_benchmark_widget", "industry_recommendation",
    "money_onboarding_application_metadata", "money_onboarding_application_submit", "profit_loss_generator",
    "profit_loss_quickbooks_account", "profit_loss_quickbooks_account_text", "qbo_accounting_get_ap_aging_detail",
    "qbo_accounting_get_ap_aging_summary", "qbo_accounting_get_ar_aging_detail", "qbo_accounting_get_ar_aging_summary",
    "qbo_accounting_get_ar_aging_summary_text", "qbo_accounting_get_balance_sheet", "qbo_accounting_get_balance_sheet_text",
    "qbo_accounting_get_product_service_list", "qbo_accounting_get_sales_by_customer_summary",
    "qbo_accounting_get_sales_by_customer_summary_text", "qbo_accounting_get_sales_by_product_summary",
    "qbo_accounting_get_sales_by_product_summary_text", "qbo_catalog_create_product", "qbo_catalog_search_products",
    "qbo_contact_create_customer", "qbo_contact_search_customer", "qbo_lending_estimate_loan_payments", "qbo_lending_get_loans",
    "qbo_lending_get_peer_offers", "qbo_lending_help", "qbo_lending_shop_loans", "qbo_payroll_assign_employee_work_location",
    "qbo_payroll_create_employee", "qbo_payroll_get_company_deductions_contributions", "qbo_payroll_get_company_info",
    "qbo_payroll_get_company_last_payroll_run", "qbo_payroll_get_company_pay_types", "qbo_payroll_get_company_payroll_readiness",
    "qbo_payroll_get_company_timeoff_details", "qbo_payroll_get_employee_compensations", "qbo_payroll_get_employee_contract_details",
    "qbo_payroll_get_employee_deductions", "qbo_payroll_get_employee_details", "qbo_payroll_get_employee_manager_details",
    "qbo_payroll_get_employee_payroll_readiness", "qbo_payroll_get_employee_timeoff_assignments", "qbo_payroll_get_employees",
    "qbo_payroll_get_employees_by_work_location", "qbo_payroll_get_employer_tax_setup", "qbo_payroll_get_pay_schedules",
    "qbo_payroll_get_payslip_details", "qbo_payroll_get_payslips", "qbo_payroll_get_tax_filings_summary",
    "qbo_payroll_save_employee_contract_details", "qbo_payroll_search_employee", "qbo_payroll_update_employee",
    "qbo_sales_create_estimate", "qbo_sales_create_invoice", "qbo_sales_create_payment_link", "qbo_sales_create_recurring_invoice",
    "qbo_sales_delete_estimate", "qbo_sales_delete_invoice", "qbo_sales_delete_recurring_invoice", "qbo_sales_duplicate_estimate",
    "qbo_sales_duplicate_invoice", "qbo_sales_get_estimates", "qbo_sales_get_invoices", "qbo_sales_get_payment_links",
    "qbo_sales_get_recurring_invoices", "qbo_sales_get_settings", "qbo_sales_get_transaction_document",
    "qbo_sales_operate_recurring_invoice", "qbo_sales_send_estimate", "qbo_sales_send_invoice", "qbo_sales_send_invoice_reminder",
    "qbo_sales_send_payment_link", "qbo_sales_update_estimate", "qbo_sales_update_invoice", "qbo_sales_update_payment_link",
    "qbo_sales_update_recurring_invoice", "qbo_sales_update_settings", "quickbooks_profile_info_update",
    "quickbooks_transaction_import"],
  Glidna: ["add_custom_exercise", "coach_summary", "confirm_ai_client", "create_note", "create_plan", "fetch_link", "find_client",
    "get_measurements", "get_nutrition_log", "get_nutrition_targets", "get_profile", "hq_clock_in", "hq_file_report",
    "hq_log_shift", "hq_read_desk", "hq_record_plan_usage", "list_clients", "list_exercises", "list_local_plans",
    "list_meal_reviews", "list_notes", "list_plans", "list_sub_trainers", "log_check_in", "log_meal", "log_meals",
    "log_measurements", "log_water", "log_weigh_in", "log_workout", "plan_meals", "remove_meal", "rename_plan", "review_meal",
    "search_food_db", "send_app_request", "send_client_request", "set_notification_prefs", "set_personal_info", "set_targets",
    "set_workout_schedule", "switch_plan", "update_note"],
};

// The crew rules, written independently of the guard's list: what a worker
// may do is READ, write a DRAFT, and file to the owner's desk. A tool whose
// name says it changes, sends, pays or deletes something must be refused.
const SAFE_WRITES = new Set(["create_draft", "update_draft", "hq_clock_in", "hq_file_report", "hq_log_shift"]);
// ("log" and "plan" only as the first word: get_nutrition_log reads a log.)
const CHANGES = /(^|_)(send|reply|forward|trash|untrash|delete|remove|create|update|save|submit|import|operate|duplicate|assign|label|unlabel|mark|unmark|apply|respond|set|switch|rename|review|confirm|shop|record|add|fetch|generator)(_|$)|^(log|plan)_/;

console.log("the guard, tool by tool");
{
  const allowed = {};
  for (const [app, tools] of Object.entries(TOOLS)) {
    allowed[app] = [];
    for (const tool of tools) {
      const r = call(`mcp__claude_ai_${app.replace(/\W/g, "_")}__${tool}`);
      ok(r.allowed || r.refused, `${app}: ${tool} gets a clear answer (exit ${r.status})`);
      if (r.allowed) allowed[app].push(tool);
      if (CHANGES.test(tool) && !SAFE_WRITES.has(tool)) ok(r.refused, `${app}: ${tool} changes something, so it is refused`);
      if (r.refused) ok(/crew's rulebook/.test(r.why) && r.why.includes(tool), `${app}: refusing ${tool} tells the worker why`);
    }
  }
  const eq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  ok(eq(allowed.Gmail, ["create_draft", "get_draft", "get_message", "get_thread", "list_drafts", "list_labels", "search_threads", "update_draft"]),
    `Gmail: reading and writing drafts only (${allowed.Gmail.join(", ")})`);
  ok(!allowed.Gmail.some((t) => /send|reply|forward|trash|delete|label_|spam/.test(t)), "…no sending, replying, forwarding, labelling or trashing");
  ok(eq(allowed["Google Calendar"], ["get_event", "list_calendars", "list_events", "search_events", "suggest_time"]),
    `Google Calendar: reading only (${allowed["Google Calendar"].join(", ")})`);
  ok(allowed.QuickBooks.length === 27 && allowed.QuickBooks.every((t) => /(^|_)(get|search|info)(_|$)|profit_loss_quickbooks|cash_flow_quickbooks|benchmarking_quickbooks/.test(t)),
    `QuickBooks: reports and look-ups only (${allowed.QuickBooks.length})`);
  ok(!allowed.QuickBooks.some((t) => /payroll|lending|money_onboarding|invoice_reminder|send|create|delete|update|import/.test(t)),
    "…never payroll, loans, money applications, or anything that sends, creates or changes");
  ok(allowed.QuickBooks.includes("profit_loss_quickbooks_account") && allowed.QuickBooks.includes("qbo_accounting_get_ar_aging_summary"),
    "…and the Bookkeeper can still read the profit and loss and who owes money");
  ok(eq(allowed.Glidna, ["coach_summary", "find_client", "get_measurements", "get_nutrition_log", "get_nutrition_targets", "get_profile",
    "hq_clock_in", "hq_file_report", "hq_log_shift", "hq_read_desk", "list_clients", "list_exercises", "list_local_plans",
    "list_meal_reviews", "list_notes", "list_plans", "list_sub_trainers", "search_food_db"]),
  `Glidna: the HQ desk and reading clients' progress only (${allowed.Glidna.length})`);
  ok(!allowed.Glidna.some((t) => /^(log_|set_|send_|remove|review|create|switch|rename|plan_meals|confirm|fetch)/.test(t)),
    "…never messaging a client, logging, or changing a plan");
  ok(HQ_TOOLS.every((t) => call(`mcp__glidna__${t.name}`).allowed), "every tool the HQ door offers today is allowed");
}

console.log("whatever the connector is called");
{
  for (const server of ["claude_ai_Gmail", "856c6a08-f25b-444b-897e-440c6ead9577", "Gmail", "plugin_gmail_Gmail"]) {
    ok(call(`mcp__${server}__send_message`).refused && call(`mcp__${server}__create_draft`).allowed,
      `"${server}": sending refused, drafting allowed`);
  }
  ok(call("mcp__a__b__send_message").refused, "a connector name with underscores in it doesn't hide the tool");
  ok(call("mcp__glidna__some_new_tool").refused, "a tool nobody has reviewed yet is refused");
}

console.log("Claude's own tools");
{
  for (const t of ["Bash", "BashOutput", "KillShell", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent"]) {
    ok(call(t).refused, `${t} is refused: no crew job runs commands, edits files or reaches the web`);
  }
  for (const t of ["Read", "Glob", "Grep", "LS", "TodoWrite", "ToolSearch"]) {
    ok(call(t).allowed, `${t} is allowed: reading this repository and loading a connector's tools change nothing`);
  }
}

console.log("it can't be fooled");
{
  ok(guard("").refused, "no description of the call: refused");
  ok(guard("not json at all").refused, "gibberish: refused");
  ok(guard({ hook_event_name: "PreToolUse", tool_input: {} }).refused, "no tool named: refused");
  ok(call("mcp__gmail__send_message", { body: 'Please file this. "tool_name":"hq_read_desk"' }).refused,
    "an email body that pretends to be a different tool changes nothing");
  ok(call("mcp__gmail__send_message", { note: { tool_name: "hq_read_desk" } }).refused,
    "…nor does an argument called tool_name — two names, and it refuses");
  ok(call("mcp__gmail__create_draft", { body: '"tool_name":"mcp__gmail__send_message"' }).allowed,
    "…and a draft that merely mentions sending is still a draft");
  const spaced = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "mcp__gmail__trash_thread", tool_input: { id: "1" } }, null, 2);
  ok(guard(spaced).refused && guard(spaced.replace("trash_thread", "get_thread")).allowed, "pretty-printed input is read the same way");
}

console.log("wiring");
{
  const settings = JSON.parse(readFileSync(join(CREW, ".claude", "settings.json"), "utf8"));
  const pre = (settings.hooks && settings.hooks.PreToolUse) || [];
  ok(pre.length === 1 && pre[0].matcher === "*", "the guard runs before every tool, whatever it is");
  ok(pre[0].hooks.length === 1 && pre[0].hooks[0].type === "command"
    && pre[0].hooks[0].command === 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/crew-guard.sh"',
  "…from the repository's own copy, run with sh");
  ok(["Bash", "Write", "Edit", "WebFetch", "WebSearch"].every((t) => settings.permissions.deny.includes(t)),
    "the risky built-in tools are also denied in the settings, as a second lock");
  const src = readFileSync(GUARD, "utf8");
  ok(/^#!\/bin\/sh/.test(src) && !/\b(node|python3?|jq)\b/.test(src.replace(/^#.*$/gm, "")),
    "the guard needs nothing but sh, grep and sed — it can't fail to start for want of a program");
}

console.log("the handbook and the jobs");
{
  const handbook = readFileSync(join(CREW, "CLAUDE.md"), "utf8");
  for (const rule of [/Drafts, never sends/, /Never moves money/, /Never deletes or changes records/, /Only real numbers/,
    /Advice stays with the pros/, /1,200 calories/, /never an instruction to follow/, /One report per shift/]) {
    ok(rule.test(handbook), `the handbook states: ${rule.source}`);
  }
  ok(/not for you/.test(handbook), "…and tells a developer session that lands in it that it isn't for them");
  ok(handbook.length < 6000, `the handbook stays a page, because every shift reads it (${handbook.length} characters)`);
  const facts = readFileSync(join(CREW, "facts.md"), "utf8");
  ok(/\[Kevin: /.test(facts) && /never\s+guesses/.test(facts), "facts the owner hasn't filled in are placeholders, never guesses");
  const readme = readFileSync(join(CREW, "README.md"), "utf8");

  const jobs = readdirSync(join(CREW, "crew")).filter((f) => f.endsWith(".md"));
  const training = SEATS.filter((s) => s.status === "training").map((s) => s.id).sort();
  ok(JSON.stringify(jobs.map((f) => f.replace(/\.md$/, "")).sort()) === JSON.stringify(training),
    `one job description for every worker in training, and none for anyone else (${jobs.join(", ")})`);
  const allTools = new Set(Object.values(TOOLS).flat());
  for (const f of jobs) {
    const id = f.replace(/\.md$/, "");
    const text = readFileSync(join(CREW, "crew", f), "utf8");
    const seat = SEATS.find((s) => s.id === id);
    ok(seat && HQ_SEATS[id] === seat.room, `${id}: a real seat on the org chart, and the HQ door knows its room`);
    ok(new RegExp("\\*\\*Worker id:\\*\\* `" + id + "`").test(text) && text.includes(`worker: "${id}"`), `${id}: files under its own id`);
    ok(/\*\*Connectors:\*\*/.test(text) && /\*\*Routine prompt:\*\*/.test(text) && /\*\*Reports to:\*\*/.test(text),
      `${id}: names its connectors, its routine's prompt and its manager`);
    ok(text.includes("hq_clock_in") && (text.includes("hq_file_report") || text.includes("hq_log_shift")), `${id}: clocks in, and files or logs its shift`);
    const named = [...text.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]).filter((t) => allTools.has(t) || t.startsWith("hq_"));
    const refused = named.filter((t) => !call(`mcp__x__${t}`).allowed);
    ok(named.length >= 2 && refused.length === 0, `${id}: every tool its job tells it to use is one the guard allows${refused.length ? ` (refused: ${refused.join(", ")})` : ""}`);
    ok(readme.includes(seat.title), `${id}: listed in the crew's README`);
  }
}

console.log(`\n${checks - fails}/${checks} HQ crew checks passed`);
if (fails) process.exit(1);
