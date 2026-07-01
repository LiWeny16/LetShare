import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type ThemeKey = "light" | "dark" | "blue" | "green" | "sunset" | "coolGray";

type ModeKey = "direct" | "internet" | "clipboard";

const themeOptions: Array<{ key: ThemeKey; label: string; color: string }> = [
  { key: "light", label: "Light", color: "#f5f5f5" },
  { key: "dark", label: "Dark", color: "#212121" },
  { key: "blue", label: "Blue", color: "#1976d2" },
  { key: "green", label: "Green", color: "#388e3c" },
  { key: "sunset", label: "Sunset", color: "#f57c00" },
  { key: "coolGray", label: "Cool gray", color: "#90a4ae" },
];

const benefits = [
  {
    eyebrow: "No account",
    title: "Open a room and move the file.",
    copy: "LetShare starts in the browser. It keeps the first action close: pick a file, text, image, or clipboard content and send it.",
  },
  {
    eyebrow: "Every screen",
    title: "Desktop to phone without a detour.",
    copy: "The interface is built for mixed devices, so your laptop, phone, and tablet can meet in the same lightweight room.",
  },
  {
    eyebrow: "P2P first",
    title: "Direct when possible, resilient when not.",
    copy: "LetShare attempts direct peer-to-peer transfer and keeps text communication available through the public network path.",
  },
];

const steps = [
  "Open LetShare on two devices.",
  "Join the same room or scan the QR code.",
  "Send files, images, text, or clipboard content.",
];

const modes: Record<ModeKey, { label: string; title: string; copy: string; metric: string }> = {
  direct: {
    label: "P2P",
    title: "Fast direct transfer",
    copy: "When the network allows it, LetShare opens a peer-to-peer channel so larger file transfers avoid unnecessary hops.",
    metric: "Direct path",
  },
  internet: {
    label: "Internet",
    title: "Fallback that stays understandable",
    copy: "When a direct path cannot be established, the UI labels the public network path clearly instead of hiding it behind vague status text.",
    metric: "Public path",
  },
  clipboard: {
    label: "Clipboard",
    title: "Small content stays instant",
    copy: "Text, snippets, and clipboard content stay close to the main action, so quick handoffs do not feel like file management.",
    metric: "Quick handoff",
  },
};

const faqs = [
  {
    question: "Does LetShare need an account?",
    answer: "No. The app is designed for quick sharing from the browser without a sign-in step.",
  },
  {
    question: "Does it only work on the same Wi-Fi?",
    answer: "LetShare tries peer-to-peer first and can still use the public network path for supported text communication when direct connection is unavailable.",
  },
  {
    question: "Why is this separate from the app root?",
    answer: "The landing page has its own HTML entry and animation bundle, so the sharing tool at the root URL does not load the marketing page code.",
  },
];

const defaultStoredSettings = {
  roomId: "",
  userTheme: "light",
  userLanguage: "en",
  serverMode: "auto",
  customServerUrl: "wss://ecs.letshare.fun/",
  authToken: "98d9a399675116e5256e9082c192bc06eb6434937af99f201252e9424c7a5652",
  ablyKey: "4TtssQ.e9OvDA:wYBGdtWQNgicbeIKNtgeV_s5XEKmfLKD_Gue5XQrWuw",
  version: "3.4.3",
  isNewUser: true,
};

function readStoredTheme(): ThemeKey {
  try {
    const raw = localStorage.getItem("user_settings");
    const parsed = raw ? JSON.parse(raw) : null;
    const value = parsed?.userTheme;
    return themeOptions.some((theme) => theme.key === value) ? value : "light";
  } catch {
    return "light";
  }
}

function storeTheme(theme: ThemeKey) {
  try {
    const raw = localStorage.getItem("user_settings");
    const parsed = raw ? JSON.parse(raw) : {};
    localStorage.setItem("user_settings", JSON.stringify({ ...defaultStoredSettings, ...parsed, userTheme: theme }));
  } catch {
    localStorage.setItem("user_settings", JSON.stringify({ ...defaultStoredSettings, userTheme: theme }));
  }
}

