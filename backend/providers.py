"""
Multi-provider LLM abstraction.
Supports: Ollama (local), Google Gemini, OpenAI, Anthropic.
"""

import json
import re
import httpx

EVAL_SYSTEM = (
    "You are a strict but fair senior JavaScript/React technical interviewer. "
    "The candidate has 8+ years of experience."
)

def build_eval_prompt(section: str, question: str, answer: str) -> str:
    return f"""Section: {section}
Question: {question}
Candidate answer: {answer}

Respond with ONLY a raw JSON object — no markdown, no backticks, no explanation outside the JSON:
{{"score": <integer 0-100>, "verdict": "correct"|"partial"|"incorrect", "strength": "<what they got right in 1 sentence or Nothing significant>", "missing": "<key concept(s) missed in 1 sentence or None>", "hint": "<Socratic hint without giving answer — empty string if correct>", "ideal": "<ideal answer in 2-3 technical sentences>"}}"""


def parse_eval_json(text: str) -> dict | None:
    """Extract evaluation JSON from any LLM output."""
    cleaned = re.sub(r"```(?:json)?", "", text).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    if "score" not in data or "verdict" not in data:
        return None
    score = max(0, min(100, int(data.get("score", 0))))
    verdict = data.get("verdict", "incorrect")
    if verdict not in ("correct", "partial", "incorrect"):
        verdict = "incorrect"
    return {
        "score": score,
        "verdict": verdict,
        "strength": str(data.get("strength", ""))[:500],
        "missing": str(data.get("missing", ""))[:500],
        "hint": str(data.get("hint", ""))[:500],
        "ideal": str(data.get("ideal", ""))[:1000],
    }


# ─── Ollama ───────────────────────────────────────────────
async def call_ollama(
    client: httpx.AsyncClient,
    model: str,
    section: str,
    question: str,
    answer: str,
    base_url: str = "http://localhost:11434",
) -> dict:
    prompt = build_eval_prompt(section, question, answer)
    r = await client.post(
        f"{base_url}/api/generate",
        json={
            "model": model or "llama3:latest",
            "prompt": f"{EVAL_SYSTEM}\n\n{prompt}",
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 512},
        },
    )
    r.raise_for_status()
    return parse_eval_json(r.json().get("response", ""))


# ─── Google Gemini ────────────────────────────────────────
async def call_gemini(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    section: str,
    question: str,
    answer: str,
) -> dict:
    prompt = build_eval_prompt(section, question, answer)
    model_name = model or "gemini-2.5-flash"
    r = await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": f"{EVAL_SYSTEM}\n\n{prompt}"}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 512},
        },
    )
    r.raise_for_status()
    data = r.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    return parse_eval_json(text)


# ─── OpenAI ───────────────────────────────────────────────
async def call_openai(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    section: str,
    question: str,
    answer: str,
) -> dict:
    prompt = build_eval_prompt(section, question, answer)
    r = await client.post(
        "https://api.openai.com/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model or "gpt-4o-mini",
            "temperature": 0.3,
            "max_tokens": 512,
            "messages": [
                {"role": "system", "content": EVAL_SYSTEM},
                {"role": "user", "content": prompt},
            ],
        },
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"]
    return parse_eval_json(text)


# ─── Groq ────────────────────────────────────────────────
async def call_groq(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    section: str,
    question: str,
    answer: str,
) -> dict:
    prompt = build_eval_prompt(section, question, answer)
    r = await client.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "model": model or "llama-3.3-70b-versatile",
            "temperature": 0.3,
            "max_tokens": 512,
            "messages": [
                {"role": "system", "content": EVAL_SYSTEM},
                {"role": "user", "content": prompt},
            ],
        },
    )
    r.raise_for_status()
    text = r.json()["choices"][0]["message"]["content"]
    return parse_eval_json(text)


# ─── Anthropic ────────────────────────────────────────────
async def call_anthropic(
    client: httpx.AsyncClient,
    api_key: str,
    model: str,
    section: str,
    question: str,
    answer: str,
) -> dict:
    prompt = build_eval_prompt(section, question, answer)
    r = await client.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": model or "claude-sonnet-4-20250514",
            "max_tokens": 512,
            "system": EVAL_SYSTEM,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    r.raise_for_status()
    data = r.json()
    text = "".join(c["text"] for c in data["content"] if c["type"] == "text")
    return parse_eval_json(text)


# ─── Router ──────────────────────────────────────────────
PROVIDERS = {
    "ollama": call_ollama,
    "gemini": call_gemini,
    "groq": call_groq,
    "openai": call_openai,
    "anthropic": call_anthropic,
}

async def evaluate_with_provider(
    client: httpx.AsyncClient,
    provider: str,
    api_key: str,
    model: str,
    section: str,
    question: str,
    answer: str,
) -> dict:
    """Route to the correct provider and return parsed evaluation."""
    if provider == "ollama":
        return await call_ollama(client, model, section, question, answer)
    elif provider == "gemini":
        if not api_key:
            raise ValueError("Google Gemini API key is required")
        return await call_gemini(client, api_key, model, section, question, answer)
    elif provider == "groq":
        if not api_key:
            raise ValueError("Groq API key is required")
        return await call_groq(client, api_key, model, section, question, answer)
    elif provider == "openai":
        if not api_key:
            raise ValueError("OpenAI API key is required")
        return await call_openai(client, api_key, model, section, question, answer)
    elif provider == "anthropic":
        if not api_key:
            raise ValueError("Anthropic API key is required")
        return await call_anthropic(client, api_key, model, section, question, answer)
    else:
        raise ValueError(f"Unknown provider: {provider}")
