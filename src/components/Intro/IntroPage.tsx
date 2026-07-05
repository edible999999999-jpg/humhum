import { useEffect, useRef, useState } from "react";

const FAMILY = [
  { name: "Humi", role: "calm" },
  { name: "Hype", role: "spark" },
  { name: "Hush", role: "listen" },
  { name: "Hexa", role: "debug" },
];

const SIGNALS = ["Hooks", "Voice", "Local", "Always-on-top"];
const GITHUB_URL = "https://github.com/edible999999999-jpg/humhum";

export function IntroPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [booting, setBooting] = useState(true);
  const [navHidden, setNavHidden] = useState(false);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });

  useEffect(() => {
    document.documentElement.dataset.page = "intro";
    const bootTimer = window.setTimeout(() => setBooting(false), 850);

    function handleScroll() {
      const nextY = window.scrollY;
      setNavHidden(nextY > 120);
    }

    function handlePointerMove(event: PointerEvent) {
      setCursor({ x: event.clientX, y: event.clientY });
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    return () => {
      delete document.documentElement.dataset.page;
      window.clearTimeout(bootTimer);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function playHeroVideo() {
      if (!video) return;
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.play().catch(() => {
        video.dataset.fallback = "poster";
      });
    }

    playHeroVideo();
    video.addEventListener("loadeddata", playHeroVideo);
    video.addEventListener("canplay", playHeroVideo);
    window.addEventListener("focus", playHeroVideo);
    document.addEventListener("visibilitychange", playHeroVideo);

    return () => {
      video.removeEventListener("loadeddata", playHeroVideo);
      video.removeEventListener("canplay", playHeroVideo);
      window.removeEventListener("focus", playHeroVideo);
      document.removeEventListener("visibilitychange", playHeroVideo);
    };
  }, []);

  return (
    <main className="intro-page">
      {booting && (
        <div className="intro-preloader" aria-label="Loading HumHum">
          <span>HumHum</span>
          <small>INITIALIZING SOFT SIGNAL</small>
        </div>
      )}

      <div
        className="intro-cursor"
        style={{ transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` }}
        aria-hidden="true"
      />
      <div className="intro-noise" aria-hidden="true" />

      <header className={`intro-nav ${navHidden ? "hidden" : ""}`}>
        <a className="intro-brand" href="#top" aria-label="HumHum">
          <span className="intro-brand-mark" aria-hidden="true" />
          <span>HumHum</span>
        </a>
        <nav aria-label="Intro sections">
          <a href="#pet">Pet</a>
          <a href="#family">Family</a>
          <a href="#signal">Signal</a>
          <a className="intro-github-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </header>

      <section className="intro-hero intro-cinematic" id="top">
        <video
          ref={videoRef}
          className="intro-hero-video"
          src="/mascots/humhum-jellyfish-world.mp4"
          poster="/mascots/humhum-jellyfish-poster.png"
          autoPlay
          muted
          loop
          playsInline
          aria-hidden="true"
        />
        <div className="intro-hero-shade" />

        <div className="intro-hero-copy">
          <p className="intro-kicker">AI DESKTOP PET</p>
          <h1 aria-label="HumHum">
            {"HumHum".split("").map((char, index) => (
              <span key={`${char}-${index}`} style={{ transitionDelay: `${index * 42}ms` }}>
                {char}
              </span>
            ))}
          </h1>
          <p>Listen. Speak. Float.</p>
          <div className="intro-actions" aria-label="Primary actions">
            <a href="#pet">Meet Humi</a>
            <a href="#family">The family</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              Star on GitHub
            </a>
          </div>
        </div>
      </section>

      <section className="intro-section intro-pet-lab" id="pet">
        <div className="intro-section-heading">
          <p>SOFT SIGNAL FAMILY</p>
          <h2>Soft signal family.</h2>
        </div>
        <div className="intro-cinematic-family">
          <img
            src="/mascots/humhum-family-cinematic-v1.png"
            alt="HumHum soft 3D jellyfish mascot family"
          />
          <div className="intro-family-caption" aria-label="Mascot names">
            {FAMILY.map((member) => (
              <span key={member.name}>
                <strong>{member.name}</strong>
                <small>{member.role}</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="intro-section intro-family-section" id="family">
        <div className="intro-section-heading">
          <p>FOUR SIGNALS</p>
          <h2>A soft 3D mascot system.</h2>
        </div>
        <div className="intro-family-layout">
          <img
            className="intro-reference"
            src="/mascots/humi-family-reference.png"
            alt="Humi, Hype, Hush and Hexa character sheet"
          />
          <div className="intro-family-list">
            {FAMILY.map((member) => (
              <article key={member.name} className="intro-family-item">
                <h3>{member.name}</h3>
                <p>{member.role}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="intro-section intro-signal-section" id="signal">
        <div className="intro-section-heading">
          <p>LOCAL VOICE LAYER</p>
          <h2>Code events become a tiny voice in the room.</h2>
        </div>
        <div className="intro-signal-row">
          {SIGNALS.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      </section>
    </main>
  );
}
