# AI Voice Interviewer 🎙️

An AI-powered technical interview platform that conducts **real-time voice interviews**, personalizes questions using a candidate's **GitHub profile**, generates live transcripts, and automatically evaluates interview performance using **Google Gemini**.

## 🚀 Overview

AI Voice Interviewer enables candidates to participate in realistic technical interviews through a low-latency voice conversation with an AI interviewer.

The system combines **OpenAI Realtime API, WebRTC, Deepgram, GitHub REST API, PostgreSQL, Prisma, and Google Gemini** to create an end-to-end automated interviewing pipeline.

### Key Features

- 🎙️ **Real-time AI voice interviews** using OpenAI Realtime API
- ⚡ **Low-latency WebRTC audio communication**
- 🔗 **Server-side sideband WebSocket** for controlling the live AI session
- 🐙 **GitHub-based candidate personalization**
- 📝 **Real-time speech-to-text transcription** using Deepgram
- 🗄️ **Persistent interview transcripts** using PostgreSQL + Prisma
- 🤖 **Automated interview evaluation** using Google Gemini
- 📊 **Structured 0–10 scoring and written feedback**
- 🔐 Backend handles authentication/session orchestration without routing live audio

---

## 🏗️ Architecture

```text
                         ┌──────────────────────┐
                         │       Candidate      │
                         │    Browser / Client  │
                         └──────────┬───────────┘
                                    │
                         WebRTC Audio│
                                    ▼
                         ┌──────────────────────┐
                         │   OpenAI Realtime    │
                         │         API          │
                         └──────────┬───────────┘
                                    │
                         Sideband WebSocket
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       Backend        │
                         │ Session / Interview  │
                         │    Orchestration     │
                         └──────┬───────┬───────┘
                                │       │
                   GitHub API   │       │   Deepgram
                                │       │
                                ▼       ▼
                         ┌──────────┐ ┌──────────┐
                         │ GitHub   │ │ Deepgram │
                         │   API    │ │   STT    │
                         └──────────┘ └────┬─────┘
                                          │
                                          ▼
                                  ┌──────────────┐
                                  │ PostgreSQL + │
                                  │    Prisma    │
                                  └──────┬───────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │ Google Gemini│
                                  │  Evaluation  │
                                  └──────────────┘