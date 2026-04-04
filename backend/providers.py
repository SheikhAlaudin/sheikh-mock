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


# ─── Question generation ──────────────────────────────────

def build_question_gen_prompt(topic: str, count: int) -> str:
    focus = f"Focus specifically on: {topic}." if topic else \
        "Cover a mix of: JS Core concepts, async/promises, React hooks, performance, and system design."
    return f"""You are a senior JavaScript/React technical interviewer with 15 years experience.

Generate exactly {count} technical interview questions for a candidate with 8+ years of experience.

{focus}

STRICT RULES:
- Return ONLY a valid JSON array — no markdown, no backticks, no explanation.
- Each item must have exactly these fields: {{"id": string, "q": string, "s": string, "day": 0}}
  - "id": unique short id like "gen01", "gen02", etc.
  - "q": the full interview question (be specific, scenario-based, not generic)
  - "s": category label e.g. "React Hooks", "JS Core", "Performance", "System Design"
  - "day": always 0 (indicates AI-generated)
- Mix difficulty: at least one deep conceptual, one practical/code, one scenario-based.
- Questions must require explanation, not yes/no answers.

Return ONLY the JSON array, nothing else."""


async def _call_llm_for_questions(
    client: httpx.AsyncClient,
    provider: str,
    api_key: str,
    model: str,
    prompt: str,
) -> list:
    """Call the appropriate LLM and return parsed question list."""
    import sys

    text = ""
    if provider == "ollama":
        r = await client.post(
            "http://localhost:11434/api/generate",
            json={"model": model or "llama3:latest", "prompt": prompt, "stream": False,
                  "options": {"temperature": 0.7, "num_predict": 1024}},
        )
        r.raise_for_status()
        text = r.json().get("response", "")

    elif provider == "gemini":
        model_name = model or "gemini-2.5-flash"
        r = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
            params={"key": api_key},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048,
                                     "responseMimeType": "application/json"},
            },
        )
        r.raise_for_status()
        data = r.json()
        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = "".join(p.get("text", "") for p in parts if p.get("text"))

    elif provider in ("groq", "openai", "anthropic"):
        if provider == "groq":
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}"}
            mdl = model or "llama-3.3-70b-versatile"
        elif provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}"}
            mdl = model or "gpt-4o-mini"
        else:  # anthropic — use openai-compat via messages
            r2 = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                         "Content-Type": "application/json"},
                json={"model": model or "claude-sonnet-4-20250514", "max_tokens": 1024,
                      "messages": [{"role": "user", "content": prompt}]},
            )
            r2.raise_for_status()
            data2 = r2.json()
            text = "".join(c["text"] for c in data2["content"] if c["type"] == "text")
            mdl = None

        if provider in ("groq", "openai"):
            r = await client.post(url, headers=headers,
                json={"model": mdl, "temperature": 0.7, "max_tokens": 1024,
                      "messages": [{"role": "user", "content": prompt}]})
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]

    print(f"[gen] raw (200): {repr(text[:200])}", file=sys.stderr)

    # Parse JSON array from text
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"```", "", cleaned).strip()
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end <= start:
        raise ValueError(f"No JSON array in response: {repr(text[:150])}")

    questions = json.loads(cleaned[start:end + 1])
    # Validate and normalise each question
    result = []
    for i, q in enumerate(questions):
        if not isinstance(q, dict) or "q" not in q:
            continue
        result.append({
            "id": q.get("id") or f"gen{i+1:02d}",
            "q": str(q["q"]).strip(),
            "s": str(q.get("s") or q.get("category") or "AI Generated").strip(),
            "day": 0,
        })
    return result


def _extract_pdf_text(file_bytes: bytes) -> str:
    """Extract plain text from a PDF file."""
    import io
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(file_bytes))
    parts = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            parts.append(t.strip())
    return "\n\n".join(parts)[:6000]  # cap to avoid token blowout


def _image_to_base64(file_bytes: bytes, content_type: str) -> str:
    import base64
    return base64.b64encode(file_bytes).decode()


def _build_file_question_prompt(text_content: str) -> str:
    return f"""You are a senior JavaScript/React technical interviewer.

The candidate has uploaded the following content (CV, resume, code snippet, or document):

---
{text_content}
---

Based ONLY on the content above, generate exactly ONE challenging technical interview question that:
- Is directly relevant to the technologies, projects, or skills mentioned
- Requires the candidate to explain, justify, or demonstrate understanding
- Is specific (not generic) — reference something actually in the content
- Is suitable for a senior engineer (8+ years experience)

STRICT RULES:
- Return ONLY a valid JSON object — no markdown, no backticks, no explanation outside JSON.
- Format: {{"id": "file01", "q": "<the full question>", "s": "<short category e.g. React, System Design, JS Core>", "day": 0}}

Return ONLY the JSON object."""


