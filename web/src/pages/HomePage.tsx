import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import EpicFinder from "../components/EpicFinder";
import ListIcon from "../components/ListIcon";
import StatsCards from "../components/StatsCards";
import { COVERAGE_TEXT, SECTION_KEYS, SECTION_LIST, type Section, type SectionConfig } from "../config/sections";
import { usePublishedSections } from "../hooks/usePublishedSections";
import { getPartsCached } from "../services/api";

const HOW_TO_STEPS = [
	{ title: "Select a list", description: "Choose Draft, Final Draft or ASDD." },
	{ title: "Choose a Part", description: "Optional: narrow results to your Part number." },
	{ title: "Search", description: "Enter your name, EPIC number or other details." },
	{ title: "View PDF", description: "Open the original page with your entry marked." },
];

function ListCardBody({
	config,
	comingSoon,
	partCount,
}: {
	config: SectionConfig;
	comingSoon: boolean;
	partCount: number | undefined;
}) {
	return (
		<>
			<span className="home-list-card-icon" aria-hidden="true">
				<ListIcon section={config.key} />
			</span>
			<h3>
				{config.title}
				{comingSoon && <span className="home-list-card-badge">Coming soon</span>}
			</h3>
			<p>{comingSoon ? config.unpublishedText : config.homeDescription}</p>
			<div className="home-list-card-foot">
				<span className="home-list-card-count">
					{comingSoon ? "Not published yet" : partCount !== undefined ? `${partCount} ${partCount === 1 ? "Part" : "Parts"} available` : "\u00a0"}
				</span>
				{!comingSoon && (
					<span className="home-list-card-arrow" aria-hidden="true">
						<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
				)}
			</div>
		</>
	);
}

export default function HomePage() {
	const [totalParts, setTotalParts] = useState<number | null>(null);
	const [totalRecords, setTotalRecords] = useState<number | null>(null);
	const published = usePublishedSections();
	const [partCounts, setPartCounts] = useState<Partial<Record<Section, number>>>({});

	// Same cached requests the nav already makes: no extra API calls.
	useEffect(() => {
		let cancelled = false;
		for (const key of SECTION_KEYS) {
			getPartsCached(key)
				.then((result) => {
					if (!cancelled) setPartCounts((current) => ({ ...current, [key]: result.parts.length }));
				})
				.catch(() => undefined);
		}
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		// Stats come from the Draft list; they are a nice-to-have, so failures stay blank.
		getPartsCached("draft")
			.then((result) => {
				if (cancelled) return;
				setTotalParts(result.parts.length);
				setTotalRecords(result.parts.reduce((sum, part) => sum + (part.record_count ?? 0), 0));
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, []);

	const stats = [
		{ icon: "parts" as const, label: "Draft Parts", value: totalParts !== null ? totalParts.toLocaleString() : "—" },
		{ icon: "records" as const, label: "Draft Records", value: totalRecords !== null ? totalRecords.toLocaleString("en-IN") : "—" },
		{ icon: "calendar" as const, label: "Election Year", value: "2026" },
		{ icon: "place" as const, label: "Panvel Constituency", value: "AC 188" },
	];

	return (
		<div className="home-page">
			<div className="home-hero">
				<span className="page-eyebrow">SPECIAL INTENSIVE REVISION 2026</span>
				<h1>Voter List Search Portal</h1>
				<p className="home-hero-locale">Maharashtra · Raigad · Panvel · Assembly Constituency 188</p>
				<p className="home-hero-copy">
					Search and access voter information from the Draft, Final Draft and ASDD lists for Panvel.
				</p>
				<p className="home-hero-coverage">{COVERAGE_TEXT}</p>
			</div>

			<EpicFinder />

			<div className="home-section-header">
				<h2>Select a List</h2>
				<p>Choose the voter information list you want to search.</p>
			</div>

			<div className="home-list-cards">
				{SECTION_LIST.map((config) => {
					// Until the status is known, show every card as a normal link.
					const comingSoon = published !== null && !published.includes(config.key);
					const className = `home-list-card home-list-card-${config.key}${comingSoon ? " is-coming-soon" : ""}`;

					return comingSoon ? (
						<div key={config.key} className={className} aria-disabled="true">
							<ListCardBody config={config} comingSoon partCount={partCounts[config.key]} />
						</div>
					) : (
						<Link key={config.key} to={config.path} className={className}>
							<ListCardBody config={config} comingSoon={false} partCount={partCounts[config.key]} />
						</Link>
					);
				})}
			</div>

			<StatsCards stats={stats} />

			<div className="home-section-header">
				<h2>How to Use</h2>
				<p>Four steps to find your voter record.</p>
			</div>

			<div className="how-to-steps">
				{HOW_TO_STEPS.map((step, index) => (
					<div className="how-to-step" key={step.title}>
						<span className="how-to-step-number">{index + 1}</span>
						<div>
							<h3>{step.title}</h3>
							<p>{step.description}</p>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
