import React, { useRef, useState, useEffect, useCallback } from "react";

/**
 * TraceLetter — finger / mouse / stylus tracing component for dyslexia learning.
 *
 * Research backing:
 *  - Bara & Gentaz (2004–2007): visuo-haptic letter exploration improves
 *    kindergarten reading acquisition vs. visual-only training.
 *  - Bonneton-Botté et al. (Frontiers, 2019): finger on tablet beats stylus
 *    for letter formation accuracy in 3–6-year-olds.
 *
 * Design rules:
 *  - One pointer-event code path covers finger + mouse + stylus.
 *  - Hit detection uses SEGMENT distance (point-to-line-segment), so fast
 *    drags don't skip over sample points between two pointermove events.
 *  - Pointer events live on the wrapping <div> so transparent space inside
 *    the SVG still captures drags, and `setPointerCapture` is reliable.
 *  - No accuracy grading. Parent decides what counts as "done" via the
 *    `threshold` prop; partial-lift triggers an encouraging retry.
 *  - `onFingerDown` / `onFingerUp` expose hooks for a continuous phoneme
 *    audio loop (Fish Audio integration point).
 */
export type TraceLetterProps = {
  /** SVG path d-strings, one per stroke. */
  strokes: string[];
  /** SVG viewBox, e.g. "0 0 360 240". */
  viewBox: string;
  /** Hit-radius in viewBox units. Default 38 — generous for kids' coordination. */
  tolerance?: number;
  /** Fraction of sample points (0–1) the user must cover. Default 0.5. */
  threshold?: number;
  /** Sample density per stroke. Default 36. */
  samplesPerStroke?: number;
  /** Called when coverage >= threshold on pointer up. */
  onComplete: () => void;
  /** Called when pointer lifts below threshold. */
  onPartialLift?: (coverage: number) => void;
  /** Bumping this resets the trace. */
  resetKey?: number | string;
  /** Pale background guide color. */
  guideColor?: string;
  /** Color of the user's drawn line. */
  inkColor?: string;
  /** Color a sampled dot turns when hit. */
  hitColor?: string;
  /** Show animated demo finger on mount. */
  showDemo?: boolean;
  /** Pointer down — wire phoneme audio loop here. */
  onFingerDown?: () => void;
  /** Pointer up — stop phoneme audio loop here. */
  onFingerUp?: () => void;
};

type SamplePoint = { x: number; y: number; strokeIdx: number };
type Pt = { x: number; y: number };

/** Squared distance from point P to segment AB. */
function distSqToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x, py = p.y - a.y;
    return px * px + py * py;
  }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  const ex = p.x - cx, ey = p.y - cy;
  return ex * ex + ey * ey;
}

