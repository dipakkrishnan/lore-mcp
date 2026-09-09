# Privacy

Lore does not collect telemetry. It stores private memories locally and exposes
only publications the owner explicitly approves.

The one exception is feedback the owner explicitly asks to send: `lore
report-feedback` and the Desktop app's Report Feedback dialog. Nothing is sent
unless the owner runs that command or submits that form, and a build with no
feedback address configured cannot send at all — the command refuses and the
Desktop app shows no button. When it is configured, a report goes to a
maintainer-operated Cloudflare Worker (`feedback-relay/`), whose only action is
filing the report as a GitHub issue on `dipakkrishnan/lore-mcp` — **that issue
is public**, and so is any email address given with the report. Each submission
also carries: the Lore version, OS and CPU architecture, Python version, and a
random id generated once on that machine and stored locally, so repeat reports
from the same install can be told apart. That id is not derived from anything
else on the machine and carries no memory content, file paths, or wallet
addresses. A copy of everything sent is kept at `~/.lore/feedback/`.

If an owner deploys a paid Lore node, the selected hosting and payment providers
process requests under their own privacy policies. See the repository documentation
for the deployment boundary and configuration details.
