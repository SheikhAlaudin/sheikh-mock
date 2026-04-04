import { useState, useRef, useCallback, useEffect } from 'react';

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function useVoice(onTranscript) {
  const [isRecording, setIsRecording] = useState(false);
  const [hasMic, setHasMic] = useState(!!SR);
  const [label, setLabel] = useState(
    SR ? 'Voice fills the box below — or just type' : 'Type your answer below'
  );

  // Stable refs — never trigger re-renders or stale closures
  const isRecRef = useRef(false);
  const recogRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);
  const hasMicRef = useRef(!!SR);

  // Keep transcript callback ref up to date without recreating recognition
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  // Build recognition instance once
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
      // Fatal — mic permanently unavailable
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        hasMicRef.current = false;
        setHasMic(false);
        isRecRef.current = false;
        setIsRecording(false);
        setLabel('Mic access denied. Type your answer below.');
        return;
      }
      // Recoverable — Chrome fires these during normal use; onend will restart
      // 'no-speech': silence timeout (~5s)
      // 'network': brief connectivity hiccup
      // 'aborted': we called stop() intentionally
      if (e.error === 'no-speech' || e.error === 'network' || e.error === 'aborted') return;
      // Any other unexpected error — stop cleanly
      isRecRef.current = false;
      setIsRecording(false);
      setLabel('Voice fills the box below — or just type');
    };

    r.onend = () => {
      // Auto-restart only if we're still supposed to be recording
      if (isRecRef.current && hasMicRef.current) {
        try {
          r.start();
        } catch {
          setTimeout(() => {
            if (isRecRef.current && hasMicRef.current) {
              try { r.start(); } catch {
                isRecRef.current = false;
                setIsRecording(false);
                setLabel('Voice fills the box below — or just type');
              }
            }
          }, 200);
        }
      } else {
        isRecRef.current = false;
        setIsRecording(false);
        setLabel('Voice fills the box below — or just type');
      }
    };

    recogRef.current = r;
  }, []); // run once only

  const toggle = useCallback(() => {
    if (!hasMicRef.current || !recogRef.current) return;

    if (isRecRef.current) {
      // Stop
      isRecRef.current = false;
      try { recogRef.current.stop(); } catch { /* ignore */ }
      setIsRecording(false);
      setLabel('Voice fills the box below — or just type');
    } else {
      // Start
      isRecRef.current = true;
      try {
        recogRef.current.start();
        setIsRecording(true);
        setLabel('Listening — speak now...');
      } catch (e) {
        if (e.name === 'InvalidStateError') {
          // Already running — treat as success
          setIsRecording(true);
          setLabel('Listening — speak now...');
        } else {
          hasMicRef.current = false;
          setHasMic(false);
          isRecRef.current = false;
          setIsRecording(false);
        }
      }
    }
  }, []);

  const stop = useCallback(() => {
    if (!isRecRef.current) return;
    isRecRef.current = false;
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    setIsRecording(false);
    setLabel('Voice fills the box below — or just type');
  }, []);

  return { isRecording, hasMic, label, toggle, stop };
}
