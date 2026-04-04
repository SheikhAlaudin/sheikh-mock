"""
Sheikh Mock Interviewer — Multi-provider FastAPI backend.
Supports: Ollama (local), Google Gemini, OpenAI, Anthropic.

Run:  uvicorn main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from questions import QUESTIONS, SESSIONS
from providers import evaluate_with_provider

# ── HTTP client (shared) ──
http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    print("[OK] Sheikh Mock backend ready - multi-provider mode")
    # Check Ollama
    try:
        r = await http_client.get("http://localhost:11434/api/tags")
        models = [m["name"] for m in r.json().get("models", [])]
        print(f"  Ollama connected - models: {models}")
    except httpx.ConnectError:
        print("  Ollama not running (optional - cloud providers still work)")
    yield
    await http_client.aclose()


app = FastAPI(title="Sheikh Mock API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ──
class EvalRequest(BaseModel):
    question_id: str
    answer: str
    provider: str = "ollama"        # ollama | gemini | openai | anthropic
    api_key: str = ""               # required for cloud providers
    model: str = ""                 # optional override


class EvalResult(BaseModel):
    score: int
    verdict: str
    strength: str
    missing: str
    hint: str
    ideal: str


class ProviderInfo(BaseModel):
    id: str
    name: str
    needs_key: bool
    default_model: str
    models: list[str]


# ── Routes ──
@app.get("/api/health")
async def health():
    ollama_ok = False
    ollama_models = []
    try:
        r = await http_client.get("http://localhost:11434/api/tags")
        ollama_models = [m["name"] for m in r.json().get("models", [])]
        ollama_ok = True
    except Exception:
        pass

    return {
        "status": "ok",
        "ollama": ollama_ok,
        "ollama_models": ollama_models,
    }


@app.get("/api/providers")
async def get_providers():
    """Return available providers and their config."""
    ollama_models = []
    try:
        r = await http_client.get("http://localhost:11434/api/tags")
        ollama_models = [m["name"] for m in r.json().get("models", [])]
    except Exception:
        pass

    providers = [
        ProviderInfo(
            id="ollama",
            name="Ollama (Local)",
            needs_key=False,
            default_model=ollama_models[0] if ollama_models else "llama3:latest",
            models=ollama_models or ["llama3:latest"],
        ),
        ProviderInfo(
            id="gemini",
            name="Google Gemini",
            needs_key=True,
            default_model="gemini-2.5-flash",
            models=["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro"],
        ),
        ProviderInfo(
            id="groq",
            name="Groq",
            needs_key=True,
            default_model="llama-3.3-70b-versatile",
            models=["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-qwq-32b", "gemma2-9b-it"],
        ),
        ProviderInfo(
            id="openai",
            name="OpenAI",
            needs_key=True,
            default_model="gpt-4o-mini",
            models=["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"],
        ),
        ProviderInfo(
            id="anthropic",
            name="Anthropic",
            needs_key=True,
            default_model="claude-sonnet-4-20250514",
            models=["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
        ),
    ]
    return {"providers": providers}


@app.get("/api/questions")
async def get_questions():
    return {"questions": QUESTIONS, "sessions": SESSIONS}


@app.post("/api/evaluate", response_model=EvalResult)
async def evaluate(req: EvalRequest):
    question = next((q for q in QUESTIONS if q["id"] == req.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    try:
        result = await evaluate_with_provider(
            client=http_client,
            provider=req.provider,
            api_key=req.api_key,
            model=req.model,
            section=question["s"],
            question=question["q"],
            answer=req.answer,
        )
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Cannot reach the provider. Is Ollama running?" if req.provider == "ollama"
            else "Cannot reach the provider API.",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Provider error: {str(e)}")

    if result is None:
        raise HTTPException(status_code=422, detail="LLM returned unparseable response")

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
