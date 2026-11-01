"""What the bundled wrangler prints when Cloudflare or wrangler refuses (XC-086).

Quoted from wrangler 4.151.1's own source (wrangler-dist/cli.js), in the
`✘ [ERROR]` shape its esbuild formatter prints. `SOURCES` holds the sentence
each refusal is built from, so a test can tell when an upgrade rewords one.
"""

from __future__ import annotations

VERSION = "4.151.1"

# Cloudflare's `email_verification_required`, as wrangler rewrites it on any API call.
VERIFY_EMAIL = (
    "\n✘ [ERROR] Please verify your account's email address and try again.\n\n"
    "  Check your email for a verification link, or login to "
    "https://dash.cloudflare.com and request a new one.\n\n"
)

# An account with no workers.dev address, deploying with no one at the prompt.
NO_SUBDOMAIN = (
    "\n▲ [WARNING] You need to register a workers.dev subdomain before publishing "
    "to workers.dev\n\n"
    "? Would you like to register a workers.dev subdomain now?\n"
    "🤖 Using fallback value in non-interactive context: no\n\n"
    "✘ [ERROR] You can either deploy your worker to one or more routes by "
    "specifying them in your wrangler.jsonc file, or register a workers.dev "
    "subdomain here:\n\n"
    "  https://dash.cloudflare.com/0123456789abcdef0123456789abcdef/workers/onboarding\n\n"
)

# A sign-in with several accounts and nothing saying which.
MANY_ACCOUNTS = (
    "\n✘ [ERROR] More than one account available but unable to select one in "
    "non-interactive mode.\n\n"
    "  Please set the appropriate `account_id` in your Wrangler configuration "
    "file or assign it to the `CLOUDFLARE_ACCOUNT_ID` environment variable.\n"
    "  Available accounts are (`<name>`: `<account_id>`):\n"
    "    `Ada's Account`: `0123456789abcdef0123456789abcdef`\n"
    "    `Lab`: `fedcba9876543210fedcba9876543210`\n\n"
)

SOURCES = {
    "VERIFY_EMAIL": "Please verify your account's email address and try again.",
    "NO_SUBDOMAIN": "or register a workers.dev subdomain here:",
    "MANY_ACCOUNTS": "More than one account available but unable to select one in non-interactive mode.",
}