export default function LandingPage() {
  const rootRef = useRef<HTMLElement | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState<ThemeKey>(() => readStoredTheme());
  const [mode, setMode] = useState<ModeKey>("direct");
  const [openFaq, setOpenFaq] = useState(0);

  const activeMode = useMemo(() => modes[mode], [mode]);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme === "dark" || theme === "coolGray" ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" || theme === "coolGray" ? "#101715" : "#f7fbf8");
  }, [theme]);

  useEffect(() => {
    ScrollTrigger.refresh();
  }, [openFaq]);

  useGSAP(() => {
    const root = rootRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !root) {
      gsap.set(".landing-reveal", { autoAlpha: 1, y: 0 });
      return;
    }

    const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
    timeline
      .from(".landing-nav", { y: -16, opacity: 0, duration: 0.55 })
      .from(".hero-kicker, .hero-title, .hero-copy, .hero-actions, .hero-metrics", {
        y: 18,
        opacity: 0,
        duration: 0.7,
        stagger: 0.08,
      }, "-=0.18")
      .from(".product-shot", {
        y: 32,
        opacity: 0,
        rotateX: 10,
        duration: 0.9,
        stagger: 0.08,
      }, "-=0.42")
      .from(".signal-line", {
        scaleX: 0.2,
        opacity: 0,
        duration: 0.75,
        stagger: 0.08,
      }, "-=0.6");

    gsap.to(".scroll-progress-bar", {
      scaleX: 1,
      ease: "none",
      scrollTrigger: {
        trigger: root,
        start: "top top",
        end: "bottom bottom",
        scrub: 0.2,
      },
    });

    root.querySelectorAll<HTMLElement>(".landing-reveal").forEach((element) => {
      gsap.fromTo(element,
        { autoAlpha: 0, y: 36 },
        {
          autoAlpha: 1,
          y: 0,
          ease: "power2.out",
          scrollTrigger: {
            trigger: element,
            start: "top 88%",
            end: "top 68%",
            scrub: 0.45,
          },
        },
      );
    });

    const showcaseSection = root.querySelector<HTMLElement>(".showcase-section");
    const showcaseImage = root.querySelector<HTMLElement>(".showcase-media img");
    if (showcaseSection && showcaseImage) {
      gsap.to(showcaseImage, {
        yPercent: -5,
        scale: 1.015,
        ease: "none",
        scrollTrigger: {
          trigger: showcaseSection,
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      });
    }

    gsap.to(".signal-dot", {
      x: 18,
      y: -10,
      repeat: -1,
      yoyo: true,
      duration: 2.8,
      ease: "sine.inOut",
      stagger: 0.35,
    });

    const visual = visualRef.current;
    if (!visual) return;

    const xTo = gsap.quickTo(visual, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(visual, "y", { duration: 0.45, ease: "power3.out" });
    const rotateTo = gsap.quickTo(visual, "rotateY", { duration: 0.45, ease: "power3.out" });

    const onPointerMove = (event: PointerEvent) => {
      const xRatio = event.clientX / window.innerWidth - 0.5;
      const yRatio = event.clientY / window.innerHeight - 0.5;
      xTo(xRatio * 18);
      yTo(yRatio * 12);
      rotateTo(xRatio * -5);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, { scope: rootRef });

  const selectTheme = (nextTheme: ThemeKey) => {
    setTheme(nextTheme);
    storeTheme(nextTheme);
  };

  return (
    <main className="letshare-landing" data-theme={theme} ref={rootRef}>
      <header className="landing-nav" aria-label="LetShare site navigation">
        <a className="brand-lockup" href="./" aria-label="Open LetShare app">
          <img src="/icons/startup-logo-192.png" alt="" width="32" height="32" />
          <span>LetShare</span>
        </a>
        <nav className="nav-links" aria-label="Page sections">
          <a href="#why">Why</a>
          <a href="#flow">Flow</a>
          <a href="#security">Security</a>
        </nav>
        <div className="nav-actions">
          <div className="theme-switcher" aria-label="Theme selector">
            {themeOptions.map((option) => (
              <button
                className="theme-swatch"
                key={option.key}
                type="button"
                aria-label={`Use ${option.label} theme`}
                aria-pressed={theme === option.key}
                title={option.label}
                style={{ backgroundColor: option.color }}
                onClick={() => selectTheme(option.key)}
              />
            ))}
          </div>
          <a className="button button-primary" href="./">Open App</a>
        </div>
        <span className="scroll-progress" aria-hidden="true">
          <span className="scroll-progress-bar" />
        </span>
      </header>

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-backdrop" aria-hidden="true">
          <div className="signal-line signal-line-a"><span className="signal-dot" /></div>
          <div className="signal-line signal-line-b"><span className="signal-dot" /></div>
          <div className="signal-line signal-line-c"><span className="signal-dot" /></div>
        </div>

        <div className="hero-copy-block">
          <p className="hero-kicker">Browser-native sharing</p>
          <h1 className="hero-title" id="hero-title">LetShare</h1>
          <p className="hero-copy">
            Fast file, image, text, and clipboard sharing across nearby devices. No login, no install, and no confusing connection labels.
          </p>
          <div className="hero-actions" aria-label="Primary actions">
            <a className="button button-primary button-large" href="./">Open sharing app</a>
            <a className="button button-secondary button-large" href="https://github.com/LiWeny16/LetShare" rel="noreferrer">View GitHub</a>
          </div>
          <dl className="hero-metrics" aria-label="LetShare highlights">
            <div>
              <dt>No account</dt>
              <dd>Start in the tab</dd>
            </div>
            <div>
              <dt>P2P first</dt>
              <dd>Direct when available</dd>
            </div>
            <div>
              <dt>Fallback clear</dt>
              <dd>Internet path shown</dd>
            </div>
          </dl>
        </div>

        <div className="hero-visual" ref={visualRef} aria-label="LetShare product preview">
          <img className="product-shot product-shot-desktop" src="/screenshots/desktop.png" alt="LetShare desktop sharing interface" width="1200" height="746" decoding="async" />
          <img className="product-shot product-shot-mobile" src="/screenshots/mobile.jpg" alt="LetShare mobile sharing interface" width="393" height="852" decoding="async" />
          <div className="transfer-card product-shot" aria-hidden="true">
            <div className="transfer-topline">
              <span className="live-dot" />
              <span>Transfer ready</span>
            </div>
            <strong>clipboard-note.txt</strong>
            <div className="transfer-progress"><span /></div>
            <div className="transfer-meta">
              <span>Text + file path</span>
              <b>P2P first</b>
            </div>
          </div>
          <div className="floating-status product-shot" aria-hidden="true">
            <span>Room ready</span>
            <strong>3 devices online</strong>
          </div>
        </div>
      </section>

      <section className="trust-strip landing-reveal" aria-label="Product facts">
        <span>WebRTC when possible</span>
        <span>Public network text fallback</span>
        <span>Desktop and mobile browsers</span>
        <span>Open source</span>
      </section>

      <section className="section-shell" id="why" aria-labelledby="why-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">Why it feels fast</p>
          <h2 id="why-title">The page gets out of the way.</h2>
          <p>LetShare is designed around the moment you already have: something on one device needs to be on another device.</p>
        </div>
        <div className="benefit-grid">
          {benefits.map((benefit) => (
            <article className="benefit-card landing-reveal" key={benefit.title}>
              <p>{benefit.eyebrow}</p>
              <h3>{benefit.title}</h3>
              <span>{benefit.copy}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell flow-section" id="flow" aria-labelledby="flow-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">Flow</p>
          <h2 id="flow-title">One room, three steps.</h2>
        </div>
        <ol className="step-list">
          {steps.map((step, index) => (
            <li className="landing-reveal" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="section-shell interactive-section" id="security" aria-labelledby="mode-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">Connection clarity</p>
          <h2 id="mode-title">Small status labels make a big difference.</h2>
          <p>Switch the mode preview to see how the product explains the path without making users decode networking language.</p>
        </div>
        <div className="mode-panel landing-reveal">
          <div className="mode-tabs" role="tablist" aria-label="Connection mode preview">
            {(Object.keys(modes) as ModeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                className={mode === key ? "is-active" : ""}
                onClick={() => setMode(key)}
              >
                {modes[key].label}
              </button>
            ))}
          </div>
          <div className="mode-copy">
            <span>{activeMode.metric}</span>
            <h3>{activeMode.title}</h3>
            <p>{activeMode.copy}</p>
          </div>
          <div className="mode-diagram" aria-hidden="true">
            <span className="device-node">Laptop</span>
            <span className="mode-path" />
            <span className="device-node">Phone</span>
          </div>
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="showcase-title">
        <div className="showcase-copy landing-reveal">
          <p className="section-kicker">Product signal</p>
          <h2 id="showcase-title">A real interface, not a stock mockup.</h2>
          <p>The landing page uses the actual LetShare screenshots so visitors understand what opens after the first click.</p>
        </div>
        <div className="showcase-media landing-reveal">
          <img src="/screenshots/desktop.png" alt="LetShare desktop product view" width="1200" height="746" loading="lazy" decoding="async" />
        </div>
      </section>

      <section className="section-shell faq-section" aria-labelledby="faq-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">FAQ</p>
          <h2 id="faq-title">Quick answers before the first transfer.</h2>
        </div>
        <div className="faq-list">
          {faqs.map((faq, index) => (
            <article className="faq-item landing-reveal" key={faq.question}>
              <button type="button" aria-expanded={openFaq === index} onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>
                <span>{faq.question}</span>
                <span aria-hidden="true">{openFaq === index ? "-" : "+"}</span>
              </button>
              {openFaq === index && <p>{faq.answer}</p>}
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <span>LetShare</span>
        <a href="./">Open app</a>
        <a href="https://github.com/LiWeny16/LetShare" rel="noreferrer">GitHub</a>
      </footer>
    </main>
  );
}
