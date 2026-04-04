# Sheikh Mock — AI Interview Simulator

An immersive mock interview app for JavaScript/React roles with real-time AI evaluation. Supports **4 LLM providers**: Ollama (local/free), Google Gemini, OpenAI, and Anthropic.

## Architecture

```
React (Vite)  ──▶  FastAPI  ──▶  Ollama / Gemini / OpenAI / Anthropic
  :5173            :8000          (your choice)
```

## Quick Start

### 1. Start the backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Start the frontend

```bash
npm install
npm run dev
```

### 3. Configure your provider

Click the **settings gear** in the top-right corner of the app to:

- Pick a provider (Ollama, Gemini, OpenAI, or Anthropic)
- Enter your API key (for cloud providers)
- Choose a model

**For local/free use:** Install [Ollama](https://ollama.com), run `ollama pull llama3`, and select "Ollama (Local)" in settings.

## Features

- Animated AI interviewer avatar with speech/thinking/reaction states
- Typewriter effect for questions being asked
- Voice input with live waveform visualization
- Cinematic dark UI with particle background
- Animated score reveal with ring counter
- In-app settings drawer — no env files needed
- 71 curated senior-level JS/React questions across 3 days
- Multi-provider support with model selection

## Project Structure

```
sheikh-mock/
├── backend/
│   ├── main.py           # FastAPI — routes + health
│   ├── providers.py       # Ollama / Gemini / OpenAI / Anthropic adapters
│   ├── questions.py       # 71-question bank
│   └── requirements.txt
├── src/
│   ├── api.js            # Frontend API client
│   ├── App.jsx           # Main app state + routing
│   ├── components/
│   │   ├── Avatar.jsx          # Animated SVG interviewer
│   │   ├── Particles.jsx       # Floating particle background
│   │   ├── ScoreReveal.jsx     # Animated score ring
│   │   ├── WaveformVisualizer.jsx  # Voice waveform
│   │   ├── SettingsDrawer.jsx  # Provider + API key config
│   │   ├── StatusBar.jsx       # Connection status
│   │   ├── StartScreen.jsx
│   │   ├── SessionScreen.jsx
│   │   └── DoneScreen.jsx
│   ├── hooks/
│   │   ├── useVoice.js        # Web Speech API
│   │   ├── useTypewriter.js   # Typewriter animation
│   │   └── useSettings.js     # localStorage persistence
│   └── index.css              # Full dark immersive design
├── package.json
└── vite.config.js
```
