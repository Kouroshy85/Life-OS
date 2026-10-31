/**
 * Liquid Glass material.
 *
 * Chromium engines (WebView2 on Windows, Chrome) accept SVG filters inside
 * `backdrop-filter`, which lets us refract the content behind a panel: a
 * displacement map generated for the element's exact size bends the backdrop
 * near the rounded edges, like light through a thick glass bezel. Other
 * engines get the same panel with a plain frosted blur.
 */

import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from "react";

const supportsRefraction = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Chrome\/|Edg\//.test(ua) && !/Firefox\//.test(ua);
})();

const reducedTransparency =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches;

/** Signed distance from a point to a rounded rectangle centered at the origin. */
function sdRoundRect(px: number, py: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}

const mapCache = new Map<string, string>();

function displacementMap(w: number, h: number, radius: number, bezel: number): string {
  const key = `${w}x${h}r${radius}b${bezel}`;
  const cached = mapCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const d = sdRoundRect(px, py, hw, hh, r);
      let dx = 0;
      let dy = 0;
      if (d > -bezel && d <= 0) {
        // Outward normal from the SDF gradient.
        const gx = sdRoundRect(px + 1, py, hw, hh, r) - sdRoundRect(px - 1, py, hw, hh, r);
        const gy = sdRoundRect(px, py + 1, hw, hh, r) - sdRoundRect(px, py - 1, hw, hh, r);
        const len = Math.hypot(gx, gy) || 1;
        const t = 1 + d / bezel; // 0 at the inner edge of the bezel, 1 at the rim
        const mag = t * t * (3 - 2 * t); // smoothstep: a convex, lens-like falloff
        // Sample inward: content near the rim is pulled toward the centre.
        dx = (-gx / len) * mag;
        dy = (-gy / len) * mag;
      }
      data[i] = Math.round(128 + dx * 127);
      data[i + 1] = Math.round(128 + dy * 127);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  if (mapCache.size > 40) mapCache.clear();
  mapCache.set(key, url);
  return url;
}

export interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
  radius?: number;
  /** Width of the refracting rim in px. */
  bezel?: number;
  /** Strength of the refraction. */
  strength?: number;
  blur?: number;
  /** Stronger tint for panels that hold dense content (dialogs, menus). */
  dense?: boolean;
  as?: "div" | "nav" | "aside" | "header" | "section";
}

export const LiquidGlass = forwardRef<HTMLDivElement, LiquidGlassProps>(function LiquidGlass(
  { radius = 24, bezel = 16, strength = 36, blur = 14, dense = false, className = "", style, children, as = "div", ...rest },
  forwarded,
) {
  const local = useRef<HTMLDivElement | null>(null);
  const id = `lg-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [map, setMap] = useState("");

  useLayoutEffect(() => {
    const el = local.current;
    if (!el || !supportsRefraction || reducedTransparency) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (w > 0 && h > 0) setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!size) return;
    // Large panels change size rarely; debounce map generation while resizing.
    const t = setTimeout(() => setMap(displacementMap(size.w, size.h, radius, bezel)), 60);
    return () => clearTimeout(t);
  }, [size, radius, bezel]);

  const refract = supportsRefraction && !reducedTransparency && map && size;
  const glassStyle: CSSProperties = {
    borderRadius: radius,
    ...(refract
      ? {
          backdropFilter: `blur(${Math.max(2, blur * 0.35)}px) url(#${id}) blur(${blur * 0.65}px) saturate(165%) brightness(1.06)`,
        }
      : {}),
    ...style,
  };

  const Tag = as;
  return (
    <Tag
      ref={(node: HTMLDivElement | null) => {
        local.current = node;
        if (typeof forwarded === "function") forwarded(node);
        else if (forwarded) forwarded.current = node;
      }}
      className={`glass ${dense ? "glass--dense" : ""} ${className}`}
      style={glassStyle}
      {...rest}
    >
      {refract && (
        <svg className="glass__defs" aria-hidden="true" width="0" height="0">
          <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </Tag>
  );
});