export function TraceLetter({
  strokes,
  viewBox,
  tolerance = 38,
  threshold = 0.5,
  samplesPerStroke = 36,
  onComplete,
  onPartialLift,
  resetKey,
  guideColor = "#EFE9FF",
  inkColor = "#6C47FF",
  hitColor = "#5DCAA5",
  showDemo = true,
  onFingerDown,
  onFingerUp,
}: TraceLetterProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

  const [samples, setSamples] = useState<SamplePoint[]>([]);
  const samplesRef = useRef<SamplePoint[]>([]);
  const [hits, setHits] = useState<boolean[]>([]);
  const hitsRef = useRef<boolean[]>([]);
  const [pointerPath, setPointerPath] = useState<Pt[]>([]);
  const drawingRef = useRef(false);
  const prevPtRef = useRef<Pt | null>(null);
  const [demoIdx, setDemoIdx] = useState(-1);
  const [demoDone, setDemoDone] = useState(!showDemo);

  // Sample the SVG paths after their refs are populated
  useEffect(() => {
    const all: SamplePoint[] = [];
    strokes.forEach((_, sIdx) => {
      const p = pathRefs.current[sIdx];
      if (!p) return;
      let total = 0;
      try { total = p.getTotalLength(); } catch { return; }
      if (!total) return;
      for (let i = 0; i < samplesPerStroke; i++) {
        const t = (i + 0.5) / samplesPerStroke;
        try {
          const pt = p.getPointAtLength(t * total);
          all.push({ x: pt.x, y: pt.y, strokeIdx: sIdx });
        } catch {}
      }
    });
    setSamples(all);
    samplesRef.current = all;
    const fresh = new Array(all.length).fill(false);
    setHits(fresh);
    hitsRef.current = fresh;
    setPointerPath([]);
    prevPtRef.current = null;
    drawingRef.current = false;
    setDemoDone(!showDemo);
    setDemoIdx(showDemo && all.length ? 0 : -1);
  }, [strokes.join("|"), samplesPerStroke, resetKey, showDemo]);

  // Animated ghost-finger demo
  useEffect(() => {
    if (demoIdx < 0) return;
    if (demoIdx >= samples.length) { setDemoDone(true); return; }
    const t = setTimeout(() => setDemoIdx(d => d + 1), 22);
    return () => clearTimeout(t);
  }, [demoIdx, samples.length]);

  /** Convert client coords (mouse/touch) → SVG viewBox coords. */
  const clientToSvg = useCallback((clientX: number, clientY: number): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  /** Mark sample points within tolerance of the segment prev→curr as hit. */
  const updateHitsSegment = useCallback((prev: Pt | null, curr: Pt) => {
    const sp = samplesRef.current;
    const hm = hitsRef.current;
    if (!sp.length) return;
    const tol2 = tolerance * tolerance;
    let changed = false;
    const next = hm.slice();
    const a = prev ?? curr;
    for (let i = 0; i < sp.length; i++) {
      if (next[i]) continue;
      if (distSqToSegment(sp[i], a, curr) <= tol2) {
        next[i] = true;
        changed = true;
      }
    }
    if (changed) {
      hitsRef.current = next;
      setHits(next);
    }
  }, [tolerance]);

  const endDraw = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    prevPtRef.current = null;
    onFingerUp?.();
    const covered = hitsRef.current.filter(Boolean).length;
    const cov = samplesRef.current.length ? covered / samplesRef.current.length : 0;
    if (cov >= threshold) onComplete();
    else onPartialLift?.(cov);
  }, [onComplete, onPartialLift, onFingerUp, threshold]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!demoDone) return;
    // Capture on the host div so we keep getting events even if the cursor
    // drifts outside the visible area or over child SVG elements.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    drawingRef.current = true;
    prevPtRef.current = p;
    setPointerPath([p]);
    updateHitsSegment(null, p);
    onFingerDown?.();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const p = clientToSvg(e.clientX, e.clientY);
    const prev = prevPtRef.current;
    setPointerPath(prevPath => [...prevPath, p]);
    updateHitsSegment(prev, p);
    prevPtRef.current = p;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    endDraw();
  };

  const coverage = samples.length ? hits.filter(Boolean).length / samples.length : 0;

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        cursor: demoDone ? "crosshair" : "wait",
        width: "100%",
      }}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={{ width: "100%", height: "auto", display: "block", pointerEvents: "none" }}
      >
        {/* Guide strokes — thick faded letter outlines */}
        {strokes.map((d, i) => (
          <path
            key={"g" + i}
            ref={el => (pathRefs.current[i] = el)}
            d={d}
            stroke={guideColor}
            strokeWidth={48}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ))}
        {/* Sample dots — gray pending, teal when hit */}
        {samples.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hits[i] ? 5 : 3}
            fill={hits[i] ? hitColor : "#C9C2DD"}
            opacity={hits[i] ? 1 : 0.55}
          />
        ))}
        {/* User's traced polyline (rendered over the dots so the trail shows) */}
        {pointerPath.length > 1 && (
          <polyline
            points={pointerPath.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            stroke={inkColor}
            strokeWidth={12}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={0.78}
          />
        )}
        {/* Ghost-finger demo */}
        {!demoDone && demoIdx >= 0 && demoIdx < samples.length && (
          <g>
            <circle cx={samples[demoIdx].x} cy={samples[demoIdx].y} r={18} fill={inkColor} opacity={0.22} />
            <circle cx={samples[demoIdx].x} cy={samples[demoIdx].y} r={9} fill={inkColor} />
          </g>
        )}
        {/* Coverage chip in the corner */}
        <g transform="translate(10, 10)">
          <rect width={54} height={22} rx={11} fill="white" opacity={0.85} />
          <text x={10} y={16} fontSize={12} fill="#6B7280" fontFamily="Lexend, sans-serif" fontWeight={700}>
            {Math.round(coverage * 100)}%
          </text>
        </g>
      </svg>
    </div>
  );
}
