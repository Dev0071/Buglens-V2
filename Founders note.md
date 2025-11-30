**Critical Founder Notes**
1. LLM cost will be your #1 variable lever

At scale, your infra will cost way more than your servers.

To fix that:

Cache RCA on “duplicate incidents”

Use local 70B models

Use retrieval over pure reasoning

Compress context aggressively

Build a "deterministic-first" RCA system

2. Your GitHub API usage will hit rate limits early

You’ll need aggressive caching + per-org prefetch.

3. Storing contextual snippets grows your S3 bill

But it's manageable with compression.

4. Incident volume is uneven

Some startups will send:

10 events/week
Some enterprises will send:

50k events/hour

You must build:

multi-tenant

rate-limited

throttled pipelines
from day 1.