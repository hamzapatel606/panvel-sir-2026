import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import ListIcon from "../components/ListIcon";
import { SECTION_LIST } from "../config/sections";

/** Text-mark logo (no official emblem): green rounded square with "SIR". */
function BrandMark({ small = false }: { small?: boolean }) {
	return (
		<span className={`brand-mark${small ? " brand-mark-small" : ""}`} aria-hidden="true">
			SIR
		</span>
	);
}

function PublicLayout() {
	const [navOpen, setNavOpen] = useState(false);
	// Tapping any menu link (or the logo) closes the phone menu.
	const closeNav = () => setNavOpen(false);

	return (
		<div className="app-shell">
			<header className="topbar">
				<div className="topbar-inner">
					<Link to="/" className="brand" aria-label="Panvel SIR 2026 home" onClick={closeNav}>
						<BrandMark />
						<span className="brand-text">
							<span className="brand-title">PANVEL SIR 2026</span>
							<span className="brand-subtitle">Voter List Search Portal</span>
						</span>
					</Link>

					<button
						type="button"
						className="nav-toggle"
						aria-label={navOpen ? "Close menu" : "Open menu"}
						aria-expanded={navOpen}
						aria-controls="site-navigation"
						onClick={() => setNavOpen((current) => !current)}
					>
						{navOpen ? (
							<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
							</svg>
						) : (
							<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
							</svg>
						)}
					</button>

					<nav
						id="site-navigation"
						className={`navigation${navOpen ? " navigation-open" : ""}`}
						aria-label="Main"
						onClick={closeNav}
					>
						<NavLink to="/" end className="nav-home">
							<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
								<path
									d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V20h3a1 1 0 0 0 1-1v-9"
									stroke="currentColor"
									strokeWidth="1.8"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							Home
						</NavLink>

						{SECTION_LIST.map((config) => (
							<NavLink key={config.key} to={config.path} className={`nav-${config.key}`}>
								<ListIcon section={config.key} />
								{config.shortLabel}
							</NavLink>
						))}
					</nav>
				</div>
			</header>

			<main className="main-content">
				<Outlet />
			</main>

			<footer className="footer">
				<div className="footer-inner">
					<div className="footer-brand">
						<BrandMark small />
						<span>
							<strong>PANVEL SIR 2026</strong>
							<span>Public Search Portal · Unofficial lookup tool</span>
						</span>
					</div>
					<span className="footer-locale">Maharashtra · Raigad · Panvel · AC 188</span>
					<Link to="/contact" className="footer-contact">
						Found an error or want your entry hidden? <strong>Contact us</strong>
					</Link>
					<a className="footer-credit" href="https://hamzapatel.co.in" target="_blank" rel="noopener">
						Developed by <strong>Hamza Patel</strong>
					</a>
				</div>
			</footer>
		</div>
	);
}

export default PublicLayout;
