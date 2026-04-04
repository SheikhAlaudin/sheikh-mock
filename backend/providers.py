"""
Multi-provider LLM abstraction.
Supports: Ollama (local), Google Gemini, OpenAI, Anthropic.
"""

import json
import re
import os
import httpx

# ── Hardcoded fallback keys (used when no key is passed from frontend) ──
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")
GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "YOUR_GROQ_API_KEY_HERE")

EVAL_SYSTEM = (
    "You are a senior JavaScript/React technical interviewer evaluating a candidate with 8+ years of experience. "
    "You evaluate answers SEMANTICALLY — you understand the INTENT and KNOWLEDGE behind words, "
    "not just literal phrasing. The candidate may have used voice-to-text, so minor transcription "
    "errors (e.g. 'letten' for 'let and', 'ESG' for 'ES6', 'temporal dead son' for 'temporal dead zone') "
    "should be interpreted charitably as the correct technical term. "
    "Judge what the candidate KNOWS, not how perfectly they phrased it."
)

def build_eval_prompt(section: str, question: str, answer: str) -> str:
    return f"""Section: {section}
Question: {question}
Candidate answer: {answer}

EVALUATION INSTRUCTIONS:
1. SEMANTIC INTERPRETATION: First, mentally correct any obvious voice transcription errors in the answer (e.g. "letten const" → "let and const", "ESG6" → "ES6", "temporal dead son" → "temporal dead zone"). Evaluate the corrected meaning.

2. CONCEPT EXTRACTION: Identify the 3-5 key concepts this question requires. For each concept, determine if the candidate demonstrated understanding (even partially or indirectly).

3. SCORING RUBRIC:
   - 85-100 (correct): Covers all key concepts accurately, even if not perfectly worded
   - 50-84 (partial): Demonstrates clear understanding of some concepts but misses others
   - 20-49 (partial): Shows awareness of the topic but with significant gaps
   - 0-19 (incorrect): Does not demonstrate meaningful understanding of the core concepts

4. VERDICT RULES:
   - "correct" if score >= 75
   - "partial" if score >= 30
   - "incorrect" if score < 30

Respond with ONLY a raw JSON object — no markdown, no backticks, no explanation outside the JSON:
{{"score": <integer 0-100>, "verdict": "correct"|"partial"|"incorrect", "strength": "<specific concepts they demonstrated correctly — be generous with partial credit>", "missing": "<specific concepts not covered or incorrect — be precise>", "hint": "<Socratic question pointing toward the gap, empty string if correct>", "ideal": "<concise ideal answer covering all key concepts in 2-3 sentences>"}}"""


def parse_eval_json(text: str) -> dict | None:
    """Extract evaluation JSON from any LLM output."""
    import sys
    if not text or not text.strip():
        print(f"[parse_eval_json] Empty text received", file=sys.stderr)
        return None

    # Remove markdown fences and leading/trailing whitespace
    cleaned = re.sub(r"```(?:json)?```?", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned).strip()

    # Find outermost JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end <= start:
        print(f"[parse_eval_json] No JSON object found. Raw text (200 chars): {repr(text[:200])}", file=sys.stderr)
        return None

    json_str = cleaned[start : end + 1]
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"[parse_eval_json] JSON parse error: {e}. Snippet: {repr(json_str[:200])}", file=sys.stderr)
        return None

    if "score" not in data or "verdict" not in data:
        print(f"[parse_eval_json] Missing required fields. Got keys: {list(data.keys())}", file=sys.stderr)
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
    api_key = api_key or GEMINI_API_KEY
    prompt = build_eval_prompt(section, question, answer)
    model_name = model or "gemini-2.5-flash"
    r = await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
        params={"key": api_key},
        json={
            "contents": [{"parts": [{"text": f"{EVAL_SYSTEM}\n\n{prompt}"}]}],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 2048,
                "responseMimeType": "application/json",
            },
        },
    )
    r.raise_for_status()
    data = r.json()

    import sys
    if "error" in data:
        raise ValueError(f"Gemini API error: {data['error'].get('message', data['error'])}")

    candidates = data.get("candidates", [])
    if not candidates:
        print(f"[Gemini] No candidates in response: {data}", file=sys.stderr)
        raise ValueError("Gemini returned no candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts if p.get("text"))
    print(f"[Gemini] Raw text (200): {repr(text[:200])}", file=sys.stderr)
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
    api_key = api_key or GROQ_API_KEY
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
