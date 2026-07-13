import { ArrowUpRight, Github, Menu, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { RoleModelCarousel } from "./RoleModelCarousel";

const GITHUB_URL = "https://github.com/edible999999999-jpg/humhum";

const NAV_ITEMS = [
  { href: "#home", label: "Home" },
  { href: "#signal", label: "Signal" },
  { href: "#roles", label: "Roles" },
  { href: "#join", label: "Join" },
];

export function IntroPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.page = "intro";
    return () => {
      delete document.documentElement.dataset.page;
    };
  }, []);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <main className="orbital-page">
      <div className="orbital-texture" aria-hidden="true" />

      <header className="orbital-nav">
        <a className="orbital-brand" href="#home" onClick={closeMenu}>
          HumHum<span>.</span>
        </a>

        <nav className="orbital-nav-links" aria-label="Page sections">
          {NAV_ITEMS.map((item) => (
            <a href={item.href} key={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <a className="orbital-nav-action" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <span>Get HumHum</span>
          <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" />
        </a>

        <button
          className="orbital-menu-button"
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open navigation"
          aria-expanded={menuOpen}
        >
          <Menu size={24} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </header>

      <div className={`orbital-mobile-menu ${menuOpen ? "is-open" : ""}`} aria-hidden={!menuOpen}>
        <div className="orbital-mobile-menu-top">
          <span className="orbital-brand">HumHum<span>.</span></span>
          <button type="button" onClick={closeMenu} aria-label="Close navigation">
            <X size={26} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Mobile page sections">
          {NAV_ITEMS.map((item, index) => (
            <a
              href={item.href}
              key={item.href}
              onClick={closeMenu}
              style={{ transitionDelay: `${120 + index * 75}ms` }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <a className="orbital-mobile-github" href={GITHUB_URL} target="_blank" rel="noreferrer">
          GitHub <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      </div>

      <section className="orbital-hero" id="home">
        <div className="orbital-hero-media" aria-hidden="true">
          <img src="/mascots/humhum-jellyfish-poster.png" alt="" />
        </div>
        <div className="orbital-hero-scrim" aria-hidden="true" />

        <div className="orbital-shell orbital-hero-content">
          <p className="orbital-eyebrow"><Sparkles size={14} aria-hidden="true" /> Personal Agent hub</p>
          <h1>
            Beyond busy tools<br />
            into <em>your</em> own signal
          </h1>
          <p className="orbital-lede">
            HUMHUM learns from your local Agent activity, then gives you back the part that matters: a calmer way to work.
          </p>
          <div className="orbital-hero-actions">
            <a className="orbital-primary-link" href="#signal">Meet the signal <ArrowUpRight size={18} aria-hidden="true" /></a>
            <a className="orbital-text-link" href={GITHUB_URL} target="_blank" rel="noreferrer">View on GitHub</a>
          </div>
        </div>

        <div className="orbital-hero-mark" aria-hidden="true">
          <span>LOCAL</span><i /><span>PRIVATE</span><i /><span>WITH YOU</span>
        </div>
      </section>

      <section className="orbital-section orbital-signal" id="signal">
        <div className="orbital-shell orbital-signal-grid">
          <div className="orbital-section-heading">
            <span className="orbital-index">01 / SIGNAL</span>
            <h2>Hello.<br />I&apos;m <em>HumHum</em></h2>
          </div>
          <div className="orbital-intro-copy">
            <p>Not another dashboard. Not another Agent you need to configure before it can help.</p>
            <p>HumHum quietly sees the rhythm around your work and turns it into knowledge that feels like it already belongs to you.</p>
            <a className="orbital-arrow-link" href="#roles">Find your four signals <ArrowUpRight size={19} aria-hidden="true" /></a>
          </div>
        </div>
        <div className="orbital-shell orbital-signal-rail" aria-label="HumHum principles">
          <span>LOCAL CONTEXT</span><span>PERSONAL KNOWLEDGE</span><span>GENTLE CONTROL</span><span>AGENT AWARENESS</span>
        </div>
      </section>

      <RoleModelCarousel />

      <section className="orbital-join" id="join">
        <div className="orbital-join-image" aria-hidden="true"><img src="/mascots/humhum-family-cinematic-v1.png" alt="" /></div>
        <div className="orbital-join-shade" aria-hidden="true" />
        <div className="orbital-shell orbital-join-content">
          <p>Stay close</p>
          <h2>Let your Agents work around you.<br />Keep what&apos;s yours in view.</h2>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">Get HumHum <Github size={18} aria-hidden="true" /></a>
        </div>
      </section>
    </main>
  );
}