async def generate_question_from_file(
    client: httpx.AsyncClient,
    provider: str,
    api_key: str,
    model: str,
    file_bytes: bytes,
    content_type: str,
    filename: str,
) -> dict:
    """Extract content from PDF or image, generate 1 interview question."""
    import sys, base64

    # Apply key fallbacks
    if provider == "gemini":
        api_key = api_key or GEMINI_API_KEY
    elif provider == "groq":
        api_key = api_key or GROQ_API_KEY

    is_pdf = "pdf" in content_type or filename.lower().endswith(".pdf")
    is_image = content_type.startswith("image/") or filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))

    if is_pdf:
        text_content = _extract_pdf_text(file_bytes)
        if not text_content.strip():
            raise ValueError("Could not extract text from PDF")
        prompt = _build_file_question_prompt(text_content)
        # Text-only path for all providers
        result = await _call_llm_for_questions(client, provider, api_key, model, prompt)
    elif is_image:
        # Vision path: use provider's vision capability
        img_b64 = _image_to_base64(file_bytes, content_type)
        mime = content_type if content_type.startswith("image/") else "image/jpeg"

        vision_prompt = (
            "You are a senior JavaScript/React technical interviewer. "
            "Look at this image (it could be a CV, code, architecture diagram, or resume). "
            "Based ONLY on what you see, generate exactly ONE challenging technical interview question "
            "that is directly relevant to the content. The question should be specific and suitable for "
            "a senior engineer (8+ years experience). "
            "Return ONLY a raw JSON object — no markdown, no backticks: "
            '{"id": "file01", "q": "<full question>", "s": "<category>", "day": 0}'
        )

        text = ""
        if provider == "gemini":
            model_name = model or "gemini-2.5-flash"
            r = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                params={"key": api_key},
                json={
                    "contents": [{"parts": [
                        {"text": vision_prompt},
                        {"inline_data": {"mime_type": mime, "data": img_b64}},
                    ]}],
                    "generationConfig": {"temperature": 0.7, "maxOutputTokens": 512},
                },
            )
            r.raise_for_status()
            data = r.json()
            parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts if p.get("text"))

        elif provider == "openai":
            r = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model or "gpt-4o-mini",
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": [
                        {"type": "text", "text": vision_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}},
                    ]}],
                },
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]

        elif provider == "anthropic":
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
                json={
                    "model": model or "claude-sonnet-4-20250514",
                    "max_tokens": 512,
                    "messages": [{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img_b64}},
                        {"type": "text", "text": vision_prompt},
                    ]}],
                },
            )
            r.raise_for_status()
            data = r.json()
            text = "".join(c["text"] for c in data["content"] if c["type"] == "text")

        else:
            # Groq / Ollama don't support vision natively — extract via OCR hint fallback
            raise ValueError(f"Provider '{provider}' does not support image vision. Use Gemini, OpenAI, or Anthropic for images, or upload a PDF.")

        print(f"[file-vision] raw (200): {repr(text[:200])}", file=sys.stderr)
        # Parse single JSON object
        cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"```", "", cleaned).strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ValueError(f"No JSON object in vision response: {repr(text[:150])}")
        q = json.loads(cleaned[start:end + 1])
        result = [{"id": q.get("id", "file01"), "q": str(q["q"]).strip(), "s": str(q.get("s", "AI Generated")).strip(), "day": 0}]
    else:
        raise ValueError("Unsupported file type. Please upload a PDF or image (PNG, JPG, WEBP).")

    if not result:
        raise ValueError("Could not generate a question from this file")
    return result[0]


async def generate_questions_with_provider(
    client: httpx.AsyncClient,
    provider: str,
    api_key: str,
    model: str,
    topic: str,
    count: int,
) -> list:
    """Generate interview questions using the selected provider."""
    # Apply key fallbacks
    if provider == "gemini":
        api_key = api_key or GEMINI_API_KEY
    elif provider in ("groq",):
        api_key = api_key or GROQ_API_KEY

    prompt = build_question_gen_prompt(topic, count)
    return await _call_llm_for_questions(client, provider, api_key, model, prompt)
