import { useEffect, useMemo, useRef, useState } from "react";
import { setAppLanguage } from "@App/libs/i18n/i18n";
import settingsStore from "@App/libs/mobx/mobx";
import { useTranslation } from "react-i18next";
import { landingTranslations } from "./landingTranslations";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

type ThemeKey = "light" | "dark" | "blue" | "green" | "sunset" | "coolGray";

type ModeKey = "direct" | "internet" | "clipboard";

const themeOptions: Array<{ key: ThemeKey; color: string }> = [
  { key: "light", color: "#f5f5f5" },
  { key: "dark", color: "#212121" },
  { key: "blue", color: "#1976d2" },
  { key: "green", color: "#388e3c" },
  { key: "sunset", color: "#f57c00" },
  { key: "coolGray", color: "#90a4ae" },
];

function readStoredTheme(): ThemeKey {
  try {
    const value = settingsStore.get("userTheme");
    return themeOptions.find((theme) => theme.key === value)?.key ?? "light";
  } catch {
    return "light";
  }
}

export default function LandingPage() {
  const { i18n } = useTranslation();
  const copy = landingTranslations[i18n.resolvedLanguage?.startsWith("zh") ? "zh" : i18n.resolvedLanguage?.startsWith("id") ? "id" : i18n.resolvedLanguage?.startsWith("ms") ? "ms" : "en"];
  const rootRef = useRef<HTMLElement | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState<ThemeKey>(() => readStoredTheme());
  const [mode, setMode] = useState<ModeKey>("direct");
  const [openFaq, setOpenFaq] = useState(0);
  const [language, setLanguage] = useState<LanguageType>(() => settingsStore.get("userLanguage") ?? "system");

  const activeMode = useMemo(() => copy.modes[mode], [copy, mode]);

  useEffect(() => {
    document.documentElement.style.colorScheme = theme === "dark" || theme === "coolGray" ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" || theme === "coolGray" ? "#101715" : "#f7fbf8");
  }, [theme]);

  useEffect(() => {
    ScrollTrigger.refresh();
  }, [openFaq, copy]);

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
    settingsStore.update("userTheme", nextTheme);
  };

  return (
    <main className="letshare-landing" data-theme={theme} ref={rootRef}>
      <header className="landing-nav" aria-label={copy.nav} style={{ gap: 8 }}>
        <a className="brand-lockup" href="./" aria-label={copy.openAppLabel} style={{ fontSize: 16, flexShrink: 0 }}>
          <img src="/icons/startup-logo-192.png" alt="" width="32" height="32" />
          <span>LetShare</span>
        </a>
        <nav className="nav-links" aria-label={copy.sections}>
          <a href="#why">{copy.why}</a>
          <a href="#flow">{copy.flow}</a>
          <a href="#security">{copy.security}</a>
        </nav>
        <div className="nav-actions" style={{ gap: 8, minWidth: 0 }}>
          <div className="theme-switcher" aria-label={copy.themeSelector}>
            {themeOptions.map((option) => (
              <button
                className="theme-swatch"
                key={option.key}
                type="button"
                aria-label={copy.useTheme(copy.themes[option.key])}
                aria-pressed={theme === option.key}
                title={copy.themes[option.key]}
                style={{ backgroundColor: option.color }}
                onClick={() => selectTheme(option.key)}
              />
            ))}
          </div>
          <select aria-label={copy.language} title={copy.language} value={language} onChange={(event) => {
            const next = event.target.value as LanguageType;
            setLanguage(next);
            void setAppLanguage(next);
          }} style={{ width: 64, flex: "0 0 64px", maxWidth: "100%", minHeight: 40, padding: "0 4px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", font: "inherit", fontSize: 12 }}>
            <option value="system">{i18n.resolvedLanguage?.startsWith("zh") ? "系统" : i18n.resolvedLanguage?.startsWith("id") ? "Otomatis" : "Auto"}</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
            <option value="ms">Melayu</option>
            <option value="id">Indonesia</option>
          </select>
          <a className="button button-primary" href="./" style={{ whiteSpace: "nowrap" }}>{copy.openApp}</a>
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
          <p className="hero-kicker">{copy.kicker}</p>
          <h1 className="hero-title" id="hero-title">LetShare</h1>
          <p className="hero-copy">{copy.hero}</p>
          <div className="hero-actions" aria-label={copy.actions}>
            <a className="button button-primary button-large" href="./">{copy.openSharing}</a>
            <a className="button button-secondary button-large" href="https://github.com/LiWeny16/LetShare" rel="noreferrer">{copy.github}</a>
          </div>
          <dl className="hero-metrics" aria-label={copy.highlights}>
            {copy.metrics.map((item, index) => <div key={index}><dt>{item.title}</dt><dd>{item.copy}</dd></div>)}
          </dl>
        </div>

        <div className="hero-visual" ref={visualRef} aria-label={copy.preview}>
          <img className="product-shot product-shot-desktop" src="/screenshots/desktop.png" alt={copy.desktopAlt} width="1200" height="746" decoding="async" />
          <img className="product-shot product-shot-mobile" src="/screenshots/mobile.jpg" alt={copy.mobileAlt} width="393" height="852" decoding="async" />
          <div className="transfer-card product-shot" aria-hidden="true">
            <div className="transfer-topline">
              <span className="live-dot" />
              <span>{copy.transferReady}</span>
            </div>
            <strong>clipboard-note.txt</strong>
            <div className="transfer-progress"><span /></div>
            <div className="transfer-meta">
              <span>{copy.transferMeta}</span>
              <b>{copy.p2pFirst}</b>
            </div>
          </div>
          <div className="floating-status product-shot" aria-hidden="true">
            <span>{copy.roomReady}</span>
            <strong>{copy.devicesOnline}</strong>
          </div>
        </div>
      </section>

      <section className="trust-strip landing-reveal" aria-label={copy.factsLabel}>
        {copy.facts.map((fact, index) => <span key={index}>{fact}</span>)}
      </section>

      <section className="section-shell" id="why" aria-labelledby="why-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">{copy.whyKicker}</p>
          <h2 id="why-title">{copy.whyTitle}</h2>
          <p>{copy.whyCopy}</p>
        </div>
        <div className="benefit-grid">
          {copy.benefits.map((benefit, index) => (
            <article className="benefit-card landing-reveal" key={index}>
              <p>{benefit.eyebrow}</p>
              <h3>{benefit.title}</h3>
              <span>{benefit.copy}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="section-shell flow-section" id="flow" aria-labelledby="flow-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">{copy.flowKicker}</p>
          <h2 id="flow-title">{copy.flowTitle}</h2>
        </div>
        <ol className="step-list">
          {copy.steps.map((step, index) => (
            <li className="landing-reveal" key={index}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="section-shell interactive-section" id="security" aria-labelledby="mode-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">{copy.connectionKicker}</p>
          <h2 id="mode-title">{copy.connectionTitle}</h2>
          <p>{copy.connectionCopy}</p>
        </div>
        <div className="mode-panel landing-reveal">
          <div className="mode-tabs" role="tablist" aria-label={copy.modesLabel}>
            {(Object.keys(copy.modes) as ModeKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                className={mode === key ? "is-active" : ""}
                onClick={() => setMode(key)}
              >
                {copy.modes[key].label}
              </button>
            ))}
          </div>
          <div className="mode-copy">
            <span>{activeMode.metric}</span>
            <h3>{activeMode.title}</h3>
            <p>{activeMode.copy}</p>
          </div>
          <div className="mode-diagram" aria-hidden="true">
            <span className="device-node">{copy.laptop}</span>
            <span className="mode-path" />
            <span className="device-node">{copy.phone}</span>
          </div>
        </div>
      </section>

      <section className="showcase-section" aria-labelledby="showcase-title">
        <div className="showcase-copy landing-reveal">
          <p className="section-kicker">{copy.showcaseKicker}</p>
          <h2 id="showcase-title">{copy.showcaseTitle}</h2>
          <p>{copy.showcaseCopy}</p>
        </div>
        <div className="showcase-media landing-reveal">
          <img src="/screenshots/desktop.png" alt={copy.showcaseAlt} width="1200" height="746" loading="lazy" decoding="async" />
        </div>
      </section>

      <section className="section-shell faq-section" aria-labelledby="faq-title">
        <div className="section-heading landing-reveal">
          <p className="section-kicker">FAQ</p>
          <h2 id="faq-title">{copy.faqTitle}</h2>
        </div>
        <div className="faq-list">
          {copy.faqs.map((faq, index) => (
            <article className="faq-item landing-reveal" key={index}>
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
        <a href="./">{copy.openApp}</a>
        <a href="https://github.com/LiWeny16/LetShare" rel="noreferrer">GitHub</a>
      </footer>
    </main>
  );
}
