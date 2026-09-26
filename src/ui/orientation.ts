/**
 * Point mode: use the phone's compass and tilt to tell which way it's pointing.
 * Hold the phone up like a camera and the scope and sky view follow.
 *
 * Android (Chrome) delivers absolute orientation via `deviceorientationabsolute`; the
 * direction the back camera faces is derived from the rotation matrix. iOS needs a
 * permission tap and reports a tilt-compensated `webkitCompassHeading`.
 */
import { DEG, normDeg } from '../geo/geo.ts';

export interface Pointing {
  /** Compass direction the phone points, degrees true. */
  az: number;
  /** Tilt above the horizon, degrees (only meaningful when held up). */
  el: number;
  /** True when the phone is held up like a camera rather than lying flat. */
  upright: boolean;
  /** iOS only: estimated compass error, degrees. */
  accuracy?: number;
}

type OrientationEventIOS = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

/** Back-camera direction and top-edge heading from W3C alpha/beta/gamma (Z-X'-Y'' angles). */
export function deviceDirection(alpha: number, beta: number, gamma: number): { az: number; el: number; topAz: number } {
  const a = alpha * DEG;
  const b = beta * DEG;
  const g = gamma * DEG;
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  // The back camera looks along the device's −Z axis; rotate that into east/north/up.
  const e = -ca * sg - sa * sb * cg;
  const n = -sa * sg + ca * sb * cg;
  const u = -cb * cg;
  return {
    az: normDeg(Math.atan2(e, n) / DEG),
    el: Math.asin(Math.max(-1, Math.min(1, u))) / DEG,
    topAz: normDeg(Math.atan2(-sa * cb, ca * cb) / DEG),
  };
}

export class Compass {
  private listener: ((e: Event) => void) | undefined;
  private smoothed: { sin: number; cos: number } | undefined;
  active = false;

  constructor(private readonly onChange: (p: Pointing) => void) {}

  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /** Must be called from a tap (iOS permission prompt). Resolves false if unavailable or denied. */
  async start(): Promise<boolean> {
    if (!Compass.supported()) return false;
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof DOE.requestPermission === 'function') {
      try {
        if ((await DOE.requestPermission()) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    const absolute = 'ondeviceorientationabsolute' in window;
    const type = absolute ? 'deviceorientationabsolute' : 'deviceorientation';
    let got = false;
    this.listener = (ev: Event) => {
      const e = ev as OrientationEventIOS;
      if (e.alpha === null || e.beta === null || e.gamma === null) return;
      const d = deviceDirection(e.alpha, e.beta, e.gamma);
      const upright = Math.abs(d.el) < 65;
      let az: number | undefined;
      if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) az = e.webkitCompassHeading;
      else if (absolute || e.absolute) az = upright ? d.az : d.topAz;
      if (az === undefined) return;
      got = true;
      // Smooth jitter with a circular moving average.
      const s = Math.sin(az * DEG);
      const c = Math.cos(az * DEG);
      this.smoothed = this.smoothed
        ? { sin: this.smoothed.sin * 0.8 + s * 0.2, cos: this.smoothed.cos * 0.8 + c * 0.2 }
        : { sin: s, cos: c };
      this.onChange({
        az: normDeg(Math.atan2(this.smoothed.sin, this.smoothed.cos) / DEG),
        el: d.el,
        upright,
        accuracy: e.webkitCompassAccuracy,
      });
    };
    window.addEventListener(type, this.listener);
    this.active = true;
    // No absolute heading after a moment: this device can't do point mode.
    await new Promise((r) => setTimeout(r, 1500));
    if (!got) {
      this.stop();
      return false;
    }
    return true;
  }

  stop(): void {
    if (this.listener) {
      window.removeEventListener('deviceorientationabsolute', this.listener);
      window.removeEventListener('deviceorientation', this.listener);
    }
    this.listener = undefined;
    this.smoothed = undefined;
    this.active = false;
  }
}
