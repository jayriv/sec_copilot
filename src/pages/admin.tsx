import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadSystemPromptOverride, persistSystemPromptOverride } from "@/lib/copilotSettings";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/defaultSystemPrompt";

export default function AdminPage() {
  const [prompt, setPrompt] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setPrompt(loadSystemPromptOverride());
  }, []);

  const save = () => {
    persistSystemPromptOverride(prompt);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  const resetDefault = () => {
    setPrompt("");
    persistSystemPromptOverride("");
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <>
      <Head>
        <title>SEC Copilot — Admin</title>
      </Head>
      <main className="min-h-screen bg-gradient-to-br from-violet-50/50 via-slate-50 to-indigo-50/40 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-violet-800 hover:text-violet-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to app
          </Link>

          <h1 className="text-2xl font-semibold text-violet-950">Admin — system prompt</h1>
          <p className="mt-2 text-sm text-slate-600">
            Edit the Copilot system prompt. It is stored in this browser only and sent with chat
            requests when{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT=1</code> is
            set on the server (Vercel env). Otherwise the API returns 403 if a custom prompt is sent.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Leave empty to use the server default (or <code className="rounded bg-slate-100 px-1 text-xs">COPILOT_SYSTEM_PROMPT</code> if set).
          </p>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            className="mt-6 w-full rounded-xl border border-violet-200/80 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none ring-violet-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40"
            placeholder={DEFAULT_SYSTEM_PROMPT.slice(0, 120) + "…"}
            spellCheck={false}
          />

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              className="rounded-xl bg-[#36013F] px-5 py-2.5 text-sm font-medium text-white shadow-md transition hover:bg-violet-900"
            >
              Save to browser
            </button>
            <button
              type="button"
              onClick={() => setPrompt(DEFAULT_SYSTEM_PROMPT)}
              className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-medium text-violet-900 shadow-sm hover:bg-violet-50"
            >
              Load default text
            </button>
            <button
              type="button"
              onClick={resetDefault}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Clear override
            </button>
            {savedFlash && (
              <span className="text-sm font-medium text-emerald-700" role="status">
                Saved.
              </span>
            )}
          </div>

          <section className="mt-10 rounded-xl border border-violet-100 bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
            <h2 className="font-semibold text-violet-950">Reference — built-in default</h2>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-800">
              {DEFAULT_SYSTEM_PROMPT}
            </pre>
          </section>
        </div>
      </main>
    </>
  );
}
