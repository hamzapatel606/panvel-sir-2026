import type { Section } from "../services/api";
import ListIcon from "./ListIcon";

export default function SectionHero({
	section,
	title,
	description,
}: {
	section: Section;
	title: string;
	description: string;
}) {
	return (
		<div className={`section-hero section-hero-${section}`}>
			<span className="section-hero-icon" aria-hidden="true">
				<ListIcon section={section} />
			</span>
			<div className="section-hero-text">
				<span className="page-eyebrow">PANVEL SIR 2026 · AC 188</span>
				<h1>{title}</h1>
				<p>{description}</p>
			</div>
		</div>
	);
}
