import { Link } from "react-router-dom";
import {
  ArrowRightIcon,
  ShieldCheckIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { LogoIcon } from "@/components/ui/Logo";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-800/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <LogoIcon size="md" />
            <span className="font-semibold text-lg tracking-tight">Buglens</span>
          </div>
          <div className="flex items-center gap-6">
            <a
              href="#how-it-works"
              className="text-sm text-zinc-400 hover:text-zinc-100 transition"
            >
              How it works
            </a>
            <a
              href="#trust"
              className="text-sm text-zinc-400 hover:text-zinc-100 transition"
            >
              Why trust us
            </a>
            <Link
              to="/login"
              className="text-sm bg-zinc-800 hover:bg-zinc-700 px-4 py-2 rounded-md transition"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-36 pb-24 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <span className="inline-block text-xs font-mono text-amber-500 border border-amber-500/30 bg-amber-500/10 px-3 py-1 rounded-full tracking-wide">
              Early access · Built for engineers
            </span>
          </div>

          <h1 className="text-5xl md:text-6xl font-bold leading-[1.08] tracking-tight mb-8">
            You've got 12 tabs open.
            <br />
            <span className="text-zinc-500">
              The bug isn't where
              <br />
              the stack trace says it is.
            </span>
          </h1>

          <p className="text-xl text-zinc-400 max-w-2xl mb-12 leading-relaxed">
            Buglens connects Sentry, GitHub, and your deploy history to produce a
            root-cause analysis in under a minute — with the actual code, the
            relevant commits, and a confidence score. Not a guess.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Link
              to="/login"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold px-8 py-3 rounded-md transition flex items-center gap-2"
            >
              Get early access
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
            <a
              href="#how-it-works"
              className="text-zinc-400 hover:text-zinc-100 px-8 py-3 transition"
            >
              See how it works →
            </a>
          </div>
        </div>
      </section>

      {/* The incident timeline */}
      <section className="py-20 px-6 bg-zinc-900/40">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            A typical incident
          </p>
          <h2 className="text-2xl font-bold mb-14">
            40 minutes in. Still no idea what caused it.
          </h2>

          <IncidentTimeline />

          <p className="text-zinc-500 mt-12 text-sm leading-relaxed">
            You're not slow. The process is broken. All the data exists — it's
            just scattered across six tools with six different timestamps.
          </p>
        </div>
      </section>

      {/* Reframe */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-4">
            The data is already there. We connect it.
          </h2>
          <p className="text-zinc-400 mb-14 text-lg leading-relaxed">
            Buglens sits on top of your existing stack. When an error fires, it
            pulls together everything you'd spend 40 minutes collecting — and
            produces a root-cause analysis with citations, not speculation.
          </p>

          <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
            {[
              "Error event",
              "Stack trace",
              "Production code",
              "Relevant commits",
              "Root cause",
            ].map((label, i, arr) => (
              <FlowStep
                key={label}
                label={label}
                isLast={i === arr.length - 1}
              />
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-6 bg-zinc-900/40" id="how-it-works">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            How it works
          </p>
          <h2 className="text-2xl font-bold mb-14">
            Six steps. No manual work.
          </h2>

          <div className="space-y-10">
            <HowItWorksStep
              n="01"
              title="Sentry fires a webhook"
              body="Buglens receives the event and extracts the full stack trace, breadcrumbs, and user context. Setup is one webhook URL — nothing else to configure."
            />
            <HowItWorksStep
              n="02"
              title="We fetch the code that's actually running"
              body="Using the release tag or commit SHA from the error event, we pull the exact file versions deployed to production. Not main — the version your users hit."
            />
            <HowItWorksStep
              n="03"
              title="Deterministic analysis runs first"
              body="AST-level pattern matching finds null access, unchecked returns, type mismatches, and missing guards on the frames in the stack trace. If we can prove something from code structure, we do. No estimation."
            />
            <HowItWorksStep
              n="04"
              title="Relevant commits are surfaced"
              body="Recent changes to every affected file are pulled from GitHub with diffs. Changed a response shape last week? You'll see exactly what changed, when, and who changed it."
            />
            <HowItWorksStep
              n="05"
              title="Evidence is assembled into one view"
              body="Code context, commit history, breadcrumbs, related errors — one place, each finding linked to its source. No tabs. No manual correlation."
            />
            <HowItWorksStep
              n="06"
              title="An LLM writes the narrative — with guardrails"
              body="The LLM summarizes findings in plain English. It only makes claims backed by deterministic evidence. There is no generated hypothesis without a code citation to support it."
            />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="py-20 px-6" id="trust">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            Trust
          </p>
          <h2 className="text-2xl font-bold mb-4">Not another noisy AI tool.</h2>
          <p className="text-zinc-400 mb-14 leading-relaxed">
            We built Buglens because we've used the tools that hallucinate or
            state the obvious. Neither is useful when production is down.
          </p>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-6 border border-zinc-800 rounded-lg">
              <ShieldCheckIcon className="w-5 h-5 text-amber-500 mb-3" />
              <h3 className="font-medium mb-2">Deterministic analysis first</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Rule-based analysis runs before any LLM. If we can prove
                something from code structure, we do. The LLM only speaks when
                there's evidence to summarize.
              </p>
            </div>

            <div className="p-6 border border-zinc-800 rounded-lg">
              <DocumentTextIcon className="w-5 h-5 text-amber-500 mb-3" />
              <h3 className="font-medium mb-2">Every claim has a source</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                When Buglens says a null check is missing, it shows you the
                line, the surrounding context, and why it matters. Nothing is
                asserted without a citation.
              </p>
            </div>

            <div className="p-6 border border-zinc-800 rounded-lg">
              <CheckCircleIcon className="w-5 h-5 text-amber-500 mb-3" />
              <h3 className="font-medium mb-2">You're still the engineer</h3>
              <p className="text-zinc-400 text-sm leading-relaxed">
                Buglens doesn't push fixes or write code. It handles the 40
                minutes of context-gathering so you can focus on the decision
                that actually requires your judgment.
              </p>
            </div>

            <div className="p-6 border border-zinc-800 rounded-lg">
              <ExclamationTriangleIcon className="w-5 h-5 text-amber-500 mb-3" />
              <h3 className="font-medium mb-2">What we won't do</h3>
              <ul className="text-zinc-400 text-sm space-y-2 mt-1">
                {[
                  "Auto-commit fixes or push code changes",
                  "Make claims without evidence",
                  "Replace your existing observability stack",
                  "Store your source code (fetched on-demand, not cached)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="text-red-400 font-mono mt-0.5 flex-shrink-0">
                      ✕
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* What engineers told us */}
      <section className="py-20 px-6 bg-zinc-900/40">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs font-mono text-zinc-500 uppercase tracking-widest mb-3">
            What we heard
          </p>
          <h2 className="text-2xl font-bold mb-3">
            We talked to engineers before we wrote a line of code.
          </h2>
          <p className="text-zinc-400 mb-12">
            The same four problems came up in every conversation.
          </p>

          <div className="space-y-8">
            {[
              {
                quote:
                  "I spent two hours just figuring out where to look. The stack trace was useless — the real bug was in a dependency three layers up.",
                role: "Senior Backend Engineer",
              },
              {
                quote:
                  "We have 500 open errors in Sentry. I've stopped looking at them because I can't tell which ones actually matter.",
                role: "SRE",
              },
              {
                quote:
                  "Every incident, I'm the one who gets pulled in. Not because I'm the best debugger — because I'm the only one who knows where all the context lives.",
                role: "Staff Engineer",
              },
              {
                quote:
                  "The AI tools I've tried either hallucinate or tell me things I already know. Neither is useful when production is down.",
                role: "Engineering Lead",
              },
            ].map((q) => (
              <QuoteItem key={q.role} quote={q.quote} role={q.role} />
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-28 px-6">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold mb-4">Get early access</h2>
          <p className="text-zinc-400 mb-10 text-lg leading-relaxed">
            Buglens is in active development. We're onboarding teams who want
            faster incident resolution and are willing to give us direct
            feedback. No sales calls. No decks. Just the product.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <Link
              to="/login"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-semibold px-8 py-3 rounded-md transition flex items-center gap-2"
            >
              Create an account
              <ArrowRightIcon className="w-4 h-4" />
            </Link>
            <a
              href="mailto:founders@buglens.com"
              className="text-zinc-400 hover:text-zinc-100 px-8 py-3 transition"
            >
              Email us directly →
            </a>
          </div>

          <p className="text-zinc-600 text-sm mt-8">
            No credit card. Connect Sentry and see your first RCA in under five
            minutes.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <LogoIcon size="sm" />
            <span className="text-sm text-zinc-500">Buglens</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-600">
            <a
              href="mailto:founders@buglens.com"
              className="hover:text-zinc-300 transition"
            >
              founders@buglens.com
            </a>
            <a
              href="https://twitter.com/buglens"
              className="hover:text-zinc-300 transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              Twitter / X
            </a>
            <a
              href="https://github.com/buglens"
              className="hover:text-zinc-300 transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function IncidentTimeline() {
  const steps = [
    {
      time: "0:00",
      label: "Alert fires",
      bad: false,
      body: (
        <>
          Sentry catches a{" "}
          <code className="text-amber-400 bg-amber-400/10 px-1 rounded text-xs">
            TypeError: Cannot read properties of undefined
          </code>
          . You open it. The stack trace points to a library file.
        </>
      ),
    },
    {
      time: "0:05",
      label: "Find the code",
      bad: false,
      body: (
        <>
          Production is on{" "}
          <code className="text-amber-400 bg-amber-400/10 px-1 rounded text-xs">
            v2.4.7
          </code>
          . You're looking at{" "}
          <code className="text-amber-400 bg-amber-400/10 px-1 rounded text-xs">
            main
          </code>
          . When did the last deploy go out? Which commit is actually running?
        </>
      ),
    },
    {
      time: "0:15",
      label: "Context is missing",
      bad: false,
      body: "The function is called from six different places. You don't know which path triggered this, or what the input looked like when it failed.",
    },
    {
      time: "0:28",
      label: "Hunting for the cause",
      bad: false,
      body: (
        <>
          47 commits in three days. You run{" "}
          <code className="text-amber-400 bg-amber-400/10 px-1 rounded text-xs">
            git log -p
          </code>
          . Someone changed the API response shape last Tuesday. Maybe. Or was
          it the migration?
        </>
      ),
    },
    {
      time: "0:42",
      label: "You ship a guess",
      bad: true,
      body: "You deploy a fix you're 60% confident in. Slack goes quiet. You're not sure if the incident is over or just sleeping.",
    },
  ];

  return (
    <div className="relative">
      <div className="absolute left-[17px] top-2 bottom-2 w-px bg-zinc-800" />
      <div className="space-y-8">
        {steps.map((step) => (
          <div key={step.time} className="relative flex gap-6">
            <div className="flex-shrink-0 w-9 flex items-start justify-center pt-1">
              <div
                className={`w-[14px] h-[14px] rounded-full z-10 ring-2 ring-zinc-950 flex-shrink-0 ${
                  step.bad ? "bg-red-500" : "bg-zinc-700"
                }`}
              />
            </div>
            <div>
              <div className="flex items-baseline gap-3 mb-1">
                <span className="font-mono text-xs text-zinc-600">
                  {step.time}
                </span>
                <span
                  className={`text-sm font-medium ${
                    step.bad ? "text-red-400" : "text-zinc-300"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowStep({ label, isLast }: { label: string; isLast: boolean }) {
  return (
    <>
      <span
        className={`px-3 py-2 rounded ${
          isLast
            ? "bg-amber-500 text-zinc-900 font-semibold"
            : "bg-zinc-900 border border-zinc-800 text-zinc-300"
        }`}
      >
        {label}
      </span>
      {!isLast && (
        <ArrowRightIcon className="w-4 h-4 text-zinc-700 flex-shrink-0" />
      )}
    </>
  );
}

function HowItWorksStep({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-6">
      <span className="font-mono text-xl text-zinc-700 font-bold leading-none pt-1 w-10 flex-shrink-0">
        {n}
      </span>
      <div>
        <h3 className="font-semibold text-zinc-100 mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function QuoteItem({ quote, role }: { quote: string; role: string }) {
  return (
    <div className="flex gap-4">
      <div className="text-amber-500/25 text-5xl font-serif leading-none flex-shrink-0 select-none">
        "
      </div>
      <div>
        <p className="text-zinc-300 leading-relaxed mb-2">{quote}</p>
        <p className="text-xs text-zinc-600 font-mono">— {role}</p>
      </div>
    </div>
  );
}
