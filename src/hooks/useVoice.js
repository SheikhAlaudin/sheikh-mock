import { useState, useRef, useCallback, useEffect } from 'react';
import { transcribeAudio } from '../api';

/**
 * useVoice — Groq Whisper STT (primary) with Web Speech API fallback.
 *
 * When groqApiKey is provided:
 *   - Click Start → MediaRecorder begins capturing mic audio
 *   - Click Stop  → audio blob sent to /api/transcribe → Whisper returns text
 *   - Text appended to textarea via onTranscript()
 *
 * When no groqApiKey:
 *   - Falls back to browser Web Speech API (real-time, lower quality)
 */

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function useVoice(onTranscript, groqApiKey = '') {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [hasMic, setHasMic] = useState(true);
  const [label, setLabel] = useState('Click Voice to speak your answer');
  const [error, setError] = useState('');

  const onTranscriptRef = useRef(onTranscript);
  const groqKeyRef = useRef(groqApiKey);
  const isRecRef = useRef(false);

  // Keep refs current
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { groqKeyRef.current = groqApiKey; }, [groqApiKey]);

  // ── MediaRecorder refs (Groq Whisper mode) ──
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  // ── Web Speech API ref (fallback mode) ──
  const recogRef = useRef(null);
  const hasMicRef = useRef(true);

  const useWhisper = () => !!groqKeyRef.current;

  // Build Web Speech instance once (fallback only)
  useEffect(() => {
    if (!SR || recogRef.current) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          onTranscriptRef.current(e.results[i][0].transcript);
        } else {
          interim = e.results[i][0].transcript;
        }
      }
      if (interim) setLabel('Hearing: ' + interim);
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        hasMicRef.current = false;
        setHasMic(false);
        isRecRef.current = false;
        setIsRecording(false);
        setLabel('Mic access denied. Type your answer below.');
        return;
      }
      if (e.error === 'no-speech' || e.error === 'network' || e.error === 'aborted') return;
      isRecRef.current = false;
      setIsRecording(false);
      setLabel('Click Voice to speak your answer');
    };

    r.onend = () => {
      if (isRecRef.current && hasMicRef.current) {
        try { r.start(); } catch {
          setTimeout(() => {
            if (isRecRef.current && hasMicRef.current) {
              try { r.start(); } catch {
                isRecRef.current = false;
                setIsRecording(false);
                setLabel('Click Voice to speak your answer');
              }
            }
          }, 200);
        }
      } else {
        isRecRef.current = false;
        setIsRecording(false);
        setLabel('Click Voice to speak your answer');
      }
    };

    recogRef.current = r;
  }, []);

  // ── Start recording ──
  const startWhisper = useCallback(async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Pick best supported format
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find(
        t => MediaRecorder.isTypeSupported(t)
      ) || '';

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250); // collect chunks every 250ms
      mediaRecorderRef.current = mr;

      isRecRef.current = true;
      setIsRecording(true);
      setLabel('Recording... click Stop when done');
    } catch {
      setHasMic(false);
      setLabel('Mic access denied. Type your answer below.');
    }
  }, []);

  const stopWhisper = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    const stream = streamRef.current;
    if (!mr) return;

    isRecRef.current = false;
    setIsRecording(false);
    setLabel('Transcribing with Whisper...');
    setIsTranscribing(true);

    await new Promise((resolve) => {
      mr.onstop = resolve;
      mr.stop();
    });

    // Stop mic tracks
    stream?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;

    try {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
      chunksRef.current = [];

      if (blob.size < 1000) {
        setLabel('Recording too short — try again');
        setIsTranscribing(false);
        return;
      }

      const text = await transcribeAudio(blob, groqKeyRef.current);
      if (text) {
        onTranscriptRef.current(text);
        setLabel(`Transcribed ${text.split(' ').length} words`);
        setTimeout(() => setLabel('Click Voice to speak your answer'), 3000);
      } else {
        setLabel('No speech detected — try again');
        setTimeout(() => setLabel('Click Voice to speak your answer'), 3000);
      }
    } catch (e) {
      setError('Transcription failed: ' + e.message);
      setLabel('Click Voice to speak your answer');
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  // ── Fallback Web Speech start/stop ──
  const startSpeech = useCallback(() => {
    if (!hasMicRef.current || !recogRef.current) return;
    isRecRef.current = true;
    try {
      recogRef.current.start();
      setIsRecording(true);
      setLabel('Listening — speak now...');
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        setIsRecording(true);
        setLabel('Listening — speak now...');
      }
    }
  }, []);

  const stopSpeech = useCallback(() => {
    isRecRef.current = false;
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    setIsRecording(false);
    setLabel('Click Voice to speak your answer');
  }, []);

  // ── Public API ──
  const toggle = useCallback(() => {
    if (!hasMic) return;
    if (isRecording) {
      useWhisper() ? stopWhisper() : stopSpeech();
    } else {
      useWhisper() ? startWhisper() : startSpeech();
    }
  }, [hasMic, isRecording, startWhisper, stopWhisper, startSpeech, stopSpeech]);

  const stop = useCallback(() => {
    if (!isRecRef.current && !isRecording) return;
    useWhisper() ? stopWhisper() : stopSpeech();
  }, [isRecording, stopWhisper, stopSpeech]);

  const mode = useWhisper() ? 'whisper' : SR ? 'browser' : 'none';

  return { isRecording, isTranscribing, hasMic, label, error, mode, toggle, stop };
}
