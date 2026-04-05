"""
Sheikh Mock Interviewer — Multi-provider FastAPI backend.
Supports: Ollama (local), Google Gemini, Groq, OpenAI, Anthropic.

Run:  uvicorn main:app --reload --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
import os

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from questions import QUESTIONS, SESSIONS
from providers import (
    ClientInputError,
    ProviderResponseError,
    evaluate_with_provider,
    generate_question_from_file,
    generate_questions_with_provider,
    resolve_api_key,
)

# ── HTTP client (shared) ──
http_client: httpx.AsyncClient | None = None

DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_UPLOAD_CONTENT_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
}
ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
SERVER_KEY_ENV_VARS = {
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}


def _cors_origins() -> list[str]:
    raw = os.environ.get("BACKEND_CORS_ORIGINS", ",".join(DEFAULT_CORS_ORIGINS)).strip()
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _http_error_detail(error: httpx.HTTPStatusError) -> str:
    body = error.response.text[:200] if error.response is not None else str(error)
    return body or str(error)


def _has_server_key(provider_id: str) -> bool:
    env_name = SERVER_KEY_ENV_VARS.get(provider_id)
    return bool(env_name and os.environ.get(env_name, "").strip())


def _validate_upload(file_bytes: bytes, content_type: str, filename: str) -> None:
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large — max 10 MB.")

    suffix = Path(filename or "").suffix.lower()
    content_type = (content_type or "").lower()
    valid_content_type = content_type in ALLOWED_UPLOAD_CONTENT_TYPES
    valid_suffix = suffix in ALLOWED_UPLOAD_EXTENSIONS

    if not (valid_content_type or valid_suffix):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PDF or image (PNG, JPG, WEBP, GIF).",
        )


async def _fetch_ollama_models() -> list[str]:
    if http_client is None:
        return []

    try:
        response = await http_client.get("http://localhost:11434/api/tags")
        response.raise_for_status()
        return [model["name"] for model in response.json().get("models", [])]
    except Exception:
        return []


@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    print("[OK] Sheikh Mock backend ready - multi-provider mode")

    try:
        models = await _fetch_ollama_models()
        if models:
            print(f"  Ollama connected - models: {models}")
        else:
            print("  Ollama not running (optional - cloud providers still work)")
    except httpx.ConnectError:
        print("  Ollama not running (optional - cloud providers still work)")

    yield
    await http_client.aclose()


app = FastAPI(title="Sheikh Mock API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class EvalRequest(BaseModel):
    question_id: str
    answer: str
    provider: str = "ollama"
    api_key: str = ""
    model: str = ""


class GenerateQuestionsRequest(BaseModel):
    provider: str = "groq"
    api_key: str = ""
    model: str = ""
    topic: str = ""
    count: int = 3


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
    server_key_available: bool = False
    default_model: str
    models: list[str]


@app.get("/api/health")
async def health():
    ollama_models = await _fetch_ollama_models()
    return {
        "status": "ok" if http_client is not None else "unreachable",
        "ollama": bool(ollama_models),
        "ollama_models": ollama_models,
    }


@app.get("/api/providers")
async def get_providers():
    """Return available providers and their config."""
    ollama_models = await _fetch_ollama_models()

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
            server_key_available=_has_server_key("gemini"),
            default_model="gemini-2.5-flash",
            models=["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro"],
        ),
        ProviderInfo(
            id="groq",
            name="Groq",
            needs_key=True,
            server_key_available=_has_server_key("groq"),
            default_model="llama-3.3-70b-versatile",
            models=["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-qwq-32b", "gemma2-9b-it"],
        ),
        ProviderInfo(
            id="openai",
            name="OpenAI",
            needs_key=True,
            server_key_available=_has_server_key("openai"),
            default_model="gpt-4o-mini",
            models=["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1-nano"],
        ),
        ProviderInfo(
            id="anthropic",
            name="Anthropic",
            needs_key=True,
            server_key_available=_has_server_key("anthropic"),
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
    if not req.answer.strip():
        raise HTTPException(status_code=400, detail="Answer is required")

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
    except ClientInputError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except ProviderResponseError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Cannot reach the provider. Is Ollama running?" if req.provider == "ollama"
            else "Cannot reach the provider API.",
        )
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"Provider error: {_http_error_detail(error)}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Provider error: {str(error)}")

    if result is None:
        raise HTTPException(status_code=422, detail="LLM returned unparseable response")

    return result


@app.post("/api/generate-questions")
async def generate_questions(req: GenerateQuestionsRequest):
    """Generate fresh interview questions using the selected LLM provider."""
    count = max(1, min(10, req.count))
    try:
        questions = await generate_questions_with_provider(
            client=http_client,
            provider=req.provider,
            api_key=req.api_key,
            model=req.model,
            topic=req.topic,
            count=count,
        )
    except ClientInputError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except ProviderResponseError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"Generation failed: {_http_error_detail(error)}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Generation failed: {str(error)}")

    if not questions:
        raise HTTPException(status_code=422, detail="LLM returned no valid questions")

    return {"questions": questions}


@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    groq_api_key: str = Form(""),
):
    """Transcribe audio using Groq Whisper large-v3-turbo."""
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(audio_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large — max 10 MB.")

    try:
        resolved_key = resolve_api_key("groq", groq_api_key)
    except ClientInputError as error:
        raise HTTPException(status_code=400, detail=str(error))

    try:
        response = await http_client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {resolved_key}"},
            files={"file": (audio.filename or "audio.webm", audio_bytes, audio.content_type or "audio/webm")},
            data={
                "model": "whisper-large-v3-turbo",
                "response_format": "json",
                "language": "en",
            },
        )
        response.raise_for_status()
        data = response.json()
        return {"text": data.get("text", "").strip()}
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"Groq Whisper error: {_http_error_detail(error)}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {str(error)}")


@app.post("/api/generate-from-file")
async def generate_from_file(
    file: UploadFile = File(...),
    provider: str = Form("groq"),
    api_key: str = Form(""),
    model: str = Form(""),
):
    """Extract text/content from a PDF or image and generate 1 interview question."""
    file_bytes = await file.read()
    content_type = file.content_type or ""
    filename = file.filename or ""
    _validate_upload(file_bytes, content_type, filename)

    try:
        question = await generate_question_from_file(
            client=http_client,
            provider=provider,
            api_key=api_key,
            model=model,
            file_bytes=file_bytes,
            content_type=content_type,
            filename=filename,
        )
    except ClientInputError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except ProviderResponseError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except httpx.HTTPStatusError as error:
        raise HTTPException(status_code=502, detail=f"File question generation failed: {_http_error_detail(error)}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"File question generation failed: {str(error)}")

    return {"questions": [question]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
