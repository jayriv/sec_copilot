import { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  loadSystemPromptDraftForEdit,
  loadUseCustomSystemPrompt,
  persistSystemPromptDraft,
  persistUseCustomSystemPrompt
} from "@/lib/copilotSettings";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/defaultSystemPrompt";

export default function AdminPage() {
  const [prompt, setPrompt] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setPrompt(loadSystemPromptDraftForEdit());
    setUseCustom(loadUseCustomSystemPrompt());
  }, []);

  const save = () => {
    persistSystemPromptDraft(prompt);
    persistUseCustomSystemPrompt(useCustom);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  };

  const loadDefaultText = () => {
    setPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const disableCustomAndResetDraft = () => {
    setUseCustom(false);
    setPrompt(DEFAULT_SYSTEM_PROMPT);
    persistUseCustomSystemPrompt(false);
    persistSystemPromptDraft(DEFAULT_SYSTEM_PROMPT);
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
            The box below starts with the built-in default so you can edit it. Nothing is sent to the API until you turn
            on <strong>Use custom prompt</strong> and click <strong>Save to browser</strong>. The server must have{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">COPILOT_ALLOW_CLIENT_SYSTEM_PROMPT=1</code> or
            chat will return 403 when a custom prompt is used.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            When <strong>Use custom prompt</strong> is off, chat uses the server default (or{" "}
            <code className="rounded bg-slate-100 px-1 text-xs">COPILOT_SYSTEM_PROMPT</code> if set in env).
          </p>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200/80 bg-white/90 px-4 py-3 shadow-sm">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => {
                const on = e.target.checked;
                setUseCustom(on);
                if (on) {
                  persistSystemPromptDraft(prompt);
                }
              }}
              className="mt-1 h-4 w-4 shrink-0 rounded border-violet-300 text-[#36013F] focus:ring-violet-400"
            />
            <span>
              <span className="font-medium text-violet-950">Use custom prompt</span>
              <span className="mt-0.5 block text-sm text-slate-600">
                When enabled, saved text below is sent as the system prompt on each chat request. When disabled, the
                server default is used (your edits stay in the browser for next time).
              </span>
            </span>
          </label>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
            className="mt-4 w-full rounded-xl border border-violet-200/80 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none ring-violet-200 focus:border-violet-400 focus:ring-2 focus:ring-violet-300/40"
            spellCheck={false}
            aria-label="System prompt draft"
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
              onClick={loadDefaultText}
              className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-medium text-violet-900 shadow-sm hover:bg-violet-50"
            >
              Reset textarea to default text
            </button>
            <button
              type="button"
              onClick={disableCustomAndResetDraft}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Turn off custom &amp; use server default
            </button>
            {savedFlash && (
              <span className="text-sm font-medium text-emerald-700" role="status">
                Saved.
              </span>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
