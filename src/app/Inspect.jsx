/**
 * Evidence capture — the check-in screen. See docs/specs/ORDER-AND-INSPECTION.md.
 *
 * ─── The one rule this component exists to enforce ─────────────────────────────────────────
 *
 * A LIVE FRAME ONLY. `getUserMedia`, NEVER `<input type="file">`. A file input would let the
 * inspector submit any photo already on the device — last week's shot of the right warehouse, a
 * picture taken from a screen. A media stream forces a frame from the camera now. There is
 * deliberately no file fallback anywhere in this file: if the camera is unavailable the capture
 * cannot proceed, because a fallback that accepts a file is the exact hole the whole design closes.
 *
 * The platform nonce, issued at claim, is drawn INTO the frame and echoed to the server, so a
 * frame that does not answer THIS check-in is refused. Coordinates are read from the device at the
 * moment of capture and sent for the server to compare against an independent network fix — the
 * grade is consistency between the two, computed server-side, not anything asserted here.
 *
 * The watermark drawn here is FOR HUMANS. It is trivially forgeable and it is not the proof; the
 * proof is the SHA-256 the server takes over the stored bytes. See the spec.
 * ───────────────────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { LEVELS } from '../../shared/assurance.mjs';

/** ddmmyyyy hhmmss for the human-readable stamp. ISO-8601 UTC is what the server stores. */
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}${p(d.getMonth() + 1)}${d.getFullYear()}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return { date, time };
}

/** One position fix, resolved at the moment the platform asks — never scheduled, never cached. */
function readPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        observedAt: new Date().toISOString(),
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export default function Inspect({ job, onCaptured }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('starting camera…');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const nonce = job?.nonce;

  useEffect(() => {
    let cancelled = false;
    // getUserMedia only. No file input, no fallback — see the header.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This device has no camera the browser can open. Capture cannot proceed here.');
      setStatus(null);
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setStatus('ready — line up the shot and capture');
      })
      .catch(() => {
        setError('Camera access was refused. The check-in needs a live frame, so it cannot go on.');
        setStatus(null);
      });
    return () => {
      cancelled = true;
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function capture() {
    setError(null);
    setBusy(true);
    setStatus('reading position…');
    // requestedAt is the moment the platform asked for the fix. The unannounced timing is part of
    // the assurance: faking a reading you did not know would be asked for is materially harder.
    const requestedAt = new Date().toISOString();
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !video.videoWidth) {
        throw new Error('the camera is not ready yet');
      }
      const pos = await readPosition();

      const w = video.videoWidth;
      const h = video.videoHeight;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      // The human-readable watermark. Forgeable on purpose-acknowledged grounds — the hash is the
      // proof — but it lets a person reading the image see what was claimed at a glance.
      const { date, time } = stamp();
      const lines = [
        pos ? `lat ${pos.lat.toFixed(6)}   lng ${pos.lng.toFixed(6)}` : 'no position',
        `${date}  ${time}`,
        `nonce ${nonce ?? '----'}`,
      ];
      const pad = Math.round(h * 0.02);
      const fs = Math.max(14, Math.round(h * 0.028));
      ctx.font = `${fs}px monospace`;
      ctx.textBaseline = 'bottom';
      const boxH = lines.length * (fs + 6) + pad;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, h - boxH, w, boxH);
      ctx.fillStyle = '#fff';
      lines.forEach((ln, i) => {
        ctx.fillText(ln, pad, h - pad - (lines.length - 1 - i) * (fs + 6));
      });

      setStatus('capturing…');
      const blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9));
      if (!blob) throw new Error('could not read a frame from the camera');

      const out = await api.captureEvidence(job.id, blob, {
        nonce,
        // The client asserts the code is in the frame; the server records it and a reviewer can
        // overturn it from the stored image. Here it is true by construction — we drew it in.
        nonceInShot: true,
        live: true,
        device: pos,
        requestedAt,
        observedAt: pos?.observedAt,
      });
      setResult(out);
      setStatus(null);
      if (onCaptured) onCaptured(out);
    } catch (e) {
      setError(e.message || 'capture failed');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  if (!job) return null;
  if (job.role !== 'inspector') {
    return <p className="muted">Only the assigned inspector captures evidence for this job.</p>;
  }

  return (
    <div className="inspect-capture">
      <div className="inspect-nonce">
        Check-in code <strong>{nonce ?? '—'}</strong>
        <span className="muted"> · keep this visible in the shot</span>
      </div>

      <div className="inspect-viewport">
        {/* muted + playsInline so mobile browsers actually start the stream inline */}
        <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12 }} />
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="inspect-result">
          <p>
            Assurance recorded: <strong>{result.evidence.assurance}</strong>
            {' · '}
            {result.meetsPolicy
              ? 'meets the buyer’s minimum'
              : `below the required ${job.minAssurance}`}
          </p>
          <ul className="muted">
            {result.evidence.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <p className="muted">sha256 {result.evidence.sha256.slice(0, 16)}…</p>
        </div>
      )}

      {!result && (
        <button type="button" onClick={capture} disabled={busy || !!error}>
          {busy ? 'capturing…' : 'Capture live frame'}
        </button>
      )}

      <p className="muted inspect-note">
        A live frame only. This screen has no file upload by design — the check-in has to prove the
        camera saw this, now. The stamp on the image is for people to read; the proof is the hash
        the platform takes of the exact bytes stored, and the grade is whether your device’s
        position agrees with an independent one, not the position itself.
      </p>
      <p className="muted">
        Until a network-position resolver is configured, every capture grades <strong>self</strong>.
        The other rungs exist in code and are not reachable.
      </p>
      <p className="muted">Levels, weakest to strongest: {LEVELS.join(' · ')}.</p>
    </div>
  );
}
