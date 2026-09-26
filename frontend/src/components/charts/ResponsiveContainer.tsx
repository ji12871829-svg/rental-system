/**
 * Shared measured-width wrapper (recharts' ResponsiveContainer equivalent),
 * moved verbatim from the former single-file charts.tsx.
 *
 * Lazy by default: the chart inside is not rendered until the container
 * scrolls within 200px of the viewport. Charts are the heaviest thing RPMS
 * renders (the dashboard alone mounts nine SVGs), and everything below the
 * fold was being paid for on every page load. The height prop reserves the
 * box, so there is no layout shift — a quiet skeleton pulse fills the space
 * until the real chart takes over. Pass `lazy={false}` to force immediate
 * rendering (e.g. print/export contexts).
 */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';

export function ResponsiveContainer(props: {
  width?: string | number;
  height?: number | string;
  children: ReactElement;
  className?: string;
  style?: React.CSSProperties;
  lazy?: boolean;
}) {
  const { height = '100%', children, className, style, lazy = true } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  // Render immediately when lazy loading is off, unsupported, or the container
  // starts on-screen — otherwise wait for the intersection below.
  const [visible, setVisible] = useState(
    !lazy || typeof IntersectionObserver === 'undefined',
  );

  // Flip to visible once the (reserved-space) box approaches the viewport.
  // One-shot: after the first intersection the observer disconnects and the
  // chart renders for good — scrolling away never unmounts it.
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // 200px head start so the chart is ready before the user reaches it.
      { rootMargin: '200px 0px' },
    );
    io.observe(el);

    // Safety valve: IntersectionObserver callbacks are delivered with frames.
    // In renderers that never produce frames (occluded/throttled webviews,
    // odd embedders) rAF stalls and IO never fires, which would leave the
    // skeleton up forever. If the first frame hasn't arrived shortly after
    // mount, render immediately; on healthy browsers rAF lands within one
    // frame and this fallback cancels itself — true scroll laziness holds.
    let sawFrame = false;
    requestAnimationFrame(() => {
      sawFrame = true;
    });
    const failSafe = setTimeout(() => {
      if (!sawFrame) setVisible(true);
    }, 1500);
    return () => {
      io.disconnect();
      clearTimeout(failSafe);
    };
  }, [visible]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      if (cw > 0) setW(cw);
    });
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ width: '100%', height, ...style }}>
      {w > 0 && visible && isValidElement(children)
        ? cloneElement(children as ReactElement<any>, { containerWidth: w })
        : !visible
          ? <div className="h-full w-full animate-pulse rounded-lg bg-gray-200" aria-hidden />
          : null}
    </div>
  );
}
