# AI Voice Interviewer 🎙️

An AI-powered technical interview platform that conducts **real-time voice interviews**, personalizes questions using a candidate's **GitHub profile**, generates live transcripts, and automatically evaluates interview performance using **Google Gemini**.

## 🚀 Overview

AI Voice Interviewer enables candidates to participate in realistic technical interviews through a low-latency voice conversation with an AI interviewer.

The system combines **Google Gemini Live API, WebSockets, GitHub REST API, PostgreSQL, Prisma, and Google Gemini** to create an end-to-end automated interviewing pipeline.

### Key Features

- 🎙️ **Real-time AI voice interviews** using the Gemini Live API (native audio)
- ⚡ **Streaming PCM audio** over a WebSocket, with barge-in (interrupt the AI by speaking)
- 🔐 **Backend-mediated Gemini session**: the API key and interviewer prompt never reach the browser
- 🐙 **GitHub-based candidate personalization**
- 📝 **Server-side transcription of both speakers** from Gemini Live input/output transcripts
- 🗄️ **Persistent interview transcripts** using PostgreSQL + Prisma
- 🤖 **Automated interview evaluation** using Google Gemini (with model fallback)
- 📊 **Structured 0–10 scoring and written feedback**

---

## 🏗️ Architecture

```text
 ┌────────────────────┐   WebSocket /api/v1/live/:id    ┌──────────────────────┐   Gemini Live API   ┌──────────────┐
 │     Candidate      │ ── mic PCM16 16 kHz ──────────▶ │       Backend        │ ──────────────────▶ │ Gemini Live  │
 │  Browser / Client  │ ◀── AI voice PCM16 24 kHz ───── │  (Express + ws)      │ ◀────────────────── │ native audio │
 │  AudioWorklet mic  │ ◀── ready/interrupted/ended ─── │ • system prompt      │  audio + input/     └──────────────┘
 │  + PCM player      │                                 │ • transcripts → DB   │  output transcripts
 └────────────────────┘                                 │ • session lifecycle  │
                                                        └───┬──────────┬───────┘
                                              GitHub REST   │          │  Prisma
                                                            ▼          ▼
                                                   ┌──────────┐  ┌──────────────┐     ┌───────────────┐
                                                   │ GitHub   │  │ PostgreSQL   │ ──▶ │ Google Gemini │
                                                   │   API    │  │ transcripts  │     │  Evaluation   │
                                                   └──────────┘  └──────────────┘     └───────────────┘
```

1. **Pre-interview**: the backend fetches the candidate's public GitHub repos and creates an `Interview` row.
2. **Live interview**: the browser opens `ws://…/api/v1/live/:interviewId`. The backend opens a Gemini Live session
   (`apps/backend/live.ts`) with the interviewer instructions + GitHub data, relays audio both ways, forwards
   interruptions, and stores both sides of the conversation from Gemini's transcriptions.
3. **End**: the client sends `{type:"end"}`; the backend flushes the transcript, closes Gemini, then closes the socket.
4. **Evaluation**: the results page triggers Gemini scoring of the stored transcript (`apps/backend/result.ts`).

---

## 🛠️ Local setup

Prereqs: [Bun](https://bun.sh) ≥ 1.3 and Docker.

```bash
# 1. Postgres (credentials must match DATABASE_URL in apps/backend/.env)
docker run -d --name ai-interviewer-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=ai_interviewer -p 5432:5432 -v ai-interviewer-pgdata:/var/lib/postgresql/data postgres:16

# 2. Install deps (also generates the Prisma client)
bun install

# 3. Env files
cp apps/backend/.env.example apps/backend/.env      # GEMINI_API_KEY, DATABASE_URL, PORT, GEMINI_LIVE_MODEL
cp apps/frontend/.env.example apps/frontend/.env    # BUN_PUBLIC_BACKEND_URL

# 4. Migrate the DB
cd apps/backend && bunx prisma migrate deploy && cd ../..

# 5. Run both apps (frontend :4000, backend :4001; ports come from each app's .env)
bun run dev
```

Open http://localhost:4000 in Chrome/Edge (mic access is required; headphones recommended). `PROXY_URL` and `GITHUB_TOKEN` are optional.
