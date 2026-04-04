import { useState, useRef, useCallback } from 'react';

export function useVoice(onTranscript) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasMicSupport = !!SR;

  const [isRecording, setIsRecording] = useState(false);
  const [hasMic, setHasMic] = useState(hasMicSupport);
  const [label, setLabel] = useState(
    hasMicSupport ? 'Voice fills the box below — or just type' : 'Type your answer below'
  );
  const recogRef = useRef(null);
  const isRecRef = useRef(false);

  const syncLabel = useCallback((rec, micOk) => {
    if (rec) setLabel('Listening — speak now...');
    else setLabel(micOk ? 'Voice fills the box below — or just type' : 'Type your answer below');
  }, []);

  const initRecog = useCallback(() => {
    if (!SR || recogRef.current) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          onTranscript(e.results[i][0].transcript);
        } else {
          interim = e.results[i][0].transcript;
        }
      }
      if (interim) setLabel('Hearing: ' + interim);
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setHasMic(false);
        isRecRef.current = false;
        setIsRecording(false);
        setLabel('Mic access denied. Type your answer below.');
        return;
      }
      isRecRef.current = false;
      setIsRecording(false);
      syncLabel(false, true);
    };

    r.onend = () => {
      if (isRecRef.current && hasMicSupport) {
        try { r.start(); } catch {
          setTimeout(() => {
            if (isRecRef.current) try { r.start(); } catch { isRecRef.current = false; setIsRecording(false); syncLabel(false, true); }
          }, 150);
        }
      } else {
        isRecRef.current = false;
        setIsRecording(false);
        syncLabel(false, true);
      }
    };

    recogRef.current = r;
  }, [SR, onTranscript, syncLabel, hasMicSupport]);

  const toggle = useCallback(() => {
    if (!hasMic) return;
    initRecog();
    if (isRecRef.current) {
      isRecRef.current = false;
      try { recogRef.current?.stop(); } catch { /* ignore */ }
      setIsRecording(false);
      syncLabel(false, hasMic);
    } else {
      isRecRef.current = true;
      try {
        recogRef.current?.start();
        setIsRecording(true);
        syncLabel(true, hasMic);
      } catch (e) {
        if (e.name !== 'InvalidStateError') { setHasMic(false); }
        isRecRef.current = false;
        setIsRecording(false);
        syncLabel(false, hasMic);
      }
    }
  }, [hasMic, initRecog, syncLabel]);

  const stop = useCallback(() => {
    if (!isRecRef.current) return;
    isRecRef.current = false;
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    setIsRecording(false);
    syncLabel(false, hasMic);
  }, [hasMic, syncLabel]);

  return { isRecording, hasMic, label, toggle, stop };
}
