/**
 * Buglens Landing Page
 *
 * Target Reader: Senior Backend Engineer / SRE / Staff Engineer
 * Context: Mid-incident or post-incident, frustrated by debugging complexity
 * Emotional State: Exhausted, skeptical of tools, time-constrained
 * What they don't trust: AI guesses, generic alerts, dashboards that show "everything is fine"
 *
 * This page is designed to make experienced engineers say:
 * "This person understands how debugging actually works."
 *
 * DELIBERATELY AVOIDED:
 * - "Single pane of glass"
 * - "End-to-end observability"
 * - "Actionable insights"
 * - "AI-driven debugging"
 * - "Boost developer productivity"
 * - "Intelligent platform"
 * - "Next-generation"
 * - Generic stock photos of happy developers
 */

import { Link } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ArrowRightIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded flex items-center justify-center">
              <MagnifyingGlassIcon className="w-5 h-5 text-zinc-900" />
            </div>
            <span className="font-semibold text-lg">Buglens</span>
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

      {/* Hero Section - The Pain */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          {/* Pain-focused headline */}
          <h1 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight mb-6">
            You've got 12 browser tabs open.
            <br />
            <span className="text-zinc-500">
              The stack trace points to line 47.
              <br />
              But the bug isn't there.
            </span>
          </h1>

          <p className="text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Sentry says it's a TypeError. GitHub shows 47 commits since the last
            deploy. Your Slack is on fire. You're 40 minutes in and still don't
            know what changed.
          </p>

          {/* CTA - Low pressure, collaborative */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="mailto:founders@buglens.com?subject=Early%20Access%20Request"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-medium px-8 py-3 rounded-md transition flex items-center gap-2"
            >
              Talk to us
              <ArrowRightIcon className="w-4 h-4" />
            </a>
            <a
              href="#how-it-works"
              className="text-zinc-400 hover:text-zinc-100 px-8 py-3 transition"
            >
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* Problem Section - Make it uncomfortable */}
      <section className="py-20 px-6 bg-zinc-900/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold mb-10 text-center">
            Debugging production errors in 2024 looks like this:
          </h2>

          <div className="space-y-6 font-mono text-sm">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <ClockIcon className="w-5 h-5 text-zinc-500 mt-1 shrink-0" />
                <div>
                  <p className="text-zinc-400 mb-2">0:00 - Incident begins</p>
                  <p className="text-zinc-100">
                    Error alert fires. You open Sentry. Stack trace shows{" "}
                    <code className="text-amber-500">
                      Cannot read property 'id' of undefined
                    </code>
                    .
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <ClockIcon className="w-5 h-5 text-zinc-500 mt-1 shrink-0" />
                <div>
                  <p className="text-zinc-400 mb-2">0:05 - Find the code</p>
                  <p className="text-zinc-100">
                    Open GitHub. Production is on{" "}
                    <code className="text-amber-500">v2.4.7</code>. You're on{" "}
                    <code className="text-amber-500">main</code>. Wait, when did
                    that deploy? Which commit?
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <ClockIcon className="w-5 h-5 text-zinc-500 mt-1 shrink-0" />
                <div>
                  <p className="text-zinc-400 mb-2">0:12 - Context missing</p>
                  <p className="text-zinc-100">
                    Stack trace points to line 142. But the function gets called
                    from 6 different places. Which path triggered this? What was{" "}
                    <code className="text-amber-500">user.subscription</code>{" "}
                    supposed to be?
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <ClockIcon className="w-5 h-5 text-zinc-500 mt-1 shrink-0" />
                <div>
                  <p className="text-zinc-400 mb-2">
                    0:25 - Hypothesis hunting
                  </p>
                  <p className="text-zinc-100">
                    47 commits in the last 3 days. You start{" "}
                    <code className="text-amber-500">git log -p</code>. Someone
                    changed the API response shape. Maybe. Or was it the
                    database migration?
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 border-red-900/50">
              <div className="flex items-start gap-4">
                <ClockIcon className="w-5 h-5 text-red-500 mt-1 shrink-0" />
                <div>
                  <p className="text-red-400 mb-2">0:40 - Still guessing</p>
                  <p className="text-zinc-100">
                    You're three levels deep in the call stack. Two terminals
                    running. Datadog showing metrics that look fine. CTO is
                    asking for an ETA.{" "}
                    <span className="text-red-400">
                      You deploy a fix you're 60% confident in.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="text-center text-zinc-500 mt-10 text-lg">
            Sound familiar? You're not slow. The process is broken.
          </p>
        </div>
      </section>

      {/* Reframe - The Real Problem */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-center">
            The data exists. The problem is connecting it.
          </h2>

          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8">
            <p className="text-lg text-zinc-300 mb-6">
              Your error tracker has the stack trace. GitHub has the commits.
              Your deployment system knows what's in production. The context is
              there—it's just scattered across 6 different tools with 6
              different timestamps.
            </p>

            <p className="text-lg text-zinc-300 mb-6">
              Debugging isn't a data problem. It's a{" "}
              <span className="text-amber-500 font-medium">
                correlation and confidence problem
              </span>
              . You're not lacking information. You're drowning in it. What you
              need is a clear line from:
            </p>

            <div className="flex flex-col md:flex-row items-center justify-center gap-4 py-6">
              <div className="bg-zinc-800 px-4 py-2 rounded font-mono text-sm">
                Error
              </div>
              <ArrowRightIcon className="w-5 h-5 text-zinc-600 rotate-90 md:rotate-0" />
              <div className="bg-zinc-800 px-4 py-2 rounded font-mono text-sm">
                Code
              </div>
              <ArrowRightIcon className="w-5 h-5 text-zinc-600 rotate-90 md:rotate-0" />
              <div className="bg-zinc-800 px-4 py-2 rounded font-mono text-sm">
                Commit
              </div>
              <ArrowRightIcon className="w-5 h-5 text-zinc-600 rotate-90 md:rotate-0" />
              <div className="bg-amber-500 text-zinc-900 px-4 py-2 rounded font-mono text-sm font-medium">
                Root Cause
              </div>
            </div>

            <p className="text-zinc-400 text-center mt-4">
              Most tools optimize for alerts. Buglens optimizes for
              understanding.
            </p>
          </div>
        </div>
      </section>

      {/* Introduce Buglens - No Hype */}
      <section className="py-20 px-6 bg-zinc-900/50" id="how-it-works">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-4">
              Buglens: A debugging copilot, not a magic wand.
            </h2>
            <p className="text-zinc-400 max-w-2xl mx-auto">
              We connect your error tracker to your codebase and give you the
              context you need to understand what went wrong—with evidence, not
              guesses.
            </p>
          </div>

          {/* How it works - Concrete steps */}
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  1
                </div>
                <h3 className="font-medium">Error ingestion</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                Sentry webhook fires. Buglens receives the error, extracts the
                stack trace, and identifies which files and lines are involved.
                No manual configuration—just a webhook URL.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  2
                </div>
                <h3 className="font-medium">Code fetching</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                Using your release tag or commit SHA, Buglens fetches the exact
                version of the code running in production. Not{" "}
                <code className="text-amber-500">main</code>. The actual
                deployed code.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  3
                </div>
                <h3 className="font-medium">Deterministic analysis</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                AST parsing identifies patterns like unchecked null access,
                missing error handling, or changed function signatures. This
                isn't AI guessing—it's pattern matching on your actual code
                structure.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  4
                </div>
                <h3 className="font-medium">Commit correlation</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                Recent commits to affected files are surfaced with diffs.
                Changed a response shape 3 days ago? You'll see exactly what
                changed and who changed it.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  5
                </div>
                <h3 className="font-medium">Evidence assembly</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                All evidence—code context, commits, breadcrumbs, related
                errors—is assembled into a single view. Each finding links to
                its source. Nothing is hidden.
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-amber-500 font-mono text-sm">
                  6
                </div>
                <h3 className="font-medium">LLM narrative (optional)</h3>
              </div>
              <p className="text-zinc-400 text-sm">
                If enabled, an LLM generates a human-readable explanation of the
                evidence. But it only summarizes findings—it never makes claims
                without deterministic backing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section - Mandatory */}
      <section className="py-20 px-6" id="trust">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-8 text-center">
            Why this isn't another noisy AI tool
          </h2>

          <div className="space-y-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <ShieldCheckIcon className="w-6 h-6 text-amber-500 shrink-0 mt-1" />
                <div>
                  <h3 className="font-medium mb-2">
                    Deterministic analysis comes first
                  </h3>
                  <p className="text-zinc-400 text-sm">
                    Before any AI runs, Buglens performs rule-based analysis on
                    your code's AST. Pattern matching catches common bugs like
                    null access, missing guards, and type mismatches. If we can
                    prove it with code, we don't guess.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <DocumentTextIcon className="w-6 h-6 text-amber-500 shrink-0 mt-1" />
                <div>
                  <h3 className="font-medium mb-2">
                    Every claim links to evidence
                  </h3>
                  <p className="text-zinc-400 text-sm">
                    When Buglens says "this null check is missing," it shows you
                    the exact line, the surrounding context, and why it matters.
                    No black boxes. No "trust me, it's AI."
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <div className="flex items-start gap-4">
                <CheckCircleIcon className="w-6 h-6 text-amber-500 shrink-0 mt-1" />
                <div>
                  <h3 className="font-medium mb-2">You verify, we assist</h3>
                  <p className="text-zinc-400 text-sm">
                    Buglens doesn't fix bugs automatically or push commits.
                    We're a copilot that does the context-gathering you'd do
                    anyway—just faster. The decision stays with you.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 border-amber-900/30">
              <div className="flex items-start gap-4">
                <ExclamationTriangleIcon className="w-6 h-6 text-amber-500 shrink-0 mt-1" />
                <div>
                  <h3 className="font-medium mb-2">What Buglens won't do</h3>
                  <ul className="text-zinc-400 text-sm space-y-2">
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">✕</span>
                      Auto-fix bugs or push code changes
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">✕</span>
                      Make causal claims without evidence
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">✕</span>
                      Replace your existing observability tools
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-red-400">✕</span>
                      Store your source code (we fetch on-demand)
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof - Honest */}
      <section className="py-20 px-6 bg-zinc-900/50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-8">
            Built from conversations with people who debug for a living
          </h2>

          <div className="grid md:grid-cols-2 gap-6 text-left">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <p className="text-zinc-300 mb-4 italic">
                "I spent 2 hours just figuring out where to look. The stack
                trace was useless because the real bug was in a dependency three
                layers up."
              </p>
              <p className="text-zinc-500 text-sm">
                — Senior Backend Engineer, Series B startup
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <p className="text-zinc-300 mb-4 italic">
                "Our error tracker shows 500 unresolved issues. I don't know
                which ones actually matter. I've stopped trusting the priorities
                it suggests."
              </p>
              <p className="text-zinc-500 text-sm">
                — SRE, Healthcare platform
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <p className="text-zinc-300 mb-4 italic">
                "Every incident, I'm the one who gets pulled in. Not because I'm
                the best debugger—because I'm the only one who knows where all
                the context lives."
              </p>
              <p className="text-zinc-500 text-sm">
                — Staff Engineer, E-commerce
              </p>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
              <p className="text-zinc-300 mb-4 italic">
                "The AI tools I've tried either hallucinate or state the
                obvious. Neither is useful when production is down."
              </p>
              <p className="text-zinc-500 text-sm">
                — Engineering Lead, FinTech
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Help shape the product</h2>
          <p className="text-zinc-400 mb-8 text-lg">
            Buglens is early. We're looking for SREs and senior engineers to
            join our early access program. Your debugging horror stories will
            directly shape what we build.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a
              href="mailto:founders@buglens.com?subject=Early%20Access%20Request"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-900 font-medium px-8 py-3 rounded-md transition flex items-center gap-2"
            >
              Talk to us
              <ArrowRightIcon className="w-4 h-4" />
            </a>
            <a
              href="https://twitter.com/buglens"
              className="text-zinc-400 hover:text-zinc-100 px-8 py-3 transition"
              target="_blank"
              rel="noopener noreferrer"
            >
              Follow updates
            </a>
          </div>

          <p className="text-zinc-600 text-sm mt-8">
            No credit card. No 14-day trial pressure. Just a conversation.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-zinc-800">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-500 rounded flex items-center justify-center">
              <MagnifyingGlassIcon className="w-4 h-4 text-zinc-900" />
            </div>
            <span className="text-sm text-zinc-400">Buglens</span>
          </div>

          <div className="flex items-center gap-6 text-sm text-zinc-500">
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
              Twitter
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
