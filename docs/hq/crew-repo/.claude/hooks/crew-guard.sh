#!/bin/sh
# Smooth Training HQ — the crew's guard.
#
# Claude runs this before EVERY tool a crew worker tries to use (it is wired up
# in .claude/settings.json). It lets through only what the crew rules allow:
# reading, writing drafts, and filing work to the owner's HQ desk. Anything
# that could send, pay, publish, delete or change a record is refused here, in
# code, so no worker can do it however it is asked — not by a confusing email,
# not by a note hidden in a document, not by its own mistake.
#
# A routine has no one to ask "are you sure?", and every connector it is given
# brings ALL of its tools (Gmail's include send and trash; QuickBooks' include
# send invoice). The routine's settings can only include or leave out a whole
# connector, so this list is where "drafts, never sends" is actually enforced.
#
# ⚠️ AN ALLOW-LIST, ON PURPOSE. A tool that isn't named below is refused, so a
# new tool a connector adds tomorrow is blocked until someone decides it is
# safe. And if this script can't tell which tool is being called, it refuses.
#
# Claude hands the guard a JSON description of the call on stdin; exit code 2
# refuses it and shows the worker the reason (stderr). Plain sh + grep + sed, so
# it runs on any machine the routine lands on.

refuse() {
  echo "Blocked by the crew's rulebook: $1" >&2
  exit 2
}

input=$(cat) || refuse "the guard could not read which tool this is, so it is refused to be safe."

# The tool's name. Quotes inside a JSON string are always escaped, so text
# inside the tool's arguments can never pass for this field. If the name is
# missing, or appears twice with two values, refuse.
names=$(printf '%s' "$input" | tr -d '\r\n' \
  | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"\\]*"' \
  | sed 's/.*"\([^"]*\)"$/\1/' | sort -u)
count=$(printf '%s\n' "$names" | grep -c .)
[ "$count" = "1" ] || refuse "the guard could not tell which tool this is, so it is refused to be safe."
name=$names

case "$name" in
  mcp__*)
    # A connector's tool: mcp__<connector>__<tool>. Judge it by the tool.
    tool=${name##*__}
    case "$tool" in
      # The owner's HQ desk (Glidna): clock in, file work, log a shift, read it.
      hq_clock_in|hq_file_report|hq_log_shift|hq_read_desk) exit 0 ;;
      # Glidna: reading clients' progress only.
      get_profile|get_nutrition_log|get_nutrition_targets|get_measurements|list_plans|list_exercises|list_notes|list_clients|find_client|coach_summary|list_local_plans|list_sub_trainers|list_meal_reviews|search_food_db) exit 0 ;;
      # Gmail: reading, and writing DRAFTS. Sending, replying, forwarding,
      # labelling and trashing are all refused below.
      search_threads|get_thread|get_message|list_drafts|get_draft|list_labels|create_draft|update_draft) exit 0 ;;
      # Google Calendar: reading only.
      list_calendars|list_events|get_event|search_events|suggest_time) exit 0 ;;
      # QuickBooks: reports and look-ups only.
      company_info|profit_loss_quickbooks_account|profit_loss_quickbooks_account_text) exit 0 ;;
      cash_flow_quickbooks_account|cash_flow_quickbooks_account_text) exit 0 ;;
      benchmarking_quickbooks_account|benchmarking_quickbooks_account_text) exit 0 ;;
      qbo_accounting_get_*|qbo_sales_get_*|qbo_catalog_search_products|qbo_contact_search_customer) exit 0 ;;
      *) refuse "\"$tool\" could send, pay, publish, delete or change something, and no crew worker may. Put what you would have done in your report for the owner instead." ;;
    esac
    ;;
  # Claude's own tools: reading this repository, loading a connector's tools,
  # and keeping a to-do list for the shift. They change nothing outside the run.
  Read|Glob|Grep|LS|ToolSearch|TodoWrite|TodoRead|TaskCreate|TaskGet|TaskList|TaskUpdate)
    exit 0
    ;;
  *)
    # Everything else Claude has: running commands, changing files, reaching
    # the web, starting helpers, setting up routines or notifications of its
    # own — and any tool a later version of Claude adds. A worker reading
    # strangers' email must have no way to send what it read anywhere, or to
    # start a copy of itself that this guard isn't watching.
    refuse "the crew works only through its connectors and this repository; \"$name\" is not part of any crew job."
    ;;
esac
